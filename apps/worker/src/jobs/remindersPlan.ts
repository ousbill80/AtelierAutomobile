// §9.1 — job horaire `reminders.plan` (verrou par organisation : organisations traitées
// séquentiellement, chacune dans ses propres transactions).
//
// Écarts documentés (cf. message de commit) :
// - `RECOMMENDED_WORK` (A8) : aucun candidat généré, `VehicleRecommendation` (M04) n'existe
//   pas encore dans schema.prisma.
// - `VEHICLE_READY` : l'ancre « passage en READY » est approximée par `RepairOrder.updatedAt`
//   (aucun horodatage dédié dans le modèle actuel ; à corriger quand M04 ajoute `readyAt`).
// - RG-M10-08 (règle « dernière facture Entretien ») : seuls `Vehicle.lastServiceDate` /
//   `lastServiceMileage` sont utilisés ; le repli sur la dernière facture de catégorie
//   « Entretien » n'est pas implémenté (nécessiterait une convention de catégorie M08/M07
//   non normalisée à ce stade).
import { adminDb, db } from "@atelieros/db";

type TenantDb = ReturnType<typeof db.forTenant>;
import {
  addDays,
  buildDedupeKey,
  buildSequenceKey,
  initialStatus,
  nextSendSlot,
  pickChannel,
  pickStep,
  priorityOf,
  approvalExpiry,
  stepsToSupersede,
  targetDate,
  type Channel,
  type PickStepHistoryEntry,
  type PickStepRuleStep,
} from "@atelieros/core";
import {
  DEFAULT_REMINDER_SETTINGS,
  reminderSettingsSchema,
  reminderStepSchema,
  reminderSendWindowSchema,
  type ReminderSettingsInput,
  type ReminderStepInput,
} from "@atelieros/validators";
import { z } from "zod";
import { logger } from "../logger";
import {
  resolveChannelCandidates,
  resolveRecipient,
  type RecipientCustomerLike,
} from "./reminderChannel";

interface Candidate {
  entityId: string;
  customerId: string;
  vehicleId?: string;
  invoiceId?: string;
  appointmentId?: string;
  quoteId?: string;
  /** Solde en retard (RECEIVABLE uniquement) : comparé à `conditions.minAmount` (RG-M10-04). */
  amount?: number;
  /** Une ancre par valeur d'`anchor` de palier réellement utilisée (RG-M10-03). */
  anchors: Partial<Record<"default" | "sentAt" | "validUntil", Date>>;
}

const DEFAULT_MIN_RECEIVABLE_AMOUNT = 2_000;

interface EligibilityFacts {
  customerDeletedAt: Date | null;
  remindersConsent: boolean;
  doNotRemind: boolean;
  optedOut: boolean;
  customer: RecipientCustomerLike | null;
}

const TRANSACTIONAL_TYPES = new Set(["APPOINTMENT", "VEHICLE_READY"]);

function isEligible(type: string, facts: EligibilityFacts): boolean {
  if (facts.customerDeletedAt) return false;
  if (facts.doNotRemind) return false;
  if (TRANSACTIONAL_TYPES.has(type)) return true;
  if (!facts.remindersConsent) return false;
  if (facts.optedOut) return false;
  return true;
}

async function loadSettings(organizationId: string): Promise<ReminderSettingsInput> {
  const org = await adminDb.organization.findUnique({ where: { id: organizationId } });
  const raw = (org?.settings as { reminders?: unknown } | null)?.reminders ?? {};
  return reminderSettingsSchema.catch(DEFAULT_REMINDER_SETTINGS).parse(raw);
}

const stepsSchema = z.array(reminderStepSchema);

function groupStepsByAnchor(
  steps: readonly ReminderStepInput[],
): Map<"default" | "sentAt" | "validUntil", ReminderStepInput[]> {
  const groups = new Map<"default" | "sentAt" | "validUntil", ReminderStepInput[]>();
  for (const step of steps) {
    const key = step.anchor;
    const list = groups.get(key) ?? [];
    list.push(step);
    groups.set(key, list);
  }
  return groups;
}

