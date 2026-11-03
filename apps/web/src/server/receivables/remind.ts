// Relance des créances depuis l'écran Créances (M09 §7) : un client (« Relancer ») ou tous
// les clients à relancer (envoi groupé), sur les canaux choisis par l'utilisateur. Chaque
// canal donne une relance distincte (stepKey MANUAL + canal), déjà approuvée, envoyée par
// reminders.dispatch au prochain passage (≤ 5 min, dans la fenêtre d'envoi), qui revérifie
// juste avant l'envoi que la facture est toujours impayée et le client non désinscrit.
import { TRPCError } from "@trpc/server";
import {
  buildManualDedupeKey,
  channelModes,
  channelsToSend,
  normalizePhoneCI,
  phoneLineType,
  remindEligibility,
  type ChannelMode,
  type RemindBlockReason,
  type ReminderChannel,
} from "@atelieros/core";
import type { db } from "@atelieros/db";

type TenantDb = ReturnType<typeof db.forTenant>;

const BLOCK_MESSAGES: Record<RemindBlockReason, string> = {
  CASE_DISPUTED: "Dossier en litige : réglez le litige avant de relancer le client.",
  CASE_PAUSED: "Relances en pause pour ce dossier : reprenez-les avant de relancer.",
  CASE_CLOSED: "Ce dossier est clos : il n'y a plus rien à relancer.",
  NOTHING_OVERDUE: "Rien n'est encore en retard pour ce client.",
  DO_NOT_REMIND: "Client marqué « Ne plus relancer » : appelez-le ou passez le voir.",
  NO_CONTACT: "Aucun téléphone mobile ni email : complétez la fiche client.",
  ALREADY_PENDING: "Une relance est déjà en cours d'envoi pour ce client.",
  RECENTLY_SENT: "Déjà relancé il y a moins de 20 h.",
};

export function blockMessage(reason: RemindBlockReason, nextAllowedAt?: Date, timeZone?: string) {
  if (reason === "RECENTLY_SENT" && nextAllowedAt) {
    const next = new Intl.DateTimeFormat("fr-FR", {
      timeZone: timeZone ?? "Africa/Abidjan",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(nextAllowedAt);
    return `Ce client a déjà été relancé il y a moins de 20 h. Nouvelle relance possible à partir du ${next}, ou appelez-le.`;
  }
  return BLOCK_MESSAGES[reason];
}

export function mobile(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const e164 = normalizePhoneCI(phone).e164 ?? phone;
  return phoneLineType(e164) === "FIXED" ? null : e164;
}

export async function loadChannelModes(
  tenantDb: TenantDb,
): Promise<Record<ReminderChannel, ChannelMode>> {
  const configs = await tenantDb.channelConfig.findMany({
    select: { channel: true, provider: true, isActive: true, status: true },
  });
  return channelModes(configs);
}

export async function requireReceivableRule(tenantDb: TenantDb) {
  const rule = await tenantDb.reminderRule.findFirst({
    where: { type: "RECEIVABLE", isActive: true },
    select: { id: true },
  });
  if (!rule) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Aucune règle de relance des créances active : activez-la dans Paramètres › Relances.",
    });
  }
  return rule;
}

export interface CaseCandidate {
  caseId: string;
  customerId: string;
  customerName: string;
  overdueDue: number;
  oldestDueDate: Date | null;
  lastSentAt: Date | null;
  eligible: boolean;
  reachable: ReminderChannel[];
  reason: RemindBlockReason | null;
  reasonMessage: string | null;
}

