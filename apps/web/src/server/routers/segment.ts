import { db } from "@atelieros/db";
import {
  createSegmentInputSchema,
  deleteSegmentInputSchema,
  previewSegmentInputSchema,
  updateSegmentInputSchema,
} from "@atelieros/validators";
import { requirePermission, router } from "../trpc";
import { buildCustomerListWhere, type CustomerListFilters } from "./customer";

export const segmentRouter = router({
  list: requirePermission("customer:read").query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    return tenantDb.customerSegment.findMany({ orderBy: { name: "asc" } });
  }),

  create: requirePermission("customer:read")
    .input(createSegmentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.customerSegment.create({
        data: {
          organizationId: ctx.organizationId,
          name: input.name,
          filters: input.filters,
          createdById: ctx.membership.id,
        },
      });
    }),

  update: requirePermission("customer:read")
    .input(updateSegmentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.customerSegment.update({
        where: { id: input.id },
        data: { name: input.name, filters: input.filters },
      });
    }),

  delete: requirePermission("customer:read")
    .input(deleteSegmentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      await tenantDb.customerSegment.delete({ where: { id: input.id } });
      return { ok: true };
    }),

  preview: requirePermission("customer:read")
    .input(previewSegmentInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const where = buildCustomerListWhere(input.filters as Partial<CustomerListFilters>);
      const [count, sample] = await Promise.all([
        tenantDb.customer.count({ where }),
        tenantDb.customer.findMany({ where, orderBy: { displayName: "asc" }, take: 10 }),
      ]);
      return { count, sample };
    }),
});
