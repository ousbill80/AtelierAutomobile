// M05 — orchestration des devis : contexte d'organisation, numérotation, lignes (prix
// catalogue, minimum, remises), totaux persistés, contrôle des plafonds de remise, jetons du
// portail (A2 : PortalToken portée QUOTE), décision (portail et personnel) et ses effets sur
// l'OR (RG-M05-12). Toute règle métier vient de `@atelieros/core` (quotes, repairOrders).
import { createHash, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  addDays,
  amendDecision,
  businessDate,
  canonicalQuoteContent,
  checkDiscounts,
  checkSalePrice,
  DEFAULT_NUMBERING_CONFIG,
  decisionResult,
  depositAmount,
  formatFCFA,
  groupKeyOf,
  isDomainError,
  laborHoursForVehicle,
  laborLinePricing,
  portalLinkExpiry,
  quoteSettingsFrom,
  quoteTotals,
  renderNumberingPattern,
  type DecisionResult,
  type LineDecision,
  type NumberingConfig,
  type QuoteLineLike,
  type QuoteSettings,
  type Role,
  type VehicleOverride,
} from "@atelieros/core";
import {
  resolvePortalToken as resolvePortalTokenRow,
  tenantSequenceStore,
  type ResolvePortalTokenOptions,
  type Prisma,
  type Quote,
  type QuoteLine,
  type ScopedTenantClient,
} from "@atelieros/db";
import type { QuoteLineInput } from "@atelieros/validators";
import { writeAuditLog } from "../audit";
import { emitDomainEvent } from "../events/emit";
import {
  appUrl,
  hashToken,
  loadOrgRoContext,
  membersWithRoles,
  notify,
  recomputeTotals,
  type OrgRoContext,
} from "../repairOrders/helpers";
import { afterLineChange, recordDeclinedRecommendation } from "../repairOrders/lines";
import { getAttachmentStorage } from "../storage";

export type Tx = ScopedTenantClient;

export interface OrgQuoteContext extends OrgRoContext {
  quotes: QuoteSettings;
  quoteNumbering: NumberingConfig;
}

export async function loadOrgQuoteContext(organizationId: string): Promise<OrgQuoteContext> {
  const ro = await loadOrgRoContext(organizationId);
  const raw = ro.rawSettings;
  const numberingRaw =
    raw && typeof raw === "object" && "numbering" in raw
      ? ((raw as { numbering?: Record<string, Partial<NumberingConfig>> }).numbering?.DEV ?? {})
      : {};
  return {
    ...ro,
    quotes: quoteSettingsFrom(raw),
    quoteNumbering: { ...DEFAULT_NUMBERING_CONFIG.DEV, ...numberingRaw },
  };
}

/** RG-M17 : en mode REMINDERS_ONLY, le module devis est masqué (RG-M05-17). */
export function assertQuoteModule(org: Pick<OrgRoContext, "operatingMode">): void {
  if (org.operatingMode === "REMINDERS_ONLY") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "MODULE_DISABLED : les devis sont disponibles en gestion complète.",
    });
  }
}

export function quoteNotFound(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "Devis introuvable." });
}

export function bad(message: string, cause?: unknown): never {
  throw new TRPCError({ code: "BAD_REQUEST", message, cause });
}

/** Traduit une `DomainError` du core en erreur tRPC (message français, code conservé). */
export function domainToTrpc(error: unknown): never {
  if (isDomainError(error)) {
    throw new TRPCError({
      code: error.code === "QUOTE_CHANGED" ? "CONFLICT" : "BAD_REQUEST",
      message: error.message,
      cause: { code: error.code },
    });
  }
  throw error;
}

/** RG-M05-01 — `DEV-{SITE}-{AAAA}-{NNNNN}`, séquence par site (A4). */
export async function nextQuoteNumber(
  tx: Tx,
  org: OrgQuoteContext,
  siteId: string,
  now: Date,
): Promise<string> {
  const site = await tx.site.findFirst({ where: { id: siteId }, select: { code: true } });
  if (!site) bad("Site introuvable.");
  const year = Number(businessDate(now, org.timeZone).toISOString().slice(0, 4));
  const value = await tenantSequenceStore(tx).getAndIncrement({
    organizationId: org.id,
    siteId: org.quoteNumbering.perSite ? siteId : null,
    docType: "DEV",
    year: org.quoteNumbering.resetYearly ? year : 0,
  });
  return renderNumberingPattern(org.quoteNumbering, { siteCode: site.code, year, value });
}

