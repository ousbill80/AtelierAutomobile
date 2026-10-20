import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry, fixedClock } from "@atelieros/core";
import { adminDb, alertUncertifiedFne, certifyInvoiceFne, dueFneInvoiceIds } from "@atelieros/db";
import { FakeFneProvider } from "@atelieros/integrations";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueFneCertifyJob } from "../billing/fneQueue";
import { setFneProviderResolver } from "../billing/fneProvider";
import { createContext } from "../context";
import { setReceivablesClock } from "../receivables/helpers";
import { setRepairOrdersClock } from "../repairOrders/helpers";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

vi.mock("../messaging/queue", () => ({ enqueueMessageSendJob: vi.fn(async () => undefined) }));
vi.mock("../billing/fneQueue", () => ({ enqueueFneCertifyJob: vi.fn(async () => undefined) }));

const callerFactory = createCallerFactory(appRouter);
type Caller = ReturnType<typeof callerFactory>;

// Horloge figée (jamais l'heure réelle) : 19/10/2026 10:00 à Abidjan (UTC+0).
const NOW = new Date("2026-10-19T10:00:00.000Z");
const MIN = 60_000;
const at = (minutes: number) => new Date(NOW.getTime() + minutes * MIN);
const SECRET = `sk_live_${randomBytes(8).toString("hex")}`;

const users: string[] = [];

async function member(organizationId: string, role: "OWNER" | "ADVISOR" | "ACCOUNTANT") {
  const user = await adminDb.user.create({
    data: {
      name: `${role} ${randomBytes(2).toString("hex")}`,
      email: `${randomBytes(5).toString("hex")}@example.com`,
    },
  });
  users.push(user.id);
  await adminDb.membership.create({
    data: { organizationId, userId: user.id, role, siteIds: [] },
  });
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
    headers: { cookie: `atelieros_session=${token}`, "x-forwarded-for": "41.202.10.77" },
  });
  return callerFactory(
    await createContext({ req, resHeaders: new Headers(), info: undefined as never }),
  );
}

const IDENTITY = {
  legalName: "Garage FNE SARL",
  rccm: "CI-ABJ-2019-B-12345",
  ncc: "1912345A",
  address: "Yopougon, Abidjan",
  phone: "+2252722000000",
  taxRegime: "RNI" as const,
};

