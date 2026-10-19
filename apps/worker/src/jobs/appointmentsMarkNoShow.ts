// RG-M03-10 — job `appointments.mark_no_show` (toutes les 15 min) : fait passer en `NO_SHOW`
// les RDV du jour encore `BOOKED`/`CONFIRMED` une fois l'heure du job dépassée (heure locale du
// site, défaut 20:00). Reprend aussi la séquence de relance VT/révision suspendue par
// `appointment.created` (RG-M03-12), comme le ferait le consommateur d'événements côté web —
// non réutilisable ici tel quel : ce job vit dans `apps/worker`, le bus d'événements dans
// `apps/web/src/server/events` (pas un package partagé).
import { adminDb, db } from "@atelieros/db";
import { isEligibleForAutoNoShow } from "@atelieros/core";
import { DEFAULT_PLANNING_SETTINGS, planningSettingsSchema } from "@atelieros/validators";
import { logger } from "../logger";

async function loadNoShowJobTime(organizationId: string, timezone: string) {
  const org = await adminDb.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });
  const raw = (org?.settings as { appointments?: unknown } | null)?.appointments ?? {};
  const parsed = planningSettingsSchema.shape.appointments.safeParse({
    ...DEFAULT_PLANNING_SETTINGS.appointments,
    ...(raw as object),
  });
  return {
    noShowJobTime: parsed.success
      ? parsed.data.noShowJobTime
      : DEFAULT_PLANNING_SETTINGS.appointments.noShowJobTime,
    timezone,
  };
}

export async function processAppointmentsMarkNoShowJob(now = new Date()): Promise<void> {
  const organizations = await adminDb.organization.findMany({
    select: { id: true, timezone: true },
  });

  for (const { id: organizationId, timezone } of organizations) {
    try {
      const { noShowJobTime } = await loadNoShowJobTime(organizationId, timezone);
      const tenantDb = db.forTenant({ organizationId });

      const candidates = await tenantDb.appointment.findMany({
        where: { status: { in: ["BOOKED", "CONFIRMED"] }, startsAt: { lte: now } },
        select: { id: true, startsAt: true, status: true, customerId: true, vehicleId: true },
      });

      for (const appointment of candidates) {
        if (
          !isEligibleForAutoNoShow({
            status: appointment.status,
            startsAt: appointment.startsAt,
            now,
            timeZone: timezone,
            noShowJobTime,
          })
        ) {
          continue;
        }

        await tenantDb.transaction(async (tx) => {
          await tx.appointment.update({
            where: { id: appointment.id },
            data: { status: "NO_SHOW", noShowAt: now },
          });
          if (appointment.customerId) {
            await tx.customer.update({
              where: { id: appointment.customerId },
              data: { noShowCount12m: { increment: 1 } },
            });
          }
          if (appointment.vehicleId) {
            // RG-M03-10 : reprise de la séquence VT/révision suspendue à la création du RDV.
            await tx.reminderSuppression.deleteMany({
              where: { vehicleId: appointment.vehicleId, source: "appointment" },
            });
          }
        });
      }
    } catch (error) {
      logger.error(
        { organizationId, error: error instanceof Error ? error.message : error },
        "appointments.mark_no_show : échec sur une organisation, passage à la suivante",
      );
    }
  }
}
