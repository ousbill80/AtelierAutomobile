// M05 §8 — routeurs `quote`, `quoteLine`, `quoteSettings` : création (libre, depuis
// inspection, depuis lignes OR), édition, remises encadrées, envoi, décision tracée, versions,
// conversion en OR / facture, statistiques. Toute règle vient de `@atelieros/core` (quotes).
import { TRPCError } from "@trpc/server";
import {
  availableQuoteTransitions,
  businessDate,
  computeValidUntil,
  DEFAULT_QUOTE_SETTINGS,
  discountRequiresReason,
  groupQuoteLines,
  insuranceGap,
  isQuoteExpired,
  laborLinePricing,
  normalizePhoneCI,
  quoteStats,
  quoteSettingsFrom,
  type QuoteStatsInput,
  type QuoteStatus,
} from "@atelieros/core";
import { adminDb, db, type Prisma, type Quote, type ScopedTenantClient } from "@atelieros/db";
import {
  quoteAddKitInputSchema,
  quoteCatalogInputSchema,
  quoteConvertToRepairOrderInputSchema,
  quoteCreateFromInspectionInputSchema,
  quoteCreateFromRepairOrderInputSchema,
  quoteCreateInputSchema,
  quoteCreateVersionInputSchema,
  quoteDecideDiscountInputSchema,
  quoteDeleteInputSchema,
  quoteIdInputSchema,
  quoteLineAddInputSchema,
  quoteLineRemoveInputSchema,
  quoteLineReorderInputSchema,
  quoteLineUpdateInputSchema,
  quoteListInputSchema,
  quoteRecordDecisionInputSchema,
  quoteRequestDepositInputSchema,
  quoteRequestDiscountApprovalInputSchema,
  quoteResendInputSchema,
  quoteSendInputSchema,
  quoteSettingsInputSchema,
  quoteStatsInputSchema,
  quoteUpdateInputSchema,
  type QuoteLineInput,
} from "@atelieros/validators";
import { writeAuditLog } from "../audit";
import type { Ctx, CtxMembership, CtxSession, CtxUser } from "../context";
import { emitDomainEvent } from "../events/emit";
import { membersWithRoles, nextRepairOrderNumber, notify } from "../repairOrders/helpers";
import {
  applyQuoteDecision,
  assertQuoteModule,
  badRequest,
  buildQuoteLineData,
  createQuoteVersion,
  flushMessages,
  issueQuoteLink,
  laborHoursForVehicle,
  loadOrgQuoteContext,
  nextQuoteNumber,
  notFound,
  quoteNow,
  quoteTimeline,
  recomputeQuoteTotals,
  sendDecisionConfirmation,
  sendQuote,
  storeQuoteSignature,
  syncDiscountApproval,
  type OrgQuoteContext,
  type Recipient,
} from "../quotes/helpers";
import { requirePermission, requireSite, router } from "../trpc";

type Tx = ScopedTenantClient;
type OrgCtx = Ctx & {
  user: CtxUser;
  session: CtxSession;
  membership: CtxMembership;
  organizationId: string;
};

function siteFilter(ctx: OrgCtx): Prisma.QuoteWhereInput {
  return ctx.allowedSiteIds === "ALL" ? {} : { siteId: { in: ctx.allowedSiteIds } };
}

async function loadQuote(tx: Tx, ctx: OrgCtx, id: string): Promise<Quote> {
  const quote = await tx.quote.findFirst({ where: { id, deletedAt: null } });
  if (!quote) notFound();
  requireSite(ctx, quote.siteId);
  return quote;
}

function actorOf(ctx: OrgCtx) {
  return { role: ctx.membership.role, permissions: ctx.permissions, membershipId: ctx.membership.id };
}

function assertEditable(quote: Quote): void {
  if (quote.status !== "DRAFT") {
    badRequest(
      "Ce devis a été envoyé : créez une nouvelle version pour le modifier (US-M05-08).",
    );
  }
}

async function resolveSiteId(tx: Tx, ctx: OrgCtx, requested?: string): Promise<string> {
  const siteId = requested ?? ctx.session.activeSiteId ?? undefined;
  if (siteId) {
    requireSite(ctx, siteId);
    return siteId;
  }
  const site = await tx.site.findFirst({
    where: {
      isActive: true,
      ...(ctx.allowedSiteIds === "ALL" ? {} : { id: { in: ctx.allowedSiteIds } }),
    },
    orderBy: { createdAt: "asc" },
  });
  if (!site) badRequest("Aucun site actif : créez un site dans les paramètres.");
  return site.id;
}

async function addLinesTo(
  tx: Tx,
  ctx: OrgCtx,
  org: OrgQuoteContext,
  quote: Quote,
  lines: QuoteLineInput[],
): Promise<void> {
  const customer = await tx.customer.findFirstOrThrow({ where: { id: quote.customerId } });
  let sortOrder = await tx.quoteLine.count({ where: { quoteId: quote.id } });
  for (const line of lines) {
    const data = await buildQuoteLineData(tx, org, quote, customer, line, actorOf(ctx));
    await tx.quoteLine.create({ data: { ...data, sortOrder: sortOrder++ } });
  }
}

async function auditQuote(
  ctx: OrgCtx,
  action: string,
  quoteId: string,
  extra: { before?: unknown; after?: unknown; reason?: string | null } = {},
) {
  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    membershipId: ctx.membership.id,
    action,
    entity: "Quote",
    entityId: quoteId,
    before: extra.before,
    after: extra.after,
    reason: extra.reason ?? undefined,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}

function tabWhere(tab: string): Prisma.QuoteWhereInput {
  switch (tab) {
    case "TODO":
      return { OR: [{ status: "DRAFT" }, { discountApprovalStatus: "PENDING" }] };
    case "PENDING":
      return { status: { in: ["SENT", "VIEWED"] } };
    case "DECIDED":
      return { status: { in: ["ACCEPTED", "PARTIALLY_ACCEPTED", "DECLINED", "CONVERTED"] } };
    case "EXPIRED":
      return { status: "EXPIRED" };
    default:
      return {};
  }
}

const LIST_INCLUDE = {
  customer: { select: { id: true, displayName: true, type: true } },
  vehicle: { select: { id: true, plate: true, make: true, model: true } },
  site: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, user: { select: { name: true } } } },
  repairOrder: { select: { id: true, number: true, status: true } },
  _count: { select: { reminders: { where: { status: "SENT" } } } },
} satisfies Prisma.QuoteInclude;

