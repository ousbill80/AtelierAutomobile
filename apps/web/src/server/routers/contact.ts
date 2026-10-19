import {
  createContactInputSchema,
  deleteContactInputSchema,
  updateContactInputSchema,
} from "@atelieros/validators";
import { db } from "@atelieros/db";
import { requirePermission, router } from "../trpc";
import { writeAuditLog } from "../audit";

/** Routeur `contact.*` — contacts d'un client (entreprise : dirigeant, flotte, comptable…). */
export const contactRouter = router({
  create: requirePermission("customer:update")
    .input(createContactInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      await tenantDb.customer.findFirstOrThrow({
        where: { id: input.customerId, deletedAt: null },
      });

      const contact = await tenantDb.customerContact.create({
        data: {
          organizationId: ctx.organizationId,
          customerId: input.customerId,
          name: input.name,
          role: input.role ?? null,
          phone: input.phone ?? null,
          phone2: input.phone2 ?? null,
          isPrimary: input.isPrimary,
          email: input.email ?? null,
          receivesInvoices: input.receivesInvoices,
          receivesReminders: input.receivesReminders,
        },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "contact.created",
        entity: "CustomerContact",
        entityId: contact.id,
        after: contact,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return contact;
    }),

  update: requirePermission("customer:update")
    .input(updateContactInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.customerContact.findFirstOrThrow({
        where: { id: input.id, deletedAt: null },
      });

      const contact = await tenantDb.customerContact.update({
        where: { id: input.id },
        data: input.patch,
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "contact.updated",
        entity: "CustomerContact",
        entityId: contact.id,
        before,
        after: contact,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return contact;
    }),

  delete: requirePermission("customer:update")
    .input(deleteContactInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.customerContact.findFirstOrThrow({
        where: { id: input.id, deletedAt: null },
      });

      const contact = await tenantDb.customerContact.update({
        where: { id: input.id },
        data: { deletedAt: new Date() },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "contact.deleted",
        entity: "CustomerContact",
        entityId: contact.id,
        before,
        after: contact,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { ok: true };
    }),
});
