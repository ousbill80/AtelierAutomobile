// M14 US-M14-11 / RG-M14-21 — avis client après restitution (jeton SURVEY ciblant l'OR) : un seul
// avis par OR ; note ≤ 3 → notification au gérant ; note ≥ 4 → avis Google proposé si configuré ;
// la relance d'origine passe `outcome = REPLIED`.
import { TRPCError } from "@trpc/server";
import { feedbackFollowUp, portalSettingsFrom, validateFeedback } from "@atelieros/core";
import { adminDb, db, notifyMembers, type PortalToken } from "@atelieros/db";
import { emitDomainEvent } from "../events/emit";
import { linkError } from "./access";

export async function buildFeedbackView(token: PortalToken) {
  const tenantDb = db.forTenant({ organizationId: token.organizationId });
  const [org, order, existing] = await Promise.all([
    adminDb.organization.findUniqueOrThrow({
      where: { id: token.organizationId },
      select: { name: true, phone: true, settings: true },
    }),
    tenantDb.repairOrder.findFirst({
      where: { id: token.targetId, customerId: token.customerId },
      select: {
        number: true,
        deliveredAt: true,
        vehicle: { select: { plate: true, make: true, model: true } },
      },
    }),
    tenantDb.customerFeedback.findFirst({
      where: { repairOrderId: token.targetId },
      select: { rating: true, comment: true, createdAt: true },
    }),
  ]);
  if (!order) linkError("NOT_FOUND");
  const settings = portalSettingsFrom(org.settings);
  return {
    garage: { name: org.name, phone: org.phone },
    number: order.number,
    deliveredAt: order.deliveredAt,
    vehicle: order.vehicle,
    submitted: existing,
    googleReviewUrl: existing
      ? feedbackFollowUp(existing.rating, settings.googleReviewUrl).googleReviewUrl
      : null,
  };
}

export async function submitFeedback(
  token: PortalToken,
  input: { rating: number; comment?: string },
  now: Date,
): Promise<{ googleReviewUrl: string | null; alreadySubmitted: boolean }> {
  const invalid = validateFeedback(input);
  if (invalid) throw new TRPCError({ code: "BAD_REQUEST", message: invalid });
  const tenantDb = db.forTenant({ organizationId: token.organizationId });
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: token.organizationId },
    select: { settings: true },
  });
  const settings = portalSettingsFrom(org.settings);
  const order = await tenantDb.repairOrder.findFirst({
    where: { id: token.targetId, customerId: token.customerId },
    select: { id: true, number: true, siteId: true, customerId: true },
  });
  if (!order) linkError("NOT_FOUND");
  const existing = await tenantDb.customerFeedback.findFirst({
    where: { repairOrderId: order.id },
    select: { rating: true },
  });
  // Un seul avis par OR : une deuxième soumission renvoie l'avis existant (rejeu).
  if (existing) {
    return {
      googleReviewUrl: feedbackFollowUp(existing.rating, settings.googleReviewUrl).googleReviewUrl,
      alreadySubmitted: true,
    };
  }
  const comment = input.comment?.trim() || null;
  const followUp = feedbackFollowUp(input.rating, settings.googleReviewUrl);
  await tenantDb.transaction(async (tx) => {
    const feedback = await tx.customerFeedback.create({
      data: {
        organizationId: token.organizationId,
        siteId: order.siteId,
        customerId: order.customerId,
        repairOrderId: order.id,
        rating: input.rating,
        comment,
        createdAt: now,
      },
    });
    if (followUp.notifyOwner) {
      await notifyMembers(
        tx as never,
        token.organizationId,
        { roles: ["OWNER"] },
        {
          type: "portal.feedback_low",
          title: `Avis client ${input.rating}/5 — ${order.number}`,
          body: comment?.slice(0, 300) ?? undefined,
          link: "/clients/avis",
          severity: "warning",
          dedupeKey: `portal.feedback_low:${feedback.id}`,
        },
      );
    }
    if (token.reminderId) {
      await tx.reminder.updateMany({
        where: { id: token.reminderId, outcome: null },
        data: { outcome: "REPLIED", outcomeAt: now },
      });
    }
    await emitDomainEvent(tx as never, token.organizationId, "portal.feedback_received", {
      repairOrderId: order.id,
      customerId: order.customerId,
      rating: input.rating,
    });
  });
  return { googleReviewUrl: followUp.googleReviewUrl, alreadySubmitted: false };
}
