import { TRPCError } from "@trpc/server";
import {
  computeDisplayName,
  duplicateScore,
  duplicateSeverity,
  mergeConsent,
  mergeTags,
  normalizePlate,
  resolveDedupeKeyCollisions,
  resolveField,
  type FieldChoice,
} from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import {
  addCustomerNoteInputSchema,
  checkDuplicatesInputSchema,
  createCustomerInputSchema,
  customerGetInputSchema,
  customerListInputSchema,
  customerTimelineInputSchema,
  deleteCustomerInputSchema,
  dismissDuplicateInputSchema,
  mergeCustomerInputSchema,
  mergePreviewInputSchema,
  reactivateRemindersInputSchema,
  setConsentInputSchema,
  setCreditInputSchema,
  updateCustomerInputSchema,
} from "@atelieros/validators";
import { requirePermission, router } from "../trpc";
import { writeAuditLog } from "../audit";
import { requestAutomationDispatch } from "../automations/queue";
import { emitDomainEvent } from "../events/emit";
import { findSimilarCustomerNames } from "../customers/trigram";
import { normalizePhoneOrThrow } from "../phone";

const UNPAID_INVOICE_STATUSES = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] as const;

async function detectDuplicates(
  tenantDb: ReturnType<typeof db.forTenant>,
  organizationId: string,
  signals: {
    phone?: string | null;
    email?: string | null;
    ncc?: string | null;
    name?: string | null;
  },
  excludeId?: string,
) {
  const orConditions: Record<string, unknown>[] = [];
  if (signals.phone) {
    orConditions.push(
      { phone: signals.phone },
      { phone2: signals.phone },
      { whatsappPhone: signals.phone },
    );
  }
  if (signals.email) orConditions.push({ email: signals.email });
  if (signals.ncc) orConditions.push({ ncc: signals.ncc });

  const exactMatches = orConditions.length
    ? await tenantDb.customer.findMany({
        where: {
          deletedAt: null,
          OR: orConditions,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      })
    : [];

  const nameMatches = signals.name
    ? await findSimilarCustomerNames(organizationId, signals.name, excludeId)
    : [];

  const candidateIds = new Set<string>([
    ...exactMatches.map((c) => c.id),
    ...nameMatches.map((c) => c.id),
  ]);

  const candidates = Array.from(candidateIds).map((id) => {
    const exact = exactMatches.find((c) => c.id === id);
    const nameMatch = nameMatches.find((c) => c.id === id);
    const { score, reasons } = duplicateScore({
      samePhone:
        !!exact &&
        !!signals.phone &&
        [exact.phone, exact.phone2, exact.whatsappPhone].includes(signals.phone),
      sameEmail: !!exact && !!signals.email && exact.email === signals.email,
      sameNcc: !!exact && !!signals.ncc && exact.ncc === signals.ncc,
      nameSimilarity: nameMatch?.similarity ?? null,
    });
    return {
      customerId: id,
      displayName: exact?.displayName ?? nameMatch?.displayName ?? "",
      score,
      reasons,
    };
  });

  return candidates.sort((a, b) => b.score - a.score);
}

export type CustomerListFilters = Omit<
  ReturnType<typeof customerListInputSchema.parse>,
  "cursor" | "limit"
>;

/** Partagé avec segment.preview (mêmes clés que customer.list, RG-M02-14). */
export function buildCustomerListWhere(
  filters: Partial<CustomerListFilters>,
): Record<string, unknown> {
  const where: Record<string, unknown> = { deletedAt: null };
  if (filters.type) where.type = filters.type;
  if (filters.tags?.length) where.tags = { hasSome: filters.tags };
  if (filters.commune) where.commune = filters.commune;
  if (filters.optedOut != null) {
    where.optedOutAt = filters.optedOut ? { not: null } : null;
  }
  if (filters.inspectionWithinDays != null) {
    const cutoff = new Date(Date.now() + filters.inspectionWithinDays * 24 * 60 * 60 * 1000);
    where.vehicles = { some: { inspectionExpiryDate: { lte: cutoff }, deletedAt: null } };
  }
  if (filters.serviceDue) {
    where.vehicles = { some: { nextServiceDueDate: { lte: new Date() }, deletedAt: null } };
  }
  if (filters.hasBalance) {
    where.invoices = { some: { status: { in: [...UNPAID_INVOICE_STATUSES] } } };
  }
  if (filters.q) {
    where.OR = [
      { displayName: { contains: filters.q, mode: "insensitive" } },
      { phone: { contains: filters.q } },
      { phone2: { contains: filters.q } },
      { email: { contains: filters.q, mode: "insensitive" } },
    ];
  }
  return where;
}

export const customerRouter = router({
  list: requirePermission("customer:read")
    .input(customerListInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });

      let effective = input;
      if (input.segmentId) {
        const segment = await tenantDb.customerSegment.findUniqueOrThrow({
          where: { id: input.segmentId },
        });
        effective = { ...(segment.filters as Partial<typeof input>), ...input };
      }

      const where = buildCustomerListWhere(effective);
      const rawItems = await tenantDb.customer.findMany({
        where,
        orderBy: { displayName: "asc" },
        take: effective.limit + 1,
        ...(effective.cursor ? { cursor: { id: effective.cursor }, skip: 1 } : {}),
        include: {
          vehicles: {
            where: { deletedAt: null },
            select: {
              id: true,
              plate: true,
              plateType: true,
              make: true,
              model: true,
              inspectionExpiryDate: true,
              nextServiceDueDate: true,
            },
          },
          repairOrders: {
            where: { deletedAt: null },
            select: { id: true, status: true },
          },
          invoices: {
            where: {
              type: "INVOICE",
              status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE", "DISPUTED"] },
            },
            select: { balance: true, dueDate: true },
          },
        },
      });

      const now = new Date();
      const items = rawItems.slice(0, effective.limit).map((c) => {
        const vehicleCount = c.vehicles.length;
        const activeRoCount = c.repairOrders.filter((ro) =>
          [
            "CHECKED_IN",
            "DIAGNOSING",
            "AWAITING_APPROVAL",
            "APPROVED",
            "IN_PROGRESS",
            "WAITING_PARTS",
            "QUALITY_CHECK",
            "READY",
          ].includes(ro.status),
        ).length;
        const repairedRoCount = c.repairOrders.filter((ro) =>
          ["DELIVERED", "INVOICED"].includes(ro.status),
        ).length;
        const dueBalance = c.invoices.reduce((sum, inv) => sum + (inv.balance ?? 0), 0);
        const overdueBalance = c.invoices
          .filter((inv) => inv.dueDate && new Date(inv.dueDate) < now)
          .reduce((sum, inv) => sum + (inv.balance ?? 0), 0);

        return {
          ...c,
          stats: {
            vehicleCount,
            activeRoCount,
            repairedRoCount,
            dueBalance,
            overdueBalance,
          },
        };
      });

      const nextCursor = rawItems.length > effective.limit ? rawItems[effective.limit]!.id : null;
      return { items, nextCursor };
    }),

  get: requirePermission("customer:read")
    .input(customerGetInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const customer = await tenantDb.customer.findFirstOrThrow({
        where: { id: input.id, deletedAt: null },
        include: {
          contacts: {
            where: { deletedAt: null },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          },
          vehicles: {
            where: { deletedAt: null },
            orderBy: { createdAt: "desc" },
          },
        },
      });

      const [repairOrders, quotes, invoices, unpaidInvoices] = await Promise.all([
        tenantDb.repairOrder.findMany({
          where: { customerId: input.id, deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            number: true,
            status: true,
            totalEstimate: true,
            createdAt: true,
            vehicle: { select: { id: true, plate: true, plateType: true, make: true, model: true } },
          },
        }),
        tenantDb.quote.findMany({
          where: { customerId: input.id, supersededAt: null },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            number: true,
            status: true,
            total: true,
            createdAt: true,
            validUntil: true,
            vehicle: { select: { id: true, plate: true, make: true, model: true } },
          },
        }),
        tenantDb.invoice.findMany({
          where: { customerId: input.id },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            number: true,
            status: true,
            type: true,
            total: true,
            balance: true,
            dueDate: true,
            issuedAt: true,
            createdAt: true,
          },
        }),
        tenantDb.invoice.findMany({
          where: { customerId: input.id, status: { in: [...UNPAID_INVOICE_STATUSES] } },
          select: { total: true, balance: true, dueDate: true },
        }),
      ]);

      const now = new Date();
      const due = unpaidInvoices.reduce((sum, inv) => sum + (inv.balance || inv.total), 0);
      const overdue = unpaidInvoices
        .filter((inv) => inv.dueDate && inv.dueDate < now)
        .reduce((sum, inv) => sum + (inv.balance || inv.total), 0);

      const reachability = customer.doNotRemind
        ? "DO_NOT_REMIND"
        : customer.optedOutAt
          ? "OPTED_OUT"
          : customer.phone || customer.email
            ? "REACHABLE"
            : "UNREACHABLE";

      const activeRoCount = repairOrders.filter((ro) =>
        [
          "CHECKED_IN",
          "DIAGNOSING",
          "AWAITING_APPROVAL",
          "APPROVED",
          "IN_PROGRESS",
          "WAITING_PARTS",
          "QUALITY_CHECK",
          "READY",
        ].includes(ro.status),
      ).length;
      const repairedRoCount = repairOrders.filter((ro) =>
        ["DELIVERED", "INVOICED"].includes(ro.status),
      ).length;

      return {
        ...customer,
        repairOrders,
        quotes,
        invoices,
        balance: { due, overdue, creditLimit: customer.creditLimit },
        reachability,
        stats: {
          vehicleCount: customer.vehicles.length,
          activeRoCount,
          repairedRoCount,
          totalInvoiced: invoices
            .filter((inv) => inv.type === "INVOICE" && inv.status !== "VOID")
            .reduce((sum, inv) => sum + inv.total, 0),
        },
      };
    }),

  checkDuplicates: requirePermission("customer:read")
    .input(checkDuplicatesInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const phone = input.phone ? normalizePhoneOrThrow(input.phone) : null;
      return detectDuplicates(
        tenantDb,
        ctx.organizationId,
        { phone, email: input.email ?? null, ncc: input.ncc ?? null, name: input.name ?? null },
        input.excludeId,
      );
    }),

  create: requirePermission("customer:create")
    .input(createCustomerInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });

      const phone = input.phone ? normalizePhoneOrThrow(input.phone) : null;
      const phone2 = input.phone2 ? normalizePhoneOrThrow(input.phone2) : null;
      const whatsappPhone = input.whatsappPhone ? normalizePhoneOrThrow(input.whatsappPhone) : null;

      const displayName =
        input.type === "INDIVIDUAL"
          ? computeDisplayName({
              type: "INDIVIDUAL",
              lastName: input.lastName,
              firstName: input.firstName,
            })
          : computeDisplayName({ type: "COMPANY", companyName: input.companyName });

      const normalizedVehicle = input.vehicle ? normalizePlate(input.vehicle.plate) : null;

      if (!input.duplicateOverrideReason) {
        const candidates = await detectDuplicates(tenantDb, ctx.organizationId, {
          phone,
          email: input.email ?? null,
          ncc: input.type === "COMPANY" ? (input.ncc ?? null) : null,
          name: displayName,
        });
        const top = candidates[0];
        if (top && duplicateSeverity(top.score) === "BLOCK") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Ce numéro appartient déjà à ${top.displayName}. Ouvrez ce client ou confirmez la création avec un motif.`,
          });
        }
      }

      const customer = await tenantDb.customer.create({
        data: {
          organizationId: ctx.organizationId,
          type: input.type,
          displayName,
          civility: input.type === "INDIVIDUAL" ? input.civility : undefined,
          lastName: input.type === "INDIVIDUAL" ? input.lastName : undefined,
          firstName: input.type === "INDIVIDUAL" ? input.firstName : undefined,
          companyName: input.type === "COMPANY" ? input.companyName : undefined,
          ncc: input.type === "COMPANY" ? input.ncc : undefined,
          rccm: input.type === "COMPANY" ? input.rccm : undefined,
          phone,
          phone2,
          whatsappPhone,
          email: input.email,
          address: input.address,
          commune: input.commune,
          preferredChannel: input.preferredChannel,
          paymentTermsDays: input.paymentTermsDays ?? 0,
          tags: input.tags ?? [],
          notes: input.notes,
          source: input.source ?? "comptoir",
          consentUpdatedAt: new Date(),
          consentSource: "staff",
          ...(input.vehicle && normalizedVehicle
            ? {
                vehicles: {
                  create: [
                    {
                      organizationId: ctx.organizationId,
                      plate: normalizedVehicle.plate,
                      plateCompact: normalizedVehicle.plateCompact,
                      make: input.vehicle.make,
                      model: input.vehicle.model,
                      vin: input.vehicle.vin,
                    },
                  ],
                },
              }
            : {}),
        },
        include: { vehicles: true },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "customer.created",
        entity: "Customer",
        entityId: customer.id,
        after: customer,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        reason: input.duplicateOverrideReason ?? null,
      });
      // M17 RG-M17-23 : déclencheur des automatisations « nouveau client ».
      await emitDomainEvent(tenantDb, ctx.organizationId, "customer.created", {
        customerId: customer.id,
        type: customer.type,
      });
      await requestAutomationDispatch({
        organizationId: ctx.organizationId,
        trigger: "customer.created",
      });

      return { customer, vehicle: customer.vehicles[0] ?? null };
    }),

  update: requirePermission("customer:update")
    .input(updateCustomerInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.customer.findFirstOrThrow({ where: { id: input.id } });

      const patch = { ...input.patch };
      if (patch.phone) patch.phone = normalizePhoneOrThrow(patch.phone);
      if (patch.phone2) patch.phone2 = normalizePhoneOrThrow(patch.phone2);
      if (patch.whatsappPhone) patch.whatsappPhone = normalizePhoneOrThrow(patch.whatsappPhone);

      const nextDisplayName =
        before.type === "INDIVIDUAL"
          ? computeDisplayName({
              type: "INDIVIDUAL",
              lastName: patch.lastName ?? before.lastName ?? "",
              firstName: patch.firstName === undefined ? before.firstName : patch.firstName,
            })
          : computeDisplayName({
              type: "COMPANY",
              companyName: patch.companyName ?? before.companyName ?? "",
            });

      const customer = await tenantDb.customer.update({
        where: { id: input.id },
        data: { ...patch, displayName: nextDisplayName },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "customer.updated",
        entity: "Customer",
        entityId: customer.id,
        before,
        after: customer,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return customer;
    }),

  setConsent: requirePermission("customer:consent")
    .input(setConsentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.customer.findFirstOrThrow({ where: { id: input.id } });

      const customer = await tenantDb.customer.update({
        where: { id: input.id },
        data: {
          remindersConsent: input.remindersConsent,
          marketingConsent: input.marketingConsent,
          doNotRemind: input.doNotRemind,
          doNotRemindReason: input.doNotRemind ? (input.reason ?? before.doNotRemindReason) : null,
          consentUpdatedAt: new Date(),
          consentSource: input.source,
        },
      });

      if (input.doNotRemind) {
        await tenantDb.reminder.updateMany({
          where: { customerId: input.id, status: { in: ["PLANNED", "NEEDS_APPROVAL"] } },
          data: { status: "CANCELLED", skippedReason: "Client en litige / ne plus relancer" },
        });
      }

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "customer.consent_changed",
        entity: "Customer",
        entityId: customer.id,
        before,
        after: customer,
        reason: input.reason ?? null,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return customer;
    }),

  reactivateReminders: requirePermission("customer:consent")
    .input(reactivateRemindersInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.customer.findFirstOrThrow({ where: { id: input.id } });

      const addresses = [before.phone, before.phone2, before.whatsappPhone, before.email].filter(
        (address): address is string => !!address,
      );
      if (addresses.length > 0) {
        await adminDb.optOut.deleteMany({
          where: { organizationId: ctx.organizationId, address: { in: addresses } },
        });
      }

      const customer = await tenantDb.customer.update({
        where: { id: input.id },
        data: {
          optedOutAt: null,
          consentUpdatedAt: new Date(),
          consentSource: input.source,
        },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "customer.consent_changed",
        entity: "Customer",
        entityId: customer.id,
        before,
        after: customer,
        reason: input.proof ?? "Réactivation des relances",
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return customer;
    }),

  setCredit: requirePermission("customer:credit")
    .input(setCreditInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.customer.findFirstOrThrow({ where: { id: input.id } });

      const customer = await tenantDb.customer.update({
        where: { id: input.id },
        data: { paymentTermsDays: input.paymentTermsDays, creditLimit: input.creditLimit },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "customer.credit_updated",
        entity: "Customer",
        entityId: customer.id,
        before,
        after: customer,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return customer;
    }),

  timeline: requirePermission("customer:read")
    .input(customerTimelineInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const vehicleFilter = input.vehicleId ? { vehicleId: input.vehicleId } : {};

      const [notes, reminders, mileageReadings] = await Promise.all([
        tenantDb.customerNote.findMany({
          where: { customerId: input.id, deletedAt: null, ...vehicleFilter },
          orderBy: { createdAt: "desc" },
          take: input.limit,
        }),
        tenantDb.reminder.findMany({
          where: { customerId: input.id, ...vehicleFilter },
          orderBy: { createdAt: "desc" },
          take: input.limit,
        }),
        input.vehicleId
          ? tenantDb.mileageReading.findMany({
              where: { vehicleId: input.vehicleId },
              orderBy: { readAt: "desc" },
              take: input.limit,
            })
          : Promise.resolve([]),
      ]);

      const items = [
        ...notes.map((n) => ({ type: "note" as const, at: n.createdAt, data: n })),
        ...reminders.map((r) => ({ type: "reminder" as const, at: r.createdAt, data: r })),
        ...mileageReadings.map((m) => ({
          type: "mileage_reading" as const,
          at: m.readAt,
          data: m,
        })),
      ].sort((a, b) => b.at.getTime() - a.at.getTime());

      return { items: items.slice(0, input.limit), nextCursor: null };
    }),

  addNote: requirePermission("customer:update")
    .input(addCustomerNoteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.customerNote.create({
        data: {
          organizationId: ctx.organizationId,
          customerId: input.customerId,
          vehicleId: input.vehicleId,
          body: input.body,
          pinned: input.pinned ?? false,
          createdById: ctx.membership.id,
        },
      });
    }),

  delete: requirePermission("customer:delete")
    .input(deleteCustomerInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const customer = await tenantDb.customer.findFirstOrThrow({ where: { id: input.id } });

      const [openRepairOrders, openQuotes, unpaidInvoices] = await Promise.all([
        tenantDb.repairOrder.count({
          where: { customerId: input.id, status: { notIn: ["DELIVERED", "CANCELLED"] } },
        }),
        tenantDb.quote.count({
          where: { customerId: input.id, status: { in: ["SENT", "VIEWED"] } },
        }),
        tenantDb.invoice.findMany({
          where: { customerId: input.id, status: { in: [...UNPAID_INVOICE_STATUSES] } },
          select: { total: true },
        }),
      ]);
      const due = unpaidInvoices.reduce((sum, inv) => sum + inv.total, 0);

      if (openRepairOrders > 0 || openQuotes > 0 || due > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            due > 0
              ? `Ce client a ${due.toLocaleString("fr-FR")} FCFA d'impayés.`
              : "Ce client a un ordre de réparation ou un devis en cours.",
        });
      }

      await tenantDb.customer.update({ where: { id: input.id }, data: { deletedAt: new Date() } });
      // RG-M14-04 : client supprimé → tous ses liens portail sont révoqués.
      await tenantDb.portalToken.updateMany({
        where: { customerId: input.id, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: new Date(), revokeReason: "customer_deleted" },
      });
      await tenantDb.reminder.updateMany({
        where: { customerId: input.id, status: { in: ["PLANNED", "NEEDS_APPROVAL", "QUEUED"] } },
        data: { status: "CANCELLED", skippedReason: "Client supprimé" },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "customer.deleted",
        entity: "Customer",
        entityId: customer.id,
        before: customer,
        reason: input.reason,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { ok: true };
    }),

  duplicates: router({
    list: requirePermission("customer:read").query(async ({ ctx }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const dismissed = await tenantDb.duplicateDismissal.findMany({
        where: { entity: "customer" },
      });
      const dismissedKeys = new Set(dismissed.map((d) => `${d.idA}:${d.idB}`));

      const customers = await tenantDb.customer.findMany({
        where: { deletedAt: null },
        take: 500,
        orderBy: { createdAt: "desc" },
      });

      const pairs: {
        customerIdA: string;
        customerIdB: string;
        displayNameA: string;
        displayNameB: string;
        score: number;
        reasons: string[];
      }[] = [];
      for (const customer of customers) {
        const candidates = await detectDuplicates(
          tenantDb,
          ctx.organizationId,
          {
            phone: customer.phone,
            email: customer.email,
            ncc: customer.ncc,
            name: customer.displayName,
          },
          customer.id,
        );
        for (const candidate of candidates) {
          const [first, second] =
            customer.id < candidate.customerId
              ? [customer, { id: candidate.customerId, displayName: candidate.displayName }]
              : [{ id: candidate.customerId, displayName: candidate.displayName }, customer];
          const key = `${first.id}:${second.id}`;
          if (dismissedKeys.has(key)) continue;
          if (duplicateSeverity(candidate.score) === "NONE") continue;
          if (!pairs.some((p) => p.customerIdA === first.id && p.customerIdB === second.id)) {
            pairs.push({
              customerIdA: first.id,
              customerIdB: second.id,
              displayNameA: first.displayName,
              displayNameB: second.displayName,
              score: candidate.score,
              reasons: candidate.reasons,
            });
          }
        }
      }
      return pairs.sort((a, b) => b.score - a.score).slice(0, 50);
    }),

    dismiss: requirePermission("customer:merge")
      .input(dismissDuplicateInputSchema)
      .mutation(async ({ ctx, input }) => {
        const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
        const [idA, idB] = [input.customerIdA, input.customerIdB].sort();
        return tenantDb.duplicateDismissal.create({
          data: {
            organizationId: ctx.organizationId,
            entity: "customer",
            idA: idA!,
            idB: idB!,
            dismissedById: ctx.membership.id,
          },
        });
      }),
  }),

  mergePreview: requirePermission("customer:merge")
    .input(mergePreviewInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const [source, target] = await Promise.all([
        tenantDb.customer.findFirstOrThrow({ where: { id: input.sourceId } }),
        tenantDb.customer.findFirstOrThrow({ where: { id: input.targetId } }),
      ]);

      const fields = ["phone", "phone2", "email", "address", "commune", "ncc", "rccm"] as const;
      const conflicts = fields
        .filter((field) => source[field] && target[field] && source[field] !== target[field])
        .map((field) => ({ field, sourceValue: source[field], targetValue: target[field] }));

      const [vehicles, repairOrders, quotes, invoices, payments, reminders, collectionCases] =
        await Promise.all([
          tenantDb.vehicle.count({ where: { customerId: input.sourceId } }),
          tenantDb.repairOrder.count({ where: { customerId: input.sourceId } }),
          tenantDb.quote.count({ where: { customerId: input.sourceId } }),
          tenantDb.invoice.count({ where: { customerId: input.sourceId } }),
          tenantDb.payment.count({ where: { customerId: input.sourceId } }),
          tenantDb.reminder.count({ where: { customerId: input.sourceId } }),
          tenantDb.collectionCase.count({ where: { customerId: input.sourceId } }),
        ]);

      return {
        source,
        target,
        conflicts,
        moved: { vehicles, repairOrders, quotes, invoices, payments, reminders, collectionCases },
      };
    }),

  merge: requirePermission("customer:merge")
    .input(mergeCustomerInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.sourceId === input.targetId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Un client ne peut pas être fusionné avec lui-même.",
        });
      }
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });

      const result = await tenantDb.transaction(async (tx) => {
        const source = await tx.customer.findFirstOrThrow({ where: { id: input.sourceId } });
        const target = await tx.customer.findFirstOrThrow({ where: { id: input.targetId } });

        if (source.displayName.trim().toLowerCase() !== input.confirmName.trim().toLowerCase()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Le nom saisi ne correspond pas au client absorbé. Fusion annulée.",
          });
        }

        const choices = input.fieldChoices as Record<string, FieldChoice>;
        const mergedFields: Record<string, unknown> = {};
        for (const field of [
          "phone",
          "phone2",
          "email",
          "address",
          "commune",
          "ncc",
          "rccm",
        ] as const) {
          mergedFields[field] = resolveField(choices[field], source[field], target[field]);
        }

        const consent = mergeConsent(source, target);
        const tags = mergeTags(target.tags, source.tags);

        const sourceReminders = await tx.reminder.findMany({ where: { customerId: source.id } });
        const targetReminders = await tx.reminder.findMany({ where: { customerId: target.id } });
        const { keep, cancel } = resolveDedupeKeyCollisions(sourceReminders, targetReminders);

        for (const reminder of cancel) {
          await tx.reminder.update({
            where: { id: reminder.id },
            data: { status: "CANCELLED", skippedReason: "Doublon fusionné" },
          });
        }
        for (const reminder of keep) {
          await tx.reminder.update({ where: { id: reminder.id }, data: { customerId: target.id } });
        }

        const movedCounts: Record<string, number> = {};
        for (const model of [
          "vehicle",
          "customerContact",
          "appointment",
          "repairOrder",
          "quote",
          "invoice",
          "payment",
          "insuranceClaim",
          "customerNote",
        ] as const) {
          const updateMany = tx[model].updateMany as unknown as (args: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => Promise<{ count: number }>;
          const res = await updateMany({
            where: { customerId: source.id },
            data: { customerId: target.id },
          });
          movedCounts[model] = res.count;
        }

        // Dossiers de recouvrement : fusionne dans la cible si les deux en ont un ouvert,
        // sinon rattache simplement celui de la source (RG-M02-08).
        const sourceCase = await tx.collectionCase.findFirst({
          where: { customerId: source.id, closedAt: null },
        });
        const targetCase = await tx.collectionCase.findFirst({
          where: { customerId: target.id, closedAt: null },
        });
        if (sourceCase && targetCase) {
          await tx.collectionCase.update({
            where: { id: sourceCase.id },
            data: { closedAt: new Date(), closeReason: "fusion" },
          });
        } else if (sourceCase) {
          await tx.collectionCase.update({
            where: { id: sourceCase.id },
            data: { customerId: target.id },
          });
        }

        await tx.customer.update({
          where: { id: target.id },
          data: { ...mergedFields, ...consent, tags },
        });
        await tx.customer.update({
          where: { id: source.id },
          data: { deletedAt: new Date(), mergedIntoId: target.id },
        });

        return { targetId: target.id, moved: movedCounts, source };
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "customer.merge",
        entity: "Customer",
        entityId: result.targetId,
        before: result.source,
        reason: `Fusion de ${result.source.displayName} dans le client ${result.targetId}`,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { targetId: result.targetId, moved: result.moved };
    }),
});
