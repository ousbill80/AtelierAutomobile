// §8 — routeur `reminderSettings` (Organization.settings.reminders, §6).
// `db.forTenant` ne s'applique pas au modèle `Organization` (il ne porte pas organizationId
// lui-même) : `adminDb` filtré explicitement par id, comme dans `./org.ts`.
import { adminDb } from "@atelieros/db";
import {
  DEFAULT_REMINDER_SETTINGS,
  reminderSettingsSchema,
  reminderSettingsUpdateInputSchema,
} from "@atelieros/validators";
import { requirePermission, router } from "../trpc";

export const reminderSettingsRouter = router({
  get: requirePermission("settings:read").query(async ({ ctx }) => {
    const org = await adminDb.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
    const raw = (org.settings as { reminders?: unknown } | null)?.reminders ?? {};
    return reminderSettingsSchema.catch(DEFAULT_REMINDER_SETTINGS).parse(raw);
  }),

  update: requirePermission("settings:update")
    .input(reminderSettingsUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
      });
      const settings = (org.settings as Record<string, unknown> | null) ?? {};
      const current = reminderSettingsSchema
        .catch(DEFAULT_REMINDER_SETTINGS)
        .parse(settings.reminders ?? {});
      const updated = reminderSettingsSchema.parse({ ...current, ...input });
      await adminDb.organization.update({
        where: { id: ctx.organizationId },
        data: { settings: { ...settings, reminders: updated } },
      });
      return updated;
    }),
});
