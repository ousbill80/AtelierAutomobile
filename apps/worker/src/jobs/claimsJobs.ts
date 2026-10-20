// M16 §9 — relances de l'assureur (RG-M16-08, `ClaimFollowUp`, pas des `Reminder` M10 — A7) :
// - `claims.plan_followups` (06:00) : crée les relances dues du jour, dédoublonnées par
//   `dedupeKey` ; `NEEDS_APPROVAL` (validation par la comptable) sauf si
//   `settings.claims.autoSendFollowUps`. Dernier palier « accord » dépassé → notification OWNER.
// - `claims.dispatch_followups` (15 min, heures ouvrées) : envoi automatique des relances
//   `PLANNED` échues, condition revérifiée juste avant l'envoi (dossier toujours en attente,
//   facture toujours impayée).
import {
  businessDate,
  claimFollowUpMessage,
  followUpConfigFrom,
  followUpStillDue,
  formatFCFA,
  planFollowUps,
  systemClock,
  type Clock,
} from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import { logger } from "../logger";
import { enqueueMessageSendJob } from "../queues/messages";

const PLANNABLE = ["EXPERT_SCHEDULED", "ESTIMATE_SENT", "INVOICED", "PARTIALLY_PAID"] as const;

function claimsSettings(raw: unknown): { autoSendFollowUps: boolean } {
  const c = (raw as { claims?: { autoSendFollowUps?: unknown } } | null)?.claims;
  return { autoSendFollowUps: c?.autoSendFollowUps === true };
}

export async function planClaimFollowUpsForOrganization(
  organizationId: string,
  now: Date,
): Promise<number> {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true, settings: true },
  });
  const auto = claimsSettings(org.settings).autoSendFollowUps;
  const today = businessDate(now, org.timezone);
  const tenantDb = db.forTenant({ organizationId });
  const claims = await tenantDb.insuranceClaim.findMany({
    where: { deletedAt: null, status: { in: [...PLANNABLE] } },
    include: {
      insuranceCompany: { select: { followUpConfig: true } },
      invoices: {
        where: { billTo: "INSURANCE", type: "INVOICE" },
        select: { id: true, billTo: true, status: true, balance: true, dueDate: true },
      },
    },
  });
  let created = 0;
  for (const claim of claims) {
    const planned = planFollowUps({
      claim,
      invoices: claim.invoices,
      config: followUpConfigFrom(claim.insuranceCompany.followUpConfig),
      today,
    });
    for (const p of planned) {
      const exists = await tenantDb.claimFollowUp.findFirst({ where: { dedupeKey: p.dedupeKey } });
      if (exists) continue;
      await tenantDb.claimFollowUp.create({
        data: {
          organizationId,
          claimId: claim.id,
          invoiceId: p.invoiceId,
          kind: p.kind,
          stepKey: p.stepKey,
          scheduledFor: p.scheduledFor,
          status: auto && !p.escalate ? "PLANNED" : "NEEDS_APPROVAL",
          dedupeKey: p.dedupeKey,
        },
      });
      created++;
      if (p.escalate) {
        const owners = await tenantDb.membership.findMany({
          where: { isActive: true, role: "OWNER" },
          select: { id: true },
        });
        for (const owner of owners) {
          const dedupeKey = `claim.escalate:${p.dedupeKey}`;
          const seen = await tenantDb.notification.findFirst({
            where: { membershipId: owner.id, dedupeKey },
          });
          if (seen) continue;
          await tenantDb.notification.create({
            data: {
              organizationId,
              membershipId: owner.id,
              type: "claim.escalate",
              title:
                p.kind === "approval"
                  ? `Sinistre ${claim.number} : toujours sans accord de l'assureur`
                  : `Sinistre ${claim.number} : facture assurance impayée depuis plus de 120 jours`,
              link: `/assurances/sinistres/${claim.id}`,
              severity: "warning",
              dedupeKey,
            },
          });
        }
      }
    }
  }
  return created;
}

