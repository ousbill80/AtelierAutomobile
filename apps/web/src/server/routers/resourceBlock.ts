import { db } from "@atelieros/db";
import { createResourceBlock, deleteResourceBlock, type Actor } from "@atelieros/planning";
import {
  resourceBlockCreateInputSchema,
  resourceBlockDeleteInputSchema,
  resourceBlockListInputSchema,
} from "@atelieros/validators";
import { z } from "zod";
import { toTRPCError } from "../domain-error";
import { requirePermission, requireSite, router } from "../trpc";
import type { Ctx, CtxMembership, CtxUser } from "../context";

type OrgCtx = Ctx & { user: CtxUser; membership: CtxMembership; organizationId: string };

function actorFrom(ctx: OrgCtx): Actor {
  return {
    organizationId: ctx.organizationId,
    membershipId: ctx.membership.id,
    userId: ctx.user.id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    canForce: true,
  };
}

export const resourceBlockRouter = router({
  list: requirePermission("appointment:read")
    .input(resourceBlockListInputSchema)
    .query(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.resourceBlock.findMany({
        where: {
          siteId: input.siteId,
          ...(input.to ? { startsAt: { lt: input.to } } : {}),
          ...(input.from ? { endsAt: { gt: input.from } } : {}),
        },
        include: {
          bay: { select: { id: true, name: true } },
          membership: { select: { id: true, user: { select: { name: true } } } },
        },
        orderBy: { startsAt: "asc" },
      });
    }),

  create: requirePermission("planning:manage")
    .input(resourceBlockCreateInputSchema.and(z.object({ force: z.boolean().default(false) })))
    .mutation(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      try {
        return await createResourceBlock(actorFrom(ctx), input);
      } catch (error) {
        return toTRPCError(error);
      }
    }),

  delete: requirePermission("planning:manage")
    .input(resourceBlockDeleteInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const block = await deleteResourceBlock(actorFrom(ctx), input);
        requireSite(ctx, block.siteId);
        return block;
      } catch (error) {
        return toTRPCError(error);
      }
    }),
});
