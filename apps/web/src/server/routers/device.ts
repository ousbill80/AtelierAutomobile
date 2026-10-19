import { adminDb } from "@atelieros/db";
import { registerSharedDeviceInputSchema } from "@atelieros/validators";
import { requirePermission, router } from "../trpc";

export const deviceRouter = router({
  registerShared: requirePermission("site:manage")
    .input(registerSharedDeviceInputSchema)
    .mutation(async ({ ctx, input }) => {
      await adminDb.trustedDevice.upsert({
        where: { deviceId: input.deviceId },
        create: {
          deviceId: input.deviceId,
          label: input.label,
          organizationId: ctx.organizationId,
          siteId: ctx.session.activeSiteId,
          isSharedWorkshopDevice: true,
        },
        update: {
          label: input.label,
          organizationId: ctx.organizationId,
          siteId: ctx.session.activeSiteId,
          isSharedWorkshopDevice: true,
        },
      });

      return { ok: true as const };
    }),
});
