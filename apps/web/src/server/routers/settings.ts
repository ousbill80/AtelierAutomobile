import { adminDb } from "@atelieros/db";
import {
  DEFAULT_TAX_SETTINGS,
  getSettingsInputSchema,
  updateSettingsInputSchema,
  type TaxSettings,
} from "@atelieros/validators";
import { requirePermission, router } from "../trpc";
import { writeAuditLog } from "../audit";

// RG-M15-02 — `settings.tax` : seule section de `OrganizationSettingsSchema` dans le périmètre
// de cette étape (1.2). Les autres sections (documents, labor, payments, channels, portal,
// reports, ai, atelier, stock, security, onboarding, costs…) appartiennent à des modules pas
// encore construits et seront ajoutées par eux (étape 6.5 et suivantes).

function readTaxSettings(settings: unknown): Partial<TaxSettings> {
  if (settings && typeof settings === "object" && "tax" in settings) {
    const tax = (settings as { tax?: unknown }).tax;
    if (tax && typeof tax === "object") {
      return tax as Partial<TaxSettings>;
    }
  }
  return {};
}

export const settingsRouter = router({
  get: requirePermission("settings:read")
    .input(getSettingsInputSchema)
    .query(async ({ ctx }) => {
      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
      });
      const tax = { ...DEFAULT_TAX_SETTINGS, ...readTaxSettings(org.settings) };
      return { tax };
    }),

  update: requirePermission("settings:update")
    .input(updateSettingsInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
      });
      const before = { ...DEFAULT_TAX_SETTINGS, ...readTaxSettings(org.settings) };
      const after = { ...before, ...input.values };

      const nextSettings = {
        ...(typeof org.settings === "object" && org.settings ? org.settings : {}),
        tax: after,
      };

      await adminDb.organization.update({
        where: { id: ctx.organizationId },
        data: { settings: nextSettings },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "settings.updated",
        entity: "Organization",
        entityId: ctx.organizationId,
        before: { tax: before },
        after: { tax: after },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { tax: after };
    }),
});
