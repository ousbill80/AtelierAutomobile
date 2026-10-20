// Étape 4.3 — liens de paiement mobile money (M08 RG-M08-23..26), webhooks signés, page facture
// du portail (M14 §4.3), envoi de la facture, paramètres des fournisseurs (M15 RG-M15-17).
// Fournisseur « fake » (simulateur, webhook HMAC) : aucun compte réel. Horloge figée.
import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry, fixedClock } from "@atelieros/core";
import { adminDb, expireStalePaymentLinks, hashPortalToken } from "@atelieros/db";
import { FakePaymentProvider, PaymentProviderError } from "@atelieros/integrations";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  handlePaymentWebhook,
  providerFromConfig,
  setPaymentProviderFactory,
} from "../billing/paymentLinks";
import { createContext } from "../context";
import { setReceivablesClock } from "../receivables/helpers";
import { setRepairOrdersClock } from "../repairOrders/helpers";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";
import { resetPortalInvoiceRateLimit } from "./portalInvoice";

vi.mock("../messaging/queue", () => ({ enqueueMessageSendJob: vi.fn(async () => undefined) }));
vi.mock("../billing/fneQueue", () => ({ enqueueFneCertifyJob: vi.fn(async () => undefined) }));

const callerFactory = createCallerFactory(appRouter);
type Caller = ReturnType<typeof callerFactory>;

// Horloge figée (jamais l'heure réelle) : 20/10/2026 10:00 à Abidjan (UTC+0).
const NOW = new Date("2026-10-20T10:00:00.000Z");
const HOUR = 3_600_000;
const SECRET = `cp_secret_${randomBytes(8).toString("hex")}`;
const users: string[] = [];

async function contextFor(token: string | null) {
  const req = new Request("http://localhost/api/trpc", {
    headers: {
      ...(token ? { cookie: `atelieros_session=${token}` } : {}),
      "x-forwarded-for": "41.202.10.77",
      "user-agent": "Mozilla/5.0 (Linux; Android 13)",
    },
  });
  return createContext({ req, resHeaders: new Headers(), info: undefined as never });
}

async function member(organizationId: string, role: "OWNER" | "ADVISOR" | "CASHIER") {
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
  return callerFactory(await contextFor(token));
}

const IDENTITY = {
  legalName: "Garage Paiement SARL",
  rccm: "CI-ABJ-2019-B-12345",
  ncc: "1912345A",
  address: "Yopougon, Abidjan",
  phone: "+2252722000000",
  taxRegime: "RNI" as const,
};

