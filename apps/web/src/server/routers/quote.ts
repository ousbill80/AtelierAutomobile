// M05 §8 — routeur `quote` : liste, fiche, création (libre, depuis l'inspection, depuis les
// lignes d'OR en attente), remises et validation, envoi (WhatsApp/SMS/email/wa.me/lien),
// décision tracée, versions, conversion en OR / facture, acompte, statistiques, paramètres.
// Les règles viennent de `@atelieros/core` (quotes) ; ici on orchestre la base et M11.
import { TRPCError } from "@trpc/server";
import {
  ACTIVE_REPAIR_ORDER_STATUSES,
  buildWaLinkUrl,
  businessDate,
  canQuoteTransition,
  canTransition,
  checkDiscounts,
  clampRates,
  diffQuoteVersions,
  groupKeyOf,
  groupQuoteLines,
  isPastValidity,
  laborLinePricing,
  normalizePhoneCI,
  phoneConfirmationMessage,
  quoteSendMessage,
  quoteStats,
  sendBlockers,
  ttcToHt,
  type QuoteStatus,
  type Role,
} from "@atelieros/core";
import { adminDb, db, type Prisma, type Quote } from "@atelieros/db";
import {
  addKitInputSchema,
  convertToRepairOrderInputSchema,
  createFromInspectionInputSchema,
  createFromRepairOrderPendingInputSchema,
  createQuoteInputSchema,
  createVersionInputSchema,
  decideDiscountInputSchema,
  deleteQuoteInputSchema,
  quoteCatalogInputSchema,
  quoteIdInputSchema,
  quoteListInputSchema,
  quoteSettingsInputSchema,
  quoteStatsInputSchema,
  recordDecisionInputSchema,
  requestDepositInputSchema,
  requestDiscountApprovalInputSchema,
  resendQuoteInputSchema,
  sendQuoteInputSchema,
  updateQuoteInputSchema,
} from "@atelieros/validators";
import { writeAuditLog } from "../audit";
import { emitDomainEvent } from "../events/emit";
import { messagingEnqueue, type EnqueueAttachment } from "../messaging/enqueue";
import { enqueueMessageSendJob } from "../messaging/queue";
import {
  applyTransition,
  nextRepairOrderNumber,
  recomputeTotals,
  roNow,
} from "../repairOrders/helpers";
import { renderQuotePdfFor, quotePdfFilename } from "../quotes/pdf";
import { buildQuotePublicView } from "../quotes/publicView";
import {
  applyDecision,
  assertQuoteModule,
  bad,
  buildQuoteLineData,
  evaluateDiscounts,
  initialValidUntil,
  issueQuoteToken,
  loadOrgQuoteContext,
  mirrorPendingLinesIntoOrder,
  nextQuoteNumber,
  quoteNotFound,
  recomputeQuote,
  requestDiscountApprovalNotification,
  roLineDataFromQuoteLine,
  storeQuoteImage,
  totalsFor,
  type OrgQuoteContext,
  type Tx,
} from "../quotes/service";
import { getAttachmentStorage } from "../storage";
import { requirePermission, requireSite, router } from "../trpc";
import type { Ctx, CtxMembership, CtxSession, CtxUser } from "../context";

type OrgCtx = Ctx & {
  user: CtxUser;
  session: CtxSession;
  membership: CtxMembership;
  organizationId: string;
};

const DECIDED: QuoteStatus[] = ["ACCEPTED", "PARTIALLY_ACCEPTED", "DECLINED", "CONVERTED"];
const CANCELLABLE_REMINDERS = ["PLANNED", "NEEDS_APPROVAL", "SNOOZED"] as const;

function siteFilter(ctx: OrgCtx): Prisma.QuoteWhereInput {
  return ctx.allowedSiteIds === "ALL" ? {} : { siteId: { in: ctx.allowedSiteIds } };
}

async function loadQuote(tx: Tx, ctx: OrgCtx, id: string): Promise<Quote> {
  const quote = await tx.quote.findFirst({ where: { id, deletedAt: null } });
  if (!quote) quoteNotFound();
  requireSite(ctx, quote.siteId);
  return quote;
}

function assertTransitionOk(quote: Quote, t: Parameters<typeof canQuoteTransition>[1]) {
  const r = canQuoteTransition(quote, t);
  if (!r.ok) {
    throw new TRPCError({ code: "BAD_REQUEST", message: r.message, cause: { code: r.code } });
  }
}

function assertEditable(quote: Quote) {
  if (quote.supersededAt) bad("Cette version est remplacée : modifiez la version courante.");
  if (quote.status !== "DRAFT") {
    bad("Devis envoyé : créez une nouvelle version pour le modifier (« Modifier »).");
  }
}

function actorOf(ctx: OrgCtx) {
  return {
    organizationId: ctx.organizationId,
    permissions: ctx.permissions as ReadonlySet<string>,
    userId: ctx.user.id,
    membershipId: ctx.membership.id,
    role: ctx.membership.role as Role,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  };
}

async function audit(
  ctx: OrgCtx,
  action: string,
  entityId: string,
  extra: { before?: unknown; after?: unknown; reason?: string | null } = {},
) {
  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    membershipId: ctx.membership.id,
    action,
    entity: "Quote",
    entityId,
    before: extra.before as never,
    after: extra.after as never,
    reason: extra.reason ?? null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}

async function flush(ids: (string | null | undefined)[]) {
  for (const id of ids) {
    if (!id) continue;
    try {
      await enqueueMessageSendJob(id);
    } catch {
      // Redis indisponible : le message reste QUEUED, repris par le worker (M11).
    }
  }
}

async function resolveSite(ctx: OrgCtx, tx: Tx, requested?: string): Promise<string> {
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
  if (!site) bad("Aucun site actif : créez un site dans les paramètres.");
  return site.id;
}

async function cancelQuoteReminders(tx: Tx, quoteIds: string[], reason: string) {
  await tx.reminder.updateMany({
    where: { quoteId: { in: quoteIds }, status: { in: [...CANCELLABLE_REMINDERS] } },
    data: { status: "CANCELLED", skippedReason: reason },
  });
}

