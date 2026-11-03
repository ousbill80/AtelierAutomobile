// Relance d'échéance depuis l'écran Échéances (M10) : l'utilisateur choisit les véhicules et
// les canaux (WhatsApp, SMS, email). Chaque véhicule × canal donne une relance MANUAL déjà
// approuvée, canal imposé, un message par véhicule ; reminders.dispatch (≤ 5 min) revérifie
// l'échéance, le consentement et les désinscriptions juste avant l'envoi.
import { TRPCError } from "@trpc/server";
import {
  buildManualDedupeKey,
  dueRemindEligibility,
  type DueRemindBlockReason,
  type ReminderChannel,
} from "@atelieros/core";
import type { db } from "@atelieros/db";
import { mobile } from "../receivables/remind";

type TenantDb = ReturnType<typeof db.forTenant>;
export type DueKind = "INSPECTION" | "SERVICE" | "INSURANCE";

const REMINDER_TYPE = {
  INSPECTION: "INSPECTION",
  SERVICE: "SERVICE",
  INSURANCE: "INSURANCE_EXPIRY",
} as const;

const DUE_FIELD = {
  INSPECTION: "inspectionExpiryDate",
  SERVICE: "nextServiceDueDate",
  INSURANCE: "insuranceExpiryDate",
} as const;

/** Autres véhicules du même client proposés dans la même relance : échéance d'ici 60 jours. */
const SUGGEST_WITHIN_DAYS = 60;

const BLOCK_MESSAGES: Record<DueRemindBlockReason, string> = {
  NO_DATE: "Pas de date d'échéance : enregistrez-la d'abord.",
  DO_NOT_REMIND: "Client marqué « Ne plus relancer » : appelez-le plutôt.",
  NO_CONSENT: "Le client a refusé les relances.",
  NO_CONTACT: "Aucun téléphone mobile ni email : complétez la fiche client.",
  ALREADY_PENDING: "Une relance part déjà pour ce véhicule.",
  RECENTLY_SENT: "Déjà relancé il y a moins de 20 h.",
};

export function reminderTypeFor(kind: DueKind) {
  return REMINDER_TYPE[kind];
}

export interface DueVehicleCandidate {
  vehicleId: string;
  customerId: string;
  customerName: string;
  plate: string;
  label: string;
  dueDate: Date | null;
  /** Véhicule ajouté parce que le client en a un autre à relancer (pas demandé au départ). */
  suggested: boolean;
  eligible: boolean;
  reachable: ReminderChannel[];
  reasonMessage: string | null;
}

/**
 * Véhicules demandés + autres véhicules des mêmes clients dont l'échéance tombe d'ici 60 jours
 * (ou est dépassée), avec l'éligibilité de chacun.
 */