describe("étape 4.3 — liens de paiement, webhooks, portail facture", () => {
  const orgIds: string[] = [];
  let orgA: { id: string };
  let orgB: { id: string };
  let owner: Caller;
  let advisor: Caller;
  let ownerB: Caller;
  let anonymous: Caller;
  let customerId: string;

  async function simulator(organizationId: string): Promise<FakePaymentProvider> {
    const config = await adminDb.paymentProviderConfig.findFirstOrThrow({
      where: { organizationId, provider: "fake" },
    });
    return providerFromConfig(config) as FakePaymentProvider;
  }

  /** « Le client paie » sur le simulateur puis le webhook signé arrive. */
  async function payByWebhook(
    organizationId: string,
    providerRef: string,
    outcome: { status: "PAID" | "FAILED"; amount?: number } = { status: "PAID" },
  ) {
    const hook = (await simulator(organizationId)).simulate(providerRef, outcome, NOW);
    if (!hook) throw new Error("simulation impossible");
    return handlePaymentWebhook({
      provider: "fake",
      organizationId,
      rawBody: hook.rawBody,
      headers: new Headers(hook.headers),
      now: NOW,
    });
  }

  async function issueInvoice(amount: number) {
    const draft = await advisor.invoice.createDirect({
      customerId,
      lines: [{ type: "LABOR", description: "Révision complète", quantity: 1, unitPrice: amount }],
    });
    return advisor.invoice.issue({ id: draft.id });
  }

  beforeAll(async () => {
    setReceivablesClock(fixedClock(NOW));
    setRepairOrdersClock(fixedClock(NOW));
    resetPortalInvoiceRateLimit();
    orgA = await adminDb.organization.create({
      data: {
        name: "Garage Paiement A",
        onboardingCompletedAt: NOW,
        vatEnabled: false,
        ...IDENTITY,
      },
    });
    orgB = await adminDb.organization.create({
      data: { name: "Garage Paiement B", onboardingCompletedAt: NOW, ...IDENTITY },
    });
    orgIds.push(orgA.id, orgB.id);
    await adminDb.site.create({ data: { organizationId: orgA.id, name: "Yopougon", code: "YOP" } });
    await adminDb.site.create({ data: { organizationId: orgB.id, name: "Cocody", code: "COC" } });
    owner = await member(orgA.id, "OWNER");
    advisor = await member(orgA.id, "ADVISOR");
    ownerB = await member(orgB.id, "OWNER");
    anonymous = callerFactory(await contextFor(null));
    await adminDb.channelConfig.create({
      data: {
        organizationId: orgA.id,
        channel: "SMS",
        provider: "console",
        isActive: true,
        credentials: "{}",
      },
    });
    customerId = (
      await adminDb.customer.create({
        data: {
          organizationId: orgA.id,
          displayName: "Kouassi Jean-Marc",
          phone: "+2250747218890",
          paymentTermsDays: 30,
        },
      })
    ).id;
  });

  afterAll(async () => {
    setPaymentProviderFactory(null);
    const where = { organizationId: { in: orgIds } };
    await adminDb.paymentWebhookLog.deleteMany({ where });
    await adminDb.paymentLink.deleteMany({ where });
    await adminDb.paymentAttribution.deleteMany({ where }).catch(() => undefined);
    await adminDb.paymentAllocation.deleteMany({ where });
    await adminDb.customerCredit.deleteMany({ where });
    await adminDb.payment.deleteMany({ where });
    await adminDb.message.deleteMany({ where });
    await adminDb.portalToken.deleteMany({ where });
    await adminDb.reminder.deleteMany({ where });
    await adminDb.quote.updateMany({ where, data: { depositInvoiceId: null } });
    await adminDb.invoiceLine.deleteMany({ where });
    await adminDb.invoice.deleteMany({ where });
    await adminDb.quote.deleteMany({ where });
    await adminDb.collectionCase.deleteMany({ where });
    await adminDb.paymentProviderConfig.deleteMany({ where });
    await adminDb.channelConfig.deleteMany({ where });
    await adminDb.documentSequence.deleteMany({ where });
    await adminDb.domainEvent.deleteMany({ where });
    await adminDb.auditLog.deleteMany({ where });
    await adminDb.customer.deleteMany({ where });
    await adminDb.session.deleteMany({ where: { userId: { in: users } } });
    await adminDb.notification.deleteMany({ where });
    await adminDb.membership.deleteMany({ where });
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
    await adminDb.site.deleteMany({ where });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  it("paramètres : secrets chiffrés, jamais renvoyés ni audités ; permission settings:payments", async () => {
    await expect(advisor.paymentProviders.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      owner.paymentProviders.upsert({
        provider: "cinetpay",
        methods: ["WAVE"],
        credentials: { apiKey: "k" },
        isActive: true,
      }),
    ).rejects.toThrow(/tous les identifiants/);
    await owner.paymentProviders.upsert({
      provider: "cinetpay",
      methods: ["WAVE", "ORANGE_MONEY"],
      credentials: { apiKey: "API-KEY", siteId: "105", secretKey: SECRET },
      isActive: false,
    });
    const listed = await owner.paymentProviders.list();
    expect(JSON.stringify(listed)).not.toContain(SECRET);
    expect(listed.providers.find((p) => p.provider === "cinetpay")).toMatchObject({
      configured: true,
      isActive: false,
      fields: [
        { name: "apiKey", filled: true },
        { name: "siteId", filled: true },
        { name: "secretKey", filled: true },
      ],
      webhookUrl: expect.stringContaining(`/api/webhooks/payments/cinetpay/${orgA.id}`),
    });
    const stored = await adminDb.paymentProviderConfig.findFirstOrThrow({
      where: { organizationId: orgA.id, provider: "cinetpay" },
    });
    expect(stored.credentials).not.toContain(SECRET);
    const audits = await adminDb.auditLog.findMany({
      where: { organizationId: orgA.id, action: "payment_provider.updated" },
    });
    expect(JSON.stringify(audits)).not.toContain(SECRET);
    expect(audits[0]?.after).toMatchObject({ credentials: "[secret modifié]" });
    // Champ vide : la valeur enregistrée est conservée.
    await owner.paymentProviders.upsert({
      provider: "cinetpay",
      methods: ["WAVE"],
      credentials: { secretKey: "" },
      isActive: false,
    });
    expect(
      (await owner.paymentProviders.list()).providers.find((p) => p.provider === "cinetpay")
        ?.fields,
    ).toContainEqual({ name: "secretKey", filled: true });
  });

  it("sans fournisseur actif : pas de lien, numéros marchands sur le portail", async () => {
    const invoice = await issueInvoice(50_000);
    await expect(advisor.paymentLink.create({ invoiceId: invoice.id })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await owner.paymentProviders.updateMerchantNumbers({
      wave: "+2250700000001",
      orangeMoney: null,
      mtn: null,
      moov: null,
    });
    const { url } = await advisor.invoice.portalLink({ id: invoice.id });
    const token = url.split("/p/")[1]!.split("/")[0]!;
    const view = await anonymous.portal.invoice.get({ token });
    expect(view.payable).toBe(false);
    expect(view.merchantNumbers).toMatchObject({ wave: "+2250700000001" });
    await expect(anonymous.portal.invoice.pay({ token, method: "WAVE" })).rejects.toThrow(
      /momentanément indisponible/,
    );
  });

  it("US-M08-09 : lien du solde (72 h), montant ≤ solde, un nouveau lien remplace l'ancien", async () => {
    await owner.paymentProviders.upsert({
      provider: "fake",
      methods: ["WAVE", "ORANGE_MONEY", "MTN_MOMO"],
      credentials: {},
      isActive: true,
    });
    const invoice = await issueInvoice(185_000);
    await expect(
      advisor.paymentLink.create({ invoiceId: invoice.id, amount: 200_000 }),
    ).rejects.toThrow(/compris entre 1 FCFA et le solde \(185 000 FCFA\)/);
    const first = await advisor.paymentLink.create({ invoiceId: invoice.id });
    expect(first.link).toMatchObject({
      provider: "fake",
      amount: 185_000,
      status: "PENDING",
      expiresAt: new Date(NOW.getTime() + 72 * HOUR),
    });
    expect(first.link.url).toContain(`/p/paiement-simule/${first.link.providerRef}`);
    const second = await advisor.paymentLink.create({ invoiceId: invoice.id, expiresInHours: 24 });
    const links = await advisor.paymentLink.list({ invoiceId: invoice.id });
    expect(links.find((l) => l.id === first.link.id)).toMatchObject({
      status: "FAILED",
      closeReason: "replaced",
    });
    expect(links.find((l) => l.id === second.link.id)).toMatchObject({ status: "PENDING" });
    expect(
      await adminDb.auditLog.count({
        where: { organizationId: orgA.id, action: "payment_link.created" },
      }),
    ).toBeGreaterThanOrEqual(2);
  });

  it("RG-M08-24 : webhook signé → paiement, facture payée, reçu ; doublon sans effet", async () => {
    const invoice = await issueInvoice(85_000);
    const { link } = await advisor.paymentLink.create({ invoiceId: invoice.id });
    const response = await payByWebhook(orgA.id, link.providerRef);
    expect(response).toEqual({ status: 200, body: { ok: true, outcome: "created" } });
    const payment = await adminDb.payment.findFirstOrThrow({
      where: { provider: "fake", providerRef: link.providerRef },
      include: { allocations: true },
    });
    expect(payment).toMatchObject({
      method: "WAVE",
      amount: 85_000,
      status: "CONFIRMED",
      unallocated: 0,
      reference: link.providerRef,
      payerPhone: null,
    });
    expect(payment.number).toMatch(/^REC-2026-\d{6}$/);
    expect(payment.allocations).toEqual([
      expect.objectContaining({ invoiceId: invoice.id, amount: 85_000 }),
    ]);
    expect(await adminDb.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({
      status: "PAID",
      balance: 0,
      amountPaid: 85_000,
    });
    expect(await adminDb.paymentLink.findUniqueOrThrow({ where: { id: link.id } })).toMatchObject({
      status: "CONFIRMED",
      paymentId: payment.id,
      confirmedAmount: 85_000,
    });
    const receipt = await adminDb.message.findFirstOrThrow({
      where: { organizationId: orgA.id, idempotencyKey: `rcpt:${payment.id}` },
    });
    expect(receipt).toMatchObject({ channel: "SMS", to: "+2250747218890" });
    expect(receipt.body).toContain(`reçu ${payment.number} : 85 000 FCFA`);
    expect(receipt.body).toContain("Votre facture est soldée");
    expect(
      await adminDb.domainEvent.count({
        where: { organizationId: orgA.id, type: "payment.received" },
      }),
    ).toBeGreaterThanOrEqual(1);
    expect(
      await adminDb.auditLog.findFirst({
        where: { organizationId: orgA.id, action: "payment.created", entityId: payment.id },
      }),
    ).not.toBeNull();

    // Le fournisseur renvoie la même notification : 200, aucun second paiement.
    const provider = await simulator(orgA.id);
    const raw = JSON.stringify({ providerRef: link.providerRef, status: "PAID", amount: 85_000 });
    const again = await handlePaymentWebhook({
      provider: "fake",
      organizationId: orgA.id,
      rawBody: raw,
      headers: new Headers({ "x-simulator-signature": provider.sign(raw) }),
      now: NOW,
    });
    expect(again).toEqual({ status: 200, body: { ok: true, outcome: "duplicate" } });
    expect(
      await adminDb.payment.count({ where: { provider: "fake", providerRef: link.providerRef } }),
    ).toBe(1);
    const logs = await adminDb.paymentWebhookLog.findMany({
      where: { organizationId: orgA.id, providerRef: link.providerRef },
    });
    // Même horodatage (horloge figée) : comparaison sans ordre.
    expect(logs.map((l) => `${l.signatureValid}:${l.outcome}`).sort()).toEqual([
      "true:created",
      "true:duplicate",
    ]);
  });

  it("webhooks concurrents de la même transaction : un seul paiement, un seul reçu", async () => {
    const invoice = await issueInvoice(30_000);
    const { link } = await advisor.paymentLink.create({ invoiceId: invoice.id });
    const hook = (await simulator(orgA.id)).simulate(link.providerRef, { status: "PAID" }, NOW)!;
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        handlePaymentWebhook({
          provider: "fake",
          organizationId: orgA.id,
          rawBody: hook.rawBody,
          headers: new Headers(hook.headers),
          now: NOW,
        }),
      ),
    );
    expect(results.map((r) => r.body.outcome).sort()).toEqual([
      "created",
      "duplicate",
      "duplicate",
    ]);
    expect(
      await adminDb.payment.count({ where: { provider: "fake", providerRef: link.providerRef } }),
    ).toBe(1);
  });

  it("signature invalide : 401 journalisé, alerte au propriétaire après 5 échecs ; endpoint inconnu : 404", async () => {
    const invoice = await issueInvoice(10_000);
    const { link } = await advisor.paymentLink.create({ invoiceId: invoice.id });
    const raw = JSON.stringify({ providerRef: link.providerRef, status: "PAID", amount: 10_000 });
    for (let i = 0; i < 5; i++) {
      const r = await handlePaymentWebhook({
        provider: "fake",
        organizationId: orgA.id,
        rawBody: raw,
        headers: new Headers({ "x-simulator-signature": "0".repeat(64) }),
        now: NOW,
      });
      expect(r.status).toBe(401);
    }
    expect(
      await adminDb.paymentWebhookLog.count({
        where: { organizationId: orgA.id, signatureValid: false, outcome: "rejected" },
      }),
    ).toBe(5);
    expect(
      await adminDb.notification.count({
        where: { organizationId: orgA.id, type: "payment.webhook_invalid_signature" },
      }),
    ).toBe(1);
    expect(await adminDb.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({
      status: "ISSUED",
    });
    expect(
      (
        await handlePaymentWebhook({
          provider: "fake",
          organizationId: "cl_inconnu_123456",
          rawBody: raw,
          headers: new Headers(),
          now: NOW,
        })
      ).status,
    ).toBe(404);
  });

  it("montant différent du lien et trop-perçu : montant confirmé enregistré, écart signalé", async () => {
    const invoice = await issueInvoice(100_000);
    const { link: partial } = await advisor.paymentLink.create({
      invoiceId: invoice.id,
      amount: 60_000,
    });
    await payByWebhook(orgA.id, partial.providerRef);
    expect(await adminDb.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({
      status: "PARTIALLY_PAID",
      balance: 40_000,
    });
    const { link } = await advisor.paymentLink.create({ invoiceId: invoice.id });
    expect(link.amount).toBe(40_000);
    await payByWebhook(orgA.id, link.providerRef, { status: "PAID", amount: 50_000 });
    const payment = await adminDb.payment.findFirstOrThrow({
      where: { provider: "fake", providerRef: link.providerRef },
    });
    expect(payment).toMatchObject({ amount: 50_000, unallocated: 10_000 });
    expect(payment.notes).toMatch(/50 000 FCFA différent du lien \(40 000 FCFA\)/);
    expect(await adminDb.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({
      status: "PAID",
      balance: 0,
    });
    const types = (
      await adminDb.notification.findMany({
        where: { organizationId: orgA.id, dedupeKey: { contains: payment.id } },
        select: { type: true },
      })
    ).map((n) => n.type);
    expect(new Set(types)).toEqual(new Set(["payment.overpaid", "payment.amount_mismatch"]));
  });

  it("ancien lien payé après solde : tout en trop-perçu, « paiement en double probable »", async () => {
    const invoice = await issueInvoice(20_000);
    const { link: old } = await advisor.paymentLink.create({ invoiceId: invoice.id });
    const { link: current } = await advisor.paymentLink.create({ invoiceId: invoice.id });
    await payByWebhook(orgA.id, current.providerRef);
    await payByWebhook(orgA.id, old.providerRef);
    const late = await adminDb.payment.findFirstOrThrow({
      where: { provider: "fake", providerRef: old.providerRef },
      include: { allocations: true },
    });
    expect(late).toMatchObject({ amount: 20_000, unallocated: 20_000, allocations: [] });
    expect(
      await adminDb.notification.count({
        where: { organizationId: orgA.id, type: "payment.probable_duplicate" },
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  it("« Vérifier » : paiement confirmé chez le fournisseur sans webhook (rapprochement)", async () => {
    const invoice = await issueInvoice(15_000);
    const { link } = await advisor.paymentLink.create({ invoiceId: invoice.id });
    // Le client paie mais le webhook se perd.
    (await simulator(orgA.id)).simulate(link.providerRef, { status: "PAID" }, NOW);
    const checked = await advisor.paymentLink.checkStatus({ id: link.id });
    expect(checked).toMatchObject({ outcome: "created", link: { status: "CONFIRMED" } });
    expect(await adminDb.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({
      status: "PAID",
    });
  });

  it("annulation, échec et expiration d'un lien", async () => {
    const invoice = await issueInvoice(12_000);
    const { link } = await advisor.paymentLink.create({ invoiceId: invoice.id });
    await expect(advisor.paymentLink.cancel({ id: link.id })).resolves.toMatchObject({
      status: "FAILED",
      closeReason: "cancelled",
    });
    await expect(advisor.paymentLink.cancel({ id: link.id })).rejects.toThrow(/plus en attente/);
    const { link: failing } = await advisor.paymentLink.create({ invoiceId: invoice.id });
    await payByWebhook(orgA.id, failing.providerRef, { status: "FAILED" });
    expect(
      await adminDb.paymentLink.findUniqueOrThrow({ where: { id: failing.id } }),
    ).toMatchObject({ status: "FAILED", closeReason: "failed" });
    const { link: stale } = await advisor.paymentLink.create({
      invoiceId: invoice.id,
      expiresInHours: 1,
    });
    expect(await expireStalePaymentLinks(new Date(NOW.getTime() + 24 * HOUR), orgA.id)).toBe(0);
    expect(await expireStalePaymentLinks(new Date(NOW.getTime() + 25 * HOUR), orgA.id)).toBe(1);
    expect(await adminDb.paymentLink.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({
      status: "FAILED",
      closeReason: "expired",
    });
  });

  it("fournisseur indisponible : message clair, aucun lien créé", async () => {
    const invoice = await issueInvoice(9_000);
    setPaymentProviderFactory(() => ({
      name: "fake",
      createPaymentLink: async () => {
        throw new PaymentProviderError("Simulateur injoignable (réseau).", true);
      },
      verifyWebhook: () => false,
      parseWebhook: () => {
        throw new Error("non");
      },
      getStatus: async () => {
        throw new PaymentProviderError("Simulateur injoignable (réseau).", true);
      },
    }));
    try {
      await expect(advisor.paymentLink.create({ invoiceId: invoice.id })).rejects.toThrow(
        /momentanément indisponible/,
      );
    } finally {
      setPaymentProviderFactory(null);
    }
    expect(await adminDb.paymentLink.count({ where: { invoiceId: invoice.id } })).toBe(0);
  });

  it("US-M08-14 + M14 : envoi SMS avec lien portail, page facture, paiement Wave, « Payé » après webhook", async () => {
    const invoice = await issueInvoice(185_000);
    const sent = await advisor.invoice.send({
      id: invoice.id,
      channel: "SMS",
      includePaymentLink: true,
    });
    expect(sent.sentTo).toBe("+2250747218890");
    const message = await adminDb.message.findUniqueOrThrow({ where: { id: sent.messageId } });
    expect(message.body).toContain("FAC-");
    expect(message.body).toContain(sent.publicUrl);
    expect(message.body).toContain(`Payer 185 000 FCFA par mobile money : ${sent.paymentUrl}`);
    expect((await adminDb.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).sentAt).toEqual(
      NOW,
    );
    const token = sent.publicUrl.split("/p/")[1]!.split("/")[0]!;
    const portalToken = await adminDb.portalToken.findFirstOrThrow({
      where: { organizationId: orgA.id, targetId: invoice.id, scope: "INVOICE" },
      orderBy: { createdAt: "desc" },
    });
    expect(portalToken.expiresAt).toEqual(new Date(NOW.getTime() + 180 * 24 * HOUR));

    const view = await anonymous.portal.invoice.get({ token });
    expect(view).toMatchObject({
      payable: true,
      methods: ["WAVE", "ORANGE_MONEY", "MTN_MOMO"],
      merchantNumbers: null,
      fne: { certified: false },
      invoice: { total: 185_000, balance: 185_000, amountPaid: 0 },
    });
    // RG-M14-17 : ni téléphone ni adresse du client sur la page publique.
    expect(JSON.stringify(view)).not.toContain("+2250747218890");

    const pay = await anonymous.portal.invoice.pay({ token, method: "WAVE" });
    expect(await anonymous.portal.invoice.pay({ token, method: "WAVE" })).toEqual(pay);
    const portalLink = await adminDb.paymentLink.findFirstOrThrow({
      where: { invoiceId: invoice.id, createdById: null, method: "WAVE" },
    });
    expect(portalLink.url).toBe(pay.url);
    // La redirection du fournisseur seule ne déclare jamais « Payé ».
    const before = await anonymous.portal.invoice.paymentStatus({ token });
    expect(before).toMatchObject({ paid: false, balance: 185_000, pending: { overdue: false } });

    await payByWebhook(orgA.id, portalLink.providerRef);
    expect(await anonymous.portal.invoice.paymentStatus({ token })).toMatchObject({
      paid: true,
      balance: 0,
      pending: null,
    });
    const after = await anonymous.portal.invoice.get({ token });
    expect(after).toMatchObject({ payable: false, invoice: { status: "PAID" } });
    expect(after.lastPayment).toMatchObject({ amount: 185_000, method: "WAVE" });
  });

  it("RG-M14-15 : 2 min sans confirmation → caissier prévenu, « ne repayez pas »", async () => {
    const invoice = await issueInvoice(7_000);
    const { url } = await advisor.invoice.portalLink({ id: invoice.id });
    const token = url.split("/p/")[1]!.split("/")[0]!;
    await anonymous.portal.invoice.pay({ token, method: "ORANGE_MONEY" });
    await adminDb.paymentLink.updateMany({
      where: { invoiceId: invoice.id, createdById: null },
      data: { createdAt: new Date(NOW.getTime() - 3 * 60_000) },
    });
    const status = await anonymous.portal.invoice.paymentStatus({ token });
    expect(status).toMatchObject({ paid: false, pending: { overdue: true } });
    expect(
      await adminDb.notification.count({
        where: { organizationId: orgA.id, type: "payment.portal_unconfirmed" },
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  it("portée des jetons : un jeton INVOICE ne lit ni devis ni RDV, une autre facture est invisible", async () => {
    const invoice = await issueInvoice(5_000);
    const { url } = await advisor.invoice.portalLink({ id: invoice.id });
    const token = url.split("/p/")[1]!.split("/")[0]!;
    await expect(anonymous.portal.quote.get({ token })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(anonymous.portal.appointment.get({ token })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(anonymous.portal.invoice.get({ token: "x".repeat(43) })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const draft = await advisor.invoice.createDirect({
      customerId,
      lines: [{ type: "LABOR", description: "Brouillon", quantity: 1, unitPrice: 1_000 }],
    });
    await expect(advisor.invoice.portalLink({ id: draft.id })).rejects.toThrow(/émise/);
    await expect(advisor.invoice.send({ id: draft.id, channel: "SMS" })).rejects.toThrow(
      /Émettez la facture/,
    );
  });

  it("acompte de devis (écart 3.3) : payable depuis le portail du devis une fois la facture émise", async () => {
    const site = await adminDb.site.findFirstOrThrow({ where: { organizationId: orgA.id } });
    const quote = await adminDb.quote.create({
      data: {
        organizationId: orgA.id,
        siteId: site.id,
        number: "DEV-YOP-2026-00017",
        customerId,
        status: "ACCEPTED",
        validUntil: new Date("2026-11-30"),
        total: 650_000,
        acceptedTotal: 650_000,
        depositAmount: 50_000,
      },
    });
    const quoteToken = randomBytes(32).toString("base64url");
    await adminDb.portalToken.create({
      data: {
        organizationId: orgA.id,
        tokenHash: hashPortalToken(quoteToken),
        scope: "QUOTE",
        targetId: quote.id,
        customerId,
        expiresAt: new Date(NOW.getTime() + 30 * 24 * HOUR),
      },
    });
    const draft = await advisor.invoice.createDeposit({
      customerId,
      quoteId: quote.id,
      amountTtc: 50_000,
    });
    await adminDb.quote.update({ where: { id: quote.id }, data: { depositInvoiceId: draft.id } });
    // Brouillon : pas encore payable.
    expect(await anonymous.portal.quote.get({ token: quoteToken })).toMatchObject({
      depositPayable: false,
      depositPaid: false,
    });
    await expect(anonymous.portal.quote.depositLink({ token: quoteToken })).rejects.toThrow(
      /pas encore payable/,
    );
    await advisor.invoice.issue({ id: draft.id });
    expect(await anonymous.portal.quote.get({ token: quoteToken })).toMatchObject({
      depositPayable: true,
    });
    const { url } = await anonymous.portal.quote.depositLink({ token: quoteToken });
    const invoiceToken = url.split("/p/")[1]!.split("/")[0]!;
    expect(url).toMatch(/\/facture$/);
    const view = await anonymous.portal.invoice.get({ token: invoiceToken });
    expect(view).toMatchObject({ invoice: { type: "DEPOSIT", balance: 50_000 }, payable: true });
    const { url: payUrl } = await anonymous.portal.invoice.pay({
      token: invoiceToken,
      method: "WAVE",
    });
    const ref = payUrl.split("/p/paiement-simule/")[1]!;
    await payByWebhook(orgA.id, ref);
    expect(await anonymous.portal.quote.get({ token: quoteToken })).toMatchObject({
      depositPayable: false,
      depositPaid: true,
    });
  });

  it("isolation multi-locataire : l'organisation B ne voit ni ne paie les liens de A", async () => {
    const invoice = await issueInvoice(8_000);
    const { link } = await advisor.paymentLink.create({ invoiceId: invoice.id });
    await expect(ownerB.paymentLink.list({ invoiceId: invoice.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(ownerB.paymentLink.cancel({ id: link.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(ownerB.paymentLink.create({ invoiceId: invoice.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(ownerB.invoice.send({ id: invoice.id, channel: "SMS" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // Un webhook adressé à B (son propre simulateur) ne peut pas confirmer un lien de A.
    await ownerB.paymentProviders.upsert({
      provider: "fake",
      methods: ["WAVE"],
      credentials: {},
      isActive: true,
    });
    const providerB = await simulator(orgB.id);
    const raw = JSON.stringify({ providerRef: link.providerRef, status: "PAID", amount: 8_000 });
    const r = await handlePaymentWebhook({
      provider: "fake",
      organizationId: orgB.id,
      rawBody: raw,
      headers: new Headers({ "x-simulator-signature": providerB.sign(raw) }),
      now: NOW,
    });
    expect(r.body.outcome).toBe("unknown_link");
    expect(await adminDb.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({
      status: "ISSUED",
    });
    expect(await adminDb.payment.count({ where: { organizationId: orgB.id } })).toBe(0);
    // Le secret de A ne signe pas pour B, et inversement.
    const hookA = (await simulator(orgA.id)).simulate(link.providerRef, { status: "PAID" }, NOW)!;
    const cross = await handlePaymentWebhook({
      provider: "fake",
      organizationId: orgB.id,
      rawBody: hookA.rawBody,
      headers: new Headers(hookA.headers),
      now: NOW,
    });
    expect(cross.status).toBe(401);
  });
});