/** Devis brouillon courant d'un OR (pour y ajouter des lignes plutôt que d'en créer un autre). */
async function currentDraftForOrder(tx: Tx, repairOrderId: string) {
  return tx.quote.findFirst({
    where: { repairOrderId, status: "DRAFT", supersededAt: null, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

async function createQuoteRecord(
  tx: Tx,
  ctx: OrgCtx,
  org: OrgQuoteContext,
  input: {
    siteId: string;
    customerId: string;
    vehicleId: string | null;
    repairOrderId: string | null;
    origin: Quote["origin"];
    validUntil?: Date;
    notes?: string | null;
    inspectionId?: string | null;
    insuranceClaimId?: string | null;
  },
  now: Date,
): Promise<Quote> {
  const customer = await tx.customer.findFirstOrThrow({ where: { id: input.customerId } });
  const number = await nextQuoteNumber(tx, org, input.siteId, now);
  const quote = await tx.quote.create({
    data: {
      organizationId: ctx.organizationId,
      siteId: input.siteId,
      number,
      version: 1,
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      repairOrderId: input.repairOrderId,
      origin: input.origin,
      inspectionId: input.inspectionId ?? null,
      insuranceClaimId: input.insuranceClaimId ?? null,
      validUntil:
        input.validUntil ??
        initialValidUntil(org, now, {
          customerType: customer.type,
          isInsurance: Boolean(input.insuranceClaimId),
        }),
      notes: input.notes ?? null,
      createdById: ctx.membership.id,
      discountApprovalStatus: "NONE",
    },
  });
  await emitDomainEvent(tx as never, ctx.organizationId, "quote.created", {
    quoteId: quote.id,
    number,
    origin: quote.origin,
    repairOrderId: quote.repairOrderId,
  });
  return quote;
}

/** Destinataire effectif d'un envoi (client, contact d'entreprise, assureur, saisi). */
async function recipientOf(
  tx: Tx,
  quote: Quote,
  recipient: { type: string; contactId?: string; address?: string },
) {
  const customer = await tx.customer.findFirstOrThrow({ where: { id: quote.customerId } });
  if (recipient.type === "CONTACT") {
    const contact = await tx.customerContact.findFirst({
      where: { id: recipient.contactId, customerId: customer.id, deletedAt: null },
    });
    if (!contact) bad("Contact introuvable.");
    return {
      customer,
      contactId: contact.id,
      name: contact.name,
      to: {
        phone: contact.phone,
        whatsapp: contact.phone,
        email: contact.email,
        name: contact.name,
      },
    };
  }
  if (recipient.type === "INSURER" || recipient.type === "CUSTOM") {
    const address = recipient.address?.trim();
    if (!address) bad("Indiquez l'adresse du destinataire.");
    if (address.includes("@")) {
      return { customer, contactId: null, name: address, to: { email: address, name: address } };
    }
    let phone: string;
    try {
      const n = normalizePhoneCI(address);
      if (!n.e164) bad("Numéro à vérifier : saisissez-le au format à 10 chiffres.");
      phone = n.e164;
    } catch {
      bad("Numéro de téléphone invalide.");
    }
    return {
      customer,
      contactId: null,
      name: address,
      to: { phone, whatsapp: phone, name: address },
    };
  }
  return {
    customer,
    contactId: null,
    name: customer.displayName,
    to: {
      phone: customer.phone,
      whatsapp: customer.whatsappPhone ?? customer.phone,
      email: customer.email,
      name: customer.displayName,
    },
  };
}

/** M04 → `AWAITING_APPROVAL` à l'envoi (transition système si la machine à états l'autorise). */
async function requestOrderApproval(tx: Tx, repairOrderId: string, now: Date) {
  const order = await tx.repairOrder.findFirst({ where: { id: repairOrderId } });
  if (!order) return;
  const lines = await tx.repairOrderLine.findMany({ where: { repairOrderId } });
  const r = canTransition(order, lines, "request_approval", {
    permissions: new Set(),
    system: true,
  });
  if (!r.ok) return;
  await applyTransition(tx, {
    order,
    to: r.to,
    transition: "request_approval",
    reason: "Devis envoyé au client",
    membershipId: null,
    now,
  });
}

async function quoteDetail(tx: Tx, ctx: OrgCtx, org: OrgQuoteContext, quote: Quote, now: Date) {
  const [lines, customer, vehicle, order, versions, reminders, audits, tokens, members, contacts] =
    await Promise.all([
      tx.quoteLine.findMany({
        where: { quoteId: quote.id },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: {
          product: { select: { id: true, sku: true, minSalePrice: true, isStocked: true } },
          laborOperation: { select: { id: true, code: true } },
        },
      }),
      tx.customer.findFirstOrThrow({ where: { id: quote.customerId } }),
      quote.vehicleId ? tx.vehicle.findFirst({ where: { id: quote.vehicleId } }) : null,
      quote.repairOrderId
        ? tx.repairOrder.findFirst({
            where: { id: quote.repairOrderId },
            select: { id: true, number: true, status: true },
          })
        : null,
      tx.quote.findMany({
        where: { number: quote.number, deletedAt: null },
        orderBy: { version: "asc" },
        include: { lines: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
      }),
      tx.reminder.findMany({
        where: { quote: { number: quote.number } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          stepKey: true,
          status: true,
          sentAt: true,
          dueDate: true,
          quoteId: true,
        },
      }),
      tx.auditLog.findMany({
        where: { entity: "Quote", entityId: quote.id },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          action: true,
          reason: true,
          createdAt: true,
          membershipId: true,
          after: true,
        },
      }),
      tx.portalToken.findMany({
        where: { scope: "QUOTE", targetId: quote.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          openCount: true,
          lastOpenedAt: true,
          createdAt: true,
          expiresAt: true,
        },
      }),
      tx.membership.findMany({
        select: { id: true, role: true, user: { select: { name: true } } },
      }),
      tx.customerContact.findMany({
        where: { customerId: quote.customerId, deletedAt: null },
        select: { id: true, name: true, role: true, phone: true, email: true },
      }),
    ]);
  const names = new Map(members.map((m) => [m.id, m.user.name]));
  // US-M05-07 « Par WhatsApp » : messages entrants récents du client, liables comme preuve.
  const inboundMessages = await tx.message.findMany({
    where: { customerId: quote.customerId, direction: "INBOUND" },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, body: true, channel: true, createdAt: true },
  });
  const totals = totalsFor(quote, lines, org.vatEnabled);
  const groups = groupQuoteLines(lines, totals.lines);
  const canSeeCost = ctx.permissions.has("product:view_cost");
  const margin = canSeeCost
    ? lines.reduce((s, l, i) => {
        const a = totals.lines[i]!;
        if (!a.billable) return s;
        return (
          s + a.subtotal - Math.round((l.costPrice ?? 0) * (l.type === "PART" ? l.quantity : 0))
        );
      }, 0)
    : null;
  const discount = checkDiscounts({
    role: ctx.membership.role as Role,
    caps: org.quotes.discountCaps,
    lineRates: lines.map((l) => l.discountRate),
    globalRate: totals.globalDiscountRateEffective,
    hasOverride: ctx.permissions.has("quote:discount_override"),
  });
  const today = businessDate(now, org.timeZone);
  const blockers = sendBlockers({
    lineCount: lines.length,
    total: totals.total,
    onlyNonBillable:
      lines.length > 0 && lines.every((l) => l.payer === "WARRANTY" || l.payer === "INTERNAL"),
    discountApprovalStatus: quote.discountApprovalStatus,
  });
  if (discount.reasonRequired && !quote.discountReason) {
    blockers.push("Indiquez le motif de la remise (au-delà de 5 %).");
  }
  // Disponibilité stock (M07, interface en lecture) : `onHand − reserved` au site du devis.
  const productIds = lines.map((l) => l.productId).filter((p): p is string => !!p);
  const levels = productIds.length
    ? await tx.stockLevel.findMany({
        where: { siteId: quote.siteId, productId: { in: productIds } },
      })
    : [];
  const available = new Map(levels.map((l) => [l.productId, l.onHand - l.reserved]));
  const alreadyApproved = quote.repairOrderId
    ? await tx.repairOrderLine.findMany({
        where: {
          repairOrderId: quote.repairOrderId,
          approval: "APPROVED",
          status: { not: "CANCELLED" },
          OR: [{ quoteLineId: null }, { quoteLineId: { notIn: lines.map((l) => l.id) } }],
        },
        select: { id: true, description: true, unitPrice: true, quantity: true },
      })
    : [];
  const transitions = (["send", "decide", "edit", "convert", "delete"] as const).map((t) => ({
    transition: t,
    ...canQuoteTransition(quote, t),
  }));
  const previous = versions.filter((v) => v.version < quote.version).at(-1);
  const diff = previous
    ? diffQuoteVersions(
        { total: previous.total, lines: previous.lines },
        { total: quote.total, lines },
      )
    : null;
  return {
    ...quote,
    customer: {
      id: customer.id,
      displayName: customer.displayName,
      phone: customer.phone,
      email: customer.email,
      type: customer.type,
      requiresPurchaseOrder: customer.requiresPurchaseOrder,
    },
    contacts,
    vehicle: vehicle
      ? { id: vehicle.id, plate: vehicle.plate, make: vehicle.make, model: vehicle.model }
      : null,
    repairOrder: order,
    lines: lines.map((l, i) => ({
      ...l,
      costPrice: canSeeCost ? l.costPrice : null,
      amounts: totals.lines[i]!,
      groupKeyResolved: groupKeyOf(l),
      available: l.productId ? (available.get(l.productId) ?? 0) : null,
      overCap: discount.overLines.includes(i),
    })),
    groups: groups.map((g) => ({
      key: g.key,
      label: g.label,
      priority: g.priority,
      total: g.total,
      accepted: g.accepted,
      isOptional: g.isOptional,
      lineIds: g.lines.map((l) => l.id),
    })),
    totals,
    margin,
    discount: {
      cap: discount.cap,
      withinCaps: discount.withinCaps,
      overGlobal: discount.overGlobal,
      reasonRequired: discount.reasonRequired,
    },
    sendBlockers: blockers,
    expired: isPastValidity(quote.validUntil, today),
    transitions,
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      status: v.status,
      total: v.total,
      createdAt: v.createdAt,
      supersededAt: v.supersededAt,
    })),
    diff,
    reminders,
    timeline: audits.map((a) => ({
      ...a,
      by: a.membershipId ? (names.get(a.membershipId) ?? null) : null,
    })),
    links: tokens,
    alreadyApproved,
    inboundMessages,
    createdByName: quote.createdById ? (names.get(quote.createdById) ?? null) : null,
    recordedByName: quote.recordedById ? (names.get(quote.recordedById) ?? null) : null,
    timeZone: org.timeZone,
    vatEnabled: org.vatEnabled,
    settings: {
      requireSignature: org.quotes.requireSignature,
      depositRule: org.quotes.depositRule,
    },
  };
}

