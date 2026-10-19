// §9.3 — job quotidien (03:30) `reminders.outcomes` : consolide `NO_RESPONSE` quand la
// fenêtre d'attribution d'un type (RG-M10-27) s'est écoulée sans autre résultat. Les
// résultats positifs (APPOINTMENT_BOOKED, REPLIED, OPTED_OUT, …) sont déjà posés en temps
// réel par `reminders.on_event`. L'attribution PAID/PARTIALLY_PAID reste hors périmètre
// (A10, M12 — voir `remindersOnEvent.ts`).
import { adminDb, db } from "@atelieros/db";
import { DEFAULT_REMINDER_SETTINGS, reminderSettingsSchema } from "@atelieros/validators";
import { logger } from "../logger";

const VEHICLE_READY_WINDOW_DAYS = 7;

async function loadAttributionDays(organizationId: string) {
  const org = await adminDb.organization.findUnique({ where: { id: organizationId } });
  const raw = (org?.settings as { reminders?: unknown } | null)?.reminders ?? {};
  const settings = reminderSettingsSchema.catch(DEFAULT_REMINDER_SETTINGS).parse(raw);
  return settings.attributionDays;
}

export async function processRemindersOutcomesJob(): Promise<void> {
  const organizations = await adminDb.organization.findMany({ select: { id: true } });
  const now = new Date();

  for (const { id: organizationId } of organizations) {
    try {
      const attributionDays = await loadAttributionDays(organizationId);
      const tenantDb = db.forTenant({ organizationId });

      const windowDaysByType: Record<string, number> = {
        INSPECTION: attributionDays.INSPECTION,
        SERVICE: attributionDays.SERVICE,
        RECEIVABLE: attributionDays.RECEIVABLE,
        QUOTE_FOLLOWUP: attributionDays.QUOTE_FOLLOWUP,
        VEHICLE_READY: VEHICLE_READY_WINDOW_DAYS,
      };

      for (const [type, windowDays] of Object.entries(windowDaysByType)) {
        const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
        await tenantDb.reminder.updateMany({
          where: { type: type as never, status: "SENT", outcome: null, sentAt: { lte: cutoff } },
          data: { outcome: "NO_RESPONSE", outcomeAt: now },
        });
      }
    } catch (error) {
      logger.error(
        { organizationId, error: error instanceof Error ? error.message : error },
        "reminders.outcomes : échec sur une organisation, passage à la suivante",
      );
    }
  }
}
