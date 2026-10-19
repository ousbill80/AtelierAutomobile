import {
  createSegmentInputSchema,
  deleteSegmentInputSchema,
  previewSegmentInputSchema,
  updateSegmentInputSchema,
} from "@atelieros/validators";
import { db } from "@atelieros/db";
import { requirePermission, router } from "../trpc";
import { writeAuditLog } from "../audit";
import { buildCustomerWhere } from "./customer";

const PREVIEW_SAMPLE_SIZE = 10;

/** Routeur `segment.*` — vues enregistrées de `customer.list` (RG partagée, §7 « segments »). */
export const segmentRouter = router({
  list: requirePermission("customer:read").query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    return tenantDb.customerSegment.findMany({ orderBy: { name: "asc" } });
  }),

  create: requirePermission("customer:update")
    .input(createSegmentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const segment = await tenantDb.customerSegment.create({
        data: {
          organizationId: ctx.organizationId,
          name: input.name,
          filters: input.filters,
          createdById: ctx.membership.id,
        },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "segment.created",
        entity: "CustomerSegment",
        entityId: segment.id,
        after: segment,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return segment;
    }),

  update: requirePermission("customer:update")
    .input(updateSegmentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.customerSegment.findFirstOrThrow({ where: { id: input.id } });

      const segment = await tenantDb.customerSegment.update({
        where: { id: input.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.filters !== undefined ? { filters: input.filters } : {}),
        },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "segment.updated",
        entity: "CustomerSegment",
        entityId: segment.id,
        before,
        after: segment,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return segment;
    }),

  delete: requirePermission("customer:update")
    .input(deleteSegmentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.customerSegment.findFirstOrThrow({ where: { id: input.id } });

      await tenantDb.customerSegment.delete({ where: { id: input.id } });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "segment.deleted",
        entity: "CustomerSegment",
        entityId: input.id,
        before,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { ok: true };
    }),

  preview: requirePermission("customer:read")
    .input(previewSegmentInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      const where = buildCustomerWhere(input.filters, now);

      const [count, sample] = await Promise.all([
        tenantDb.customer.count({ where }),
        tenantDb.customer.findMany({
          where,
          orderBy: { lastVisitAt: "desc" },
          take: PREVIEW_SAMPLE_SIZE,
        }),
      ]);

      return { count, sample };
    }),
});