export const quoteRouter = router({
  list: requirePermission("quote:read")
    .input(quoteListInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      assertQuoteModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      const tabStatuses: Record<string, QuoteStatus[] | undefined> = {
        todo: ["DRAFT"],
        waiting: ["SENT", "VIEWED"],
        decided: DECIDED,
        expired: ["EXPIRED"],
        all: undefined,
      };
      const statuses = input.statuses ?? tabStatuses[input.tab];
      const where: Prisma.QuoteWhereInput = {
        deletedAt: null,
        supersededAt: null,
        ...siteFilter(ctx),
        ...(input.siteId ? { siteId: input.siteId } : {}),
        ...(statuses
          ? input.tab === "todo"
            ? { OR: [{ status: { in: statuses } }, { discountApprovalStatus: "PENDING" }] }
            : { status: { in: statuses } }
          : {}),
        ...(input.advisorId ? { createdById: input.advisorId } : {}),
        ...(input.origin ? { origin: input.origin } : {}),
        ...(input.minTotal ? { total: { gte: input.minTotal } } : {}),
        ...(input.from || input.to
          ? {
              createdAt: {
                ...(input.from ? { gte: input.from } : {}),
                ...(input.to ? { lte: input.to } : {}),
              },
            }
          : {}),
        ...(input.q
          ? {
              AND: [
                {
                  OR: [
                    { number: { contains: input.q, mode: "insensitive" } },
                    { customer: { displayName: { contains: input.q, mode: "insensitive" } } },
                    { vehicle: { plate: { contains: input.q, mode: "insensitive" } } },
                  ],
                },
              ],
            }
          : {}),
      };
      const rows = await tenantDb.quote.findMany({
        where,
        orderBy:
          input.tab === "waiting"
            ? [{ sentAt: "asc" }, { id: "asc" }]
            : [{ createdAt: "desc" }, { id: "desc" }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: {
          customer: { select: { id: true, displayName: true } },
          vehicle: { select: { id: true, plate: true, make: true, model: true } },
          createdBy: { select: { id: true, user: { select: { name: true } } } },
          reminders: { where: { status: "SENT" }, select: { id: true } },
        },
      });
      const page = rows.slice(0, input.limit);
      const today = businessDate(now, org.timeZone);
      const counts = await tenantDb.quote.groupBy({
        by: ["status"],
        where: { deletedAt: null, supersededAt: null, ...siteFilter(ctx) },
        _count: { _all: true },
      });
      const pendingDiscounts = await tenantDb.quote.count({
        where: {
          deletedAt: null,
          supersededAt: null,
          discountApprovalStatus: "PENDING",
          ...siteFilter(ctx),
        },
      });
      return {
        items: page.map((q) => ({
          id: q.id,
          number: q.number,
          version: q.version,
          status: q.status,
          origin: q.origin,
          createdAt: q.createdAt,
          sentAt: q.sentAt,
          viewedAt: q.viewedAt,
          decidedAt: q.decidedAt,
          validUntil: q.validUntil,
          daysToExpiry: Math.round((q.validUntil.getTime() - today.getTime()) / 86_400_000),
          total: q.total,
          acceptedTotal: q.acceptedTotal,
          customer: q.customer,
          vehicle: q.vehicle,
          advisor: q.createdBy?.user.name ?? null,
          followupsSent: q.reminders.length,
          discountApprovalStatus: q.discountApprovalStatus,
          lastAction: q.decidedAt ?? q.viewedAt ?? q.sentAt ?? q.updatedAt,
        })),
        nextCursor: rows.length > input.limit ? page.at(-1)!.id : null,
        counts: {
          todo: (counts.find((c) => c.status === "DRAFT")?._count._all ?? 0) + pendingDiscounts,
          waiting: counts
            .filter((c) => c.status === "SENT" || c.status === "VIEWED")
            .reduce((s, c) => s + c._count._all, 0),
          decided: counts
            .filter((c) => DECIDED.includes(c.status))
            .reduce((s, c) => s + c._count._all, 0),
          expired: counts.find((c) => c.status === "EXPIRED")?._count._all ?? 0,
        },
        timeZone: org.timeZone,
      };
    }),

  get: requirePermission("quote:read")
    .input(quoteIdInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      assertQuoteModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        return quoteDetail(tx, ctx, org, quote, roNow());
      });
    }),

  /** Devis liés à un OR (onglet « Devis » de la fiche OR). */
  forRepairOrder: requirePermission("quote:read")
    .input(quoteIdInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.quote.findMany({
        where: { repairOrderId: input.id, deletedAt: null, ...siteFilter(ctx) },
        orderBy: [{ number: "desc" }, { version: "desc" }],
        select: {
          id: true,
          number: true,
          version: true,
          status: true,
          total: true,
          acceptedTotal: true,
          sentAt: true,
          supersededAt: true,
        },
      });
    }),

  create: requirePermission("quote:create")
    .input(createQuoteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      assertQuoteModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      const quote = await tenantDb.transaction(async (tx) => {
        let customerId = input.customerId;
        let vehicleId = input.vehicleId ?? null;
        let siteId = input.siteId;
        let origin = input.origin;
        if (input.repairOrderId) {
          const order = await tx.repairOrder.findFirst({
            where: { id: input.repairOrderId, deletedAt: null },
          });
          if (!order) bad("Ordre de réparation introuvable.");
          requireSite(ctx, order.siteId);
          customerId = order.customerId;
          vehicleId = order.vehicleId;
          siteId = order.siteId;
          if (origin === "STANDALONE") origin = "REPAIR_ORDER";
        }
        if (!customerId && input.newCustomer) {
          // US-M05-02 : prospect (nom + téléphone), `source = "devis"`.
          let phone: string | null;
          try {
            phone = normalizePhoneCI(input.newCustomer.phone).e164;
          } catch {
            bad("Numéro de téléphone invalide.");
          }
          if (!phone) bad("Numéro à vérifier : saisissez-le au format à 10 chiffres.");
          if (!ctx.permissions.has("customer:create")) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Permission manquante : customer:create",
            });
          }
          const existing = await tx.customer.findFirst({ where: { phone, deletedAt: null } });
          const created =
            existing ??
            (await tx.customer.create({
              data: {
                organizationId: ctx.organizationId,
                displayName: input.newCustomer.name,
                lastName: input.newCustomer.name,
                phone,
                source: "devis",
              },
            }));
          customerId = created.id;
        }
        if (!customerId) bad("Choisissez un client ou créez-le.");
        const customer = await tx.customer.findFirst({
          where: { id: customerId, deletedAt: null },
        });
        if (!customer) bad("Client introuvable.");
        if (vehicleId) {
          const vehicle = await tx.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } });
          if (!vehicle) bad("Véhicule introuvable.");
          if (vehicle.customerId !== customer.id) bad("Ce véhicule n'appartient pas à ce client.");
        }
        const resolvedSite = await resolveSite(ctx, tx, siteId);
        const q = await createQuoteRecord(
          tx,
          ctx,
          org,
          {
            siteId: resolvedSite,
            customerId: customer.id,
            vehicleId,
            repairOrderId: input.repairOrderId ?? null,
            origin,
            validUntil: input.validUntil,
            notes: input.notes,
          },
          now,
        );
        let sortOrder = 0;
        for (const line of input.lines ?? []) {
          const data = await buildQuoteLineData(tx, actorOf(ctx), org, q, line);
          await tx.quoteLine.create({ data: { ...data, sortOrder: sortOrder++ } });
        }
        await recomputeQuote(tx, q.id, org.vatEnabled);
        await evaluateDiscounts(tx, actorOf(ctx), org, q.id);
        return q;
      });
      return { id: quote.id, number: quote.number };
    }),

  /** US-M05-01 — devis depuis l'inspection : un groupe par point URGENT/WATCH recommandé. */
  createFromInspection: requirePermission("quote:create")
    .input(createFromInspectionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      assertQuoteModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      return tenantDb.transaction(async (tx) => {
        const inspection = await tx.inspection.findFirst({
          where: { id: input.inspectionId },
          include: { items: { orderBy: { sortOrder: "asc" } } },
        });
        if (!inspection) bad("Inspection introuvable.");
        if (!inspection.completedAt) bad("Terminez l'inspection avant de créer le devis.");
        const order = await tx.repairOrder.findFirstOrThrow({
          where: { id: inspection.repairOrderId },
        });
        requireSite(ctx, order.siteId);
        if (["DELIVERED", "INVOICED", "CANCELLED"].includes(order.status)) bad("L'OR est clôturé.");
        const candidates = inspection.items.filter(
          (i) =>
            (i.result === "URGENT" || (input.includeWatch && i.result === "WATCH")) &&
            !i.addedToQuote,
        );
        const items = candidates.filter(
          (i) => i.recommendedLaborIds.length > 0 || i.recommendedProductIds.length > 0,
        );
        const skipped = candidates.filter((i) => !items.includes(i)).map((i) => i.label);
        if (items.length === 0) {
          bad(
            skipped.length > 0
              ? `Aucune recommandation sur : ${skipped.join(", ")}. Ajoutez des opérations ou pièces à ces points, ou créez un devis vide.`
              : "Aucun point urgent ou à surveiller à chiffrer.",
          );
        }
        const quote =
          (await currentDraftForOrder(tx, order.id)) ??
          (await createQuoteRecord(
            tx,
            ctx,
            org,
            {
              siteId: order.siteId,
              customerId: order.customerId,
              vehicleId: order.vehicleId,
              repairOrderId: order.id,
              origin: "INSPECTION",
              inspectionId: inspection.id,
              insuranceClaimId: order.insuranceClaimId,
            },
            now,
          ));
        let sortOrder = await tx.quoteLine.count({ where: { quoteId: quote.id } });
        for (const item of items) {
          const [ops, products] = await Promise.all([
            tx.laborOperation.findMany({ where: { id: { in: item.recommendedLaborIds } } }),
            tx.product.findMany({ where: { id: { in: item.recommendedProductIds } } }),
          ]);
          const photoIds = item.shareWithCustomer
            ? item.photoUrls.map((u) => u.split("/").pop()!).filter(Boolean)
            : [];
          const common = {
            groupKey: `insp:${item.id}`,
            groupLabel: item.label,
            priority: item.result,
            isOptional: item.result === "WATCH",
            customerExplanation: item.comment ?? null,
            photoAttachmentIds: photoIds,
          };
          for (const op of ops) {
            const data = await buildQuoteLineData(tx, actorOf(ctx), org, quote, {
              type: "LABOR",
              laborOperationId: op.id,
              description: op.name,
              quantity: laborLinePricing(op, org.laborRates).quantity,
              ...common,
            });
            await tx.quoteLine.create({
              data: { ...data, inspectionItemId: item.id, sortOrder: sortOrder++ },
            });
          }
          for (const p of products) {
            const data = await buildQuoteLineData(tx, actorOf(ctx), org, quote, {
              type: "PART",
              productId: p.id,
              description: p.name,
              quantity: 1,
              ...common,
            });
            await tx.quoteLine.create({
              data: { ...data, inspectionItemId: item.id, sortOrder: sortOrder++ },
            });
          }
          await tx.inspectionItem.update({ where: { id: item.id }, data: { addedToQuote: true } });
        }
        await recomputeQuote(tx, quote.id, org.vatEnabled);
        await audit(ctx, "quote.created_from_inspection", quote.id, {
          after: { inspectionId: inspection.id, items: items.length, skipped },
        });
        return { id: quote.id, number: quote.number, skipped };
      });
    }),

  /** Devis reprenant les lignes d'OR en attente d'accord (M04 → M05). */
  createFromRepairOrderPending: requirePermission("quote:create")
    .input(createFromRepairOrderPendingInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      assertQuoteModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      return tenantDb.transaction(async (tx) => {
        const order = await tx.repairOrder.findFirst({
          where: { id: input.repairOrderId, deletedAt: null },
        });
        if (!order) bad("Ordre de réparation introuvable.");
        requireSite(ctx, order.siteId);
        const pending = await tx.repairOrderLine.findMany({
          where: {
            repairOrderId: order.id,
            approval: "PENDING",
            status: { not: "CANCELLED" },
            quoteLineId: null,
          },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        });
        if (pending.length === 0) bad("Aucune ligne de l'OR n'attend l'accord du client.");
        const items = await tx.inspectionItem.findMany({
          where: {
            id: { in: pending.map((l) => l.inspectionItemId).filter((x): x is string => !!x) },
          },
        });
        const itemById = new Map(items.map((i) => [i.id, i]));
        const quote =
          (await currentDraftForOrder(tx, order.id)) ??
          (await createQuoteRecord(
            tx,
            ctx,
            org,
            {
              siteId: order.siteId,
              customerId: order.customerId,
              vehicleId: order.vehicleId,
              repairOrderId: order.id,
              origin: "REPAIR_ORDER",
              insuranceClaimId: order.insuranceClaimId,
            },
            now,
          ));
        let sortOrder = await tx.quoteLine.count({ where: { quoteId: quote.id } });
        for (const l of pending) {
          const item = l.inspectionItemId ? itemById.get(l.inspectionItemId) : undefined;
          const created = await tx.quoteLine.create({
            data: {
              organizationId: ctx.organizationId,
              quoteId: quote.id,
              type: l.type,
              productId: l.productId,
              laborOperationId: l.laborOperationId,
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              discountRate: l.discountRate,
              vatRate: l.vatRate,
              payer: l.payer,
              isCustomerSupplied: l.isCustomerSupplied,
              costPrice: l.costPrice,
              inspectionItemId: l.inspectionItemId,
              groupKey: item ? `insp:${item.id}` : null,
              groupLabel: item?.label ?? null,
              priority:
                item && (item.result === "URGENT" || item.result === "WATCH") ? item.result : null,
              isOptional: item?.result === "WATCH",
              customerExplanation: item?.comment ?? null,
              photoAttachmentIds: item?.shareWithCustomer
                ? item.photoUrls.map((u) => u.split("/").pop()!)
                : [],
              sortOrder: sortOrder++,
            },
          });
          await tx.repairOrderLine.update({
            where: { id: l.id },
            data: { quoteLineId: created.id },
          });
        }
        await recomputeQuote(tx, quote.id, org.vatEnabled);
        return { id: quote.id, number: quote.number };
      });
    }),

  update: requirePermission("quote:update")
    .input(updateQuoteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        assertEditable(quote);
        const patch = { ...input.patch };
        if (patch.globalDiscountAmount != null && patch.globalDiscountAmount > 0)
          patch.globalDiscountRate = null;
        else if (patch.globalDiscountRate != null && patch.globalDiscountRate > 0)
          patch.globalDiscountAmount = null;
        if (patch.vehicleId) {
          const vehicle = await tx.vehicle.findFirst({
            where: { id: patch.vehicleId, deletedAt: null },
          });
          if (!vehicle || vehicle.customerId !== quote.customerId)
            bad("Ce véhicule n'appartient pas à ce client.");
        }
        await tx.quote.update({ where: { id: quote.id }, data: patch });
        await recomputeQuote(tx, quote.id, org.vatEnabled);
        const discount = await evaluateDiscounts(tx, actorOf(ctx), org, quote.id);
        return { ok: true, discount };
      });
    }),

  /** RG-M05-05 — opération du catalogue avec son kit de pièces (un groupe). */
  addKit: requirePermission("quote:update")
    .input(addKitInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.quoteId);
        assertEditable(quote);
        const op = await tx.laborOperation.findFirst({
          where: { id: input.laborOperationId, isActive: true },
        });
        if (!op) bad("Opération de main-d'œuvre introuvable.");
        const target = input.vehicleId ? { ...quote, vehicleId: input.vehicleId } : quote;
        const groupKey = `kit:${op.code}:${Date.now().toString(36)}`;
        let sortOrder = await tx.quoteLine.count({ where: { quoteId: quote.id } });
        const common = { groupKey, groupLabel: op.name };
        const labor = await buildQuoteLineData(tx, actorOf(ctx), org, target, {
          type: "LABOR",
          laborOperationId: op.id,
          description: op.name,
          quantity: op.standardHours || 1,
          ...common,
        });
        await tx.quoteLine.create({ data: { ...labor, sortOrder: sortOrder++ } });
        const parts =
          (op.defaultParts as { productId?: string; category?: string; quantity: number }[]) ?? [];
        let added = 1;
        for (const part of parts) {
          const product = part.productId
            ? await tx.product.findFirst({ where: { id: part.productId, isActive: true } })
            : part.category
              ? await tx.product.findFirst({
                  where: { category: part.category, isActive: true },
                  orderBy: { salePrice: "asc" },
                })
              : null;
          if (!product) continue;
          const data = await buildQuoteLineData(tx, actorOf(ctx), org, target, {
            type: "PART",
            productId: product.id,
            description: product.name,
            quantity: part.quantity,
            ...common,
          });
          await tx.quoteLine.create({ data: { ...data, sortOrder: sortOrder++ } });
          added += 1;
        }
        await recomputeQuote(tx, quote.id, org.vatEnabled);
        return { added };
      });
    }),

  /** Recherche unifiée MO / kits / pièces avec prix et disponibilité (éditeur). */
  catalog: requirePermission("quote:read")
    .input(quoteCatalogInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const q = input.q;
      const quote = input.quoteId
        ? await tenantDb.quote.findFirst({ where: { id: input.quoteId } })
        : null;
      const contains = { contains: q, mode: "insensitive" as const };
      const [ops, products] = await Promise.all([
        tenantDb.laborOperation.findMany({
          where: {
            isActive: true,
            ...(q ? { OR: [{ name: contains }, { code: contains }, { category: contains }] } : {}),
          },
          orderBy: { name: "asc" },
          take: 15,
        }),
        tenantDb.product.findMany({
          where: {
            isActive: true,
            ...(q
              ? { OR: [{ name: contains }, { sku: contains }, { oemReference: contains }] }
              : {}),
          },
          orderBy: { name: "asc" },
          take: 15,
        }),
      ]);
      const levels = quote
        ? await tenantDb.stockLevel.findMany({
            where: { siteId: quote.siteId, productId: { in: products.map((p) => p.id) } },
          })
        : [];
      const available = new Map(levels.map((l) => [l.productId, l.onHand - l.reserved]));
      return {
        labor: ops.map((op) => ({
          id: op.id,
          code: op.code,
          name: op.name,
          category: op.category,
          hours: op.standardHours,
          fixedPrice: op.fixedPrice,
          unitPrice: laborLinePricing(op, org.laborRates).unitPrice,
          isKit: Array.isArray(op.defaultParts) && (op.defaultParts as unknown[]).length > 0,
        })),
        parts: products.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          salePrice: p.salePrice,
          available: quote ? (available.get(p.id) ?? 0) : null,
          isStocked: p.isStocked,
          leadTimeDays: 3,
        })),
      };
    }),

  requestDiscountApproval: requirePermission("quote:update")
    .input(requestDiscountApprovalInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        assertEditable(quote);
        await tx.quote.update({
          where: { id: quote.id },
          data: {
            discountApprovalStatus: "PENDING",
            discountReason: input.reason || quote.discountReason,
          },
        });
        await requestDiscountApprovalNotification(tx, quote, 0);
        return { status: "PENDING" as const };
      });
    }),

  /** Modale « Valider la remise » : Approuver / Approuver à X % / Refuser (RG-M05-07). */
  decideDiscount: requirePermission("quote:discount_override")
    .input(decideDiscountInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        assertEditable(quote);
        const before = { status: quote.discountApprovalStatus };
        if (input.decision === "APPROVE_PARTIAL") {
          if (input.maxRate === undefined) bad("Indiquez le taux maximum accordé.");
          const lines = await tx.quoteLine.findMany({ where: { quoteId: quote.id } });
          const clamped = clampRates(
            lines.map((l) => l.discountRate),
            input.maxRate,
          );
          for (const [i, l] of lines.entries()) {
            if (clamped[i] !== l.discountRate) {
              await tx.quoteLine.update({
                where: { id: l.id },
                data: { discountRate: clamped[i] },
              });
            }
          }
          if (quote.globalDiscountRate != null && quote.globalDiscountRate > input.maxRate) {
            await tx.quote.update({
              where: { id: quote.id },
              data: { globalDiscountRate: input.maxRate },
            });
          }
          if (quote.globalDiscountAmount != null) {
            const totals = totalsFor(quote, lines, org.vatEnabled);
            if (totals.globalDiscountRateEffective > input.maxRate) {
              await tx.quote.update({
                where: { id: quote.id },
                data: { globalDiscountAmount: null, globalDiscountRate: input.maxRate },
              });
            }
          }
          await recomputeQuote(tx, quote.id, org.vatEnabled);
        }
        const status = input.decision === "REJECT" ? "REJECTED" : "APPROVED";
        const updated = await tx.quote.update({
          where: { id: quote.id },
          data: {
            discountApprovalStatus: status,
            discountApprovedById: status === "APPROVED" ? ctx.membership.id : null,
          },
        });
        await audit(
          ctx,
          status === "APPROVED" ? "quote.discount_approved" : "quote.discount_rejected",
          quote.id,
          {
            before,
            after: { status, maxRate: input.maxRate ?? null },
            reason: quote.discountReason,
          },
        );
        await tx.notification.updateMany({
          where: { dedupeKey: `quote.discount:${quote.id}`, readAt: null },
          data: { readAt: roNow() },
        });
        return updated;
      });
    }),

  /** Vue client (même rendu que le portail, lecture seule). */
  preview: requirePermission("quote:read")
    .input(quoteIdInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        return buildQuotePublicView(tx, org, quote, roNow());
      });
    }),

  send: requirePermission("quote:send")
    .input(sendQuoteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      assertQuoteModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      const out = await tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        assertTransitionOk(quote, "send");
        const lines = await tx.quoteLine.findMany({ where: { quoteId: quote.id } });
        const totals = await recomputeQuote(tx, quote.id, org.vatEnabled);
        const blockers = sendBlockers({
          lineCount: lines.length,
          total: totals.total,
          onlyNonBillable:
            lines.length > 0 &&
            lines.every((l) => l.payer === "WARRANTY" || l.payer === "INTERNAL"),
          discountApprovalStatus: quote.discountApprovalStatus,
        });
        const discount = checkDiscounts({
          role: ctx.membership.role as Role,
          caps: org.quotes.discountCaps,
          lineRates: lines.map((l) => l.discountRate),
          globalRate: totals.globalDiscountRateEffective,
          hasOverride: true,
        });
        if (discount.reasonRequired && !quote.discountReason) {
          blockers.push("Indiquez le motif de la remise (au-delà de 5 %).");
        }
        if (blockers.length > 0) bad(blockers.join(" "));
        const recipient = await recipientOf(tx, quote, input.recipient);
        const link = await issueQuoteToken(tx, quote, ctx.membership.id);
        const vehicle = quote.vehicleId
          ? await tx.vehicle.findFirst({ where: { id: quote.vehicleId } })
          : null;
        const urgentIds = new Set(lines.filter((l) => l.priority === "URGENT").map((l) => l.id));
        const urgentTotal = totals.lines
          .filter((a) => a.billable && urgentIds.has(a.id))
          .reduce((s, a) => s + a.total, 0);
        const body = input.message
          ? input.message.replace(/\{\{\s*lien\.devis\s*\}\}/g, link.url).includes(link.url)
            ? input.message.replace(/\{\{\s*lien\.devis\s*\}\}/g, link.url)
            : `${input.message}\n${link.url}`
          : quoteSendMessage({
              customerName: recipient.name,
              number: quote.number,
              vehicle: vehicle ? `${vehicle.make} ${vehicle.model}` : null,
              plate: vehicle?.plate,
              total: totals.total,
              urgentTotal,
              link: link.url,
              garageName: org.name,
            });
        let messageId: string | null = null;
        let sentTo: string | null = null;
        let waLink: string | null = null;
        if (input.channel === "WHATSAPP" || input.channel === "SMS" || input.channel === "EMAIL") {
          const attachments: EnqueueAttachment[] = [];
          if (input.channel === "EMAIL") {
            const pdf = await renderQuotePdfFor(
              tx,
              org,
              await tx.quote.findFirstOrThrow({ where: { id: quote.id } }),
              input.recipient.type === "INSURER" ? "insurer" : "customer",
              link.url,
            );
            const key = `${ctx.organizationId}/quotes/${quote.id}/${quotePdfFilename(quote, "customer")}`;
            await getAttachmentStorage().upload({
              key,
              body: pdf,
              contentType: "application/pdf",
              maxBytes: 5_000_000,
            });
            attachments.push({
              kind: "pdf",
              storageKey: key,
              filename: quotePdfFilename(quote, "customer"),
            });
          }
          const result = await messagingEnqueue(tx, ctx.organizationId, {
            idempotencyKey: `quote:${quote.id}:send:${now.getTime()}`,
            kind: "transactional",
            customerId: recipient.customer.id,
            to: recipient.to,
            channels: [input.channel],
            // WhatsApp hors fenêtre 24 h : modèle Meta approuvé « quote_send » requis (RG-M11-10).
            templateKey: input.channel === "WHATSAPP" ? "quote_send" : undefined,
            bodyOverride: body,
            subjectOverride: `Devis ${quote.number} — ${org.name}`,
            attachments,
            sentById: ctx.membership.id,
          });
          if (!("message" in result)) {
            bad(
              input.channel === "WHATSAPP"
                ? "WhatsApp indisponible pour ce client (canal non configuré, pas de modèle approuvé ni de conversation ouverte) : utilisez « Ouvrir dans WhatsApp » ou le SMS."
                : "Destinataire injoignable sur ce canal (adresse absente ou canal non configuré) : copiez le lien ou choisissez un autre canal.",
            );
          }
          messageId = result.message.id;
          sentTo =
            input.channel === "EMAIL"
              ? (recipient.to.email ?? null)
              : input.channel === "WHATSAPP"
                ? (recipient.to.whatsapp ?? recipient.to.phone ?? null)
                : (recipient.to.phone ?? null);
        } else if (input.channel === "WA_LINK") {
          const phone = recipient.to.whatsapp ?? recipient.to.phone;
          if (!phone) bad("Le client n'a pas de numéro WhatsApp : copiez le lien.");
          waLink = buildWaLinkUrl(phone, body);
          sentTo = phone;
        }
        const updated = await tx.quote.update({
          where: { id: quote.id },
          data: {
            status: "SENT",
            sentAt: now,
            sentVia: input.channel,
            sentTo,
            recipientContactId: recipient.contactId,
          },
        });
        await emitDomainEvent(tx as never, ctx.organizationId, "quote.sent", {
          quoteId: quote.id,
          version: quote.version,
          channel: input.channel,
          total: totals.total,
          customerId: quote.customerId,
        });
        if (quote.repairOrderId) {
          await mirrorPendingLinesIntoOrder(tx, updated);
          await requestOrderApproval(tx, quote.repairOrderId, now);
          await recomputeTotals(tx, quote.repairOrderId, org.vatEnabled);
        }
        await audit(ctx, "quote.sent", quote.id, {
          after: { channel: input.channel, sentTo, messageId, version: quote.version },
        });
        return { quote: updated, messageId, waLink, publicUrl: link.url, body };
      });
      await flush([out.messageId]);
      return out;
    }),

  /** Renvoyer (nouveau message, nouveau lien) ou relancer maintenant (US-M05-09). */
  resend: requirePermission("quote:send")
    .input(resendQuoteInputSchema)
    .mutation(async ({ ctx, input }) => resendQuote(ctx, input.id, input.channel, false)),

  followUpNow: requirePermission("quote:send")
    .input(resendQuoteInputSchema)
    .mutation(async ({ ctx, input }) => resendQuote(ctx, input.id, input.channel, true)),

  regenerateLink: requirePermission("quote:send")
    .input(quoteIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        if (!quote.sentAt) bad("Le devis n'a pas encore été envoyé.");
        const versions = await tx.quote.findMany({
          where: { number: quote.number },
          select: { id: true },
        });
        await tx.portalToken.updateMany({
          where: { scope: "QUOTE", targetId: { in: versions.map((v) => v.id) }, status: "ACTIVE" },
          data: { status: "REVOKED", revokedAt: now, revokeReason: "Lien régénéré" },
        });
        const link = await issueQuoteToken(tx, quote, ctx.membership.id);
        await audit(ctx, "quote.link_regenerated", quote.id);
        return { publicUrl: link.url };
      });
    }),

  /** US-M05-07 / RG-M05-11 — décision saisie par le personnel. */
  recordDecision: requirePermission("quote:record_decision")
    .input(recordDecisionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      const out = await tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        if (input.amendment) {
          if (
            quote.supersededAt ||
            !["ACCEPTED", "PARTIALLY_ACCEPTED", "DECLINED"].includes(quote.status)
          ) {
            bad(
              "Décision complémentaire possible uniquement sur un devis décidé (version courante).",
            );
          }
        } else {
          assertTransitionOk(quote, "decide");
          if (isPastValidity(quote.validUntil, businessDate(now, org.timeZone))) {
            if (!input.overrideExpiredReason) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "QUOTE_EXPIRED : devis expiré. Indiquez un motif pour enregistrer la décision.",
              });
            }
            await audit(ctx, "quote.decision_forced_after_expiry", quote.id, {
              reason: input.overrideExpiredReason,
            });
          }
        }
        if (quote.discountApprovalStatus === "PENDING") bad("Remise en attente de validation.");
        const data: Prisma.QuoteUpdateInput = {
          recordedById: ctx.membership.id,
          decisionCounterpart: input.counterpartName ?? null,
        };
        if (input.channel === "whatsapp") {
          if (!input.messageId) bad("Liez le message WhatsApp du client comme preuve.");
          const message = await tx.message.findFirst({
            where: { id: input.messageId, customerId: quote.customerId, direction: "INBOUND" },
          });
          if (!message) bad("Message du client introuvable.");
          data.decisionMessageId = message.id;
        }
        if (input.signature) {
          const sig = await storeQuoteImage(tx, {
            organizationId: ctx.organizationId,
            quoteId: quote.id,
            dataUrl: input.signature.dataUrl,
            kind: "signature",
            membershipId: ctx.membership.id,
          });
          data.signatureUrl = sig.url;
          data.signerName = input.signature.signerName;
        } else if (input.counterpartName) {
          data.signerName = input.counterpartName;
        }
        if (
          input.channel === "insurer" &&
          input.insurerApprovedAmount !== undefined &&
          quote.insuranceClaimId
        ) {
          await tx.insuranceClaim.update({
            where: { id: quote.insuranceClaimId },
            data: { approvedAmount: input.insurerApprovedAmount },
          });
        }
        const decided = await applyDecision(tx, org, {
          quote,
          decisions: input.decisions,
          amendment: input.amendment,
          channel: input.channel,
          now,
          data: input.amendment ? { recordedById: ctx.membership.id } : data,
          actorMembershipId: ctx.membership.id,
          declineReason: input.declineReason ?? null,
        });
        let confirmationId: string | null = null;
        let confirmationNote: string | null = null;
        if (input.channel === "phone" && input.sendWrittenConfirmation) {
          const lines = await tx.quoteLine.findMany({
            where: { quoteId: quote.id },
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          });
          const groups = groupQuoteLines(
            lines,
            totalsFor(decided.quote, lines, org.vatEnabled).lines,
          );
          const time =
            input.decidedAtTime ??
            new Intl.DateTimeFormat("fr-FR", {
              timeZone: org.timeZone,
              hour: "2-digit",
              minute: "2-digit",
            }).format(now);
          const body = phoneConfirmationMessage({
            time,
            accepted: groups
              .filter((g) => g.lines.every((l) => l.accepted))
              .map((g) => ({ label: g.label, total: g.total })),
            declined: groups
              .filter((g) => g.lines.every((l) => l.accepted === false))
              .map((g) => g.label),
          });
          const customer = await tx.customer.findFirstOrThrow({ where: { id: quote.customerId } });
          const result = await messagingEnqueue(tx, ctx.organizationId, {
            idempotencyKey: `quote:${quote.id}:phone-confirmation:${now.getTime()}`,
            kind: "transactional",
            customerId: customer.id,
            to: {
              phone: customer.phone,
              whatsapp: customer.whatsappPhone ?? customer.phone,
              email: customer.email,
              name: customer.displayName,
            },
            channels: ["WHATSAPP", "SMS", "EMAIL"],
            bodyOverride: body,
            subjectOverride: `Votre accord sur le devis ${quote.number}`,
            sentById: ctx.membership.id,
          });
          if ("message" in result) confirmationId = result.message.id;
          else confirmationNote = "Confirmation écrite impossible (client sans mobile)";
        }
        await audit(
          ctx,
          input.amendment ? "quote.decision_amended" : "quote.decision_recorded",
          quote.id,
          {
            after: {
              channel: input.channel,
              status: decided.quote.status,
              acceptedTotal: decided.acceptedTotal,
              counterpart: input.counterpartName ?? null,
              confirmationMessageId: confirmationId,
            },
            reason: confirmationNote,
          },
        );
        return { quote: decided.quote, confirmationId, confirmationNote, deposit: decided.deposit };
      });
      await flush([out.confirmationId]);
      return out;
    }),

  /** US-M05-08 / US-M05-10 — nouvelle version (modifier un devis envoyé, ou réactiver). */
  createVersion: requirePermission("quote:update")
    .input(createVersionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        assertTransitionOk(quote, "edit");
        const refresh = input.refreshPrices ?? quote.status === "EXPIRED";
        const lines = await tx.quoteLine.findMany({
          where: { quoteId: quote.id },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        });
        const customer = await tx.customer.findFirstOrThrow({ where: { id: quote.customerId } });
        const next = await tx.quote.create({
          data: {
            organizationId: quote.organizationId,
            siteId: quote.siteId,
            number: quote.number,
            version: quote.version + 1,
            customerId: quote.customerId,
            vehicleId: quote.vehicleId,
            repairOrderId: quote.repairOrderId,
            origin: quote.origin,
            inspectionId: quote.inspectionId,
            insuranceClaimId: quote.insuranceClaimId,
            supersedesId: quote.id,
            validUntil: initialValidUntil(org, now, {
              customerType: customer.type,
              isInsurance: Boolean(quote.insuranceClaimId),
            }),
            notes: quote.notes,
            globalDiscountRate: quote.globalDiscountRate,
            globalDiscountAmount: quote.globalDiscountAmount,
            discountReason: quote.discountReason,
            discountApprovalStatus:
              quote.discountApprovalStatus === "PENDING" ? "PENDING" : quote.discountApprovalStatus,
            discountApprovedById: quote.discountApprovedById,
            customerPoNumber: quote.customerPoNumber,
            createdById: ctx.membership.id,
          },
        });
        for (const l of lines) {
          let unitPrice = l.unitPrice;
          if (refresh) {
            if (l.productId && !l.isCustomerSupplied) {
              const product = await tx.product.findFirst({ where: { id: l.productId } });
              if (product) unitPrice = product.salePrice;
            } else if (l.laborOperationId) {
              const op = await tx.laborOperation.findFirst({ where: { id: l.laborOperationId } });
              if (op) unitPrice = laborLinePricing(op, org.laborRates).unitPrice;
            }
          }
          const { id: _id, quoteId: _q, accepted: _a, declineReason: _d, ...rest } = l;
          void _id;
          void _q;
          void _a;
          void _d;
          await tx.quoteLine.create({ data: { ...rest, quoteId: next.id, unitPrice } });
        }
        await tx.quote.update({ where: { id: quote.id }, data: { supersededAt: now } });
        // Lignes d'OR encore en attente issues de l'ancienne version : retirées, reportées au renvoi.
        if (quote.repairOrderId) {
          await tx.repairOrderLine.deleteMany({
            where: {
              repairOrderId: quote.repairOrderId,
              approval: "PENDING",
              quoteLineId: { in: lines.map((l) => l.id) },
            },
          });
        }
        await cancelQuoteReminders(tx, [quote.id], "Nouvelle version du devis.");
        await recomputeQuote(tx, next.id, org.vatEnabled);
        if (quote.repairOrderId) {
          await recomputeTotals(tx, quote.repairOrderId, org.vatEnabled);
        }
        await audit(ctx, refresh ? "quote.reactivated" : "quote.version_created", quote.id, {
          after: { newQuoteId: next.id, version: next.version },
        });
        return { id: next.id, version: next.version };
      });
    }),

  /** US-M05-11 — devis libre accepté → OR (lignes acceptées approuvées). */
  convertToRepairOrder: requirePermission("quote:update", "repair_order:create")
    .input(convertToRepairOrderInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        assertTransitionOk(quote, "convert");
        if (quote.repairOrderId)
          bad("Ce devis est déjà lié à un OR : ses lignes y sont reportées.");
        if (!quote.vehicleId) bad("Ajoutez le véhicule au devis avant de créer l'OR.");
        const lines = await tx.quoteLine.findMany({
          where: { quoteId: quote.id, accepted: true },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        });
        if (lines.length === 0) bad("Aucune ligne acceptée à convertir.");
        const active = await tx.repairOrder.findFirst({
          where: {
            vehicleId: quote.vehicleId,
            deletedAt: null,
            status: { in: [...ACTIVE_REPAIR_ORDER_STATUSES] },
          },
        });
        const siteId = input.siteId ?? quote.siteId;
        requireSite(ctx, siteId);
        const order =
          active ??
          (await tx.repairOrder.create({
            data: {
              organizationId: ctx.organizationId,
              siteId,
              number: await nextRepairOrderNumber(tx, org, siteId, now),
              customerId: quote.customerId,
              vehicleId: quote.vehicleId,
              advisorId: ctx.membership.id,
              createdById: ctx.membership.id,
              status: "DRAFT",
              complaint: `Travaux du devis ${quote.number}`,
            },
          }));
        if (!active) {
          await emitDomainEvent(tx as never, ctx.organizationId, "repair_order.created", {
            repairOrderId: order.id,
            customerId: order.customerId,
            vehicleId: order.vehicleId,
            status: "DRAFT",
          });
        }
        let sortOrder = await tx.repairOrderLine.count({ where: { repairOrderId: order.id } });
        for (const l of lines) {
          await tx.repairOrderLine.create({
            data: {
              ...roLineDataFromQuoteLine(l, order.id),
              approval:
                l.payer === "WARRANTY" || l.payer === "INTERNAL" ? "NOT_REQUIRED" : "APPROVED",
              approvalSource: "QUOTE",
              sortOrder: sortOrder++,
            },
          });
        }
        await recomputeTotals(tx, order.id, org.vatEnabled);
        await tx.quote.update({
          where: { id: quote.id },
          data: { status: "CONVERTED", convertedAt: now, repairOrderId: order.id },
        });
        await emitDomainEvent(tx as never, ctx.organizationId, "quote.converted", {
          quoteId: quote.id,
          repairOrderId: order.id,
        });
        await audit(ctx, "quote.converted", quote.id, { after: { repairOrderId: order.id } });
        // M03 : durée suggérée du RDV = somme des temps barème des lignes MO acceptées.
        const hours = lines.filter((l) => l.type === "LABOR").reduce((s, l) => s + l.quantity, 0);
        return {
          repairOrderId: order.id,
          number: order.number,
          appendedToExisting: Boolean(active),
          suggestedHours: hours,
        };
      });
    }),

  /** US-M05-11 — vente comptoir : facture brouillon (M08) avec les lignes acceptées. */
  convertToInvoice: requirePermission("quote:update")
    .input(quoteIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        assertTransitionOk(quote, "convert");
        if (quote.repairOrderId) bad("Ce devis est lié à un OR : la facture se fait depuis l'OR.");
        const lines = await tx.quoteLine.findMany({
          where: { quoteId: quote.id, accepted: true },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        });
        if (lines.length === 0) bad("Aucune ligne acceptée à facturer.");
        const billable = lines.filter((l) => l.payer === "CUSTOMER" || l.payer === "INSURANCE");
        const invoice = await tx.invoice.create({
          data: {
            organizationId: ctx.organizationId,
            siteId: quote.siteId,
            type: "INVOICE",
            status: "DRAFT",
            customerId: quote.customerId,
            vehicleId: quote.vehicleId,
            quoteId: quote.id,
            subtotal: billable.reduce((s, l) => s + l.lineSubtotal, 0),
            discountTotal: 0,
            vatTotal: billable.reduce((s, l) => s + l.lineVat, 0),
            total: billable.reduce((s, l) => s + l.lineTotal, 0),
            balance: billable.reduce((s, l) => s + l.lineTotal, 0),
            notes: quote.customerPoNumber
              ? `Bon de commande client : ${quote.customerPoNumber}`
              : null,
            createdById: ctx.membership.id,
            lines: {
              create: billable.map((l, i) => ({
                organizationId: ctx.organizationId,
                type: l.type,
                productId: l.productId,
                laborOperationId: l.laborOperationId,
                description: l.description,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                discountRate: l.discountRate,
                vatRate: l.vatRate,
                lineSubtotal: l.lineSubtotal,
                lineVat: l.lineVat,
                lineTotal: l.lineTotal,
                sortOrder: i,
              })),
            },
          },
        });
        await tx.quote.update({
          where: { id: quote.id },
          data: { status: "CONVERTED", convertedAt: now },
        });
        await emitDomainEvent(tx as never, ctx.organizationId, "quote.converted", {
          quoteId: quote.id,
          invoiceId: invoice.id,
        });
        await audit(ctx, "quote.converted_to_invoice", quote.id, {
          after: { invoiceId: invoice.id },
        });
        void org;
        return { invoiceId: invoice.id };
      });
    }),

  /** US-M05-12 — acompte : facture d'acompte brouillon (M08 émettra la facture et le lien de paiement). */
  requestDeposit: requirePermission("quote:update")
    .input(requestDepositInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        if (!["ACCEPTED", "PARTIALLY_ACCEPTED", "CONVERTED"].includes(quote.status))
          bad("Le devis doit être accepté.");
        if (quote.depositInvoiceId) bad("Un acompte est déjà demandé pour ce devis.");
        const amount = input.amount ?? quote.depositAmount ?? 0;
        if (amount <= 0) bad("Indiquez le montant de l'acompte.");
        if (amount > quote.acceptedTotal) bad("L'acompte ne peut pas dépasser le total accepté.");
        const { ht, vat } = ttcToHt(amount, org.vatEnabled ? org.vatRate : 0);
        const invoice = await tx.invoice.create({
          data: {
            organizationId: ctx.organizationId,
            siteId: quote.siteId,
            type: "DEPOSIT",
            status: "DRAFT",
            customerId: quote.customerId,
            vehicleId: quote.vehicleId,
            repairOrderId: quote.repairOrderId,
            quoteId: quote.id,
            subtotal: ht,
            vatTotal: vat,
            total: amount,
            balance: amount,
            createdById: ctx.membership.id,
            lines: {
              create: [
                {
                  organizationId: ctx.organizationId,
                  type: "FEE",
                  description: `Acompte sur devis ${quote.number}`,
                  quantity: 1,
                  unitPrice: ht,
                  vatRate: org.vatEnabled ? org.vatRate : 0,
                  lineSubtotal: ht,
                  lineVat: vat,
                  lineTotal: amount,
                },
              ],
            },
          },
        });
        await tx.quote.update({
          where: { id: quote.id },
          data: { depositAmount: amount, depositInvoiceId: invoice.id },
        });
        await audit(ctx, "quote.deposit_requested", quote.id, {
          after: { invoiceId: invoice.id, amount },
        });
        return { invoiceId: invoice.id, paymentLinkUrl: null as string | null };
      });
    }),

  delete: requirePermission("quote:delete")
    .input(deleteQuoteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      return tenantDb.transaction(async (tx) => {
        const quote = await loadQuote(tx, ctx, input.id);
        assertTransitionOk(quote, "delete");
        const lines = await tx.quoteLine.findMany({ where: { quoteId: quote.id } });
        await tx.repairOrderLine.updateMany({
          where: { quoteLineId: { in: lines.map((l) => l.id) } },
          data: { quoteLineId: null },
        });
        const itemIds = lines.map((l) => l.inspectionItemId).filter((x): x is string => !!x);
        if (itemIds.length)
          await tx.inspectionItem.updateMany({
            where: { id: { in: itemIds } },
            data: { addedToQuote: false },
          });
        await tx.quote.update({ where: { id: quote.id }, data: { deletedAt: now } });
        if (quote.supersedesId) {
          // Supprimer le brouillon d'une nouvelle version rend la main à la précédente.
          await tx.quote.update({
            where: { id: quote.supersedesId },
            data: { supersededAt: null },
          });
        }
        await audit(ctx, "quote.deleted", quote.id, { reason: input.reason });
        return { ok: true };
      });
    }),

  /** RG-M05-16 — taux d'acceptation (US-M05-14), exposé à M12. */
  stats: requirePermission("report:read")
    .input(quoteStatsInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const quotes = await tenantDb.quote.findMany({
        where: {
          deletedAt: null,
          supersededAt: null,
          sentAt: { gte: input.from, lte: input.to },
          ...siteFilter(ctx),
          ...(input.siteId ? { siteId: input.siteId } : {}),
          ...(input.advisorId ? { createdById: input.advisorId } : {}),
        },
        include: { lines: { select: { priority: true, accepted: true } } },
      });
      const numbers = quotes.map((q) => q.number);
      const followups = await tenantDb.reminder.findMany({
        where: { type: "QUOTE_FOLLOWUP", status: "SENT", quote: { number: { in: numbers } } },
        select: { quote: { select: { number: true } }, sentAt: true },
      });
      const followed = new Set(followups.map((f) => f.quote?.number));
      const stats = quoteStats(
        quotes.map((q) => ({
          number: q.number,
          version: q.version,
          status: q.status,
          sentAt: q.sentAt,
          decidedAt: q.decidedAt,
          total: q.total,
          acceptedTotal: q.acceptedTotal,
          advisorId: q.createdById,
          declineReason: q.declineReason,
          hadFollowup: followed.has(q.number),
          lines: q.lines,
        })),
      );
      const members = await tenantDb.membership.findMany({
        select: { id: true, user: { select: { name: true } } },
      });
      const names = new Map(members.map((m) => [m.id, m.user.name]));
      return {
        ...stats,
        byAdvisor: stats.byAdvisor.map((a) => ({
          ...a,
          name: a.advisorId ? (names.get(a.advisorId) ?? null) : null,
        })),
      };
    }),

  settings: requirePermission("quote:read").query(async ({ ctx }) => {
    const org = await loadOrgQuoteContext(ctx.organizationId);
    return org.quotes;
  }),

  updateSettings: requirePermission("settings:update")
    .input(quoteSettingsInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      const raw = (
        org.rawSettings && typeof org.rawSettings === "object" ? org.rawSettings : {}
      ) as Record<string, unknown>;
      const next = {
        ...raw,
        quotes: {
          ...org.quotes,
          ...input,
          discountCaps: { ...org.quotes.discountCaps, ...(input.discountCaps ?? {}) },
        },
      };
      await adminDb.organization.update({
        where: { id: ctx.organizationId },
        data: { settings: next as unknown as Prisma.InputJsonValue },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "settings.quotes_updated",
        entity: "Organization",
        entityId: ctx.organizationId,
        before: org.quotes as never,
        after: next.quotes as never,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return (await loadOrgQuoteContext(ctx.organizationId)).quotes;
    }),
});