async function createDraft(
  tx: Tx,
  ctx: OrgCtx,
  org: OrgQuoteContext,
  input: {
    siteId: string;
    customerId: string;
    vehicleId: string | null;
    repairOrderId: string | null;
    inspectionId: string | null;
    insuranceClaimId: string | null;
    origin: Quote["origin"];
    validUntil?: Date;
    notes?: string | null;
  },
  now: Date,
): Promise<Quote> {
  const customer = await tx.customer.findFirst({
    where: { id: input.customerId, deletedAt: null },
  });
  if (!customer) notFound("Client introuvable.");
  if (input.vehicleId) {
    const vehicle = await tx.vehicle.findFirst({ where: { id: input.vehicleId, deletedAt: null } });
    if (!vehicle) notFound("Véhicule introuvable.");
    if (vehicle.customerId !== customer.id) badRequest("Ce véhicule n'appartient pas à ce client.");
  }
  const number = await nextQuoteNumber(tx, org, input.siteId, now);
  const validUntil =
    input.validUntil ??
    computeValidUntil({
      createdOn: businessDate(now, org.timeZone),
      settings: org.quotes,
      customerType: customer.type,
      isInsurance: input.origin === "INSURANCE" || Boolean(input.insuranceClaimId),
    });
  const quote = await tx.quote.create({
    data: {
      organizationId: ctx.organizationId,
      siteId: input.siteId,
      number,
      version: 1,
      customerId: customer.id,
      vehicleId: input.vehicleId,
      repairOrderId: input.repairOrderId,
      inspectionId: input.inspectionId,
      insuranceClaimId: input.insuranceClaimId,
      origin: input.origin,
      status: "DRAFT",
      validUntil,
      notes: input.notes ?? null,
      createdById: ctx.membership.id,
    },
  });
  await emitDomainEvent(tx as never, ctx.organizationId, "quote.created", {
    quoteId: quote.id,
    number: quote.number,
    customerId: quote.customerId,
    vehicleId: quote.vehicleId,
    repairOrderId: quote.repairOrderId,
    origin: quote.origin,
  });
  return quote;
}

function isoToDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Disponibilité M07 (interface) : `onHand − reserved` au site, délai si à commander. */
async function availabilityFor(
  tx: Tx,
  org: OrgQuoteContext,
  siteId: string | null,
  productIds: string[],
) {
  if (!siteId || productIds.length === 0) return new Map<string, number>();
  const levels = await tx.stockLevel.findMany({ where: { siteId, productId: { in: productIds } } });
  const map = new Map<string, number>();
  for (const l of levels) map.set(l.productId, l.onHand - l.reserved);
  void org;
  return map;
}

async function recipientFor(
  tx: Tx,
  quote: Quote,
  recipient: { type: string; contactId?: string; address?: string },
): Promise<{ recipient: Recipient; contactId: string | null }> {
  const customer = await tx.customer.findFirstOrThrow({ where: { id: quote.customerId } });
  const base: Recipient = {
    customerId: customer.id,
    name: customer.displayName,
    phone: customer.phone,
    whatsapp: customer.whatsappPhone,
    email: customer.email,
  };
  if (recipient.type === "CONTACT" && recipient.contactId) {
    const contact = await tx.customerContact.findFirst({
      where: { id: recipient.contactId, customerId: customer.id, deletedAt: null },
    });
    if (!contact) notFound("Contact introuvable.");
    return {
      recipient: {
        customerId: customer.id,
        name: contact.name,
        phone: contact.phone,
        whatsapp: contact.phone,
        email: contact.email,
      },
      contactId: contact.id,
    };
  }
  if (recipient.type === "INSURER") {
    if (!quote.insuranceClaimId) badRequest("Ce devis n'est pas lié à un sinistre.");
    const claim = await tx.insuranceClaim.findFirst({
      where: { id: quote.insuranceClaimId },
      include: { insuranceCompany: true },
    });
    if (!claim) notFound("Sinistre introuvable.");
    return {
      recipient: {
        customerId: customer.id,
        name: claim.insuranceCompany.name,
        phone: claim.insuranceCompany.phone,
        whatsapp: null,
        email: claim.insuranceCompany.email,
      },
      contactId: null,
    };
  }
  if (recipient.type === "CUSTOM" && recipient.address) {
    const isEmail = recipient.address.includes("@");
    const phone = isEmail ? null : normalizePhoneCI(recipient.address);
    return {
      recipient: {
        customerId: customer.id,
        name: customer.displayName,
        phone: phone?.e164 ?? null,
        whatsapp: phone?.e164 ?? null,
        email: isEmail ? recipient.address.trim().toLowerCase() : null,
      },
      contactId: null,
    };
  }
  return { recipient: base, contactId: null };
}

