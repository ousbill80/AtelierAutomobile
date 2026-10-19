import {
  createContactInputSchema,
  deleteContactInputSchema,
  updateContactInputSchema,
} from "@atelieros/validators";
import { db } from "@atelieros/db";
import { requirePermission, router } from "../trpc";

export const contactRouter = router({
  create: requirePermission("customer:update")
    .input(createContactInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.customerContact.create({
        data: { organizationId: ctx.organizationId, ...input },
      });
    }),

  update: requirePermission("customer:update")
    .input(updateContactInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.customerContact.update({ where: { id: input.id }, data: input.patch });
    }),

  delete: requirePermission("customer:update")
    .input(deleteContactInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      await tenantDb.customerContact.update({
        where: { id: input.id },
        data: { deletedAt: new Date() },
      });
      return { ok: true };
    }),
});
