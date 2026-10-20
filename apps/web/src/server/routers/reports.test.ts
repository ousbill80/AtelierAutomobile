import { randomBytes } from "node:crypto";
import ExcelJS from "exceljs";
import { computeSessionAbsoluteExpiry, fixedClock } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as exportReport } from "../../app/api/rapports/[slug]/route";
import { createContext } from "../context";
import { setReportsClock } from "../reports/context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

// M12 partie 2 (étape 6.1) — rapports et tableau de bord complet. Horloge figée au
// 18/10/2026 10:00 (Abidjan = UTC) : aucun test ne dépend de l'heure réelle.
const NOW = new Date("2026-10-18T10:00:00.000Z");
const at = (iso: string) => new Date(iso);
const callerFactory = createCallerFactory(appRouter);
const users: string[] = [];

async function member(
  organizationId: string,
  role: "OWNER" | "MANAGER" | "ACCOUNTANT" | "MECHANIC",
  siteIds: string[] = [],
  hourlyCost: number | null = null,
) {
  const user = await adminDb.user.create({
    data: { name: `Rapports ${role}`, email: `${randomBytes(5).toString("hex")}@example.com` },
  });
  users.push(user.id);
  const membership = await adminDb.membership.create({
    data: { organizationId, userId: user.id, role, siteIds, hourlyCost },
  });
  const token = randomBytes(32).toString("hex");
  await adminDb.session.create({
    data: {
      userId: user.id,
      token,
      expiresAt: computeSessionAbsoluteExpiry(NOW, false),
      activeOrganizationId: organizationId,
      isPinSession: false,
    },
  });
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}` },
  });
  const ctx = await createContext({ req, resHeaders: new Headers(), info: undefined as never });
  return { caller: callerFactory(ctx), membership, token };
}

/** Ligne de facture : HT net, TVA 18 % (montants signés tels que M08 les fige). */
function line(type: "LABOR" | "PART" | "FEE", ht: number, costAmount = 0, quantity = 1) {
  const vat = Math.round(ht * 0.18);
  return {
    type,
    description: type === "PART" ? "Plaquettes de frein" : type,
    quantity,
    unitPrice: Math.round(ht / quantity),
    vatRate: 18,
    lineSubtotal: ht,
    lineVat: vat,
    lineTotal: ht + vat,
    costAmount,
  };
}

describe("reports / dashboard (M12 partie 2)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let yop: { id: string };
  let coc: { id: string };
  let owner: Awaited<ReturnType<typeof member>>;
  let ownerB: Awaited<ReturnType<typeof member>>;
  let manager: Awaited<ReturnType<typeof member>>;
  let cocOnly: Awaited<ReturnType<typeof member>>;
  let inv1: { id: string };

  beforeAll(async () => {
    setReportsClock(fixedClock(NOW));
    orgA = await adminDb.organization.create({
      data: { name: "Garage Rapports A", ncc: "1234567A", onboardingCompletedAt: NOW },
    });
    orgB = await adminDb.organization.create({ data: { name: "Garage Rapports B" } });
    const hours = [["08:00", "18:00"]];
    yop = await adminDb.site.create({
      data: {
        organizationId: orgA.id,
        name: "Yopougon",
        code: `Y${randomBytes(2).toString("hex")}`,
        openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours },
      },
    });
    coc = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Cocody", code: `C${randomBytes(2).toString("hex")}` },
    });
    const siteB = await adminDb.site.create({
      data: { organizationId: orgB.id, name: "Site B", code: `B${randomBytes(2).toString("hex")}` },
    });
    await adminDb.bay.createMany({
      data: [
        { organizationId: orgA.id, siteId: yop.id, name: "Pont 1" },
        { organizationId: orgA.id, siteId: yop.id, name: "Pont 2" },
        { organizationId: orgA.id, siteId: yop.id, name: "Lavage", type: "WASH" },
      ],
    });
    owner = await member(orgA.id, "OWNER");
    ownerB = await member(orgB.id, "OWNER");
    manager = await member(orgA.id, "MANAGER");
    cocOnly = await member(orgA.id, "OWNER", [coc.id]);
    const mechanic = await member(orgA.id, "MECHANIC", [], 3_000);

    const sotra = await adminDb.customer.create({
      data: { organizationId: orgA.id, displayName: "SOTRA Logistique", type: "COMPANY" },
    });
    const kone = await adminDb.customer.create({
      data: { organizationId: orgA.id, displayName: "Koné Awa" },
    });
    const customerB = await adminDb.customer.create({
      data: { organizationId: orgB.id, displayName: "Client B" },
    });
    const vehicle = await adminDb.vehicle.create({
      data: {
        organizationId: orgA.id,
        customerId: sotra.id,
        plate: "1234AB01",
        make: "Toyota",
        model: "Hilux",
      },
    });
    const ro = await adminDb.repairOrder.create({
      data: {
        organizationId: orgA.id,
        siteId: yop.id,
        number: `OR-T-${randomBytes(3).toString("hex")}`,
        customerId: sotra.id,
        vehicleId: vehicle.id,
        status: "INVOICED",
        createdAt: at("2026-10-01T08:00:00Z"),
        invoicedAt: at("2026-10-01T16:00:00Z"),
      },
    });
    await adminDb.timeEntry.create({
      data: {
        organizationId: orgA.id,
        membershipId: mechanic.membership.id,
        repairOrderId: ro.id,
        startedAt: at("2026-10-01T09:00:00Z"),
        endedAt: at("2026-10-01T11:00:00Z"),
      },
    });

    const invoice = (data: Record<string, unknown>, lines: ReturnType<typeof line>[]) =>
      adminDb.invoice.create({
        data: {
          organizationId: orgA.id,
          siteId: yop.id,
          customerId: sotra.id,
          number: `FAC-T-${randomBytes(4).toString("hex")}`,
          status: "ISSUED",
          ...data,
          lines: { create: lines.map((l) => ({ ...l, organizationId: orgA.id })) },
        } as never,
      });
    // §12 : 3 factures 100 000 / 250 000 / 85 000 HT + avoir 35 000 → CA 400 000.
    inv1 = await invoice(
      {
        repairOrderId: ro.id,
        status: "PAID",
        issuedAt: at("2026-10-01T17:00:00Z"),
        dueDate: at("2026-10-01T00:00:00Z"),
        total: 118_000,
        amountPaid: 118_000,
        balance: 0,
      },
      [line("LABOR", 100_000)],
    );
    const inv2 = await invoice(
      {
        status: "OVERDUE",
        issuedAt: at("2026-10-02T10:00:00Z"),
        dueDate: at("2026-10-02T00:00:00Z"),
        total: 295_000,
        balance: 295_000,
      },
      [line("PART", 250_000, 150_000, 2)],
    );
    await invoice(
      {
        siteId: coc.id,
        customerId: kone.id,
        issuedAt: at("2026-10-10T10:00:00Z"),
        dueDate: at("2026-10-25T00:00:00Z"),
        total: 100_300,
        balance: 100_300,
      },
      [line("FEE", 85_000)],
    );
    await invoice(
      {
        type: "CREDIT_NOTE",
        creditedInvoiceId: inv2.id,
        issuedAt: at("2026-10-12T10:00:00Z"),
        total: -41_300,
        balance: 0,
      },
      [{ ...line("PART", -35_000, -21_000, -1) }],
    );
    // Exclus du CA : acompte, brouillon, facture annulée.
    await invoice({ type: "DEPOSIT", issuedAt: at("2026-10-03T10:00:00Z"), total: 59_000 }, [
      line("FEE", 50_000),
    ]);
    await invoice({ status: "DRAFT" }, [line("FEE", 70_000)]);
    await invoice({ status: "VOID", issuedAt: at("2026-10-04T10:00:00Z") }, [line("FEE", 60_000)]);

    // Encaissements : Wave 118 000 (YOP), espèces 100 000 (COC) ; remboursement 10 000 ;
    // reprise de solde importée et paiement annulé exclus.
    const pay = (data: Record<string, unknown>) =>
      adminDb.payment.create({
        data: {
          organizationId: orgA.id,
          siteId: yop.id,
          number: `REC-T-${randomBytes(4).toString("hex")}`,
          method: "WAVE",
          amount: 0,
          receivedAt: at("2026-10-05T09:00:00Z"),
          ...data,
        } as never,
      });
    const wave = await pay({ customerId: sotra.id, amount: 118_000 });
    await adminDb.paymentAllocation.create({
      data: { organizationId: orgA.id, paymentId: wave.id, invoiceId: inv1.id, amount: 118_000 },
    });
    await pay({
      siteId: coc.id,
      method: "CASH",
      amount: 100_000,
      receivedAt: at("2026-10-10T11:00:00Z"),
    });
    await pay({ method: "CASH", amount: 999_000, origin: "IMPORTED", reference: "OPENING" });
    await pay({ method: "CASH", amount: 777_000, voidedAt: at("2026-10-06T09:00:00Z") });
    await adminDb.refund.create({
      data: {
        organizationId: orgA.id,
        siteId: yop.id,
        customerId: sotra.id,
        method: "CASH",
        amount: 10_000,
        reason: "Trop-perçu",
        createdAt: at("2026-10-12T09:00:00Z"),
      },
    });

    // Organisation B : chiffres qui ne doivent jamais apparaître chez A.
    await adminDb.invoice.create({
      data: {
        organizationId: orgB.id,
        siteId: siteB.id,
        customerId: customerB.id,
        number: `FAC-B-${randomBytes(4).toString("hex")}`,
        status: "ISSUED",
        issuedAt: at("2026-10-08T10:00:00Z"),
        total: 1_178_820,
        balance: 1_178_820,
        lines: {
          create: [{ ...line("PART", 999_000, 500_000), organizationId: orgB.id }],
        },
      },
    });
  });

  afterAll(async () => {
    const orgIds = [orgA.id, orgB.id];
    const where = { where: { organizationId: { in: orgIds } } };
    await adminDb.paymentAllocation.deleteMany(where);
    await adminDb.refund.deleteMany(where);
    await adminDb.payment.deleteMany(where);
    await adminDb.invoiceLine.deleteMany(where);
    await adminDb.invoice.updateMany({ ...where, data: { creditedInvoiceId: null } });
    await adminDb.invoice.deleteMany(where);
    await adminDb.timeEntry.deleteMany(where);
    await adminDb.repairOrder.deleteMany(where);
    await adminDb.vehicle.deleteMany(where);
    await adminDb.customer.deleteMany(where);
    await adminDb.bay.deleteMany(where);
    await adminDb.auditLog.deleteMany(where);
    await adminDb.session.deleteMany({ where: { userId: { in: users } } });
    await adminDb.notification.deleteMany(where);
    await adminDb.membership.deleteMany(where);
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
    await adminDb.site.deleteMany(where);
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  it("Synthèse : CA HT 400 000 (avoir déduit, acompte exclu), encaissé, marge, panier moyen", async () => {
    const d = await owner.caller.dashboard.overview({ period: "month" });
    expect(d.mode).toBe("FULL");
    expect(d.sales?.revenueHt.value).toBe(400_000);
    expect(d.sales?.byNature).toEqual({
      labor: 100_000,
      parts: 215_000,
      subcontract: 0,
      fees: 85_000,
    });
    // 118 000 + 100 000 − 10 000 (remboursement) ; reprise OPENING et paiement annulé exclus.
    expect(d.sales?.collected.value).toBe(208_000);
    expect(d.sales?.collected.byMethod).toEqual({ WAVE: 118_000, CASH: 90_000 });
    expect(d.sales?.avgTicket).toBe(133_333);
    // Pièces (215 000 − 129 000) + MO (100 000 − 2 h × 3 000) + frais 85 000.
    expect(d.sales?.margins?.grossMargin).toBe(86_000 + 94_000 + 85_000);
    expect(d.sales?.revenueHt.variation).toEqual({ kind: "new" });
    expect(d.sales?.daily.find((x) => x.day === "2026-10-12")?.ht).toBe(-35_000);
  });

  it("filtre site : Cocody seul ; membre restreint jamais sur un autre site", async () => {
    const d = await owner.caller.dashboard.overview({ period: "month", siteId: coc.id });
    expect(d.sales?.revenueHt.value).toBe(85_000);
    expect(d.sales?.collected.value).toBe(100_000);
    const restricted = await cocOnly.caller.dashboard.overview({ period: "month" });
    expect(restricted.sales?.revenueHt.value).toBe(85_000);
    await expect(
      cocOnly.caller.dashboard.overview({ period: "month", siteId: yop.id }),
    ).rejects.toThrow("Vous n'avez pas accès à ce site.");
  });

  it("isolation multi-locataire : l'organisation B ne voit rien de A et inversement", async () => {
    const b = await ownerB.caller.reports.preview({
      slug: "ventes",
      filters: { from: "2026-10-01", to: "2026-10-31" },
    });
    expect(b.totals.ht).toBe(999_000);
    expect(b.count).toBe(1);
    const a = await owner.caller.reports.preview({
      slug: "ventes",
      filters: { from: "2026-10-01", to: "2026-10-31" },
    });
    expect(a.totals.ht).toBe(400_000);
    // Un site d'une autre organisation ne renvoie rien (filtre organisation + RLS).
    const foreign = await ownerB.caller.reports.preview({
      slug: "ventes",
      filters: { siteId: yop.id },
    });
    expect([foreign.count, foreign.totals.ht]).toEqual([0, 0]);
  });

  it("rapport Ventes : mêmes totaux que la carte CA, regroupement par client", async () => {
    const r = await owner.caller.reports.preview({
      slug: "ventes",
      filters: { from: "2026-10-01", to: "2026-10-31" },
    });
    expect(r.count).toBe(4);
    expect(r.totals).toMatchObject({ ht: 400_000, labor: 100_000, parts: 215_000, fees: 85_000 });
    expect(r.rows.map((x) => x.date)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-10",
      "2026-10-12",
    ]);
    expect(String(r.rows[3]!.number)).toMatch(/\(Avoir\)$/);
    const byCustomer = await owner.caller.reports.preview({
      slug: "ventes",
      filters: { from: "2026-10-01", to: "2026-10-31", groupBy: "customer" },
    });
    expect(byCustomer.rows.map((x) => [x.customer, x.ht])).toEqual([
      ["SOTRA Logistique", 315_000],
      ["Koné Awa", 85_000],
    ]);
  });

  it("encaissements : remboursement en négatif, total = carte Encaissé", async () => {
    const r = await owner.caller.reports.preview({
      slug: "encaissements",
      filters: { from: "2026-10-01", to: "2026-10-31" },
    });
    expect(r.totals.amount).toBe(208_000);
    expect(r.count).toBe(3);
    expect(r.rows.find((x) => x.amount === 118_000)?.invoices).toMatch(/^FAC-T-/);
    expect(r.rows.find((x) => x.amount === -10_000)?.number).toBe("Remboursement");
  });

  it("balance âgée : à aujourd'hui = soldes ; à une date passée = solde reconstitué", async () => {
    const today = await owner.caller.reports.preview({ slug: "balance-agee", filters: {} });
    expect(today.totals.balance).toBe(295_000 + 100_300);
    expect(today.period.asOf).toBe("2026-10-18");
    const past = await owner.caller.reports.preview({
      slug: "balance-agee",
      filters: { asOf: "2026-10-03" },
    });
    // Au 03/10 : FAC 1 non encore payée (paiement le 05/10), FAC 2 émise ; FAC 3 pas encore émise.
    expect(past.rows.map((x) => x.balance).sort()).toEqual([118_000, 295_000]);
    expect(past.rows.find((x) => x.balance === 118_000)).toMatchObject({
      daysLate: 2,
      bucket: "1 à 30 j",
    });
  });

  it("rentabilité par OR : coût MO pointé, marge et heures", async () => {
    const r = await owner.caller.reports.preview({
      slug: "rentabilite-or",
      filters: { from: "2026-10-01", to: "2026-10-31" },
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      laborHt: 100_000,
      laborCost: 6_000,
      margin: 94_000,
      workedHours: 2,
    });
  });

  it("permissions : MANAGER sans report:financial — ventes refusées, top pièces sans marge", async () => {
    await expect(manager.caller.reports.preview({ slug: "ventes", filters: {} })).rejects.toThrow(
      "Permission manquante : report:financial",
    );
    const top = await manager.caller.reports.preview({
      slug: "top-pieces",
      filters: { from: "2026-10-01", to: "2026-10-31" },
    });
    expect(top.columns.map((c) => c.key)).not.toContain("margin");
    expect(top.rows[0]).not.toHaveProperty("margin");
    expect(top.rows[0]).toMatchObject({ label: "Plaquettes de frein", quantity: 1, ht: 215_000 });
    const catalog = await manager.caller.reports.catalog();
    expect(catalog.reports.map((x) => x.slug)).toEqual([
      "relances",
      "productivite",
      "clients",
      "top-pieces",
    ]);
    expect(catalog.compareSites).toBe(false);
    await expect(manager.caller.reports.compareSites({})).rejects.toThrow();
  });

  it("comparaison des sites : ligne Réseau = somme, meilleur site par indicateur", async () => {
    const c = await owner.caller.reports.compareSites({ period: "month" });
    expect(c.sites.map((s) => s.name).sort()).toEqual(["Cocody", "Yopougon"]);
    expect(c.network.revenueHt).toBe(400_000);
    expect(c.best.revenueHt).toBe(yop.id);
    expect(c.sites.find((s) => s.siteId === coc.id)?.values.occupancy).toBeNull();
    // Membre restreint : Réseau = ses sites seulement.
    const restricted = await cocOnly.caller.reports.compareSites({ period: "month" });
    expect(restricted.sites.map((s) => s.siteId)).toEqual([coc.id]);
    expect(restricted.network.revenueHt).toBe(85_000);
  });

  it("onglet Clients : actifs / nouveaux ; Atelier : occupation et retards", async () => {
    const customers = await owner.caller.dashboard.customers({ period: "month" });
    expect(customers.counts).toEqual({ active: 2, new: 2, lost: 0 });
    expect(customers.topParts[0]).toMatchObject({ label: "Plaquettes de frein", margin: 86_000 });
    const workshop = await owner.caller.dashboard.workshop({ period: "month" });
    expect(workshop.late.count).toBe(0);
    expect(workshop.sitesWithoutHours).toEqual(["Cocody"]);
  });

  it("export Excel : fichier nommé selon §7, totaux identiques à l'écran, export journalisé", async () => {
    const req = new Request(
      "http://localhost/api/rapports/ventes?format=xlsx&from=2026-10-01&to=2026-10-31",
      { headers: { cookie: `atelieros_session=${owner.token}` } },
    );
    const res = await exportReport(req, { params: Promise.resolve({ slug: "ventes" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain(
      'filename="ventes_2026-10-01_2026-10-31_reseau.xlsx"',
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await res.arrayBuffer()) as never);
    expect(workbook.worksheets.map((w) => w.name)).toEqual(["Données", "Synthèse", "Paramètres"]);
    const data = workbook.getWorksheet("Données")!;
    const totalRow = data.getRow(data.rowCount);
    expect(totalRow.getCell(1).value).toBe("Total");
    expect(totalRow.getCell(10).value).toBe(400_000);
    expect(data.getColumn(10).numFmt).toBe('# ##0 "FCFA"');
    const audit = await adminDb.auditLog.findFirst({
      where: { organizationId: orgA.id, action: "report.export" },
    });
    expect(audit?.entityId).toBe("ventes");

    const pdf = await exportReport(
      new Request("http://localhost/api/rapports/balance-agee?format=pdf", {
        headers: { cookie: `atelieros_session=${owner.token}` },
      }),
      { params: Promise.resolve({ slug: "balance-agee" }) },
    );
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    const forbidden = await exportReport(
      new Request("http://localhost/api/rapports/ventes?format=csv", {
        headers: { cookie: `atelieros_session=${manager.token}` },
      }),
      { params: Promise.resolve({ slug: "ventes" }) },
    );
    expect(forbidden.status).toBe(403);
  });
});