export async function loadDueCandidates(
  tenantDb: TenantDb,
  kind: DueKind,
  vehicleIds: string[],
  now: Date,
): Promise<DueVehicleCandidate[]> {
  const field = DUE_FIELD[kind];
  const requested = await tenantDb.vehicle.findMany({
    where: { id: { in: vehicleIds }, deletedAt: null },
    select: { id: true, customerId: true },
  });
  const customerIds = [...new Set(requested.map((v) => v.customerId))];
  const limit = new Date(now.getTime() + SUGGEST_WITHIN_DAYS * 86_400_000);
  const vehicles = await tenantDb.vehicle.findMany({
    where: {
      deletedAt: null,
      OR: [
        { id: { in: requested.map((v) => v.id) } },
        { customerId: { in: customerIds }, [field]: { not: null, lte: limit } },
      ],
    },
    orderBy: [{ customerId: "asc" }, { [field]: "asc" }],
    select: {
      id: true,
      plate: true,
      make: true,
      model: true,
      customerId: true,
      inspectionExpiryDate: true,
      nextServiceDueDate: true,
      insuranceExpiryDate: true,
      customer: {
        select: {
          displayName: true,
          doNotRemind: true,
          remindersConsent: true,
          phone: true,
          whatsappPhone: true,
          email: true,
        },
      },
    },
  });
  const ids = vehicles.map((v) => v.id);
  const type = REMINDER_TYPE[kind];
  const [sent, pending] = await Promise.all([
    tenantDb.reminder.findMany({
      where: { vehicleId: { in: ids }, type, status: "SENT" },
      orderBy: { sentAt: "desc" },
      select: { vehicleId: true, sentAt: true },
    }),
    tenantDb.reminder.findMany({
      where: {
        vehicleId: { in: ids },
        type,
        status: { in: ["PLANNED", "QUEUED"] },
        scheduledFor: { lte: now },
      },
      select: { vehicleId: true },
    }),
  ]);
  const lastSent = new Map<string, Date>();
  for (const r of sent) {
    if (r.vehicleId && r.sentAt && !lastSent.has(r.vehicleId)) lastSent.set(r.vehicleId, r.sentAt);
  }
  const pendingSet = new Set(pending.map((r) => r.vehicleId));
  const requestedSet = new Set(vehicleIds);

  // Ordre : celui des véhicules demandés, chaque client suivi de ses autres véhicules.
  const order = new Map(vehicleIds.map((id, index) => [id, index]));
  const firstIndexOf = new Map<string, number>();
  for (const v of requested) {
    const index = order.get(v.id) ?? 0;
    firstIndexOf.set(v.customerId, Math.min(firstIndexOf.get(v.customerId) ?? index, index));
  }
  const sorted = [...vehicles].sort(
    (a, b) =>
      (firstIndexOf.get(a.customerId) ?? 0) - (firstIndexOf.get(b.customerId) ?? 0) ||
      Number(!requestedSet.has(a.id)) - Number(!requestedSet.has(b.id)),
  );

  return sorted.map((v) => {
    const dueDate = v[field];
    const phone = mobile(v.customer.phone);
    const addresses: Partial<Record<ReminderChannel, string | null>> = {
      WHATSAPP: mobile(v.customer.whatsappPhone) ?? phone,
      SMS: phone,
      EMAIL: v.customer.email,
    };
    const result = dueRemindEligibility({
      dueDate,
      doNotRemind: v.customer.doNotRemind,
      remindersConsent: v.customer.remindersConsent,
      addresses,
      lastSentAt: lastSent.get(v.id) ?? null,
      hasPendingDue: pendingSet.has(v.id),
      now,
    });
    return {
      vehicleId: v.id,
      customerId: v.customerId,
      customerName: v.customer.displayName,
      plate: v.plate,
      label: `${v.make} ${v.model}`.trim(),
      dueDate,
      suggested: !requestedSet.has(v.id),
      eligible: result.eligible,
      reachable: result.eligible
        ? result.reachable
        : (["WHATSAPP", "SMS", "EMAIL"] as const).filter((c) => !!addresses[c]),
      reasonMessage: result.eligible ? null : BLOCK_MESSAGES[result.reason],
    };
  });
}

export async function requireDueRule(tenantDb: TenantDb, kind: DueKind) {
  const type = REMINDER_TYPE[kind];
  const rule =
    (await tenantDb.reminderRule.findFirst({
      where: { type, isActive: true },
      select: { id: true },
    })) ?? (await tenantDb.reminderRule.findFirst({ where: { type }, select: { id: true } }));
  if (!rule) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Aucune règle de relance pour ce type d'échéance : créez-la dans Paramètres › Relances.",
    });
  }
  return rule;
}

/** Une relance par canal pour un véhicule éligible (dueDate = échéance, revérifiée à l'envoi). */
export async function createDueReminders(
  tenantDb: TenantDb,
  input: {
    organizationId: string;
    membershipId: string;
    ruleId: string;
    kind: DueKind;
    candidate: DueVehicleCandidate;
    channels: ReminderChannel[];
    now: Date;
  },
): Promise<void> {
  const { candidate, now } = input;
  const type = REMINDER_TYPE[input.kind];
  for (const channel of input.channels) {
    await tenantDb.reminder.create({
      data: {
        organizationId: input.organizationId,
        ruleId: input.ruleId,
        type,
        stepKey: "MANUAL",
        customerId: candidate.customerId,
        vehicleId: candidate.vehicleId,
        dueDate: candidate.dueDate!,
        scheduledFor: now,
        status: "PLANNED",
        channel,
        channelLocked: true,
        priority: 1,
        approvedById: input.membershipId,
        approvedAt: now,
        dedupeKey: `${buildManualDedupeKey(type, candidate.vehicleId, now)}:${channel}`,
        sequenceKey: `${type}:${candidate.vehicleId}:manual`,
      },
    });
  }
}