async function resendQuote(
  ctx: OrgCtx,
  id: string,
  channel: "WHATSAPP" | "SMS" | "EMAIL" | undefined,
  followUp: boolean,
) {
  const org = await loadOrgQuoteContext(ctx.organizationId);
  const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
  const now = roNow();
  const out = await tenantDb.transaction(async (tx) => {
    const quote = await loadQuote(tx, ctx, id);
    if (quote.supersededAt || !["SENT", "VIEWED"].includes(quote.status)) {
      bad("Seul un devis envoyé et en attente de réponse peut être renvoyé.");
    }
    const customer = await tx.customer.findFirstOrThrow({ where: { id: quote.customerId } });
    const link = await issueQuoteToken(tx, quote, ctx.membership.id);
    const body = followUp
      ? `Bonjour ${customer.displayName}, avez-vous pu consulter le devis ${quote.number} ? Vous pouvez valider les travaux en ligne : ${link.url} — ${org.name}`
      : `Bonjour ${customer.displayName}, voici à nouveau votre devis ${quote.number} : ${link.url} — ${org.name}`;
    const result = await messagingEnqueue(tx, ctx.organizationId, {
      idempotencyKey: `quote:${quote.id}:${followUp ? "followup" : "resend"}:${now.getTime()}`,
      kind: "transactional",
      customerId: customer.id,
      to: {
        phone: customer.phone,
        whatsapp: customer.whatsappPhone ?? customer.phone,
        email: customer.email,
        name: customer.displayName,
      },
      channels: channel ? [channel] : ["WHATSAPP", "SMS", "EMAIL"],
      bodyOverride: body,
      subjectOverride: `Devis ${quote.number} — ${org.name}`,
      sentById: ctx.membership.id,
    });
    if (!("message" in result)) bad("Client injoignable sur ce canal : copiez le lien.");
    await audit(ctx, followUp ? "quote.followed_up" : "quote.resent", quote.id, {
      after: { messageId: result.message.id, channel: result.message.channel },
    });
    return { messageId: result.message.id, publicUrl: link.url };
  });
  await flush([out.messageId]);
  return out;
}
