import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMessagesQueue } from "../queues/messages";
import {
  dispatchClaimFollowUpsForOrganization,
  planClaimFollowUpsForOrganization,
} from "./claimsJobs";

// Horloge figée : mardi 20/10/2026 à 06:00, Abidjan (UTC+0).
const NOW = new Date("2026-10-20T06:00:00.000Z");
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("claims.plan_followups / claims.dispatch_followups (M16 §9)", () => {
  let orgId: string;
  let otherOrgId: string;
  let ownerUserId: string;
  let estimateClaimId: string;
  let invoicedClaimId: string;
  let invoiceId: string;

  beforeAll(async () => {
    orgId = (
      await adminDb.organization.create({
        data: { name: "Garage Sinistres Worker", onboardingCompletedAt: NOW },
      })
    ).id;
    otherOrgId = (
      await adminDb.organization.create({
        data: { name: "Autre garage", onboardingCompletedAt: NOW },
      })
    ).id;
    const site = await adminDb.site.create({
      data: { organizationId: orgId, name: "Marcory", code: "MAR" },
    });
    const owner = await adminDb.user.create({
      data: { name: "Gérant", email: `owner-${orgId}@example.com` },
    });
    ownerUserId = owner.id;
    await adminDb.membership.create({
      data: { organizationId: orgId, userId: owner.id, role: "OWNER" },
    });
    const customer = await adminDb.customer.create({
      data: { organizationId: orgId, displayName: "Koné Awa" },
    });
    const insurerCustomer = await adminDb.customer.create({
      data: { organizationId: orgId, displayName: "NSIA Assurances", type: "COMPANY" },
    });
    const vehicle = await adminDb.vehicle.create({
      data: {
        organizationId: orgId,
        customerId: customer.id,
        plate: "1234 AB 01",
        make: "Toyota",
        model: "Corolla",
      },
    });
    const insurer = await adminDb.insuranceCompany.create({
      data: {
        organizationId: orgId,
        name: "NSIA Assurances",
        customerId: insurerCustomer.id,
        claimsEmail: "sinistres@nsia.example",
        accountingEmail: "compta@nsia.example",
      },
    });
    const base = {
      organizationId: orgId,
      siteId: site.id,
      insuranceCompanyId: insurer.id,
      customerId: customer.id,
      vehicleId: vehicle.id,
    };
    estimateClaimId = (
      await adminDb.insuranceClaim.create({
        data: {
          ...base,
          number: "SIN-MAR-2026-00001",
          status: "ESTIMATE_SENT",
          estimateSentAt: d("2026-09-01"),
        },
      })
    ).id;
    invoicedClaimId = (
      await adminDb.insuranceClaim.create({
        data: { ...base, number: "SIN-MAR-2026-00002", status: "INVOICED" },
      })
    ).id;
    invoiceId = (
      await adminDb.invoice.create({
        data: {
          organizationId: orgId,
          siteId: site.id,
          customerId: insurerCustomer.id,
          insuranceClaimId: invoicedClaimId,
          billTo: "INSURANCE",
          type: "INVOICE",
          status: "ISSUED",
          number: "FAC-2026-00010",
          issuedAt: d("2026-07-22"),
          dueDate: d("2026-09-20"),
          total: 1_150_000,
          balance: 1_150_000,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await getMessagesQueue().close();
    for (const id of [orgId, otherOrgId]) {
      const where = { organizationId: id };
      await adminDb.claimFollowUp.deleteMany({ where });
      await adminDb.claimActivity.deleteMany({ where });
      await adminDb.message.deleteMany({ where });
      await adminDb.invoice.deleteMany({ where });
      await adminDb.insuranceClaim.deleteMany({ where });
      await adminDb.insuranceCompany.deleteMany({ where });
      await adminDb.vehicle.deleteMany({ where });
      await adminDb.customer.deleteMany({ where });
      await adminDb.channelConfig.deleteMany({ where });
      await adminDb.notification.deleteMany({ where });
      await adminDb.membership.deleteMany({ where });
      await adminDb.site.deleteMany({ where });
      await adminDb.organization.delete({ where: { id } });
    }
    await adminDb.user.deleteMany({ where: { id: ownerUserId } });
  });

  it("planifie les paliers dus (accord J+7/14/21, paiement J+0/15/30…), sans doublon", async () => {
    // Devis envoyé le 01/09 : J+7, J+14, J+21 dus ; escalade OWNER au dernier palier.
    // Échéance 20/09 (dimanche → lundi 21/09) : J+0, J+15, J+30 dus au 20/10.
    expect(await planClaimFollowUpsForOrganization(orgId, NOW)).toBe(6);
    expect(await planClaimFollowUpsForOrganization(orgId, NOW)).toBe(0);
    const rows = await adminDb.claimFollowUp.findMany({
      where: { organizationId: orgId },
      orderBy: [{ kind: "asc" }, { scheduledFor: "asc" }],
    });
    expect(rows.map((r) => `${r.kind}:${r.stepKey}:${r.status}`)).toEqual([
      "approval:J+7:NEEDS_APPROVAL",
      "approval:J+14:NEEDS_APPROVAL",
      "approval:J+21:NEEDS_APPROVAL",
      "payment:J+0:NEEDS_APPROVAL",
      "payment:J+15:NEEDS_APPROVAL",
      "payment:J+30:NEEDS_APPROVAL",
    ]);
    expect(rows.find((r) => r.stepKey === "J+0")!.scheduledFor).toEqual(d("2026-09-21"));
    const notes = await adminDb.notification.findMany({ where: { organizationId: orgId } });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.type).toBe("claim.escalate");
    // Isolation : rien n'est planifié pour une autre organisation.
    expect(await adminDb.claimFollowUp.count({ where: { organizationId: otherOrgId } })).toBe(0);
  });

  it("n'envoie rien sans autoSendFollowUps ; sinon envoie et revérifie la condition", async () => {
    expect(await dispatchClaimFollowUpsForOrganization(orgId, NOW)).toBe(0);
    await adminDb.organization.update({
      where: { id: orgId },
      data: { settings: { claims: { autoSendFollowUps: true } } },
    });
    await adminDb.channelConfig.create({
      data: {
        organizationId: orgId,
        channel: "EMAIL",
        provider: "console",
        isActive: true,
        credentials: "{}",
      },
    });
    await adminDb.claimFollowUp.updateMany({
      where: { organizationId: orgId, stepKey: { in: ["J+30", "J+21"] } },
      data: { status: "PLANNED" },
    });
    // Accord reçu entre-temps : la relance « accord » n'est plus justifiée.
    await adminDb.insuranceClaim.update({
      where: { id: estimateClaimId },
      data: { status: "APPROVED" },
    });
    expect(await dispatchClaimFollowUpsForOrganization(orgId, NOW)).toBe(1);
    const approval = await adminDb.claimFollowUp.findFirstOrThrow({
      where: { organizationId: orgId, kind: "approval", stepKey: "J+21" },
    });
    expect(approval.status).toBe("SKIPPED");
    const payment = await adminDb.claimFollowUp.findFirstOrThrow({
      where: { organizationId: orgId, kind: "payment", stepKey: "J+30" },
    });
    expect(payment.status).toBe("QUEUED");
    const message = await adminDb.message.findUniqueOrThrow({ where: { id: payment.messageId! } });
    expect(message.to).toBe("compta@nsia.example");
    expect(message.subject).toContain("FAC-2026-00010");
    expect(message.body).toContain("1 150 000 FCFA");
    const activity = await adminDb.claimActivity.findFirstOrThrow({
      where: { claimId: invoicedClaimId, type: "followup" },
    });
    expect(activity.messageId).toBe(message.id);
    expect(await dispatchClaimFollowUpsForOrganization(orgId, NOW)).toBe(0);
    expect(invoiceId).toBeTruthy();
  });
});