async function isSuppressed(
  tenantDb: TenantDb,
  input: { sequenceKey: string; customerId: string; vehicleId?: string; type: string },
  now: Date,
): Promise<boolean> {
  const suppressions = await tenantDb.reminderSuppression.findMany({
    where: {
      OR: [
        { sequenceKey: input.sequenceKey },
        { customerId: input.customerId, type: input.type as never, vehicleId: null },
        ...(input.vehicleId ? [{ vehicleId: input.vehicleId, type: input.type as never }] : []),
      ],
    },
  });
  return suppressions.some((s) => s.until === null || s.until.getTime() > now.getTime());
}

// ───────────────────────────── Candidats par type (RG-M10-01) ─────────────────────────────

async function inspectionCandidates(tenantDb: TenantDb, today: Date): Promise<Candidate[]> {
  const from = addDays(today, -60);
  const to = addDays(today, 45);
  const vehicles = await tenantDb.vehicle.findMany({
    where: { deletedAt: null, inspectionExpiryDate: { gte: from, lte: to } },
    select: { id: true, customerId: true, inspectionExpiryDate: true, inspectionLastDate: true },
  });
  const out: Candidate[] = [];
  for (const v of vehicles) {
    if (!v.inspectionExpiryDate) continue;
    // RG-M10-30 : garde-fous de données — on ignore les dates manifestement incohérentes.
    const tooFar = v.inspectionExpiryDate.getTime() > addDays(today, 730).getTime();
    const inverted = v.inspectionLastDate && v.inspectionLastDate > v.inspectionExpiryDate;
    if (tooFar || inverted) {
      await tenantDb.vehicle.update({
        where: { id: v.id },
        data: { dataQualityFlags: { push: "inspection_date_suspect" } },
      });
      continue;
    }
    out.push({
      entityId: v.id,
      customerId: v.customerId,
      vehicleId: v.id,
      anchors: { default: v.inspectionExpiryDate },
    });
  }
  return out;
}

async function serviceCandidates(tenantDb: TenantDb, today: Date): Promise<Candidate[]> {
  const from = addDays(today, -90);
  const to = addDays(today, 30);
  const vehicles = await tenantDb.vehicle.findMany({
    where: { deletedAt: null, nextServiceDueDate: { gte: from, lte: to } },
    select: { id: true, customerId: true, nextServiceDueDate: true },
  });
  return vehicles
    .filter((v) => v.nextServiceDueDate)
    .map((v) => ({
      entityId: v.id,
      customerId: v.customerId,
      vehicleId: v.id,
      anchors: { default: v.nextServiceDueDate! },
    }));
}

/** RG-M10-01 : dossiers `OPEN`/`ESCALATED`, ancre = plus ancienne échéance en retard. */
async function receivableCaseCandidates(tenantDb: TenantDb): Promise<Candidate[]> {
  const cases = await tenantDb.collectionCase.findMany({
    where: { status: { in: ["OPEN", "ESCALATED"] } },
    select: { id: true, customerId: true, oldestDueDate: true, totalDue: true },
  });
  return cases
    .filter((c) => c.oldestDueDate)
    .map((c) => ({
      entityId: c.id,
      customerId: c.customerId,
      amount: c.totalDue,
      anchors: { default: c.oldestDueDate! },
    }));
}

/** RG-M10-01 (ligne « avant échéance ») : factures entreprises, ancre = échéance à venir. */
async function receivableInvoiceCandidates(tenantDb: TenantDb): Promise<Candidate[]> {
  const invoices = await tenantDb.invoice.findMany({
    where: {
      status: { in: ["ISSUED", "PARTIALLY_PAID"] },
      customer: { type: "COMPANY", paymentTermsDays: { gt: 0 } },
    },
    select: { id: true, customerId: true, vehicleId: true, dueDate: true, balance: true },
  });
  return invoices
    .filter((i) => i.dueDate)
    .map((i) => ({
      entityId: i.id,
      customerId: i.customerId,
      vehicleId: i.vehicleId ?? undefined,
      invoiceId: i.id,
      amount: i.balance,
      anchors: { default: i.dueDate! },
    }));
}

