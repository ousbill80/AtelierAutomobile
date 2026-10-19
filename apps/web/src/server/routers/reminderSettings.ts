import { parseReminderSettings } from "@atelieros/core";
import { adminDb, type Prisma } from "@atelieros/db";
import { updateReminderSettingsInputSchema } from "@atelieros/validators";
import { requirePermission, router } from "../trpc";
import { writeAuditLog } from "../audit";

/** `Organization.settings` regroupe plusieurs sous-objets (onboarding, sécurité…) — ne jamais écraser les autres clés. */
async function mutateOrganizationSettings(
  organizationId: string,
  mutate: (settings: Record<string, unknown>) => Record<string, unknown>,
) {
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const settings = mutate((org.settings as Record<string, unknown>) ?? {});
  await adminDb.organization.update({
    where: { id: organizationId },
    data: { settings: settings as Prisma.InputJsonValue },
  });
  return settings;
}

export const reminderSettingsRouter = router({
  /** M10 §6 — réglages d'organisation (fenêtre, plafonds anti-spam, mode d'approbation…). */
  get: requirePermission("reminder:rules_manage").query(async ({ ctx }) => {
    const org = await adminDb.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
    const settings = (org.settings as { reminders?: unknown } | null)?.reminders;
    return parseReminderSettings(settings);
  }),

  update: requirePermission("reminder:rules_manage")
    .input(updateReminderSettingsInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
      });
      const before = parseReminderSettings(
        (org.settings as { reminders?: unknown } | null)?.reminders,
      );

      const merged = {
        ...before,
        ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
      };
      const after = parseReminderSettings(merged);

      await mutateOrganizationSettings(ctx.organizationId, (settings) => ({
        ...settings,
        reminders: after,
      }));

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "reminder_settings.updated",
        entity: "Organization",
        entityId: ctx.organizationId,
        before,
        after,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return after;
    }),

  /** RG-M10-18 — interrupteur général : met en pause/reprend l'envoi sans toucher aux autres réglages. */
  setApprovalMode: requirePermission("reminder:pause")
    .input(updateReminderSettingsInputSchema.pick({ approvalMode: true }).required())
    .mutation(async ({ ctx, input }) => {
      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
      });
      const before = parseReminderSettings(
        (org.settings as { reminders?: unknown } | null)?.reminders,
      );
      const after = parseReminderSettings({ ...before, approvalMode: input.approvalMode });

      await mutateOrganizationSettings(ctx.organizationId, (settings) => ({
        ...settings,
        reminders: after,
      }));

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "reminder_settings.approval_mode_changed",
        entity: "Organization",
        entityId: ctx.organizationId,
        before: { approvalMode: before.approvalMode },
        after: { approvalMode: after.approvalMode },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return after;
    }),
});
