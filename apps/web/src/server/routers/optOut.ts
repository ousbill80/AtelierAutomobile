import { db } from "@atelieros/db";
import { optOutAddInputSchema, optOutRemoveInputSchema } from "@atelieros/validators";
import { requirePermission, router } from "../trpc";

export const optOutRouter = router({
  list: requirePermission("optout:manage").query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    return tenantDb.optOut.findMany({ orderBy: { createdAt: "desc" } });
  }),

  add: requirePermission("optout:manage")
    .input(optOutAddInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.optOut.create({
        data: {
          organizationId: ctx.organizationId,
          address: input.address,
          channel: input.channel ?? null,
          reason: input.reason,
          source: "staff",
        },
      });
    }),

  remove: requirePermission("optout:manage")
    .input(optOutRemoveInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      await tenantDb.optOut.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});
