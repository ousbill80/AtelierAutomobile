// §9.3 — consommateur `reminders.on_event` (RG-M10-22), idempotent par `eventId`
// (= `DomainEvent.id`, sondage de la table plutôt qu'une vraie file : voir
// `apps/web/src/server/events/emit.ts`).
//
// Écarts documentés (cf. message de commit) :
// - Seuls les producteurs déjà câblés émettent réellement ces événements aujourd'hui
//   (`message.inbound_received`, M11). Les autres (appointment.*, payment.received,
//   collection.*, quote.*, vehicle.*, repair_order.*) nécessitent M03/M04/M05/M08/M09, qui
//   n'existent pas encore comme modules métier : ce consommateur est prêt à les traiter dès
//   qu'ils émettront ces événements, mais n'est pas exercé en pratique avant cette étape.
// - L'attribution PAID/PARTIALLY_PAID (RG-M10-27) n'est jamais posée ici : une seule règle
//   d'attribution, possédée par M12 (`04-arbitrages-coherence.md` A10), via
//   `core/receivables/attribution` + `PaymentAttribution` (pas encore construits).
import { adminDb, db, type Prisma } from "@atelieros/db";
import { strongerOutcome, type ReminderOutcomeLike } from "@atelieros/core";
import { logger } from "../logger";
import { handleAppointmentEvent } from "./appointments";

type TenantDb = ReturnType<typeof db.forTenant>;

const NON_TRANSACTIONAL_TYPES = [
  "INSPECTION",
  "SERVICE",
  "RECEIVABLE",
  "QUOTE_FOLLOWUP",
  "INSURANCE_EXPIRY",
  "SATISFACTION",
  "RECOMMENDED_WORK",
  "CUSTOM",
] as const;

const CANCELLABLE_STATUSES = ["PLANNED", "NEEDS_APPROVAL", "SNOOZED"] as const;

async function cancelReminders(
  tenantDb: TenantDb,
  where: Prisma.ReminderWhereInput,
  reason: string,
): Promise<void> {
  await tenantDb.reminder.updateMany({
    where: { ...where, status: { in: [...CANCELLABLE_STATUSES] } },
    data: { status: "CANCELLED", skippedReason: reason },
  });
}

async function recordOutcome(
  tenantDb: TenantDb,
  where: Prisma.ReminderWhereInput,
  outcome: ReminderOutcomeLike,
  windowHours: number,
  now: Date,
): Promise<void> {
  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const lastSent = await tenantDb.reminder.findFirst({
    where: { ...where, status: "SENT", sentAt: { gte: since } },
    orderBy: { sentAt: "desc" },
  });
  if (!lastSent) return;
  const resolved = strongerOutcome(lastSent.outcome as ReminderOutcomeLike | null, outcome);
  await tenantDb.reminder.update({
    where: { id: lastSent.id },
    data: { outcome: resolved, outcomeAt: now },
  });
}

interface EventRow {
  id: string;
  organizationId: string;
  type: string;
  payload: unknown;
  occurredAt: Date;
}