// ───────────── Totaux persistés (RG-M05-03) ─────────────

export async function quoteDeductible(tx: Tx, quote: Pick<Quote, "insuranceClaimId">) {
  if (!quote.insuranceClaimId) return 0;
  const claim = await tx.insuranceClaim.findFirst({ where: { id: quote.insuranceClaimId } });
  return claim?.deductible ?? 0;
}

export function totalsFor(
  quote: Pick<Quote, "globalDiscountRate" | "globalDiscountAmount">,
  lines: readonly QuoteLineLike[],
  vatEnabled: boolean,
  deductible = 0,
) {
  return quoteTotals(lines, {
    vatEnabled,
    globalDiscountRate: quote.globalDiscountRate,
    globalDiscountAmount: quote.globalDiscountAmount,
    deductible,
  });
}

/** Recalcule et fige montants de ligne + totaux du devis, dans la transaction. */
export async function recomputeQuote(tx: Tx, quoteId: string, vatEnabled: boolean) {
  const quote = await tx.quote.findFirstOrThrow({ where: { id: quoteId } });
  const lines = await tx.quoteLine.findMany({
    where: { quoteId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  let totals;
  try {
    totals = totalsFor(quote, lines, vatEnabled, await quoteDeductible(tx, quote));
  } catch (error) {
    domainToTrpc(error);
  }
  for (const [i, a] of totals.lines.entries()) {
    const l = lines[i]!;
    const lineTotal = a.billable ? a.total : 0;
    const lineVat = a.billable ? a.vat : 0;
    const lineSubtotal = a.billable ? a.subtotal : 0;
    if (l.lineTotal !== lineTotal || l.lineVat !== lineVat || l.lineSubtotal !== lineSubtotal) {
      await tx.quoteLine.update({
        where: { id: l.id },
        data: { lineTotal, lineVat, lineSubtotal },
      });
    }
  }
  await tx.quote.update({
    where: { id: quoteId },
    data: {
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      vatTotal: totals.vatTotal,
      total: totals.total,
      insuranceShare: totals.insuranceShare,
      customerShare: totals.customerShare,
      acceptedTotal: totals.acceptedTotal,
    },
  });
  return totals;
}

// ───────────── Lignes (RG-M05-05/06) ─────────────

interface PricingActor {
  organizationId: string;
  permissions: ReadonlySet<string>;
  userId?: string | null;
  membershipId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** Données de création d'une ligne de devis (prix catalogue, TVA, minimum de vente). */
export async function buildQuoteLineData(
  tx: Tx,
  actor: PricingActor,
  org: OrgQuoteContext,
  quote: Pick<Quote, "id" | "organizationId" | "vehicleId"> & {
    insuranceClaimId?: string | null;
  },
  line: QuoteLineInput,
  priceReason?: string,
): Promise<Omit<Prisma.QuoteLineUncheckedCreateInput, "sortOrder">> {
  let quantity = line.quantity;
  let unitPrice = line.unitPrice;
  let vatRate = line.vatRate ?? (org.vatEnabled ? org.vatRate : 0);
  let costPrice = line.costPrice ?? null;
  let laborOperationId: string | undefined;
  let productId: string | undefined;
  let customerExplanation = line.customerExplanation ?? null;

  if (line.type === "LABOR" && line.laborOperationId) {
    const op = await tx.laborOperation.findFirst({ where: { id: line.laborOperationId } });
    if (!op) bad("Opération de main-d'œuvre introuvable.");
    laborOperationId = op.id;
    const vehicle = quote.vehicleId
      ? await tx.vehicle.findFirst({ where: { id: quote.vehicleId } })
      : null;
    const hours = laborHoursForVehicle(
      op.standardHours,
      (op.vehicleOverrides as unknown as VehicleOverride[]) ?? [],
      vehicle,
    );
    const pricing = laborLinePricing({ ...op, standardHours: hours }, org.laborRates);
    if (unitPrice === undefined) unitPrice = pricing.unitPrice;
    if (op.fixedPrice != null) quantity = 1;
    customerExplanation ??= op.customerDescription;
  }
  if (line.type === "PART" && line.productId) {
    const product = await tx.product.findFirst({ where: { id: line.productId } });
    if (!product) bad("Pièce introuvable.");
    productId = product.id;
    if (unitPrice === undefined) unitPrice = product.salePrice;
    if (line.vatRate === undefined) vatRate = org.vatEnabled ? product.vatRate : 0;
    costPrice ??= product.averageCost || product.purchasePrice || null;
  }
  if (line.type === "PART" && line.isCustomerSupplied) unitPrice = 0;
  if (unitPrice === undefined) bad("Indiquez le prix unitaire.");
  await assertMinSalePrice(tx, actor, quote.id, productId ?? null, {
    unitPrice,
    discountRate: line.discountRate ?? 0,
    isCustomerSupplied: Boolean(line.isCustomerSupplied),
    priceReason,
  });
  return {
    organizationId: quote.organizationId,
    quoteId: quote.id,
    type: line.type,
    productId,
    laborOperationId,
    description: line.description,
    quantity,
    unitPrice,
    discountRate: line.discountRate ?? 0,
    vatRate,
    // US-M16-04 : sur un devis assurance, les lignes sont à la charge de l'assureur par défaut.
    payer: line.payer ?? (quote.insuranceClaimId ? "INSURANCE" : "CUSTOMER"),
    isOptional: Boolean(line.isOptional),
    priority: line.priority ?? null,
    groupKey: line.groupKey ?? null,
    groupLabel: line.groupLabel ?? null,
    requiresGroupKey: line.requiresGroupKey ?? null,
    customerExplanation,
    isCustomerSupplied: Boolean(line.isCustomerSupplied),
    costPrice,
    photoAttachmentIds: line.photoAttachmentIds ?? [],
  };
}

/** US-M05-03 : prix net (après remise de ligne) sous `Product.minSalePrice` → `invoice:price_below_min`. */
export async function assertMinSalePrice(
  tx: Tx,
  actor: PricingActor,
  quoteId: string,
  productId: string | null,
  input: {
    unitPrice: number;
    discountRate: number;
    isCustomerSupplied: boolean;
    priceReason?: string;
  },
): Promise<void> {
  if (!productId || input.isCustomerSupplied) return;
  const product = await tx.product.findFirst({ where: { id: productId } });
  if (!product) return;
  // RG-M07-13 : même contrôle que `product.checkPrice` (M07).
  const check = checkSalePrice({
    unitPrice: input.unitPrice,
    discountRate: input.discountRate,
    minSalePrice: product.minSalePrice,
    averageCost: product.averageCost,
  });
  if (!check.belowMin) return;
  if (!actor.permissions.has("invoice:price_below_min")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Prix inférieur au minimum autorisé pour « ${product.name} ». Demandez au gérant.`,
    });
  }
  if (!input.priceReason?.trim()) bad("Indiquez le motif du prix sous le minimum.");
  await writeAuditLog({
    organizationId: actor.organizationId,
    userId: actor.userId ?? null,
    membershipId: actor.membershipId ?? null,
    action: "quote.price_below_min",
    entity: "Quote",
    entityId: quoteId,
    after: { productId, unitPrice: input.unitPrice, discountRate: input.discountRate },
    reason: input.priceReason,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  });
}

// ───────────── Remises et plafonds (RG-M05-07) ─────────────

/**
 * Réévalue les remises d'un brouillon avec le rôle de l'auteur de la modification :
 * dans son plafond → aucune validation ; au-delà → `PENDING` (envoi bloqué) + notification
 * aux détenteurs de `quote:discount_override`.
 */
export async function evaluateDiscounts(
  tx: Tx,
  actor: {
    organizationId: string;
    membershipId: string;
    role: Role;
    permissions: ReadonlySet<string>;
  },
  org: OrgQuoteContext,
  quoteId: string,
): Promise<{ status: string; withinCaps: boolean; cap: { line: number; global: number } }> {
  const quote = await tx.quote.findFirstOrThrow({ where: { id: quoteId } });
  const lines = await tx.quoteLine.findMany({ where: { quoteId } });
  const totals = totalsFor(quote, lines, org.vatEnabled);
  const check = checkDiscounts({
    role: actor.role,
    caps: org.quotes.discountCaps,
    lineRates: lines.map((l) => l.discountRate),
    globalRate: totals.globalDiscountRateEffective,
    hasOverride: actor.permissions.has("quote:discount_override"),
  });
  const anyDiscount = check.maxRequested > 0;
  let status: string;
  if (!anyDiscount) status = "NONE";
  else if (check.withinCaps) {
    // Un détenteur de quote:discount_override qui dépasse le plafond de son rôle valide de fait.
    const ownCap = org.quotes.discountCaps[actor.role];
    const beyondOwn =
      lines.some((l) => l.discountRate > ownCap.line) ||
      totals.globalDiscountRateEffective > ownCap.global;
    status = beyondOwn ? "APPROVED" : "NONE";
  } else status = "PENDING";

  if (status !== quote.discountApprovalStatus) {
    await tx.quote.update({
      where: { id: quoteId },
      data: {
        discountApprovalStatus: status,
        discountApprovedById: status === "APPROVED" ? actor.membershipId : null,
      },
    });
    if (status === "PENDING") {
      await requestDiscountApprovalNotification(tx, quote, check.cap.line);
    }
  }
  return { status, withinCaps: check.withinCaps, cap: check.cap };
}

export async function requestDiscountApprovalNotification(
  tx: Tx,
  quote: Pick<Quote, "id" | "organizationId" | "number" | "version">,
  capLine: number,
): Promise<void> {
  await notify(tx, quote.organizationId, await membersWithRoles(tx, ["OWNER", "MANAGER"]), {
    type: "quote.discount_approval_requested",
    title: `Remise à valider — ${quote.number} v${quote.version}`,
    body: `Remise au-delà du plafond du conseiller (${capLine} %).`,
    link: `/devis/${quote.id}`,
    dedupeKey: `quote.discount:${quote.id}`,
  });
  await emitDomainEvent(tx as never, quote.organizationId, "quote.discount_approval_requested", {
    quoteId: quote.id,
  });
}

// ───────────── Jetons du portail (A2, RG-M05-09) ─────────────

export function newPortalToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function quotePublicUrl(token: string): string {
  return `${appUrl()}/p/${token}/devis`;
}

/** Crée un jeton `QUOTE` ; `Quote.publicToken` = hash (A2). */
export async function issueQuoteToken(
  tx: Tx,
  quote: Pick<Quote, "id" | "organizationId" | "customerId" | "validUntil">,
  createdById: string | null,
): Promise<{ token: string; url: string }> {
  const { token, tokenHash } = newPortalToken();
  await tx.portalToken.create({
    data: {
      organizationId: quote.organizationId,
      tokenHash,
      scope: "QUOTE",
      targetId: quote.id,
      customerId: quote.customerId,
      createdById,
      expiresAt: portalLinkExpiry(quote.validUntil),
    },
  });
  await tx.quote.update({ where: { id: quote.id }, data: { publicToken: tokenHash } });
  return { token, url: quotePublicUrl(token) };
}

export type ResolvedQuoteToken =
  | {
      status: "ACTIVE";
      token: { id: string; organizationId: string; targetId: string; customerId: string };
    }
  | { status: "EXPIRED" | "REVOKED" | "NOT_FOUND"; organizationId?: string; targetId?: string };

/** Résout un jeton public de portée QUOTE (hors contexte locataire, lecture par hash). */
export async function resolveQuoteToken(
  token: string,
  now: Date,
  options: ResolvePortalTokenOptions = {},
): Promise<ResolvedQuoteToken> {
  const resolved = await resolvePortalTokenRow(token, ["QUOTE"], now, options);
  if (resolved.status === "NOT_FOUND") return { status: "NOT_FOUND" };
  if (resolved.status !== "ACTIVE") {
    return {
      status: resolved.status,
      organizationId: resolved.row.organizationId,
      targetId: resolved.row.targetId,
    };
  }
  return { status: "ACTIVE", token: resolved.row };
}

/** RG-M05-09 : le jeton couvre « ce devis et ses versions suivantes par redirection ». */
export async function latestVersionOf(tx: Tx, quote: Quote): Promise<Quote> {
  if (!quote.supersededAt) return quote;
  const latest = await tx.quote.findFirst({
    where: { number: quote.number, deletedAt: null, supersededAt: null },
    orderBy: { version: "desc" },
  });
  return latest ?? quote;
}

// ───────────── Empreinte (RG-M05-10) ─────────────

export function quoteContentHash(
  quote: Pick<Quote, "number" | "version" | "total">,
  lines: readonly Pick<
    QuoteLine,
    | "id"
    | "description"
    | "quantity"
    | "unitPrice"
    | "discountRate"
    | "vatRate"
    | "payer"
    | "lineTotal"
    | "groupKey"
  >[],
): string {
  return createHash("sha256")
    .update(
      canonicalQuoteContent({
        number: quote.number,
        version: quote.version,
        total: quote.total,
        lines,
      }),
    )
    .digest("hex");
}

// ───────────── Décision et effets (RG-M05-11 / RG-M05-12) ─────────────

export interface ApplyDecisionInput {
  quote: Quote;
  decisions: LineDecision[];
  amendment?: boolean;
  channel: "portal" | "phone" | "in_person" | "whatsapp" | "insurer";
  now: Date;
  data?: Prisma.QuoteUpdateInput;
  actorMembershipId: string | null;
  declineReason?: string | null;
}

export interface ApplyDecisionOutput {
  quote: Quote;
  result: DecisionResult;
  acceptedTotal: number;
  declinedTotal: number;
  deposit: number;
}

export async function applyDecision(
  tx: Tx,
  org: OrgQuoteContext,
  input: ApplyDecisionInput,
): Promise<ApplyDecisionOutput> {
  const { quote, now } = input;
  const lines = await tx.quoteLine.findMany({
    where: { quoteId: quote.id },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  let result: DecisionResult;
  try {
    result = input.amendment
      ? amendDecision(lines, input.decisions)
      : decisionResult(lines, input.decisions);
  } catch (error) {
    domainToTrpc(error);
  }
  for (const l of lines) {
    const accepted = result.accepted.get(l.id)!;
    await tx.quoteLine.update({
      where: { id: l.id },
      data: {
        accepted,
        declineReason: accepted
          ? null
          : (result.declineReasons.get(l.id) ?? l.declineReason ?? input.declineReason ?? null),
      },
    });
  }
  const totals = await recomputeQuote(tx, quote.id, org.vatEnabled);
  const fresh = await tx.quote.findFirstOrThrow({ where: { id: quote.id } });
  const freshLines = await tx.quoteLine.findMany({ where: { quoteId: quote.id } });
  const specialOrderCost = await specialOrderCostOf(
    tx,
    freshLines.filter((l) => l.accepted),
  );
  const deposit = depositAmount({
    acceptedTotal: totals.acceptedTotal,
    rule: org.quotes.depositRule,
    specialOrderCost,
  });
  const updated = await tx.quote.update({
    where: { id: quote.id },
    data: {
      status: result.status,
      decidedAt: input.amendment ? (quote.decidedAt ?? now) : now,
      decisionChannel: input.amendment ? quote.decisionChannel : input.channel,
      declineReason:
        result.status === "DECLINED"
          ? (input.declineReason ?? [...result.declineReasons.values()][0] ?? null)
          : null,
      decisionHash: quoteContentHash(fresh, freshLines),
      depositAmount: deposit > 0 ? deposit : null,
      ...input.data,
    },
  });

  if (quote.repairOrderId) {
    await syncRepairOrder(tx, org, updated, now);
  }
  const eventPayload = {
    quoteId: quote.id,
    number: quote.number,
    version: quote.version,
    status: result.status,
    channel: input.channel,
    acceptedTotal: totals.acceptedTotal,
    declinedTotal: totals.declinedTotal,
    amendment: Boolean(input.amendment),
  };
  await emitDomainEvent(
    tx as never,
    quote.organizationId,
    result.status === "DECLINED" ? "quote.declined" : "quote.accepted",
    eventPayload,
  );
  const managers =
    quote.repairOrderId || totals.acceptedTotal >= 1_000_000
      ? await membersWithRoles(
          tx,
          totals.acceptedTotal >= 1_000_000 ? ["OWNER", "MANAGER"] : ["MANAGER"],
        )
      : [];
  await notify(
    tx,
    quote.organizationId,
    [quote.createdById, ...managers].filter((m) => m !== input.actorMembershipId),
    {
      type: result.status === "DECLINED" ? "quote.declined" : "quote.accepted",
      title:
        result.status === "DECLINED"
          ? `Devis refusé — ${quote.number}`
          : `Devis ${result.status === "ACCEPTED" ? "accepté" : "partiellement accepté"} — ${quote.number}`,
      body: `Accepté : ${formatFCFA(totals.acceptedTotal)} TTC`,
      link: `/devis/${quote.id}`,
    },
  );
  return {
    quote: updated,
    result,
    acceptedTotal: totals.acceptedTotal,
    declinedTotal: totals.declinedTotal,
    deposit,
  };
}

/** RG-M05-14 : coût d'achat des pièces commandées spécialement (`isStocked = false`). */
async function specialOrderCostOf(
  tx: Tx,
  lines: Pick<QuoteLine, "productId" | "quantity" | "costPrice" | "type">[],
): Promise<number> {
  const ids = lines.filter((l) => l.type === "PART" && l.productId).map((l) => l.productId!);
  if (ids.length === 0) return 0;
  const products = await tx.product.findMany({ where: { id: { in: ids }, isStocked: false } });
  const special = new Set(products.map((p) => p.id));
  return lines
    .filter((l) => l.productId && special.has(l.productId))
    .reduce((s, l) => s + Math.round((l.costPrice ?? 0) * l.quantity), 0);
}

/**
 * RG-M05-12 — devis lié à un OR : lignes acceptées approuvées (ou créées) dans l'OR avec
 * `approvalSource = QUOTE` et `quoteLineId` ; lignes refusées → DECLINED + travaux conseillés
 * (VehicleRecommendation, un par groupe) ; puis enchaînement `approve` / `decline_all` (M04).
 */
export async function syncRepairOrder(
  tx: Tx,
  org: OrgQuoteContext,
  quote: Quote,
  now: Date,
): Promise<void> {
  const order = await tx.repairOrder.findFirst({ where: { id: quote.repairOrderId! } });
  if (!order || ["DELIVERED", "INVOICED", "CANCELLED"].includes(order.status)) return;
  const lines = await tx.quoteLine.findMany({
    where: { quoteId: quote.id },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  const linked = await tx.repairOrderLine.findMany({
    where: { repairOrderId: order.id, quoteLineId: { in: lines.map((l) => l.id) } },
  });
  const byQuoteLine = new Map(linked.map((l) => [l.quoteLineId!, l]));
  let sortOrder = await tx.repairOrderLine.count({ where: { repairOrderId: order.id } });
  const declinedGroups = new Map<string, QuoteLine[]>();
  for (const l of lines) {
    const roLine = byQuoteLine.get(l.id);
    if (l.accepted) {
      if (roLine) {
        if (roLine.approval !== "APPROVED") {
          await tx.repairOrderLine.update({
            where: { id: roLine.id },
            data: {
              approval: "APPROVED",
              approvalSource: "QUOTE",
              status: roLine.status === "CANCELLED" ? "PENDING" : roLine.status,
              cancelReason: null,
            },
          });
        }
      } else {
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
    } else if (l.accepted === false) {
      if (roLine && roLine.approval === "PENDING") {
        await tx.repairOrderLine.update({
          where: { id: roLine.id },
          data: { approval: "DECLINED", cancelReason: "Refusée par le client (devis)" },
        });
      }
      const key = groupKeyOf(l);
      declinedGroups.set(key, [...(declinedGroups.get(key) ?? []), l]);
    }
  }
  // Une recommandation par groupe refusé, pour les points d'inspection (ou travaux prioritaires).
  for (const group of declinedGroups.values()) {
    const first = group[0]!;
    if (!first.inspectionItemId && !first.priority) continue;
    const existing = await tx.vehicleRecommendation.findFirst({
      where: { quoteLineId: { in: group.map((g) => g.id) } },
    });
    if (existing) continue;
    await recordDeclinedRecommendation(
      tx,
      org,
      order,
      {
        description: first.groupLabel ?? first.description,
        inspectionItemId: first.inspectionItemId,
        quoteLineId: first.id,
      },
      group.reduce((s, g) => s + g.lineTotal, 0),
      now,
    );
    if (first.priority === "URGENT") {
      await tx.vehicleRecommendation.updateMany({
        where: { quoteLineId: first.id },
        data: { severity: "URGENT" },
      });
    }
  }
  await recomputeTotals(tx, order.id, org.vatEnabled);
  await afterLineChange(
    tx,
    { organizationId: order.organizationId, permissions: new Set() },
    org,
    order.id,
    now,
  );
}

export function roLineDataFromQuoteLine(
  l: QuoteLine,
  repairOrderId: string,
): Prisma.RepairOrderLineUncheckedCreateInput {
  return {
    organizationId: l.organizationId,
    repairOrderId,
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
    quoteLineId: l.id,
  };
}

/**
 * US-M05-04 : à l'envoi d'un devis lié à un OR, ses lignes non encore reportées entrent dans
 * l'OR en attente d'accord (`PENDING`) puis l'OR passe `AWAITING_APPROVAL` si possible.
 */
export async function mirrorPendingLinesIntoOrder(tx: Tx, quote: Quote): Promise<string[]> {
  if (!quote.repairOrderId) return [];
  const order = await tx.repairOrder.findFirst({ where: { id: quote.repairOrderId } });
  if (!order || ["DELIVERED", "INVOICED", "CANCELLED"].includes(order.status)) return [];
  const lines = await tx.quoteLine.findMany({
    where: { quoteId: quote.id },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  const linked = new Set(
    (
      await tx.repairOrderLine.findMany({
        where: { quoteLineId: { in: lines.map((l) => l.id) } },
        select: { quoteLineId: true },
      })
    ).map((l) => l.quoteLineId),
  );
  let sortOrder = await tx.repairOrderLine.count({ where: { repairOrderId: order.id } });
  const created: string[] = [];
  for (const l of lines) {
    if (linked.has(l.id)) continue;
    const row = await tx.repairOrderLine.create({
      data: {
        ...roLineDataFromQuoteLine(l, order.id),
        approval: l.payer === "WARRANTY" || l.payer === "INTERNAL" ? "NOT_REQUIRED" : "PENDING",
        sortOrder: sortOrder++,
      },
    });
    created.push(row.id);
  }
  return created;
}

/** Date de validité initiale d'un devis (RG-M05-08). */
export function initialValidUntil(
  org: OrgQuoteContext,
  now: Date,
  input: { customerType?: string | null; isInsurance?: boolean },
): Date {
  const days =
    input.isInsurance || input.customerType === "COMPANY"
      ? org.quotes.validityDaysCompany
      : org.quotes.validityDays;
  return addDays(businessDate(now, org.timeZone), days);
}

// ───────────── Pièces jointes (signature, preuve) ─────────────

/** Stocke une image data-URL (signature PNG) comme `Attachment` du devis ; renvoie son URL. */
export async function storeQuoteImage(
  tx: Tx,
  input: {
    organizationId: string;
    quoteId: string;
    dataUrl: string;
    kind: "signature";
    membershipId: string | null;
  },
): Promise<{ attachmentId: string; url: string }> {
  const [meta, base64] = input.dataUrl.split(",", 2);
  const mimeType = meta!.slice(5, meta!.indexOf(";"));
  const body = Buffer.from(base64 ?? "", "base64");
  if (body.byteLength > 200_000) bad("Signature trop lourde (200 Ko maximum).");
  const key = `${input.organizationId}/quotes/${input.quoteId}/${input.kind}-${randomBytes(8).toString("hex")}.${mimeType.split("/")[1]}`;
  await getAttachmentStorage().upload({ key, body, contentType: mimeType, maxBytes: 200_000 });
  const attachment = await tx.attachment.create({
    data: {
      organizationId: input.organizationId,
      entity: "quote",
      entityId: input.quoteId,
      kind: input.kind,
      url: key,
      mimeType,
      size: body.byteLength,
      createdById: input.membershipId,
    },
  });
  return { attachmentId: attachment.id, url: `/api/attachments/${attachment.id}` };
}

/** IP tronquée /24 (RG-M14-06) : la preuve garde le réseau, pas l'adresse exacte. */
export function truncateIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.\d+$/);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0`;
  return ip.split(":").slice(0, 4).join(":") + "::";
}
