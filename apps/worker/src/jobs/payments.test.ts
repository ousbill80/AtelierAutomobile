// RG-M08-25 — `payments.reconcile` rattrape un webhook perdu (statut relu chez le fournisseur),
// sans doublon au passage suivant ; `paymentLinks.expire` clôt les liens expirés depuis 24 h.
import { adminDb, expireStalePaymentLinks } from "@atelieros/db";
import type { PaymentStatusResult } from "@atelieros/integrations";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { reconcilePaymentLinks } from "./payments";

vi.mock("../queues/messages", () => ({ enqueueMessageSendJob: vi.fn(async () => undefined) }));

// Horloge figée : 20/10/2026 10:00 à Abidjan (UTC+0).
const NOW = new Date("2026-10-20T10:00:00.000Z");
const HOUR = 3_600_000;

describe("payments.reconcile (RG-M08-25)", () => {
  let org: { id: string };
  let invoiceId: string;
  const statuses = new Map<string, PaymentStatusResult>();
  const resolve = async (_org: string, _provider: string, ref: string) => {
    const status = statuses.get(ref);
    if (!status) throw new Error("fournisseur injoignable");
    return status;
  };

  beforeAll(async () => {
    org = await adminDb.organization.create({
      data: { name: "Garage Rapprochement", onboardingCompletedAt: NOW },
    });
    const site = await adminDb.site.create({
      data: { organizationId: org.id, name: "Yopougon", code: "YOP" },
    });
    await adminDb.channelConfig.create({
      data: {
        organizationId: org.id,
        channel: "SMS",
        provider: "console",
        isActive: true,
        credentials: "{}",
      },
    });
    const customer = await adminDb.customer.create({
      data: { organizationId: org.id, displayName: "Bamba Aminata", phone: "+2250505050505" },
    });
    invoiceId = (
      await adminDb.invoice.create({
        data: {
          organizationId: org.id,
          siteId: site.id,
          customerId: customer.id,
          number: "FAC-2026-000412",
          status: "ISSUED",
          issuedAt: NOW,
          dueDate: new Date("2026-11-19"),
          subtotal: 85_000,
          total: 85_000,
          balance: 85_000,
        },
      })
    ).id;
    const link = (ref: string, expiresAt: Date) =>
      adminDb.paymentLink.create({
        data: {
          organizationId: org.id,
          invoiceId,
          provider: "fake",
          providerRef: ref,
          url: `http://localhost/p/paiement-simule/${ref}`,
          amount: 85_000,
          expiresAt,
        },
      });
    await link("sim_paid", new Date(NOW.getTime() + 72 * HOUR));
    await link("sim_waiting", new Date(NOW.getTime() + 72 * HOUR));
    await link("sim_down", new Date(NOW.getTime() + 72 * HOUR));
    await link("sim_late", new Date(NOW.getTime() - 23 * HOUR));
    await link("sim_old", new Date(NOW.getTime() - 25 * HOUR));
    const pending = { amount: null, method: null, paidAt: null, payerPhone: null };
    statuses.set("sim_paid", {
      status: "PAID",
      amount: 85_000,
      method: "ORANGE_MONEY",
      paidAt: new Date(NOW.getTime() - 20 * 60_000),
      payerPhone: "+2250505050505",
    });
    statuses.set("sim_waiting", { status: "PENDING", ...pending });
    statuses.set("sim_late", { status: "PENDING", ...pending });
    statuses.set("sim_old", { status: "PENDING", ...pending });
  });

  afterAll(async () => {
    const where = { organizationId: org.id };
    await adminDb.paymentLink.deleteMany({ where });
    await adminDb.paymentAllocation.deleteMany({ where });
    await adminDb.payment.deleteMany({ where });
    await adminDb.message.deleteMany({ where });
    await adminDb.invoice.deleteMany({ where });
    await adminDb.collectionCase.deleteMany({ where });
    await adminDb.documentSequence.deleteMany({ where });
    await adminDb.domainEvent.deleteMany({ where });
    await adminDb.auditLog.deleteMany({ where });
    await adminDb.notification.deleteMany({ where });
    await adminDb.channelConfig.deleteMany({ where });
    await adminDb.customer.deleteMany({ where });
    await adminDb.site.deleteMany({ where });
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  it("webhook perdu : paiement enregistré, facture payée, reçu ; fournisseur injoignable ignoré", async () => {
    const result = await reconcilePaymentLinks(NOW, resolve, org.id);
    // sim_old (expiré depuis plus de 24 h) n'est plus interrogé ; sim_down injoignable.
    expect(result).toEqual({ checked: 3, created: 1, failed: 0 });
    const payment = await adminDb.payment.findFirstOrThrow({
      where: { organizationId: org.id, providerRef: "sim_paid" },
    });
    expect(payment).toMatchObject({
      method: "ORANGE_MONEY",
      amount: 85_000,
      status: "CONFIRMED",
      payerPhone: "+2250505050505",
    });
    expect(await adminDb.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).toMatchObject({
      status: "PAID",
      balance: 0,
    });
    const receipt = await adminDb.message.findFirstOrThrow({
      where: { organizationId: org.id, idempotencyKey: `rcpt:${payment.id}` },
    });
    expect(receipt).toMatchObject({ channel: "SMS", to: "+2250505050505", kind: "TRANSACTIONAL" });
    expect(
      await adminDb.auditLog.findFirst({
        where: { organizationId: org.id, action: "payment.created", entityId: payment.id },
      }),
    ).not.toBeNull();
  });

  it("passage suivant : aucun doublon ; 24 h après l'expiration, le lien en attente passe FAILED", async () => {
    const again = await reconcilePaymentLinks(NOW, resolve, org.id);
    expect(again.created).toBe(0);
    expect(await adminDb.payment.count({ where: { organizationId: org.id } })).toBe(1);
    // Au-delà de 24 h après l'expiration, le lien sort du rapprochement : `paymentLinks.expire`
    // le clôt (balayage limité à l'organisation du test).
    const later = new Date(NOW.getTime() + 2 * HOUR);
    expect((await reconcilePaymentLinks(later, resolve, org.id)).failed).toBe(0);
    expect(await expireStalePaymentLinks(later, org.id)).toBe(2);
    expect(
      await adminDb.paymentLink.findFirstOrThrow({
        where: { organizationId: org.id, providerRef: "sim_late" },
      }),
    ).toMatchObject({ status: "FAILED", closeReason: "expired" });
  });
});