export async function dispatchClaimFollowUpsForOrganization(
  organizationId: string,
  now: Date,
): Promise<number> {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true, legalName: true, settings: true },
  });
  if (!claimsSettings(org.settings).autoSendFollowUps) return 0;
  const tenantDb = db.forTenant({ organizationId });
  const due = await tenantDb.claimFollowUp.findMany({
    where: { status: { in: ["PLANNED", "SNOOZED"] }, scheduledFor: { lte: now } },
    orderBy: { scheduledFor: "asc" },
    take: 100,
  });
  const configs = await tenantDb.channelConfig.findMany({
    where: { isActive: true },
    orderBy: { priority: "asc" },
    select: { channel: true, provider: true },
  });
  const providerByChannel = new Map<string, string>();
  for (const c of configs)
    if (!providerByChannel.has(c.channel)) providerByChannel.set(c.channel, c.provider);

  let sent = 0;
  for (const f of due) {
    const messageId = await tenantDb.transaction(async (tx) => {
      // Garde de concurrence : un seul passage prend la relance.
      const taken = await tx.claimFollowUp.updateMany({
        where: { id: f.id, status: f.status },
        data: { status: "QUEUED" },
      });
      if (taken.count === 0) return null;
      const claim = await tx.insuranceClaim.findFirstOrThrow({
        where: { id: f.claimId },
        include: {
          insuranceCompany: true,
          customer: { select: { displayName: true } },
          vehicle: { select: { plate: true } },
        },
      });
      const invoice = f.invoiceId
        ? await tx.invoice.findFirst({ where: { id: f.invoiceId } })
        : null;
      const stillDue = followUpStillDue({
        kind: f.kind,
        claimStatus: claim.status,
        expertVisitedAt: claim.expertVisitedAt,
        invoiceBalance: invoice?.balance ?? null,
      });
      if (!stillDue || claim.deletedAt) {
        await tx.claimFollowUp.update({ where: { id: f.id }, data: { status: "SKIPPED" } });
        return null;
      }
      const insurer = claim.insuranceCompany;
      const email =
        f.kind === "payment" ? insurer.accountingEmail || insurer.claimsEmail : insurer.claimsEmail;
      const channel =
        email && providerByChannel.has("EMAIL")
          ? "EMAIL"
          : insurer.claimsPhone && providerByChannel.has("WHATSAPP")
            ? "WHATSAPP"
            : insurer.claimsPhone && providerByChannel.has("SMS")
              ? "SMS"
              : null;
      if (!channel) {
        // Pas de canal joignable : la comptable reprend la main (appel téléphonique).
        await tx.claimFollowUp.update({ where: { id: f.id }, data: { status: "NEEDS_APPROVAL" } });
        return null;
      }
      const text = claimFollowUpMessage({
        kind: f.kind,
        garageName: org.legalName || org.name,
        claimNumber: claim.number,
        insurerClaimNumber: claim.claimNumber,
        plate: claim.vehicle?.plate ?? null,
        insuredName: claim.customer.displayName,
        invoiceNumber: invoice?.number ?? null,
        balance: invoice ? formatFCFA(invoice.balance) : null,
        daysLate: invoice?.dueDate
          ? Math.max(0, Math.floor((now.getTime() - invoice.dueDate.getTime()) / 86_400_000))
          : null,
      });
      const message = await tx.message.create({
        data: {
          organizationId,
          direction: "OUTBOUND",
          channel,
          to: channel === "EMAIL" ? email! : insurer.claimsPhone!,
          subject: channel === "EMAIL" ? text.subject : undefined,
          body: channel === "EMAIL" ? text.body : `${text.subject}\n\n${text.body}`,
          status: "QUEUED",
          provider: providerByChannel.get(channel)!,
          kind: "SYSTEM",
          idempotencyKey: `claim:${f.dedupeKey}`,
        },
      });
      await tx.claimFollowUp.update({
        where: { id: f.id },
        data: { channel, messageId: message.id, sentAt: now },
      });
      await tx.claimActivity.create({
        data: {
          organizationId,
          claimId: claim.id,
          type: "followup",
          body: text.subject,
          messageId: message.id,
          data: { followUpId: f.id, kind: f.kind, step: f.stepKey, auto: true },
        },
      });
      return message.id;
    });
    if (messageId) {
      await enqueueMessageSendJob(messageId);
      sent++;
    }
  }
  return sent;
}

async function forEachOrganization(
  name: string,
  run: (organizationId: string) => Promise<number>,
): Promise<{ total: number }> {
  const organizations = await adminDb.organization.findMany({
    where: { operatingMode: "FULL" },
    select: { id: true },
  });
  let total = 0;
  for (const org of organizations) {
    try {
      total += await run(org.id);
    } catch (error) {
      logger.error(
        { organizationId: org.id, error: error instanceof Error ? error.message : error },
        `${name} : échec sur une organisation, passage à la suivante`,
      );
    }
  }
  return { total };
}

export function processClaimsPlanFollowUpsJob(clock: Clock = systemClock) {
  return forEachOrganization("claims.plan_followups", (id) =>
    planClaimFollowUpsForOrganization(id, clock.now()),
  );
}

export function processClaimsDispatchFollowUpsJob(clock: Clock = systemClock) {
  return forEachOrganization("claims.dispatch_followups", (id) =>
    dispatchClaimFollowUpsForOrganization(id, clock.now()),
  );
}
