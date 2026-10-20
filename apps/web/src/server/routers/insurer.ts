// M16 §8 — compagnies d'assurance (RG-M16-01) avec Customer lié pour la facturation, et
// statistiques d'encours : balance âgée, délai moyen de paiement (RG-M16-11).
import { TRPCError } from "@trpc/server";
import { avgDaysToPay, businessDate, insurerAging, normalizePhoneCI } from "@atelieros/core";
import { db, type Prisma } from "@atelieros/db";
import {
  type InsurerInput,
  insurerInputSchema,
  insurerStatsInputSchema,
  updateInsurerInputSchema,
} from "@atelieros/validators";
import { z } from "zod";
import { actorOf } from "../billing/context";
import { audit, billingNow } from "../billing/service";
import { bad, ensureInsurerCustomer, loadOrgClaimsContext } from "../claims/service";
import { requirePermission, router } from "../trpc";

const DAY = 86_400_000;

function phone(value: string | undefined | null): string | null {
  const v = value?.trim();
  if (!v) return null;
  try {
    return normalizePhoneCI(v).e164;
  } catch {
    bad(`Numéro de téléphone invalide : ${v}.`);
  }
}

function insurerData(input: Partial<InsurerInput>): Prisma.InsuranceCompanyUncheckedUpdateInput {
  const str = (v: string | undefined) => (v === undefined ? undefined : v.trim() || null);
  return {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    legalName: str(input.legalName),
    ncc: str(input.ncc),
    rccm: str(input.rccm),
    address: str(input.address),
    phone: input.phone === undefined ? undefined : phone(input.phone),
    email: str(input.email),
    claimsContactName: str(input.claimsContactName),
    claimsPhone: input.claimsPhone === undefined ? undefined : phone(input.claimsPhone),
    claimsEmail: str(input.claimsEmail),
    accountingEmail: str(input.accountingEmail),
    paymentTermsDays: input.paymentTermsDays,
    laborRate: input.laborRate,
    partsDiscountRate: input.partsDiscountRate,
    requiredDocuments: input.requiredDocuments,
    followUpConfig: input.followUpConfig as Prisma.InputJsonValue | undefined,
    isActive: input.isActive,
  };
}

export const insurerRouter = router({
  list: requirePermission("insurance:read")
    .input(z.object({ includeInactive: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.insuranceCompany.findMany({
        where: input?.includeInactive ? {} : { isActive: true },
        orderBy: { name: "asc" },
      });
    }),

  get: requirePermission("insurance:read")
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const insurer = await tenantDb.insuranceCompany.findFirst({ where: { id: input.id } });
      if (!insurer) throw new TRPCError({ code: "NOT_FOUND", message: "Compagnie introuvable." });
      return insurer;
    }),

  create: requirePermission("insurer:edit")
    .input(insurerInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgClaimsContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const insurer = await tx.insuranceCompany.create({
          data: {
            ...(insurerData(input) as Prisma.InsuranceCompanyUncheckedCreateInput),
            organizationId: ctx.organizationId,
            name: input.name.trim(),
            paymentTermsDays: input.paymentTermsDays ?? org.claims.defaultPaymentTermsDays,
          },
        });
        const customerId = await ensureInsurerCustomer(tx, insurer);
        await audit(actorOf(ctx), "insurer.created", "InsuranceCompany", insurer.id, {
          after: { name: insurer.name },
        });
        return { ...insurer, customerId };
      });
    }),

  update: requirePermission("insurer:edit")
    .input(updateInsurerInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const before = await tx.insuranceCompany.findFirst({ where: { id: input.id } });
        if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Compagnie introuvable." });
        const { id, ...rest } = input;
        const insurer = await tx.insuranceCompany.update({
          where: { id },
          data: insurerData(rest),
        });
        await ensureInsurerCustomer(tx, insurer);
        await audit(actorOf(ctx), "insurer.updated", "InsuranceCompany", insurer.id, {
          before: { name: before.name, paymentTermsDays: before.paymentTermsDays },
          after: { name: insurer.name, paymentTermsDays: insurer.paymentTermsDays },
        });
        return insurer;
      });
    }),

  /** US-M16-07 — encours par compagnie, balance âgée, délai moyen, dossier le plus ancien. */
  stats: requirePermission("insurance:read")
    .input(insurerStatsInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgClaimsContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const today = businessDate(billingNow(), org.timeZone);
      const since = new Date(today.getTime() - 365 * DAY);
      const siteFilter =
        input.siteId || ctx.allowedSiteIds !== "ALL"
          ? { siteId: input.siteId ?? { in: ctx.allowedSiteIds as string[] } }
          : {};
      const [insurers, claims, invoices] = await Promise.all([
        tenantDb.insuranceCompany.findMany({ orderBy: { name: "asc" } }),
        tenantDb.insuranceClaim.findMany({
          where: { deletedAt: null, ...siteFilter },
          select: {
            id: true,
            insuranceCompanyId: true,
            status: true,
            createdAt: true,
            number: true,
          },
        }),
        tenantDb.invoice.findMany({
          where: {
            billTo: "INSURANCE",
            type: "INVOICE",
            insuranceClaimId: { not: null },
            status: { notIn: ["DRAFT", "VOID"] },
            ...siteFilter,
          },
          select: {
            id: true,
            insuranceClaimId: true,
            balance: true,
            issuedAt: true,
            status: true,
            allocations: {
              where: { voidedAt: null },
              select: { payment: { select: { receivedAt: true, status: true } } },
            },
          },
        }),
      ]);
      const claimInsurer = new Map(claims.map((c) => [c.id, c.insuranceCompanyId]));
      return insurers.map((insurer) => {
        const own = claims.filter((c) => c.insuranceCompanyId === insurer.id);
        const open = own.filter((c) => !["PAID", "REJECTED", "CANCELLED"].includes(c.status));
        const ownInvoices = invoices.filter(
          (i) => i.insuranceClaimId && claimInsurer.get(i.insuranceClaimId) === insurer.id,
        );
        const aging = insurerAging(ownInvoices, today);
        const paid = ownInvoices
          .filter((i) => i.status === "PAID" && i.issuedAt)
          .map((i) => {
            const dates = i.allocations
              .filter((a) => a.payment?.status === "CONFIRMED")
              .map((a) => a.payment!.receivedAt.getTime());
            return dates.length
              ? { issuedAt: i.issuedAt!, paidAt: new Date(Math.max(...dates)) }
              : null;
          })
          .filter((p): p is { issuedAt: Date; paidAt: Date } => !!p && p.paidAt >= since);
        const oldest = open.reduce<(typeof open)[number] | null>(
          (o, c) => (!o || c.createdAt < o.createdAt ? c : o),
          null,
        );
        return {
          insurerId: insurer.id,
          name: insurer.name,
          isActive: insurer.isActive,
          openClaims: open.length,
          outstanding: aging.outstanding,
          aging: aging.aging,
          oldestInvoiceDays: aging.oldestDays,
          avgDaysToPay: avgDaysToPay(paid),
          oldestClaim: oldest ? { id: oldest.id, number: oldest.number } : null,
        };
      });
    }),
});