describe("M08 §FNE — configuration, certification, reprises, saisie manuelle", () => {
  const orgIds: string[] = [];
  let orgA: { id: string };
  let orgB: { id: string };
  let owner: Caller;
  let advisor: Caller;
  let accountant: Caller;
  let ownerB: Caller;
  let customerId: string;
  let provider: FakeFneProvider;

  beforeAll(async () => {
    setReceivablesClock(fixedClock(NOW));
    setRepairOrdersClock(fixedClock(NOW));
    orgA = await adminDb.organization.create({
      data: { name: "Garage FNE A", onboardingCompletedAt: NOW, ...IDENTITY },
    });
    orgB = await adminDb.organization.create({
      data: { name: "Garage FNE B", onboardingCompletedAt: NOW, ...IDENTITY },
    });
    orgIds.push(orgA.id, orgB.id);
    await adminDb.site.create({ data: { organizationId: orgA.id, name: "Yopougon", code: "YOP" } });
    await adminDb.site.create({ data: { organizationId: orgB.id, name: "Cocody", code: "COC" } });
    owner = await member(orgA.id, "OWNER");
    advisor = await member(orgA.id, "ADVISOR");
    accountant = await member(orgA.id, "ACCOUNTANT");
    ownerB = await member(orgB.id, "OWNER");
    const customer = await adminDb.customer.create({
      data: {
        organizationId: orgA.id,
        displayName: "Kouassi Jean-Marc",
        phone: "+2250707070707",
        paymentTermsDays: 60,
      },
    });
    customerId = customer.id;
    await adminDb.customer.create({
      data: { organizationId: orgB.id, displayName: "Client B", paymentTermsDays: 60 },
    });
  });

  beforeEach(() => {
    provider = new FakeFneProvider();
    setFneProviderResolver(async () => provider);
    vi.mocked(enqueueFneCertifyJob).mockClear();
  });

  afterAll(async () => {
    setFneProviderResolver(null);
    const where = { organizationId: { in: orgIds } };
    await adminDb.attachment.deleteMany({ where });
    await adminDb.paymentAllocation.deleteMany({ where });
    await adminDb.customerCredit.deleteMany({ where });
    await adminDb.payment.deleteMany({ where });
    await adminDb.reminder.deleteMany({ where });
    await adminDb.invoiceLine.deleteMany({ where });
    await adminDb.invoice.deleteMany({ where: { ...where, creditedInvoiceId: { not: null } } });
    await adminDb.invoice.deleteMany({ where });
    await adminDb.collectionCase.deleteMany({ where });
    await adminDb.fneConfig.deleteMany({ where });
    await adminDb.documentSequence.deleteMany({ where });
    await adminDb.notification.deleteMany({ where });
    await adminDb.domainEvent.deleteMany({ where });
    await adminDb.auditLog.deleteMany({ where });
    await adminDb.customer.deleteMany({ where });
    await adminDb.session.deleteMany({ where: { userId: { in: users } } });
    await adminDb.membership.deleteMany({ where });
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
    await adminDb.site.deleteMany({ where });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  async function issueInvoice(amount = 20_000) {
    const draft = await advisor.invoice.createDirect({
      customerId,
      lines: [{ type: "LABOR", description: "Diagnostic", quantity: 1, unitPrice: amount }],
    });
    return advisor.invoice.issue({ id: draft.id });
  }

  it("mode manuel (défaut) : PENDING sans tentative automatique, saisie du numéro et du QR → MANUAL", async () => {
    const issued = await issueInvoice();
    expect(issued).toMatchObject({ fneStatus: "PENDING", fneNextRetryAt: null, fneAttempts: 0 });
    expect(enqueueFneCertifyJob).not.toHaveBeenCalled();
    await expect(owner.fne.retry({ invoiceId: issued.id })).rejects.toThrow(/mode FNE « API »/);
    await expect(
      advisor.fne.setManual({ invoiceId: issued.id, fneNumber: "FNE-1", qrCode: "q" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      accountant.fne.setManual({ invoiceId: issued.id, fneNumber: "FNE-2026-000001" }),
    ).rejects.toThrow(/QR code/);

    const manual = await accountant.fne.setManual({
      invoiceId: issued.id,
      fneNumber: " FNE-2026-000001 ",
      qrCode: "https://fne.dgi.gouv.ci/verification/FNE-2026-000001",
    });
    expect(manual).toMatchObject({
      fneStatus: "MANUAL",
      fneNumber: "FNE-2026-000001",
      fneCertifiedAt: NOW,
    });
    await expect(
      accountant.fne.setManual({ invoiceId: issued.id, fneNumber: "FNE-X", qrCode: "q" }),
    ).rejects.toThrow(/déjà certifiée/);
    const audit = await adminDb.auditLog.findFirst({
      where: { organizationId: orgA.id, action: "invoice.fne_manual", entityId: issued.id },
    });
    expect(audit?.after).toMatchObject({ fneStatus: "MANUAL", fneNumber: "FNE-2026-000001" });
    const list = await owner.invoice.list({ view: "fne_pending" });
    expect(list.items.map((i) => i.id)).not.toContain(issued.id);
  });

  it("saisie manuelle avec image du QR : pièce jointe `fne_qr` rattachée à la facture", async () => {
    const issued = await issueInvoice();
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const manual = await owner.fne.setManual({
      invoiceId: issued.id,
      fneNumber: "FNE-2026-000002",
      qrImage: png,
    });
    expect(manual.fneQrCode).toMatch(/^attachment:/);
    const attachment = await adminDb.attachment.findFirst({
      where: { organizationId: orgA.id, entity: "invoice", entityId: issued.id },
    });
    expect(attachment).toMatchObject({ kind: "fne_qr", mimeType: "image/png" });
  });

  it("paramètres : secrets chiffrés, jamais renvoyés ni audités en clair ; permissions et motif", async () => {
    await expect(accountant.fne.getConfig()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.fne.updateConfig({ mode: "api", provider: "dgi_api" })).rejects.toThrow(
      /identifiants DGI/,
    );
    await owner.fne.updateConfig({
      mode: "api",
      provider: "dgi_api",
      establishmentId: "ETB-01",
      pointOfSale: "PDV-01",
      credentials: { baseUrl: "https://fne.example.test", apiKey: SECRET },
    });
    const stored = await adminDb.fneConfig.findUniqueOrThrow({
      where: { organizationId: orgA.id },
    });
    expect(stored.credentials).toBeTruthy();
    expect(stored.credentials).not.toContain(SECRET);
    const config = await owner.fne.getConfig();
    expect(config).toMatchObject({ mode: "api", provider: "dgi_api", hasCredentials: true });
    expect(JSON.stringify(config)).not.toContain(SECRET);
    expect(JSON.stringify(config)).not.toContain(stored.credentials!);
    const audits = await adminDb.auditLog.findMany({
      where: { organizationId: orgA.id, action: "fne_config.updated" },
    });
    expect(JSON.stringify(audits)).not.toContain(SECRET);
    expect(audits[0]!.after).toMatchObject({ credentials: "[secret modifié]" });

    await expect(owner.fne.updateConfig({ mode: "disabled" })).rejects.toThrow(/arrêté n°0337/);
    // Simulateur pour la suite (aucun compte DGI requis) ; identifiants conservés.
    await owner.fne.updateConfig({ mode: "api", provider: "fake" });
    expect((await owner.fne.test()).ok).toBe(true);
    expect((await owner.fne.getConfig()).lastTestOk).toBe(true);
  });

  it("mode API : PENDING à l'émission, job demandé, échec ×2 puis certifié (backoff 10 min, 30 min)", async () => {
    provider = new FakeFneProvider({ failTimes: 2 });
    const issued = await issueInvoice(30_000);
    expect(issued).toMatchObject({ fneStatus: "PENDING", fneNextRetryAt: NOW });
    expect(enqueueFneCertifyJob).toHaveBeenCalledWith(orgA.id, issued.id, 0);
    const resolveProvider = async () => provider;

    // Job fne.certify (worker) : première tentative.
    expect(
      await certifyInvoiceFne({
        organizationId: orgA.id,
        invoiceId: issued.id,
        now: NOW,
        resolveProvider,
      }),
    ).toMatchObject({ outcome: "failed", kind: "transient" });
    let row = await adminDb.invoice.findUniqueOrThrow({ where: { id: issued.id } });
    expect(row).toMatchObject({ fneStatus: "FAILED", fneAttempts: 1, fneNextRetryAt: at(10) });
    expect(row.fneError).toMatch(/nouvelle tentative automatique/);

    // fne.retry : rien avant l'échéance, puis 2e échec (+30 min), puis succès.
    expect(await dueFneInvoiceIds(orgA.id, at(5))).not.toContain(issued.id);
    expect(await dueFneInvoiceIds(orgA.id, at(10))).toContain(issued.id);
    await certifyInvoiceFne({
      organizationId: orgA.id,
      invoiceId: issued.id,
      now: at(10),
      resolveProvider,
    });
    row = await adminDb.invoice.findUniqueOrThrow({ where: { id: issued.id } });
    expect(row).toMatchObject({ fneStatus: "FAILED", fneAttempts: 2, fneNextRetryAt: at(40) });
    expect(
      await certifyInvoiceFne({
        organizationId: orgA.id,
        invoiceId: issued.id,
        now: at(40),
        resolveProvider,
      }),
    ).toEqual({ outcome: "certified", fneNumber: `SIM-${issued.number}` });
    row = await adminDb.invoice.findUniqueOrThrow({ where: { id: issued.id } });
    expect(row).toMatchObject({
      fneStatus: "CERTIFIED",
      fneNumber: `SIM-${issued.number}`,
      fneAttempts: 3,
      fneNextRetryAt: null,
      fneError: null,
    });
    expect(row.fneQrCode).toContain("SIM-");
    expect(provider.calls).toBe(3);
    expect(
      await adminDb.domainEvent.count({
        where: {
          organizationId: orgA.id,
          type: "invoice.fne_failed",
          payload: { path: ["invoiceId"], equals: issued.id },
        },
      }),
    ).toBe(2);
    // Final : une nouvelle tentative ne rappelle pas l'adaptateur.
    expect(
      await certifyInvoiceFne({
        organizationId: orgA.id,
        invoiceId: issued.id,
        now: at(50),
        resolveProvider,
      }),
    ).toMatchObject({ outcome: "skipped" });
    expect(provider.calls).toBe(3);
  });

  it("idempotence : deux tentatives simultanées → un seul appel à l'adaptateur", async () => {
    const issued = await issueInvoice();
    const resolveProvider = async () => provider;
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        certifyInvoiceFne({
          organizationId: orgA.id,
          invoiceId: issued.id,
          now: NOW,
          resolveProvider,
        }),
      ),
    );
    expect(results.filter((r) => r.outcome === "certified")).toHaveLength(1);
    expect(provider.calls).toBe(1);
  });

  it("rejet DGI : pas de reprise automatique, « Réessayer » relance une tentative", async () => {
    provider = new FakeFneProvider({ rejectWith: "NCC client invalide" });
    const issued = await issueInvoice();
    await owner.fne.retry({ invoiceId: issued.id });
    let row = await adminDb.invoice.findUniqueOrThrow({ where: { id: issued.id } });
    expect(row).toMatchObject({
      fneStatus: "FAILED",
      fneErrorKind: "rejected",
      fneError: "Rejet de la DGI : NCC client invalide",
      fneNextRetryAt: null,
    });
    expect(await dueFneInvoiceIds(orgA.id, at(24 * 60))).not.toContain(issued.id);
    const detail = await accountant.invoice.get({ id: issued.id });
    expect(detail.fneMode).toBe("api");

    provider = new FakeFneProvider();
    const res = await accountant.fne.retry({ invoiceId: issued.id });
    expect(res.result.outcome).toBe("certified");
    row = await adminDb.invoice.findUniqueOrThrow({ where: { id: issued.id } });
    expect(row.fneStatus).toBe("CERTIFIED");
    expect(
      await adminDb.auditLog.count({
        where: { organizationId: orgA.id, action: "invoice.fne_retry", entityId: issued.id },
      }),
    ).toBe(2);
  });

  it("avoir : soumis à la FNE après la certification de la facture d'origine (RG-M08-12)", async () => {
    const issued = await issueInvoice(40_000);
    const { creditNote } = await owner.invoice.createCreditNote({
      invoiceId: issued.id,
      lines: "FULL",
      reason: "Erreur sur le client",
    });
    expect(creditNote).toMatchObject({
      type: "CREDIT_NOTE",
      fneStatus: "PENDING",
      fneNextRetryAt: NOW,
    });
    expect(enqueueFneCertifyJob).toHaveBeenCalledWith(orgA.id, creditNote.id, 0);
    const resolveProvider = async () => provider;
    expect(
      await certifyInvoiceFne({
        organizationId: orgA.id,
        invoiceId: creditNote.id,
        now: NOW,
        resolveProvider,
      }),
    ).toMatchObject({ outcome: "deferred" });
    let row = await adminDb.invoice.findUniqueOrThrow({ where: { id: creditNote.id } });
    expect(row).toMatchObject({ fneStatus: "PENDING", fneAttempts: 0, fneNextRetryAt: at(10) });

    await certifyInvoiceFne({
      organizationId: orgA.id,
      invoiceId: issued.id,
      now: NOW,
      resolveProvider,
    });
    expect(
      await certifyInvoiceFne({
        organizationId: orgA.id,
        invoiceId: creditNote.id,
        now: at(10),
        resolveProvider,
      }),
    ).toMatchObject({ outcome: "certified" });
    row = await adminDb.invoice.findUniqueOrThrow({ where: { id: creditNote.id } });
    expect(row.fneNumber).toBe(`SIM-${creditNote.number}`);
    // 40 000 HT + TVA 18 % : montants transmis en valeur absolue.
    expect(row.fneRaw).toMatchObject({ documentType: "CREDIT_NOTE", total: 47_200 });
  });

  it("signalement : non certifiée depuis plus d'1 h → OWNER et ACCOUNTANT notifiés une fois", async () => {
    const issued = await issueInvoice();
    const before = await adminDb.notification.count({
      where: { organizationId: orgA.id, type: "invoice.fne_uncertified" },
    });
    await alertUncertifiedFne(orgA.id, at(30));
    expect(
      await adminDb.notification.count({
        where: { organizationId: orgA.id, dedupeKey: `fne.uncertified:${issued.id}` },
      }),
    ).toBe(0);
    await alertUncertifiedFne(orgA.id, at(61));
    await alertUncertifiedFne(orgA.id, at(120));
    const notes = await adminDb.notification.findMany({
      where: { organizationId: orgA.id, dedupeKey: `fne.uncertified:${issued.id}` },
      include: { membership: { select: { role: true } } },
    });
    expect(notes.map((n) => n.membership.role).sort()).toEqual(["ACCOUNTANT", "OWNER"]);
    expect(notes[0]).toMatchObject({ link: `/factures/${issued.id}` });
    expect(
      await adminDb.notification.count({
        where: { organizationId: orgA.id, type: "invoice.fne_uncertified" },
      }),
    ).toBeGreaterThan(before);
  });

  it("isolation multi-locataire : une autre organisation ne voit ni ne certifie les factures de A", async () => {
    const issued = await issueInvoice();
    await expect(
      ownerB.fne.setManual({ invoiceId: issued.id, fneNumber: "FNE-B", qrCode: "q" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerB.fne.retry({ invoiceId: issued.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const configB = await ownerB.fne.getConfig();
    expect(configB).toMatchObject({ mode: "manual", hasCredentials: false, recent: [] });
    expect(await dueFneInvoiceIds(orgB.id, at(60))).toEqual([]);
    expect(
      await certifyInvoiceFne({
        organizationId: orgB.id,
        invoiceId: issued.id,
        now: NOW,
        resolveProvider: async () => provider,
      }),
    ).toMatchObject({ outcome: "skipped" });
    const row = await adminDb.invoice.findUniqueOrThrow({ where: { id: issued.id } });
    expect(row.fneStatus).toBe("PENDING");
  });
});
