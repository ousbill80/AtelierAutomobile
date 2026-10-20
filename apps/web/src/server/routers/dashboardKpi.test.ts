import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry, fixedClock, KPI_CODES } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { kpiCodeSchema } from "@atelieros/validators";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { setReportsClock } from "../reports/context";
import { systemClock } from "@atelieros/core";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

// M12 §8 `dashboard.kpi` (utilisé par l'assistant M17) : mêmes chiffres que l'onglet Synthèse,
// permission par indicateur (marges sous report:financial), filtre site, isolation.

const callerFactory = createCallerFactory(appRouter);
const NOW = new Date("2026-10-15T12:00:00Z");

type Role = "OWNER" | "MANAGER" | "ADVISOR" | "MECHANIC" | "ACCOUNTANT";

describe("dashboard.kpi (M12 §8, M17 get_kpi)", () => {
  const orgIds: string[] = [];
  const userIds: string[] = [];
  const callers: Record<string, ReturnType<typeof callerFactory>> = {};
  let siteA1: { id: string };
  let siteA2: { id: string };

  async function member(key: string, organizationId: string, role: Role, siteIds: string[] = []) {
    const user = await adminDb.user.create({
      data: { name: key, email: `kpi-${randomBytes(4).toString("hex")}@example.com` },
    });
    userIds.push(user.id);
    await adminDb.membership.create({ data: { organizationId, userId: user.id, role, siteIds } });
    const token = randomBytes(32).toString("hex");
    await adminDb.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt: computeSessionAbsoluteExpiry(new Date(), false),
        activeOrganizationId: organizationId,
        isPinSession: false,
      },
    });
    const req = new Request("http://localhost/api/trpc", {
      headers: { cookie: `atelieros_session=${token}` },
    });
    callers[key] = callerFactory(
      await createContext({ req, resHeaders: new Headers(), info: undefined as never }),
    );
  }

  async function invoice(
    organizationId: string,
    siteId: string,
    customerId: string,
    issuedAt: string,
    lines: { type: "LABOR" | "PART"; ht: number; cost: number }[],
  ) {
    const ht = lines.reduce((s, l) => s + l.ht, 0);
    const created = await adminDb.invoice.create({
      data: {
        organizationId,
        siteId,
        customerId,
        number: `FAC-K-${randomBytes(3).toString("hex")}`,
        status: "PAID",
        issuedAt: new Date(issuedAt),
        dueDate: new Date(issuedAt),
        subtotal: ht,
        vatTotal: Math.round(ht * 0.18),
        total: Math.round(ht * 1.18),
        balance: 0,
      },
    });
    for (const l of lines) {
      await adminDb.invoiceLine.create({
        data: {
          organizationId,
          invoiceId: created.id,
          type: l.type,
          description: l.type,
          quantity: 1,
          unitPrice: l.ht,
          vatRate: 18,
          lineSubtotal: l.ht,
          lineVat: Math.round(l.ht * 0.18),
          lineTotal: Math.round(l.ht * 1.18),
          costAmount: l.cost,
        },
      });
    }
  }

  beforeAll(async () => {
    setReportsClock(fixedClock(NOW));
    const orgA = await adminDb.organization.create({
      // PRO : l'assistant n'est pas inclus dans l'offre STARTER (RG-M17-07).
      data: { name: "Garage KPI A", onboardingCompletedAt: new Date(), plan: "PRO" },
    });
    const orgB = await adminDb.organization.create({
      data: { name: "Garage KPI B", onboardingCompletedAt: new Date() },
    });
    orgIds.push(orgA.id, orgB.id);
    siteA1 = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "YOP", code: "YOP" },
    });
    siteA2 = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "COC", code: "COC" },
    });
    const siteB = await adminDb.site.create({
      data: { organizationId: orgB.id, name: "B", code: "BBB" },
    });
    const custA = await adminDb.customer.create({
      data: { organizationId: orgA.id, displayName: "A" },
    });
    const custB = await adminDb.customer.create({
      data: { organizationId: orgB.id, displayName: "B" },
    });
    // Octobre : 100 000 (MO) + 250 000 (pièces, coût 150 000) sur YOP, 85 000 MO sur COC.
    await invoice(orgA.id, siteA1.id, custA.id, "2026-10-03T10:00:00Z", [
      { type: "LABOR", ht: 100_000, cost: 0 },
    ]);
    await invoice(orgA.id, siteA1.id, custA.id, "2026-10-05T10:00:00Z", [
      { type: "PART", ht: 250_000, cost: 150_000 },
    ]);
    await invoice(orgA.id, siteA2.id, custA.id, "2026-10-08T10:00:00Z", [
      { type: "LABOR", ht: 85_000, cost: 0 },
    ]);
    // Septembre (période précédente) : 200 000.
    await invoice(orgA.id, siteA1.id, custA.id, "2026-09-10T10:00:00Z", [
      { type: "LABOR", ht: 200_000, cost: 0 },
    ]);
    // Organisation B : jamais comptée pour A.
    await invoice(orgB.id, siteB.id, custB.id, "2026-10-04T10:00:00Z", [
      { type: "LABOR", ht: 999_000, cost: 0 },
    ]);

    await member("owner", orgA.id, "OWNER");
    await member("manager", orgA.id, "MANAGER");
    await member("accountant", orgA.id, "ACCOUNTANT");
    await member("advisor", orgA.id, "ADVISOR");
    await member("mechanic", orgA.id, "MECHANIC");
    await member("accountantCoc", orgA.id, "ACCOUNTANT", [siteA2.id]);
    await member("ownerB", orgB.id, "OWNER");
  });

  afterAll(async () => {
    setReportsClock(systemClock);
    const where = { organizationId: { in: orgIds } };
    await adminDb.invoiceLine.deleteMany({ where });
    await adminDb.invoice.deleteMany({ where });
    await adminDb.customer.deleteMany({ where });
    await adminDb.site.deleteMany({ where });
    await adminDb.session.deleteMany({ where: { userId: { in: userIds } } });
    await adminDb.notification.deleteMany({ where });
    await adminDb.membership.deleteMany({ where });
    await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
    await adminDb.domainEvent.deleteMany({ where });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  it("codes alignés entre core et validators", () => {
    expect([...kpiCodeSchema.options]).toEqual([...KPI_CODES]);
  });

  it("CA HT : même valeur que l'onglet Synthèse, avec comparaison", async () => {
    const kpi = await callers.owner!.dashboard.kpi({ metric: "revenue_ht", compare: true });
    expect(kpi).toMatchObject({
      metric: "revenue_ht",
      value: 435_000,
      previous: 200_000,
      delta: { kind: "pct", pct: 118 },
    });
    const overview = await callers.owner!.dashboard.overview({ period: "month" });
    expect(overview.sales?.revenueHt.value).toBe(kpi.value);
  });

  it("panier moyen et marge pièces (report:financial)", async () => {
    expect(await callers.accountant!.dashboard.kpi({ metric: "avg_ticket" })).toMatchObject({
      value: 145_000,
      numerator: 435_000,
      denominator: 3,
    });
    expect(await callers.accountant!.dashboard.kpi({ metric: "parts_margin" })).toMatchObject({
      value: 100_000,
      denominator: 250_000,
    });
  });

  it("M12 §10 — marges refusées sans report:financial ; mécanicien refusé", async () => {
    // L'OWNER a toutes les permissions (M01) : il voit les marges.
    // Marge pièces 100 000 + MO 185 000 (aucune heure pointée : coût MO nul).
    expect((await callers.owner!.dashboard.kpi({ metric: "gross_margin" })).value).toBe(285_000);
    for (const key of ["manager", "advisor"]) {
      const error = await callers[key]!.dashboard.kpi({ metric: "gross_margin" }).catch(
        (e: unknown) => e,
      );
      expect(error, key).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("FORBIDDEN");
    }
    await expect(callers.advisor!.dashboard.kpi({ metric: "revenue_ht" })).rejects.toThrow(
      /pas accès/,
    );
    await expect(callers.mechanic!.dashboard.kpi({ metric: "revenue_ht" })).rejects.toThrow(
      /mécaniciens/,
    );
    expect((await callers.manager!.dashboard.kpi({ metric: "quote_acceptance" })).value).toBeNull();
  });

  it("RG-M12-02 — filtre site intersecté avec Membership.siteIds", async () => {
    expect((await callers.accountantCoc!.dashboard.kpi({ metric: "revenue_ht" })).value).toBe(
      85_000,
    );
    await expect(
      callers.accountantCoc!.dashboard.kpi({ metric: "revenue_ht", siteId: siteA1.id }),
    ).rejects.toThrow(/accès à ce site/);
    expect(
      (await callers.owner!.dashboard.kpi({ metric: "revenue_ht", siteId: siteA1.id })).value,
    ).toBe(350_000);
  });

  it("isolation : l'organisation B ne voit que ses factures", async () => {
    expect((await callers.ownerB!.dashboard.kpi({ metric: "revenue_ht" })).value).toBe(999_000);
    // Un site d'une autre organisation ne renvoie rien (RLS) : aucune donnée de A.
    expect(
      (await callers.ownerB!.dashboard.kpi({ metric: "revenue_ht", siteId: siteA1.id })).value,
    ).toBe(0);
  });

  it("assistant get_kpi : mêmes chiffres, marges refusées au chef d'atelier", async () => {
    const answer = await callers.owner!.ai.assistant.ask({ question: "quel est mon CA ce mois ?" });
    expect(answer.text).toBe("Chiffre d'affaires HT facturé (mois en cours) : 435 000 FCFA.");
    const margin = await callers.manager!.ai.assistant.ask({
      question: "quelle est ma marge ce mois ?",
    });
    expect(margin.text).toBe("Vous n'avez pas accès à cette information.");
    const accountant = await callers.accountant!.ai.assistant.ask({
      question: "marge des pièces ce mois ?",
    });
    expect(accountant.text).toBe("Marge pièces (mois en cours) : 100 000 FCFA.");
  });
});