/** Dossiers et éligibilité à une relance maintenant (avec les canaux joignables). */
export async function loadCandidates(
  tenantDb: TenantDb,
  where: { caseIds?: string[] },
  now: Date,
  timeZone: string,
): Promise<CaseCandidate[]> {
  const cases = await tenantDb.collectionCase.findMany({
    where: where.caseIds
      ? { id: { in: where.caseIds } }
      : { status: { in: ["OPEN", "PROMISED", "ESCALATED"] }, overdueDue: { gt: 0 } },
    orderBy: [{ overdueDue: "desc" }, { id: "asc" }],
    take: 300,
    include: {
      customer: {
        select: {
          id: true,
          displayName: true,
          type: true,
          doNotRemind: true,
          phone: true,
          whatsappPhone: true,
          email: true,
          contacts: {
            where: { deletedAt: null, receivesInvoices: true },
            select: { phone: true, email: true },
          },
        },
      },
    },
  });
  const customerIds = cases.map((c) => c.customerId);
  const [sent, pending] = await Promise.all([
    tenantDb.reminder.findMany({
      where: { customerId: { in: customerIds }, type: "RECEIVABLE", status: "SENT" },
      orderBy: { sentAt: "desc" },
      select: { customerId: true, sentAt: true },
    }),
    tenantDb.reminder.findMany({
      where: {
        customerId: { in: customerIds },
        type: "RECEIVABLE",
        status: { in: ["PLANNED", "QUEUED"] },
        scheduledFor: { lte: now },
      },
      select: { customerId: true },
    }),
  ]);
  const lastSent = new Map<string, Date>();
  for (const r of sent)
    if (r.sentAt && !lastSent.has(r.customerId)) lastSent.set(r.customerId, r.sentAt);
  const pendingSet = new Set(pending.map((r) => r.customerId));

  return cases.map((c) => {
    const contact = c.customer.contacts[0];
    // Entreprise : contact « reçoit les factures » d'abord (comme le dispatch, RG-M09).
    const phone = mobile(contact?.phone) ?? mobile(c.customer.phone);
    const addresses: Partial<Record<ReminderChannel, string | null>> = {
      WHATSAPP: mobile(c.customer.whatsappPhone) ?? phone,
      SMS: phone,
      EMAIL: contact?.email ?? c.customer.email,
    };
    const result = remindEligibility({
      caseStatus: c.status,
      overdueDue: c.overdueDue,
      doNotRemind: c.customer.doNotRemind,
      addresses,
      lastSentAt: lastSent.get(c.customerId) ?? null,
      hasPendingDue: pendingSet.has(c.customerId),
      now,
    });
    return {
      caseId: c.id,
      customerId: c.customerId,
      customerName: c.customer.displayName,
      overdueDue: c.overdueDue,
      oldestDueDate: c.oldestDueDate,
      lastSentAt: lastSent.get(c.customerId) ?? null,
      eligible: result.eligible,
      reachable: result.eligible ? result.reachable : reachableChannels(addresses),
      reason: result.eligible ? null : result.reason,
      reasonMessage: result.eligible
        ? null
        : blockMessage(result.reason, result.nextAllowedAt, timeZone),
    };
  });
}

function reachableChannels(addresses: Partial<Record<ReminderChannel, string | null>>) {
  return (["WHATSAPP", "SMS", "EMAIL"] as const).filter((channel) => !!addresses[channel]);
}

/** Crée les relances (une par canal utilisable) d'un dossier éligible. */
export async function createCaseReminders(
  tenantDb: TenantDb,
  input: {
    organizationId: string;
    membershipId: string;
    ruleId: string;
    candidate: CaseCandidate;
    channels: ReminderChannel[];
    now: Date;
    today: Date;
  },
): Promise<number> {
  const { candidate, now } = input;
  for (const channel of input.channels) {
    await tenantDb.reminder.create({
      data: {
        organizationId: input.organizationId,
        ruleId: input.ruleId,
        type: "RECEIVABLE",
        stepKey: "MANUAL",
        customerId: candidate.customerId,
        dueDate: input.today,
        scheduledFor: now,
        status: "PLANNED",
        channel,
        priority: 1,
        approvedById: input.membershipId,
        approvedAt: now,
        dedupeKey: `${buildManualDedupeKey("RECEIVABLE", candidate.caseId, now)}:${channel}`,
        sequenceKey: `RECEIVABLE:${candidate.customerId}:manual`,
      },
    });
  }
  const labels = input.channels
    .map((c) => (c === "WHATSAPP" ? "WhatsApp" : c === "SMS" ? "SMS" : "email"))
    .join(", ");
  await tenantDb.collectionNote.create({
    data: {
      organizationId: input.organizationId,
      collectionCaseId: candidate.caseId,
      type: "note",
      body: `Relance envoyée manuellement par ${labels}.`,
      createdById: input.membershipId,
    },
  });
  return input.channels.length;
}

export { channelsToSend };

/** Adresses utilisables d'un client par canal (mobile pour WhatsApp/SMS, email). */
export async function loadCustomerAddresses(
  tenantDb: TenantDb,
  customerId: string,
): Promise<Partial<Record<ReminderChannel, string | null>>> {
  const customer = await tenantDb.customer.findFirst({
    where: { id: customerId },
    select: {
      phone: true,
      whatsappPhone: true,
      email: true,
      contacts: {
        where: { deletedAt: null, receivesInvoices: true },
        select: { phone: true, email: true },
      },
    },
  });
  if (!customer) return {};
  const contact = customer.contacts[0];
  const phone = mobile(contact?.phone) ?? mobile(customer.phone);
  return {
    WHATSAPP: mobile(customer.whatsappPhone) ?? phone,
    SMS: phone,
    EMAIL: contact?.email ?? customer.email,
  };
}