async function appointmentCandidates(tenantDb: TenantDb, today: Date): Promise<Candidate[]> {
  const appointments = await tenantDb.appointment.findMany({
    where: { status: { in: ["BOOKED", "CONFIRMED"] }, startsAt: { gte: today } },
    select: { id: true, customerId: true, vehicleId: true, startsAt: true },
  });
  return appointments.map((a) => ({
    entityId: a.id,
    customerId: a.customerId,
    vehicleId: a.vehicleId ?? undefined,
    appointmentId: a.id,
    anchors: { default: a.startsAt },
  }));
}

async function quoteFollowupCandidates(tenantDb: TenantDb): Promise<Candidate[]> {
  const quotes = await tenantDb.quote.findMany({
    where: { status: { in: ["SENT", "VIEWED"] } },
    select: { id: true, customerId: true, vehicleId: true, sentAt: true, validUntil: true },
  });
  return quotes
    .filter((q) => q.sentAt)
    .map((q) => ({
      entityId: q.id,
      customerId: q.customerId,
      vehicleId: q.vehicleId ?? undefined,
      quoteId: q.id,
      anchors: { sentAt: q.sentAt!, validUntil: q.validUntil },
    }));
}

async function vehicleReadyCandidates(tenantDb: TenantDb): Promise<Candidate[]> {
  const orders = await tenantDb.repairOrder.findMany({
    where: { status: "READY" },
    select: { id: true, customerId: true, vehicleId: true, updatedAt: true },
  });
  return orders.map((o) => ({
    entityId: o.id,
    customerId: o.customerId,
    vehicleId: o.vehicleId,
    anchors: { default: o.updatedAt },
  }));
}

async function insuranceExpiryCandidates(tenantDb: TenantDb, today: Date): Promise<Candidate[]> {
  const to = addDays(today, 30);
  const vehicles = await tenantDb.vehicle.findMany({
    where: { deletedAt: null, insuranceExpiryDate: { gte: today, lte: to } },
    select: { id: true, customerId: true, insuranceExpiryDate: true },
  });
  return vehicles
    .filter((v) => v.insuranceExpiryDate)
    .map((v) => ({
      entityId: v.id,
      customerId: v.customerId,
      vehicleId: v.id,
      anchors: { default: v.insuranceExpiryDate! },
    }));
}

async function satisfactionCandidates(tenantDb: TenantDb): Promise<Candidate[]> {
  const orders = await tenantDb.repairOrder.findMany({
    where: { status: "DELIVERED", deliveredAt: { not: null } },
    select: { id: true, customerId: true, vehicleId: true, deliveredAt: true },
  });
  const disputedCustomerIds = new Set(
    (
      await tenantDb.collectionCase.findMany({
        where: { status: { in: ["ESCALATED", "DISPUTED"] } },
        select: { customerId: true },
      })
    ).map((c) => c.customerId),
  );
  return orders
    .filter((o) => o.deliveredAt && !disputedCustomerIds.has(o.customerId))
    .map((o) => ({
      entityId: o.id,
      customerId: o.customerId,
      vehicleId: o.vehicleId,
      anchors: { default: o.deliveredAt! },
    }));
}

async function candidatesFor(
  type: string,
  tenantDb: TenantDb,
  today: Date,
  usesInvoiceAnchor: boolean,
): Promise<Candidate[]> {
  switch (type) {
    case "INSPECTION":
      return inspectionCandidates(tenantDb, today);
    case "SERVICE":
      return serviceCandidates(tenantDb, today);
    case "RECEIVABLE":
      return usesInvoiceAnchor
        ? receivableInvoiceCandidates(tenantDb)
        : receivableCaseCandidates(tenantDb);
    case "APPOINTMENT":
      return appointmentCandidates(tenantDb, today);
    case "QUOTE_FOLLOWUP":
      return quoteFollowupCandidates(tenantDb);
    case "VEHICLE_READY":
      return vehicleReadyCandidates(tenantDb);
    case "INSURANCE_EXPIRY":
      return insuranceExpiryCandidates(tenantDb, today);
    case "SATISFACTION":
      return satisfactionCandidates(tenantDb);
    default:
      return []; // RECOMMENDED_WORK, CUSTOM : pas de source générique
  }
}

