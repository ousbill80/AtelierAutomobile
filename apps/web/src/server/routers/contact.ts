import {
  createContactInputSchema,
  deleteContactInputSchema,
  listContactsInputSchema,
  updateContactInputSchema,
} from "@atelieros/validators";
import { db } from "@atelieros/db";
import { TRPCError } from "@trpc/server";
import { writeAuditLog } from "../audit";
import { normalizePhoneOrThrow } from "../phone";
import { requirePermission, router } from "../trpc";

type TenantDb = ReturnType<typeof db.forTenant>;

function normalizeOptionalPhone(value: string | null | undefined): string | null | undefined {
  return value ? normalizePhoneOrThrow(value) : value;
}

async function findActiveContact(tenantDb: TenantDb, id: string) {
  const contact = await tenantDb.customerContact.findFirst({ where: { id, deletedAt: null } });
  if (!contact) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Contact introuvable." });
  }
  return contact;
}

/** Un seul contact principal par client : retire le drapeau des autres contacts. */
async function clearOtherPrimaries(tenantDb: TenantDb, customerId: string, keepId: string) {
  await tenantDb.customerContact.updateMany({
    where: { customerId, isPrimary: true, deletedAt: null, id: { not: keepId } },
    data: { isPrimary: false },
  });
}

/**
 * Routeur `contact.*` — interlocuteurs d'un client (entreprise : dirigeant, responsable flotte,
 * comptable…). `receivesReminders` / `receivesInvoices` orientent les envois M10/M11 (US-M02
 * « SOTRA Logistique »). Téléphones normalisés E.164 ; chaque écriture est journalisée.
 */
export const contactRouter = router({
  list: requirePermission("customer:read")
    .input(listContactsInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.customerContact.findMany({
        where: { customerId: input.customerId, deletedAt: null },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      });
    }),

  create: requirePermission("customer:update")
    .input(createContactInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const customer = await tenantDb.customer.findFirst({
        where: { id: input.customerId, deletedAt: null },
        select: { id: true },
      });
      if (!customer) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Client introuvable." });
      }

      const contact = await tenantDb.customerContact.create({
        data: {
          organizationId: ctx.organizationId,
          customerId: customer.id,
          name: input.name,
          role: input.role ?? null,
          phone: normalizeOptionalPhone(input.phone) ?? null,
          phone2: normalizeOptionalPhone(input.phone2) ?? null,
          email: input.email ?? null,
          isPrimary: input.isPrimary ?? false,
          receivesInvoices: input.receivesInvoices ?? false,
          receivesReminders: input.receivesReminders ?? false,
        },
      });
      if (contact.isPrimary) await clearOtherPrimaries(tenantDb, customer.id, contact.id);

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
      const before = await findActiveContact(tenantDb, input.id);

      const { phone, phone2, ...rest } = input.patch;
      const contact = await tenantDb.customerContact.update({
        where: { id: before.id },
        data: {
          ...rest,
          ...(phone !== undefined ? { phone: normalizeOptionalPhone(phone) } : {}),
          ...(phone2 !== undefined ? { phone2: normalizeOptionalPhone(phone2) } : {}),
        },
      });
      if (contact.isPrimary && !before.isPrimary) {
        await clearOtherPrimaries(tenantDb, contact.customerId, contact.id);
      }

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
      const before = await findActiveContact(tenantDb, input.id);

      // Suppression logique : le contact reste visible dans l'historique des messages envoyés.
      const contact = await tenantDb.customerContact.update({
        where: { id: before.id },
        data: { deletedAt: new Date(), isPrimary: false },
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