async function handleEvent(event: EventRow, now: Date): Promise<void> {
  const tenantDb = db.forTenant({ organizationId: event.organizationId });
  const payload = (event.payload ?? {}) as Record<string, unknown>;

  switch (event.type) {
    case "appointment.created": {
      const vehicleId = payload.vehicleId as string | undefined;
      const customerId = payload.customerId as string | undefined;
      const startsAt = payload.startsAt ? new Date(payload.startsAt as string) : now;
      const where: Prisma.ReminderWhereInput = vehicleId ? { vehicleId } : { customerId };
      await cancelReminders(
        tenantDb,
        { ...where, type: { in: ["INSPECTION", "SERVICE", "QUOTE_FOLLOWUP"] } },
        "Rendez-vous pris.",
      );
      if (vehicleId) {
        await tenantDb.reminderSuppression.create({
          data: {
            organizationId: event.organizationId,
            vehicleId,
            type: "INSPECTION",
            until: new Date(startsAt.getTime() + 24 * 60 * 60 * 1000),
            reason: "RDV pris",
            source: "appointment",
          },
        });
      }
      await recordOutcome(tenantDb, where, "APPOINTMENT_BOOKED", 24 * 30, now);
      break;
    }
    case "appointment.cancelled":
    case "appointment.updated": {
      const vehicleId = payload.vehicleId as string | undefined;
      if (vehicleId) {
        await tenantDb.reminderSuppression.deleteMany({
          where: { vehicleId, source: "appointment" },
        });
      }
      break;
    }
    case "repair_order.created": {
      const vehicleId = payload.vehicleId as string | undefined;
      const customerId = payload.customerId as string | undefined;
      const where: Prisma.ReminderWhereInput = vehicleId ? { vehicleId } : { customerId };
      await cancelReminders(
        tenantDb,
        { ...where, type: { in: ["INSPECTION", "SERVICE", "QUOTE_FOLLOWUP"] } },
        "Client venu sans rendez-vous.",
      );
      await recordOutcome(tenantDb, where, "VISITED", 24 * 30, now);
      break;
    }
    case "repair_order.status_changed": {
      if (payload.newStatus === "DELIVERED" && payload.vehicleId) {
        const where: Prisma.ReminderWhereInput = {
          vehicleId: payload.vehicleId as string,
          type: "VEHICLE_READY",
        };
        await cancelReminders(tenantDb, where, "Véhicule livré.");
        await recordOutcome(tenantDb, where, "VEHICLE_PICKED_UP", 24 * 7, now);
      }
      break;
    }
    case "vehicle.inspection_updated": {
      const vehicleId = payload.vehicleId as string | undefined;
      if (vehicleId) {
        await cancelReminders(
          tenantDb,
          { vehicleId, type: "INSPECTION" },
          "Visite technique renseignée.",
        );
      }
      break;
    }
    case "vehicle.service_recorded": {
      const vehicleId = payload.vehicleId as string | undefined;
      if (vehicleId) {
        await cancelReminders(tenantDb, { vehicleId, type: "SERVICE" }, "Révision enregistrée.");
      }
      break;
    }
    case "vehicle.owner_changed": {
      const vehicleId = payload.vehicleId as string | undefined;
      const previousCustomerId = payload.previousCustomerId as string | undefined;
      if (vehicleId && previousCustomerId) {
        await cancelReminders(
          tenantDb,
          { vehicleId, customerId: previousCustomerId },
          "Véhicule cédé à un nouveau propriétaire.",
        );
      }
      break;
    }
    case "vehicle.insurance_updated": {
      const vehicleId = payload.vehicleId as string | undefined;
      if (vehicleId) {
        await cancelReminders(
          tenantDb,
          { vehicleId, type: "INSURANCE_EXPIRY" },
          "Assurance mise à jour.",
        );
      }
      break;
    }
    case "payment.received": {
      const caseId = payload.caseId as string | undefined;
      if (caseId) {
        const kase = await tenantDb.collectionCase.findFirst({ where: { id: caseId } });
        if (kase && kase.totalDue <= 0) {
          await cancelReminders(
            tenantDb,
            { type: "RECEIVABLE", customerId: kase.customerId },
            "Dossier soldé.",
          );
        }
      }
      break;
    }
    case "collection.promised":
    case "collection.disputed":
    case "collection.paused": {
      const caseId = payload.caseId as string | undefined;
      const customerId = payload.customerId as string | undefined;
      if (caseId || customerId) {
        await cancelReminders(
          tenantDb,
          { type: "RECEIVABLE", ...(customerId ? { customerId } : {}) },
          "Dossier de recouvrement : promesse, litige ou pause.",
        );
      }
      break;
    }
    case "quote.accepted":
    case "quote.declined":
    case "quote.expired": {
      const quoteId = payload.quoteId as string | undefined;
      if (quoteId) {
        await cancelReminders(tenantDb, { quoteId }, "Devis décidé.");
        if (event.type === "quote.accepted") {
          await recordOutcome(tenantDb, { quoteId }, "QUOTE_ACCEPTED", 24 * 7, now);
        }
      }
      break;
    }
    case "message.inbound_received": {
      const address = payload.address as string | undefined;
      const customerId = payload.customerId as string | undefined;
      const stop = payload.stop === true;
      if (!address) break;
      const where: Prisma.ReminderWhereInput = customerId ? { customerId } : {};
      if (stop) {
        await cancelReminders(
          tenantDb,
          { ...where, type: { in: [...NON_TRANSACTIONAL_TYPES] } },
          "Client désinscrit (STOP).",
        );
        await recordOutcome(tenantDb, where, "OPTED_OUT", 72, now);
      } else if (customerId) {
        await recordOutcome(tenantDb, where, "REPLIED", 72, now);
        // RG-M10-22 : suspend 48h (settings.reminders.pauseOnReplyHours) les séquences de ce
        // client pour laisser le temps à un humain de répondre.
        const activeSequences = await tenantDb.reminder.findMany({
          where: { customerId, status: { in: [...CANCELLABLE_STATUSES] } },
          select: { sequenceKey: true },
          distinct: ["sequenceKey"],
        });
        for (const { sequenceKey } of activeSequences) {
          if (!sequenceKey) continue;
          await tenantDb.reminderSuppression.create({
            data: {
              organizationId: event.organizationId,
              sequenceKey,
              until: new Date(now.getTime() + 48 * 60 * 60 * 1000),
              reason: "Réponse entrante — pause pour réponse humaine",
              source: "message_reply",
            },
          });
        }
      }
      break;
    }
    case "customer.updated": {
      const customerId = payload.customerId as string | undefined;
      const doNotRemind = payload.doNotRemind === true;
      const consentWithdrawn = payload.remindersConsent === false;
      if (customerId && (doNotRemind || consentWithdrawn)) {
        await cancelReminders(
          tenantDb,
          { customerId, type: { in: [...NON_TRANSACTIONAL_TYPES] } },
          "Client : ne plus relancer / consentement retiré.",
        );
      }
      break;
    }
    default:
      break;
  }
}

export async function processRemindersOnEventJob(): Promise<void> {
  const events = await adminDb.domainEvent.findMany({
    where: { processedAt: null },
    orderBy: { occurredAt: "asc" },
    take: 200,
  });

  for (const event of events) {
    try {
      await handleEvent(event, new Date());
      // M03 : même événement, consommateur RDV (OR livré → COMPLETED, réponses 1/2/3).
      await handleAppointmentEvent(event, new Date());
    } catch (error) {
      logger.error(
        {
          eventId: event.id,
          type: event.type,
          error: error instanceof Error ? error.message : error,
        },
        "reminders.on_event : échec du traitement d'un événement",
      );
    } finally {
      await adminDb.domainEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date() },
      });
    }
  }
}