export async function processRemindersPlanJob(): Promise<void> {
  const organizations = await adminDb.organization.findMany({
    select: { id: true, timezone: true, operatingMode: true },
  });

  for (const org of organizations) {
    try {
      await planForOrganization(org.id, org.timezone, org.operatingMode);
    } catch (error) {
      logger.error(
        { organizationId: org.id, error: error instanceof Error ? error.message : error },
        "reminders.plan : échec sur une organisation, passage à la suivante",
      );
    }
  }
}

async function planForOrganization(
  organizationId: string,
  timeZone: string,
  operatingMode: string,
): Promise<void> {
  const settings = await loadSettings(organizationId);
  if (settings.approvalMode === "PAUSED") return;

  const tenantDb = db.forTenant({ organizationId });
  const now = new Date();
  const today = now;
  const inWarmup = settings.warmupUntil ? new Date(settings.warmupUntil) > now : false;

  const rules = await tenantDb.reminderRule.findMany({ where: { isActive: true } });

  for (const rule of rules) {
    const steps = stepsSchema.parse(rule.steps);
    const sendWindow = reminderSendWindowSchema.parse(rule.sendWindow);
    const usesInvoiceAnchor = steps.some((s) => s.offsetDays < 0) && rule.type === "RECEIVABLE";
    const existingCountForRule = await tenantDb.reminder.count({ where: { ruleId: rule.id } });
    const isFirstRunOfRule = existingCountForRule === 0;

    const candidates = await candidatesFor(rule.type, tenantDb, today, usesInvoiceAnchor);
    const anchorGroups = groupStepsByAnchor(steps);

    const minAmount =
      rule.type === "RECEIVABLE"
        ? ((rule.conditions as { minAmount?: number } | null)?.minAmount ??
          DEFAULT_MIN_RECEIVABLE_AMOUNT)
        : 0;

    for (const candidate of candidates) {
      if (rule.type === "RECEIVABLE" && (candidate.amount ?? 0) < minAmount) continue;
      const facts: EligibilityFacts = await loadEligibilityFacts(tenantDb, candidate.customerId);
      if (!isEligible(rule.type, facts)) continue;

      for (const [anchorKind, groupSteps] of anchorGroups) {
        const anchor = candidate.anchors[anchorKind];
        if (!anchor) continue;

        const seqKey = buildSequenceKey({ type: rule.type, entityId: candidate.entityId, anchor });
        if (
          await isSuppressed(
            tenantDb,
            {
              sequenceKey: seqKey,
              customerId: candidate.customerId,
              vehicleId: candidate.vehicleId,
              type: rule.type,
            },
            now,
          )
        ) {
          continue;
        }

        const history: PickStepHistoryEntry[] = (
          await tenantDb.reminder.findMany({
            where: { sequenceKey: seqKey },
            select: { stepKey: true, status: true, sentAt: true },
          })
        ).map((r) => ({ stepKey: r.stepKey, status: r.status, sentAt: r.sentAt }));

        const ruleSteps: PickStepRuleStep[] = groupSteps.map((s) => ({
          key: s.key,
          offsetDays: s.offsetDays,
          catchUpDays: s.catchUpDays,
        }));
        const pick = pickStep({
          steps: ruleSteps,
          anchor,
          today,
          history,
          minGapDays: settings.minGapDays,
          defaultCatchUpDays: settings.catchUpDays,
        });
        if (!pick) continue;

        const step = groupSteps.find((s) => s.key === pick.step.key)!;
        const dedupeKey = buildDedupeKey(seqKey, step.key);
        const scheduledFor = nextSendSlot({
          target: pick.notBefore ?? targetDate(anchor, step),
          offsetDays: step.offsetDays,
          sendWindow,
          sendAt: step.sendAt,
          timeZone,
          now,
        });
        const status = initialStatus({
          step: {
            internalOnly: step.internalOnly,
            autoSend: step.autoSend,
            requiresPermission: step.requiresPermission,
          },
          catchUp: pick.catchUp,
          isFirstRunOfRule,
          approvalMode: settings.approvalMode,
          inWarmup,
          isReceivable: rule.type === "RECEIVABLE",
          operatingMode: operatingMode as "FULL" | "REMINDERS_ONLY",
          dataAgeHours:
            operatingMode === "REMINDERS_ONLY" ? await dataAgeHours(organizationId) : null,
          maxDataAgeHours: settings.maxDataAgeHours,
        });

        // RG-M10-31 : un canal préliminaire est posé dès la planification (pas seulement à
        // l'envoi) pour que la relance apparaisse d'emblée dans « À appeler » quand aucun
        // canal n'est exploitable, plutôt que dans « À valider ». Re-résolu (et prioritaire)
        // par reminders.dispatch au moment de l'envoi, RG-M10-24.
        let preliminaryChannel: Channel | null = null;
        if (!step.internalOnly && step.channels.length > 0 && facts.customer) {
          const recipient = await resolveRecipient(
            tenantDb,
            facts.customer as RecipientCustomerLike,
            rule.type,
          );
          if (recipient) {
            const { candidates } = await resolveChannelCandidates(
              tenantDb,
              recipient,
              step.channels as Channel[],
            );
            const picked = pickChannel({ candidates });
            preliminaryChannel = picked.channel;
          }
        }

        try {
          const created = await tenantDb.reminder.create({
            data: {
              organizationId,
              ruleId: rule.id,
              type: rule.type,
              stepKey: step.key,
              customerId: candidate.customerId,
              vehicleId: candidate.vehicleId,
              invoiceId: candidate.invoiceId,
              appointmentId: candidate.appointmentId,
              quoteId: candidate.quoteId,
              dueDate: anchor,
              scheduledFor,
              status,
              channel: preliminaryChannel,
              priority: priorityOf(rule.type as never, step),
              dedupeKey,
              sequenceKey: seqKey,
              approvalExpiresAt:
                status === "NEEDS_APPROVAL" ? approvalExpiry(ruleSteps, anchor, pick.step) : null,
              isCatchUp: pick.catchUp,
            },
          });

          const toSupersede = stepsToSupersede(ruleSteps, step.key, history);
          if (toSupersede.length > 0) {
            await tenantDb.reminder.updateMany({
              where: {
                sequenceKey: seqKey,
                stepKey: { in: toSupersede.map((s) => s.stepKey) },
                status: { in: ["PLANNED", "NEEDS_APPROVAL", "SNOOZED"] },
              },
              data: {
                status: "CANCELLED",
                skippedReason: `Remplacé par le palier ${step.key}`,
                supersededById: created.id,
              },
            });
          }
        } catch (error) {
          // Contrainte unique (organizationId, dedupeKey) : déjà créé par un passage
          // concurrent (ON CONFLICT DO NOTHING, RG-M10-05).
          const isUniqueViolation =
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "P2002";
          if (!isUniqueViolation) throw error;
        }
      }
    }
  }
}

