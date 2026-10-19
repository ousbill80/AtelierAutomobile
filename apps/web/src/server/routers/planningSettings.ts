// M03 §6/§8 — `planningSettings.get/update` (US-M03-10, `Organization.settings.appointments`
// et `.planning`). Les jours fériés ne sont pas ici : source unique `Holiday` (A1, M15).
import { adminDb } from "@atelieros/db";
import { planningSettingsUpdateInputSchema } from "@atelieros/validators";
import { requirePermission, router } from "../trpc";
import { loadPlanningSettings } from "../appointments/helpers";
import { writeAuditLog } from "../audit";

export const planningSettingsRouter = router({
  get: requirePermission("planning:manage").query(async ({ ctx }) => {
    return loadPlanningSettings(ctx.organizationId);
  }),

  update: requirePermission("planning:manage")
    .input(planningSettingsUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      // `Organization` n'est pas un modèle « tenant » : lecture/écriture directe via `adminDb`.
      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
        select: { settings: true },
      });
      const settings = (org.settings as Record<string, unknown>) ?? {};
      const updated = await adminDb.organization.update({
        where: { id: ctx.organizationId },
        data: {
          settings: {
            ...settings,
            appointments: input.appointments,
            planning: input.planning,
          },
        },
        select: { settings: true },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "planningSettings.updated",
        entity: "Organization",
        entityId: ctx.organizationId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return updated.settings;
    }),
});