export const quoteRouter = router({
  list: requirePermission("quote:read")
    .input(quoteListInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      assertQuoteModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const where: Prisma.QuoteWhereInput = {
        deletedAt: null,
        supersededAt: null,
        ...siteFilter(ctx),
        ...tabWhere(input.tab),
      };
      if (input.siteId) {
        requireSite(ctx, input.siteId);
        where.siteId = input.siteId;
      }
      if (input.statuses?.length) where.status = { in: input.statuses };
      if (input.advisorId) where.createdById = input.advisorId;
      if (input.origin) where.origin = input.origin;
      if (input.customerId) where.customerId = input.customerId;
      if (input.vehicleId) where.vehicleId = input.vehicleId;
      if (input.repairOrderId) where.repairOrderId = input.repairOrderId;
      if (input.minTotal) where.total = { gte: input.minTotal };
      if (input.from || input.to) {
        where.createdAt = {
          ...(input.from ? { gte: isoToDate(input.from) } : {}),
          ...(input.to ? { lt: new Date(isoToDate(input.to).getTime() + 86_400_000) } : {}),
        };
      }
      if (input.q) {
        where.OR = [
          { number: { contains: input.q, mode: "insensitive" } },
          { customer: { displayName: { contains: input.q, mode: "insensitive" } } },
          { vehicle: { plateCompact: { contains: input.q.toUpperCase().replace(/[^A-Z0-9]/g, "") } } },
        ];
      }
      const rows = await tenantDb.quote.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: input.tab === "PENDING" ? [{ sentAt: "asc" }] : [{ createdAt: "desc" }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      const nextCursor = rows.length > input.limit ? rows[input.limit]!.id : null;
      const today = businessDate(quoteNow(), org.timeZone);
      const items = rows.slice(0, input.limit).map((q) => ({
        id: q.id,
        number: q.number,
        version: q.version,
        status: q.status as QuoteStatus,
        origin: q.origin,
        createdAt: q.createdAt,
        sentAt: q.sentAt,
        viewedAt: q.viewedAt,
        decidedAt: q.decidedAt,
        validUntil: q.validUntil,
        daysToExpiry: Math.round((q.validUntil.getTime() - today.getTime()) / 86_400_000),
        total: q.total,
        acceptedTotal: q.acceptedTotal,
        customerShare: q.customerShare,
        discountApprovalStatus: q.discountApprovalStatus,
        customer: q.customer,
        vehicle: q.vehicle,
        site: q.site,
        advisor: q.createdBy ? { id: q.createdBy.id, name: q.createdBy.user.name } : null,
        repairOrder: q.repairOrder,
        remindersSent: q._count.reminders,
        lastAction: q.decidedAt ?? q.viewedAt ?? q.sentAt ?? q.updatedAt,
      }));
      const counts = await Promise.all(
        (["TODO", "PENDING", "DECIDED", "EXPIRED"] as const).map((tab) =>
          tenantDb.quote.count({
            where: { deletedAt: null, supersededAt: null, ...siteFilter(ctx), ...tabWhere(tab) },
          }),
        ),
      );
      return {
        items,
        nextCursor,
        counts: { TODO: counts[0], PENDING: counts[1], DECIDED: counts[2], EXPIRED: counts[3] },
      };
    }),

  get: requirePermission("quote:read")
    .input(quoteIdInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      assertQuoteModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = quoteNow();
      return tenantDb.transaction(async (tx) => {
        const base = await loadQuote(tx, ctx, input.id);
        const quote = await tx.quote.findFirstOrThrow({
          where: { id: base.id },
          include: {
            customer: true,
            vehicle: true,
            site: { select: { id: true, code: true, name: true } },
            createdBy: { select: { id: true, user: { select: { name: true } } } },
            recordedBy: { select: { id: true, user: { select: { name: true } } } },
            discountApprovedBy: { select: { id: true, user: { select: { name: true } } } },
            repairOrder: { select: { id: true, number: true, status: true } },
            insuranceClaim: {
              select: {
                id: true,
                claimNumber: true,
                deductible: true,
                approvedAmount: true,
                insuranceCompany: { select: { name: true, email: true } },
              },
            },
            lines: {
              orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
              include: {
                product: { select: { id: true, sku: true, minSalePrice: true, isStocked: true } },
                laborOperation: { select: { id: true, code: true, standardHours: true } },
              },
            },
            invoices: { select: { id: true, number: true, type: true, status: true, total: true } },
          },
        });
        const [versions, reminders, messages, contacts, tokens, recommendations] =
          await Promise.all([
            tx.quote.findMany({
              where: { number: quote.number, deletedAt: null },
              orderBy: { version: "asc" },
              select: {
                id: true,
                version: true,
                status: true,
                total: true,
                createdAt: true,
                sentAt: true,
                supersededAt: true,
              },
            }),
            tx.reminder.findMany({
              where: { quoteId: quote.id },
              orderBy: { scheduledFor: "asc" },
              select: { id: true, stepKey: true, status: true, scheduledFor: true, sentAt: true },
            }),
            tx.message.findMany({
              where: { customerId: quote.customerId, createdAt: { gte: quote.createdAt } },
              orderBy: { createdAt: "desc" },
              take: 20,
              select: {
                id: true,
                direction: true,
                channel: true,
                status: true,
                body: true,
                createdAt: true,
              },
            }),
            tx.customerContact.findMany({
              where: { customerId: quote.customerId, deletedAt: null },
              select: { id: true, name: true, role: true, phone: true, email: true },
            }),
            tx.portalToken.findMany({
              where: { scope: "QUOTE", targetId: quote.id },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { status: true, openCount: true, lastOpenedAt: true, expiresAt: true },
            }),
            tx.vehicleRecommendation.findMany({
              where: { quoteLineId: { in: quote.lines.map((l) => l.id) } },
              select: { id: true, quoteLineId: true, status: true },
            }),
          ]);
        const availability = await availabilityFor(
          tx,
          org,
          quote.siteId,
          quote.lines.map((l) => l.productId).filter((p): p is string => !!p),
        );
        const groups = groupQuoteLines(
          quote.lines,
          quote.lines.map((l) => l.lineTotal),
        ).map((g) => ({
          key: g.key,
          label: g.label,
          priority: g.priority,
          isOptional: g.isOptional,
          requiresGroupKey: g.requiresGroupKey,
          total: g.total,
          accepted: g.accepted,
          lineIds: g.lines.map((l) => l.id),
        }));
        const canViewCost = ctx.permissions.has("product:view_cost");
        const cost = quote.lines.reduce(
          (s, l) => s + (l.costPrice != null ? Math.round(l.costPrice * l.quantity) : 0),
          0,
        );
        const today = businessDate(now, org.timeZone);
        const lines = quote.lines.map((l) => ({
          ...l,
          costPrice: canViewCost ? l.costPrice : null,
          availability: l.productId ? (availability.get(l.productId) ?? null) : null,
          leadTimeDays:
            l.productId && (availability.get(l.productId) ?? 0) < l.quantity
              ? org.defaultLeadTimeDays
              : null,
          recommendation: recommendations.find((r) => r.quoteLineId === l.id) ?? null,
        }));
        const versionAfter = versions.find((v) => v.version === quote.version + 1) ?? null;
        return {
          ...quote,
          lines,
          groups,
          versions,
          supersededById: versionAfter?.id ?? null,
          reminders,
          messages,
          contacts,
          link: tokens[0] ?? null,
          timeline: quoteTimeline(quote, reminders),
          transitions: availableQuoteTransitions(quote.status as QuoteStatus),
          isExpired: isQuoteExpired(quote.validUntil, today),
          margin: canViewCost ? { cost, estimated: quote.subtotal - quote.discountTotal - cost } : null,
          insurance: quote.insuranceClaim
            ? {
                ...quote.insuranceClaim,
                gap: insuranceGap(quote.insuranceShare, quote.insuranceClaim.approvedAmount),
              }
            : null,
          settings: {
            requireSignature: org.quotes.requireSignature,
            showLinePricesToCustomer: org.quotes.showLinePricesToCustomer,
            discountCaps: org.quotes.discountCaps,
            depositRule: org.quotes.depositRule,
          },
          myDiscountCap:
            org.quotes.discountCaps[ctx.membership.role as keyof typeof org.quotes.discountCaps] ??
            DEFAULT_QUOTE_SETTINGS.discountCaps.CASHIER,
        };
      });
    }),

  /** US-M05-02 — devis libre (client existant ou prospect nom + téléphone). */
  create: requirePermission("quote:create")
    .input(quoteCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      assertQuoteModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = quoteNow();
      return tenantDb.transaction(async (tx) => {
        let customerId = input.customerId ?? null;
        let vehicleId = input.vehicleId ?? null;
        const repairOrderId = input.repairOrderId ?? null;
        let siteId = input.siteId;
        if (repairOrderId) {
          const order = await tx.repairOrder.findFirst({ where: { id: repairOrderId, deletedAt: null } });
          if (!order) notFound("Ordre de réparation introuvable.");
          requireSite(ctx, order.siteId);
          customerId ??= order.customerId;
          vehicleId ??= order.vehicleId;
          siteId ??= order.siteId;
        }
        if (!customerId && input.newCustomer) {
          const phone = normalizePhoneCI(input.newCustomer.phone);
          if (phone.status !== "OK" || !phone.e164) badRequest("Numéro de téléphone invalide.");
          const existing = await tx.customer.findFirst({
            where: { phone: phone.e164, deletedAt: null },
          });
          if (existing) {
            customerId = existing.id;
          } else {
            const parts = input.newCustomer.name.trim().split(/\s+/);
            const created = await tx.customer.create({
              data: {
                organizationId: ctx.organizationId,
                type: "INDIVIDUAL",
                lastName: parts[0],
                firstName: parts.slice(1).join(" ") || null,
                displayName: input.newCustomer.name.trim(),
                phone: phone.e164,
                source: "devis",
              },
            });
            customerId = created.id;
          }
        }
        if (!customerId) badRequest("Indiquez un client.");
        const resolvedSite = await resolveSiteId(tx, ctx, siteId);
        const quote = await createDraft(
          tx,
          ctx,
          org,
          {
            siteId: resolvedSite,
            customerId,
            vehicleId,
            repairOrderId,
            inspectionId: null,
            insuranceClaimId: input.insuranceClaimId ?? null,
            origin:
              input.origin ??
              (input.insuranceClaimId ? "INSURANCE" : repairOrderId ? "REPAIR_ORDER" : "STANDALONE"),
            validUntil: input.validUntil ? isoToDate(input.validUntil) : undefined,
            notes: input.notes,
          },
          now,
        );
        if (input.lines?.length) await addLinesTo(tx, ctx, org, quote, input.lines);
        const { quote: recomputed } = await recomputeQuoteTotals(tx, org, quote.id);
        await syncDiscountApproval(tx, org, actorOf(ctx), quote.id);
        return recomputed;
      });
    }),

  /** US-M05-01 — depuis l'inspection : un groupe par point URGENT/WATCH avec recommandations. */
  createFromInspection: requirePermission("quote:create")
    .input(quoteCreateFromInspectionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      assertQuoteModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = quoteNow();
      return tenantDb.transaction(async (tx) => {
        const inspection = await tx.inspection.findFirst({
          where: { id: input.inspectionId },
          include: { items: { orderBy: { sortOrder: "asc" } } },
        });
        if (!inspection) notFound("Inspection introuvable.");
        const order = await tx.repairOrder.findFirstOrThrow({
          where: { id: inspection.repairOrderId },
          include: { vehicle: { select: { make: true, model: true, year: true } } },
        });
        requireSite(ctx, order.siteId);
        const items = inspection.items.filter(
          (i) =>
            (i.result === "URGENT" || (input.includeWatch && i.result === "WATCH")) &&
            !i.addedToQuote &&
            (i.recommendedLaborIds.length > 0 || i.recommendedProductIds.length > 0),
        );
        if (items.length === 0) {
          badRequest("Aucun point d'inspection avec recommandation à chiffrer.");
        }
        const quote = await createDraft(
          tx,
          ctx,
          org,
          {
            siteId: order.siteId,
            customerId: order.customerId,
            vehicleId: order.vehicleId,
            repairOrderId: order.id,
            inspectionId: inspection.id,
            insuranceClaimId: order.insuranceClaimId,
            origin: "INSPECTION",
          },
          now,
        );
        const customer = await tx.customer.findFirstOrThrow({ where: { id: order.customerId } });
        const alreadyApproved = await tx.repairOrderLine.findMany({
          where: {
            repairOrderId: order.id,
            status: { not: "CANCELLED" },
            approval: { in: ["APPROVED", "NOT_REQUIRED"] },
          },
          select: { description: true, quantity: true, unitPrice: true },
        });
        let sortOrder = 0;
        for (const item of items) {
          const groupKey = `insp:${item.id}`;
          const [ops, products] = await Promise.all([
            tx.laborOperation.findMany({ where: { id: { in: item.recommendedLaborIds } } }),
            tx.product.findMany({ where: { id: { in: item.recommendedProductIds } } }),
          ]);
          const common = {
            groupKey,
            groupLabel: item.label,
            priority: item.result,
            isOptional: item.result !== "URGENT",
            inspectionItemId: item.id,
            customerExplanation: item.comment ?? ops[0]?.customerDescription ?? null,
            photoAttachmentIds: item.photoUrls.map((u) => u.split("/").pop() ?? u),
          };
          for (const op of ops) {
            const pricing = laborLinePricing(
              { ...op, standardHours: laborHoursForVehicle(op, order.vehicle) },
              org.laborRates,
            );
            const data = await buildQuoteLineData(
              tx,
              org,
              quote,
              customer,
              {
                type: "LABOR",
                laborOperationId: op.id,
                description: op.name,
                quantity: pricing.quantity,
                unitPrice: pricing.unitPrice,
                ...common,
              },
              actorOf(ctx),
            );
            await tx.quoteLine.create({ data: { ...data, sortOrder: sortOrder++ } });
          }
          for (const product of products) {
            const data = await buildQuoteLineData(
              tx,
              org,
              quote,
              customer,
              {
                type: "PART",
                productId: product.id,
                description: product.name,
                quantity: 1,
                ...common,
              },
              actorOf(ctx),
            );
            await tx.quoteLine.create({ data: { ...data, sortOrder: sortOrder++ } });
          }
          await tx.inspectionItem.update({ where: { id: item.id }, data: { addedToQuote: true } });
        }
        const { quote: recomputed } = await recomputeQuoteTotals(tx, org, quote.id);
        await syncDiscountApproval(tx, org, actorOf(ctx), quote.id);
        return { quote: recomputed, alreadyApproved, itemsAdded: items.length };
      });
    }),

  /** Devis reprenant les lignes `PENDING` d'un OR (accord à obtenir par lien). */
  createFromRepairOrderPending: requirePermission("quote:create")
    .input(quoteCreateFromRepairOrderInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      assertQuoteModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = quoteNow();
      return tenantDb.transaction(async (tx) => {
        const order = await tx.repairOrder.findFirst({
          where: { id: input.repairOrderId, deletedAt: null },
        });
        if (!order) notFound("Ordre de réparation introuvable.");
        requireSite(ctx, order.siteId);
        const pending = await tx.repairOrderLine.findMany({
          where: { repairOrderId: order.id, approval: "PENDING", status: { not: "CANCELLED" } },
          orderBy: { sortOrder: "asc" },
        });
        if (pending.length === 0) badRequest("Aucune ligne en attente d'accord sur cet OR.");
        const quote = await createDraft(
          tx,
          ctx,
          org,
          {
            siteId: order.siteId,
            customerId: order.customerId,
            vehicleId: order.vehicleId,
            repairOrderId: order.id,
            inspectionId: null,
            insuranceClaimId: order.insuranceClaimId,
            origin: "REPAIR_ORDER",
          },
          now,
        );
        for (const [i, line] of pending.entries()) {
          const created = await tx.quoteLine.create({
            data: {
              organizationId: ctx.organizationId,
              quoteId: quote.id,
              type: line.type,
              productId: line.productId,
              laborOperationId: line.laborOperationId,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountRate: line.discountRate,
              vatRate: line.vatRate,
              payer: line.payer,
              isOptional: false,
              groupKey: line.inspectionItemId ? `insp:${line.inspectionItemId}` : null,
              inspectionItemId: line.inspectionItemId,
              costPrice: line.costPrice,
              isCustomerSupplied: line.isCustomerSupplied,
              sortOrder: i,
            },
          });
          await tx.repairOrderLine.update({
            where: { id: line.id },
            data: { quoteLineId: created.id },
          });
        }
        const { quote: recomputed } = await recomputeQuoteTotals(tx, org, quote.id);
        await syncDiscountApproval(tx, org, actorOf(ctx), quote.id);
        return recomputed;
      });
    }),

  update: requirePermission("quote:update")
    .input(quoteUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      assertQuoteModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        const patch = input.patch;
        const editsLockedFields =
          patch.validUntil !== undefined ||
          patch.globalDiscountRate !== undefined ||
          patch.globalDiscountAmount !== undefined;
        if (editsLockedFields) assertEditable(quote);
        if (patch.globalDiscountRate != null && patch.globalDiscountAmount != null) {
          badRequest("Indiquez une remise globale en % ou en FCFA, pas les deux.");
        }
        await tx.quote.update({
          where: { id: quote.id },
          data: {
            validUntil: patch.validUntil ? isoToDate(patch.validUntil) : undefined,
            notes: patch.notes,
            globalDiscountRate:
              patch.globalDiscountRate !== undefined
                ? patch.globalDiscountRate
                : patch.globalDiscountAmount
                  ? null
                  : undefined,
            globalDiscountAmount:
              patch.globalDiscountAmount !== undefined
                ? patch.globalDiscountAmount
                : patch.globalDiscountRate
                  ? null
                  : undefined,
            discountReason: patch.discountReason,
            customerPoNumber: patch.customerPoNumber,
            recipientContactId: patch.recipientContactId,
          },
        });
        const { quote: recomputed } = await recomputeQuoteTotals(tx, org, quote.id);
        const discount = await syncDiscountApproval(tx, org, actorOf(ctx), quote.id);
        return { quote: recomputed, discount };
      });
    }),

  /** US-M05-03 — demande de validation d'une remise au-delà du plafond. */
  requestDiscountApproval: requirePermission("quote:update")
    .input(quoteRequestDiscountApprovalInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        await tx.quote.update({
          where: { id: quote.id },
          data: { discountApprovalStatus: "PENDING", discountReason: input.reason },
        });
        const approvers = await membersWithRoles(tx, ["MANAGER", "OWNER"]);
        await notify(tx, ctx.organizationId, approvers, {
          type: "quote.discount_approval_requested",
          title: `Remise à valider — devis ${quote.number}`,
          body: input.reason,
          link: `/devis/${quote.id}`,
          dedupeKey: `quote.discount:${quote.id}:${quote.updatedAt.getTime()}`,
        });
        await emitDomainEvent(tx as never, ctx.organizationId, "quote.discount_approval_requested", {
          quoteId: quote.id,
          number: quote.number,
          requestedById: ctx.membership.id,
        });
        return { status: "PENDING" as const };
      });
    }),

  decideDiscount: requirePermission("quote:discount_override")
    .input(quoteDecideDiscountInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        if (input.decision === "APPROVE_PARTIAL") {
          const cap = input.maxRate ?? 0;
          await tx.quoteLine.updateMany({
            where: { quoteId: quote.id, discountRate: { gt: cap } },
            data: { discountRate: cap },
          });
          if ((quote.globalDiscountRate ?? 0) > cap) {
            await tx.quote.update({
              where: { id: quote.id },
              data: { globalDiscountRate: cap },
            });
          }
        }
        const status = input.decision === "REJECT" ? "REJECTED" : "APPROVED";
        await tx.quote.update({
          where: { id: quote.id },
          data: {
            discountApprovalStatus: status,
            discountApprovedById: input.decision === "REJECT" ? null : ctx.membership.id,
          },
        });
        const { quote: recomputed } = await recomputeQuoteTotals(tx, org, quote.id);
        await auditQuote(ctx, `quote.discount_${status.toLowerCase()}`, quote.id, {
          after: { decision: input.decision, maxRate: input.maxRate ?? null },
        });
        await notify(tx, ctx.organizationId, [quote.createdById], {
          type: "quote.discount_decided",
          title:
            status === "APPROVED"
              ? `Remise validée — devis ${quote.number}`
              : `Remise refusée — devis ${quote.number}`,
          link: `/devis/${quote.id}`,
        });
        return recomputed;
      });
    }),

  /** US-M05-04 — envoi par WhatsApp / SMS / email / lien seul / wa.me. */
  send: requirePermission("quote:send")
    .input(quoteSendInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      assertQuoteModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = quoteNow();
      const out = await tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        const lines = await tx.quoteLine.findMany({
          where: { quoteId: quote.id },
          orderBy: { sortOrder: "asc" },
        });
        const { recipient, contactId } = await recipientFor(tx, quote, input.recipient);
        const result = await sendQuote(tx, {
          org,
          quote,
          lines,
          channel: input.channel,
          recipient,
          recipientContactId: contactId,
          customMessage: input.message,
          sentById: ctx.membership.id,
          now,
        });
        await auditQuote(ctx, "quote.sent", quote.id, {
          after: { channel: input.channel, to: result.quote.sentTo },
        });
        return result;
      });
      await flushMessages([out.messageId]);
      return {
        quote: out.quote,
        messageId: out.messageId,
        waLink: out.waLink,
        publicUrl: out.publicUrl,
        body: out.body,
      };
    }),

  resend: requirePermission("quote:send")
    .input(quoteResendInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = quoteNow();
      const out = await tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        const lines = await tx.quoteLine.findMany({ where: { quoteId: quote.id } });
        const { recipient } = await recipientFor(tx, quote, { type: "CUSTOMER" });
        return sendQuote(tx, {
          org,
          quote,
          lines,
          channel: input.channel ?? "WHATSAPP",
          recipient,
          sentById: ctx.membership.id,
          now,
          resend: true,
        });
      });
      await flushMessages([out.messageId]);
      return { messageId: out.messageId, waLink: out.waLink, publicUrl: out.publicUrl };
    }),

  /** US-M05-07 — accord par téléphone / en personne / WhatsApp / assureur, avec preuve. */
  recordDecision: requirePermission("quote:record_decision")
    .input(quoteRecordDecisionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      assertQuoteModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = quoteNow();
      const out = await tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        const amendment = Boolean(input.amendment);
        if (!amendment && !["DRAFT", "SENT", "VIEWED"].includes(quote.status)) {
          badRequest(
            "Ce devis est déjà décidé : créez une nouvelle version ou enregistrez une décision complémentaire.",
          );
        }
        if (amendment && !["PARTIALLY_ACCEPTED", "DECLINED"].includes(quote.status)) {
          badRequest("Une décision complémentaire ne s'applique qu'à un devis refusé ou partiel.");
        }
        const today = businessDate(now, org.timeZone);
        if (isQuoteExpired(quote.validUntil, today)) {
          if (!input.overrideExpiredReason) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "QUOTE_EXPIRED : ce devis a expiré. Indiquez un motif pour forcer la décision.",
              cause: { code: "QUOTE_EXPIRED" },
            });
          }
          await auditQuote(ctx, "quote.decision_forced_after_expiry", quote.id, {
            reason: input.overrideExpiredReason,
          });
        }
        if (input.channel === "insurer" && input.approvedAmount !== undefined && quote.insuranceClaimId) {
          await tx.insuranceClaim.update({
            where: { id: quote.insuranceClaimId },
            data: { approvedAmount: input.approvedAmount, status: "APPROVED" },
          });
        }
        let signatureUrl: string | null = null;
        if (input.signatureDataUrl) {
          signatureUrl = await storeQuoteSignature(
            tx,
            ctx.organizationId,
            quote.id,
            input.signatureDataUrl,
            ctx.membership.id,
          );
        }
        const decisions = input.decisions.map((d) => ({
          lineId: d.lineId,
          groupKey: d.groupKey,
          accepted: d.accepted,
          declineReason: d.declineReason ?? input.declineReason ?? null,
        }));
        const result = await applyQuoteDecision(tx, org, quote, decisions, {
          channel: input.channel,
          signerName: input.signerName ?? input.counterpartName ?? null,
          signatureUrl,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          recordedById: ctx.membership.id,
          counterpart: input.counterpartName ?? null,
          messageId: input.messageId ?? null,
          declineReason: input.declineReason ?? null,
          amendment,
        }, now);
        let confirmation: { messageId: string | null; note: string | null } = {
          messageId: null,
          note: null,
        };
        if (input.sendWrittenConfirmation && input.channel !== "insurer") {
          const customer = await tx.customer.findFirstOrThrow({ where: { id: quote.customerId } });
          confirmation = await sendDecisionConfirmation(
            tx,
            org,
            result.quote,
            result.lines,
            customer,
            ctx.membership.id,
            now,
          );
          if (confirmation.note) {
            await tx.quote.update({
              where: { id: quote.id },
              data: { notes: [quote.notes, confirmation.note].filter(Boolean).join("\n") },
            });
          }
        }
        await auditQuote(ctx, "quote.decision_recorded", quote.id, {
          after: {
            channel: input.channel,
            status: result.status,
            acceptedTotal: result.acceptedTotal,
            counterpart: input.counterpartName ?? null,
            amendment,
          },
        });
        await notify(tx, ctx.organizationId, result.notifyMembershipIds, {
          type: "quote.decided",
          title: `Devis ${quote.number} : ${result.status === "DECLINED" ? "refusé" : "accepté"} (${input.channel})`,
          link: `/devis/${quote.id}`,
          dedupeKey: `quote.decided:${quote.id}:${now.getTime()}`,
        });
        return { ...result, confirmation };
      });
      await flushMessages([out.confirmation.messageId]);
      return {
        quote: out.quote,
        status: out.status,
        acceptedTotal: out.acceptedTotal,
        depositAmount: out.depositAmount,
        confirmationMessageId: out.confirmation.messageId,
        confirmationNote: out.confirmation.note,
      };
    }),

  /** US-M05-08 / US-M05-10 — nouvelle version (modification d'un devis envoyé, réactivation). */
  createVersion: requirePermission("quote:update")
    .input(quoteCreateVersionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      assertQuoteModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = quoteNow();
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        if (quote.supersededAt) badRequest("Cette version a déjà été remplacée.");
        if (!["SENT", "VIEWED", "EXPIRED", "PARTIALLY_ACCEPTED", "DECLINED"].includes(quote.status)) {
          badRequest(
            quote.status === "DRAFT"
              ? "Un brouillon se modifie directement."
              : "Ce devis ne peut plus être versionné.",
          );
        }
        const result = await createQuoteVersion(tx, org, quote, {
          refreshPrices: input.refreshPrices ?? quote.status === "EXPIRED",
          createdById: ctx.membership.id,
          now,
        });
        await auditQuote(ctx, "quote.version_created", result.quote.id, {
          after: { from: quote.id, version: result.quote.version, priceChanges: result.priceChanges },
        });
        return result;
      });
    }),

  /** US-M05-11 — devis libre accepté → OR brouillon avec les lignes acceptées. */
  convertToRepairOrder: requirePermission("quote:update", "repair_order:create")
    .input(quoteConvertToRepairOrderInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      assertQuoteModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = quoteNow();
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        if (!["ACCEPTED", "PARTIALLY_ACCEPTED"].includes(quote.status)) {
          badRequest("Seul un devis accepté peut être converti en ordre de réparation.");
        }
        if (quote.repairOrderId) badRequest("Ce devis est déjà lié à un ordre de réparation.");
        if (!quote.vehicleId) badRequest("Indiquez le véhicule concerné avant de créer l'OR.");
        const accepted = await tx.quoteLine.findMany({
          where: { quoteId: quote.id, accepted: true },
          orderBy: { sortOrder: "asc" },
        });
        if (accepted.length === 0) badRequest("Aucune ligne acceptée à convertir.");
        const active = await tx.repairOrder.findFirst({
          where: {
            vehicleId: quote.vehicleId,
            deletedAt: null,
            status: {
              in: [
                "DRAFT",
                "CHECKED_IN",
                "DIAGNOSING",
                "AWAITING_APPROVAL",
                "APPROVED",
                "IN_PROGRESS",
                "WAITING_PARTS",
                "QUALITY_CHECK",
                "READY",
              ],
            },
          },
          select: { number: true },
        });
        if (active) {
          badRequest(`Ce véhicule a déjà un OR ouvert (${active.number}). Ajoutez-y les travaux.`);
        }
        const siteId = input.siteId ?? quote.siteId;
        requireSite(ctx, siteId);
        const number = await nextRepairOrderNumber(tx, org, siteId, now);
        const order = await tx.repairOrder.create({
          data: {
            organizationId: ctx.organizationId,
            siteId,
            number,
            customerId: quote.customerId,
            vehicleId: quote.vehicleId,
            advisorId: ctx.membership.id,
            createdById: ctx.membership.id,
            status: "DRAFT",
            complaint: `Devis ${quote.number} accepté`,
            insuranceClaimId: quote.insuranceClaimId,
          },
        });
        for (const [i, line] of accepted.entries()) {
          await tx.repairOrderLine.create({
            data: {
              organizationId: ctx.organizationId,
              repairOrderId: order.id,
              type: line.type,
              productId: line.productId,
              laborOperationId: line.laborOperationId,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountRate: line.discountRate,
              vatRate: line.vatRate,
              payer: line.payer,
              approval: "APPROVED",
              approvalSource: "QUOTE",
              quoteLineId: line.id,
              inspectionItemId: line.inspectionItemId,
              isCustomerSupplied: line.isCustomerSupplied,
              costPrice: line.costPrice,
              sortOrder: i,
            },
          });
        }
        const totalEstimate = accepted.reduce((s, l) => s + l.lineTotal, 0);
        await tx.repairOrder.update({ where: { id: order.id }, data: { totalEstimate } });
        await tx.quote.update({
          where: { id: quote.id },
          data: { repairOrderId: order.id, status: "CONVERTED", convertedAt: now },
        });
        await emitDomainEvent(tx as never, ctx.organizationId, "repair_order.created", {
          repairOrderId: order.id,
          customerId: order.customerId,
          vehicleId: order.vehicleId,
          status: "DRAFT",
          quoteId: quote.id,
        });
        await emitDomainEvent(tx as never, ctx.organizationId, "quote.converted", {
          quoteId: quote.id,
          number: quote.number,
          repairOrderId: order.id,
        });
        await auditQuote(ctx, "quote.converted", quote.id, { after: { repairOrderId: order.id } });
        const laborHours = accepted
          .filter((l) => l.type === "LABOR")
          .reduce((s, l) => s + l.quantity, 0);
        return { repairOrderId: order.id, number, suggestedDurationHours: laborHours };
      });
    }),

  /** US-M05-11 — vente comptoir : facture brouillon (M08 minimal) avec les lignes acceptées. */
  convertToInvoice: requirePermission("quote:update", "invoice:create")
    .input(quoteIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      assertQuoteModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = quoteNow();
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        if (!["ACCEPTED", "PARTIALLY_ACCEPTED"].includes(quote.status)) {
          badRequest("Seul un devis accepté peut être facturé.");
        }
        const accepted = await tx.quoteLine.findMany({
          where: { quoteId: quote.id, accepted: true },
          orderBy: { sortOrder: "asc" },
        });
        if (accepted.length === 0) badRequest("Aucune ligne acceptée à facturer.");
        const billable = accepted.filter((l) => l.payer === "CUSTOMER" || l.payer === "INSURANCE");
        const subtotal = billable.reduce((s, l) => s + l.lineSubtotal, 0);
        const vatTotal = billable.reduce((s, l) => s + l.lineVat, 0);
        const total = billable.reduce((s, l) => s + l.lineTotal, 0);
        const gross = billable.reduce((s, l) => s + Math.round(l.quantity * l.unitPrice), 0);
        const invoice = await tx.invoice.create({
          data: {
            organizationId: ctx.organizationId,
            siteId: quote.siteId,
            customerId: quote.customerId,
            vehicleId: quote.vehicleId,
            quoteId: quote.id,
            repairOrderId: quote.repairOrderId,
            status: "DRAFT",
            type: "INVOICE",
            subtotal,
            discountTotal: gross - subtotal,
            vatTotal,
            total,
            balance: total,
            createdById: ctx.membership.id,
          },
        });
        for (const [i, line] of billable.entries()) {
          await tx.invoiceLine.create({
            data: {
              organizationId: ctx.organizationId,
              invoiceId: invoice.id,
              type: line.type,
              productId: line.productId,
              laborOperationId: line.laborOperationId,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountRate: line.discountRate,
              vatRate: line.vatRate,
              lineSubtotal: line.lineSubtotal,
              lineVat: line.lineVat,
              lineTotal: line.lineTotal,
              sortOrder: i,
            },
          });
        }
        await tx.quote.update({
          where: { id: quote.id },
          data: { status: "CONVERTED", convertedAt: now },
        });
        await emitDomainEvent(tx as never, ctx.organizationId, "quote.converted", {
          quoteId: quote.id,
          number: quote.number,
          invoiceId: invoice.id,
        });
        await auditQuote(ctx, "quote.converted", quote.id, { after: { invoiceId: invoice.id } });
        return { invoiceId: invoice.id };
      });
    }),

  /** US-M05-12 — acompte : facture `DEPOSIT` brouillon (le lien de paiement arrive avec M08). */
  requestDeposit: requirePermission("quote:update", "invoice:create")
    .input(quoteRequestDepositInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        if (!["ACCEPTED", "PARTIALLY_ACCEPTED", "CONVERTED"].includes(quote.status)) {
          badRequest("L'acompte se demande sur un devis accepté.");
        }
        if (quote.depositInvoiceId) {
          return { invoiceId: quote.depositInvoiceId, amount: quote.depositAmount ?? 0, paymentLinkUrl: null };
        }
        const amount = input.amount ?? quote.depositAmount ?? 0;
        if (amount <= 0) badRequest("Indiquez le montant de l'acompte.");
        const vatRate = org.vatEnabled ? org.vatRate : 0;
        const ht = Math.round((amount * 100) / (100 + vatRate));
        const invoice = await tx.invoice.create({
          data: {
            organizationId: ctx.organizationId,
            siteId: quote.siteId,
            customerId: quote.customerId,
            vehicleId: quote.vehicleId,
            quoteId: quote.id,
            repairOrderId: quote.repairOrderId,
            type: "DEPOSIT",
            status: "DRAFT",
            subtotal: ht,
            vatTotal: amount - ht,
            total: amount,
            balance: amount,
            createdById: ctx.membership.id,
            lines: {
              create: {
                organizationId: ctx.organizationId,
                type: "FEE",
                description: `Acompte sur devis ${quote.number}`,
                quantity: 1,
                unitPrice: ht,
                vatRate,
                lineSubtotal: ht,
                lineVat: amount - ht,
                lineTotal: amount,
              },
            },
          },
        });
        await tx.quote.update({
          where: { id: quote.id },
          data: { depositInvoiceId: invoice.id, depositAmount: amount },
        });
        return { invoiceId: invoice.id, amount, paymentLinkUrl: null };
      });
    }),

  regenerateLink: requirePermission("quote:send")
    .input(quoteIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = quoteNow();
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        if (quote.status === "DRAFT") badRequest("Envoyez d'abord le devis.");
        const link = await issueQuoteLink(tx, {
          organizationId: ctx.organizationId,
          quote,
          createdById: ctx.membership.id,
          now,
        });
        await auditQuote(ctx, "quote.link_regenerated", quote.id);
        return { publicUrl: link.publicUrl };
      });
    }),

  delete: requirePermission("quote:delete")
    .input(quoteDeleteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = quoteNow();
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        if (quote.status !== "DRAFT" || quote.sentAt) {
          badRequest("Un devis envoyé ne se supprime jamais (traçabilité).");
        }
        await tx.quote.update({ where: { id: quote.id }, data: { deletedAt: now } });
        if (quote.supersedesId) {
          // Annulation d'une nouvelle version jamais envoyée : l'ancienne redevient courante.
          await tx.quote.update({
            where: { id: quote.supersedesId },
            data: { supersededAt: null },
          });
        }
        await auditQuote(ctx, "quote.deleted", quote.id, { reason: input.reason });
        return { ok: true as const };
      });
    }),

  /** Catalogue unifié MO / pièces avec disponibilité (US-M05-02, RG-M05-06). */
  catalog: requirePermission("quote:read")
    .input(quoteCatalogInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const q = input.q;
      const filter = q
        ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { code: { contains: q, mode: "insensitive" as const } }] }
        : {};
      const [ops, products] = await Promise.all([
        tenantDb.laborOperation.findMany({
          where: { isActive: true, ...filter },
          orderBy: { name: "asc" },
          take: 15,
        }),
        tenantDb.product.findMany({
          where: {
            isActive: true,
            ...(q
              ? {
                  OR: [
                    { name: { contains: q, mode: "insensitive" } },
                    { sku: { contains: q, mode: "insensitive" } },
                    { oemReference: { contains: q, mode: "insensitive" } },
                  ],
                }
              : {}),
          },
          orderBy: { name: "asc" },
          take: 15,
        }),
      ]);
      const siteId = input.siteId ?? ctx.session.activeSiteId ?? null;
      const availability = await availabilityFor(
        tenantDb as unknown as Tx,
        org,
        siteId,
        products.map((p) => p.id),
      );
      return [
        ...ops.map((op) => {
          const pricing = laborLinePricing(op, org.laborRates);
          const parts = Array.isArray(op.defaultParts) ? (op.defaultParts as unknown[]).length : 0;
          return {
            id: op.id,
            kind: "LABOR" as const,
            code: op.code,
            name: op.name,
            hours: pricing.quantity,
            unitPrice: pricing.unitPrice,
            vatRate: org.vatEnabled ? org.vatRate : 0,
            fixed: op.fixedPrice != null,
            kitParts: parts,
            customerDescription: op.customerDescription,
            available: null,
            leadTimeDays: null,
          };
        }),
        ...products.map((p) => {
          const available = availability.get(p.id) ?? 0;
          return {
            id: p.id,
            kind: "PART" as const,
            code: p.sku,
            name: p.name,
            hours: null,
            unitPrice: p.salePrice,
            vatRate: org.vatEnabled ? p.vatRate : 0,
            fixed: false,
            kitParts: 0,
            customerDescription: null,
            available: siteId ? available : null,
            leadTimeDays: available > 0 ? null : org.defaultLeadTimeDays,
          };
        }),
      ];
    }),

  /** RG-M05-05 — forfait + kit de pièces, avec durée spécifique au véhicule. */
  addKit: requirePermission("quote:update")
    .input(quoteAddKitInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.quoteId);
        assertEditable(quote);
        const op = await tx.laborOperation.findFirst({ where: { id: input.laborOperationId } });
        if (!op) notFound("Opération introuvable.");
        const groupKey = `kit:${op.code}:${Date.now().toString(36)}`;
        const vehicleId = input.vehicleId ?? quote.vehicleId;
        const vehicle = vehicleId
          ? await tx.vehicle.findFirst({
              where: { id: vehicleId },
              select: { make: true, model: true, year: true },
            })
          : null;
        const pricing = laborLinePricing(
          { ...op, standardHours: laborHoursForVehicle(op, vehicle) },
          org.laborRates,
        );
        const lines: QuoteLineInput[] = [
          {
            type: "LABOR",
            laborOperationId: op.id,
            description: op.name,
            quantity: pricing.quantity,
            unitPrice: pricing.unitPrice,
            groupKey,
            groupLabel: op.name,
            customerExplanation: op.customerDescription ?? null,
          },
        ];
        const parts = Array.isArray(op.defaultParts)
          ? (op.defaultParts as { productId?: string; category?: string; quantity?: number }[])
          : [];
        for (const part of parts) {
          const product = part.productId
            ? await tx.product.findFirst({ where: { id: part.productId, isActive: true } })
            : part.category
              ? await tx.product.findFirst({
                  where: { category: part.category, isActive: true },
                  orderBy: { name: "asc" },
                })
              : null;
          if (!product) continue;
          lines.push({
            type: "PART",
            productId: product.id,
            description: product.name,
            quantity: part.quantity ?? 1,
            groupKey,
            groupLabel: op.name,
          });
        }
        await addLinesTo(tx, ctx, org, quote, lines);
        const { quote: recomputed } = await recomputeQuoteTotals(tx, org, quote.id);
        await syncDiscountApproval(tx, org, actorOf(ctx), quote.id);
        return { quote: recomputed, added: lines.length };
      });
    }),

  /** US-M05-14 — statistiques d'acceptation (exposées à M12). */
  stats: requirePermission("report:read")
    .input(quoteStatsInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const where: Prisma.QuoteWhereInput = { deletedAt: null, sentAt: { not: null }, ...siteFilter(ctx) };
      if (input.siteId) where.siteId = input.siteId;
      if (input.advisorId) where.createdById = input.advisorId;
      if (input.from || input.to) {
        where.sentAt = {
          ...(input.from ? { gte: isoToDate(input.from) } : {}),
          ...(input.to ? { lt: new Date(isoToDate(input.to).getTime() + 86_400_000) } : {}),
        };
      }
      const rows = await tenantDb.quote.findMany({
        where,
        include: {
          createdBy: { select: { id: true, user: { select: { name: true } } } },
          reminders: { where: { status: "SENT" }, select: { sentAt: true } },
        },
      });
      const inputs: QuoteStatsInput[] = rows.map((q) => ({
        number: q.number,
        version: q.version,
        status: q.status as QuoteStatus,
        sentAt: q.sentAt,
        decidedAt: q.decidedAt,
        total: q.total,
        acceptedTotal: q.acceptedTotal,
        declineReason: q.declineReason,
        advisorId: q.createdBy?.id ?? null,
        advisorName: q.createdBy?.user.name ?? null,
        followedUp: q.reminders.some(
          (r) => r.sentAt && (!q.decidedAt || r.sentAt.getTime() <= q.decidedAt.getTime()),
        ),
      }));
      return quoteStats(inputs);
    }),

  settings: requirePermission("quote:read").query(async ({ ctx }) => {
    const org = await adminDb.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { settings: true },
    });
    return quoteSettingsFrom(org.settings);
  }),

  updateSettings: requirePermission("settings:update")
    .input(quoteSettingsInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
        select: { settings: true },
      });
      const raw = (org.settings ?? {}) as Record<string, unknown>;
      const current = (raw.quotes ?? {}) as Record<string, unknown>;
      const nextCaps = {
        ...((current.discountCaps as Record<string, unknown> | undefined) ?? {}),
        ...(input.discountCaps ?? {}),
      };
      const next = { ...current, ...input, discountCaps: nextCaps };
      await adminDb.organization.update({
        where: { id: ctx.organizationId },
        data: { settings: { ...raw, quotes: next } as Prisma.InputJsonValue },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "settings.updated",
        entity: "Organization",
        entityId: ctx.organizationId,
        before: { quotes: current },
        after: { quotes: next },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return quoteSettingsFrom({ ...raw, quotes: next });
    }),
});