async function loadEligibilityFacts(
  tenantDb: TenantDb,
  customerId: string,
): Promise<EligibilityFacts> {
  const customer = await tenantDb.customer.findFirst({
    where: { id: customerId },
    select: {
      id: true,
      type: true,
      deletedAt: true,
      remindersConsent: true,
      doNotRemind: true,
      phone: true,
      phone2: true,
      whatsappPhone: true,
      email: true,
    },
  });
  if (!customer) {
    return {
      customerDeletedAt: new Date(0),
      remindersConsent: false,
      doNotRemind: true,
      optedOut: false,
      customer: null,
    };
  }
  const addresses = [
    customer.phone,
    customer.phone2,
    customer.whatsappPhone,
    customer.email,
  ].filter((a): a is string => !!a);
  const optOuts =
    addresses.length > 0
      ? await tenantDb.optOut.findMany({ where: { address: { in: addresses } } })
      : [];
  return {
    customerDeletedAt: customer.deletedAt,
    remindersConsent: customer.remindersConsent,
    doNotRemind: customer.doNotRemind,
    optedOut: optOuts.length > 0,
    customer,
  };
}

async function dataAgeHours(organizationId: string): Promise<number | null> {
  const lastImport = await adminDb.importJob.findFirst({
    where: { organizationId, status: "COMPLETED", finishedAt: { not: null } },
    orderBy: { finishedAt: "desc" },
  });
  if (!lastImport?.finishedAt) return null;
  return (Date.now() - lastImport.finishedAt.getTime()) / (60 * 60 * 1000);
}
