import { db } from "@atelieros/db";
import { quickReplyDeleteInputSchema, quickReplyUpsertInputSchema } from "@atelieros/validators";
import { requirePermission, router } from "../trpc";

export const quickReplyRouter = router({
  list: requirePermission("message:send").query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    return tenantDb.quickReply.findMany({ orderBy: { shortcut: "asc" } });
  }),

  upsert: requirePermission("template:manage")
    .input(quickReplyUpsertInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      if (input.id) {
        return tenantDb.quickReply.update({
          where: { id: input.id },
          data: {
            title: input.title,
            shortcut: input.shortcut,
            body: input.body,
            templateKey: input.templateKey,
          },
        });
      }
      return tenantDb.quickReply.create({
        data: {
          organizationId: ctx.organizationId,
          title: input.title,
          shortcut: input.shortcut,
          body: input.body,
          templateKey: input.templateKey,
          createdById: ctx.membership.id,
        },
      });
    }),

  delete: requirePermission("template:manage")
    .input(quickReplyDeleteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      await tenantDb.quickReply.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});