export const quoteLineRouter = router({
  add: requirePermission("quote:update")
    .input(quoteLineAddInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      assertQuoteModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.quoteId);
        assertEditable(quote);
        const { quoteId: _ignored, ...line } = input;
        void _ignored;
        await addLinesTo(tx, ctx, org, quote, [line]);
        const { quote: recomputed } = await recomputeQuoteTotals(tx, org, quote.id);
        const discount = await syncDiscountApproval(tx, org, actorOf(ctx), quote.id);
        if (line.priceReason) {
          await auditQuote(ctx, "quote.price_below_min", quote.id, { reason: line.priceReason });
        }
        return { quote: recomputed, discount };
      });
    }),

  update: requirePermission("quote:update")
    .input(quoteLineUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      assertQuoteModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const line = await tx.quoteLine.findFirst({ where: { id: input.id } });
        if (!line) notFound("Ligne introuvable.");
        const quote = await loadQuote(tx, ctx, line.quoteId);
        assertEditable(quote);
        const patch = input.patch;
        if (patch.unitPrice !== undefined && line.productId && !(patch.isCustomerSupplied ?? line.isCustomerSupplied)) {
          const product = await tx.product.findFirst({ where: { id: line.productId } });
          if (product?.minSalePrice != null && patch.unitPrice < product.minSalePrice) {
            if (!ctx.permissions.has("invoice:price_below_min")) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: `Prix inférieur au minimum autorisé pour « ${product.name} ». Demandez au gérant.`,
              });
            }
            if (!patch.priceReason?.trim()) badRequest("Indiquez le motif du prix sous le minimum.");
            await auditQuote(ctx, "quote.price_below_min", quote.id, { reason: patch.priceReason });
          }
        }
        const { priceReason: _r, ...rest } = patch;
        void _r;
        const data: Prisma.QuoteLineUncheckedUpdateInput = { ...rest };
        if ((rest.isCustomerSupplied ?? line.isCustomerSupplied) && line.type === "PART") {
          data.unitPrice = 0;
        }
        await tx.quoteLine.update({ where: { id: line.id }, data });
        const { quote: recomputed } = await recomputeQuoteTotals(tx, org, quote.id);
        const discount = await syncDiscountApproval(tx, org, actorOf(ctx), quote.id);
        return { quote: recomputed, discount };
      });
    }),

  remove: requirePermission("quote:update")
    .input(quoteLineRemoveInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const line = await tx.quoteLine.findFirst({ where: { id: input.id } });
        if (!line) notFound("Ligne introuvable.");
        const quote = await loadQuote(tx, ctx, line.quoteId);
        assertEditable(quote);
        await tx.quoteLine.delete({ where: { id: line.id } });
        const { quote: recomputed } = await recomputeQuoteTotals(tx, org, quote.id);
        const discount = await syncDiscountApproval(tx, org, actorOf(ctx), quote.id);
        return { quote: recomputed, discount };
      });
    }),

  reorder: requirePermission("quote:update")
    .input(quoteLineReorderInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.quoteId);
        assertEditable(quote);
        for (const [i, id] of input.orderedIds.entries()) {
          await tx.quoteLine.updateMany({ where: { id, quoteId: quote.id }, data: { sortOrder: i } });
        }
        for (const g of input.groups ?? []) {
          await tx.quoteLine.updateMany({
            where: { id: g.lineId, quoteId: quote.id },
            data: { groupKey: g.groupKey },
          });
        }
        const { quote: recomputed } = await recomputeQuoteTotals(tx, org, quote.id);
        return recomputed;
      });
    }),
});

/** Motif obligatoire (RG-M05-07) exposé pour l'interface. */
export function discountNeedsReason(lineRates: number[], globalRate: number | null): boolean {
  return discountRequiresReason(lineRates, globalRate);
}
