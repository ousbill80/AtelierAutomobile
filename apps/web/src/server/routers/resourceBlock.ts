// M03 §8 — `resourceBlock.list/create/delete` (US-M03-10, RG-M03-06).
import { TRPCError } from "@trpc/server";
import {
  resourceBlockCreateInputSchema,
  resourceBlockDeleteInputSchema,
  resourceBlockListInputSchema,
} from "@atelieros/validators";
import { requirePermission, requireSite, router } from "../trpc";
import { db } from "../appointments/helpers";

export const resourceBlockRouter = router({
  list: requirePermission("planning:manage")
    .input(resourceBlockListInputSchema)
    .query(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.resourceBlock.findMany({
        where: {
          siteId: input.siteId,
          ...(input.from ? { endsAt: { gt: input.from } } : {}),
          ...(input.to ? { startsAt: { lt: input.to } } : {}),
        },
        orderBy: { startsAt: "asc" },
      });
    }),

  create: requirePermission("planning:manage")
    .input(resourceBlockCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });

      const conflicting = await tenantDb.appointment.findMany({
        where: {
          siteId: input.siteId,
          startsAt: { lt: input.endsAt },
          endsAt: { gt: input.startsAt },
          status: { notIn: ["CANCELLED", "NO_SHOW"] },
          ...(input.bayId ? { bayId: input.bayId } : {}),
          ...(input.membershipId ? { mechanicId: input.membershipId } : {}),
        },
        select: { id: true },
      });
      if (conflicting.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `BLOCK_HAS_APPOINTMENTS:${conflicting.map((a) => a.id).join(",")}`,
        });
      }

      return tenantDb.resourceBlock.create({
        data: {
          organizationId: ctx.organizationId,
          siteId: input.siteId,
          bayId: input.bayId,
          membershipId: input.membershipId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          reason: input.reason,
          createdById: ctx.membership.id,
        },
      });
    }),

  delete: requirePermission("planning:manage")
    .input(resourceBlockDeleteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const existing = await tenantDb.resourceBlock.findFirst({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Blocage introuvable." });
      requireSite(ctx, existing.siteId);
      await tenantDb.resourceBlock.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});
