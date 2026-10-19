// M05 — orchestration des devis : contexte d'organisation, numérotation, prix des lignes,
// totaux, lien portail (A2), envoi (M11), décision et ses effets (OR M04, recommandations,
// relances M10), versions, conversion, expiration. Toute décision métier vient de
// `@atelieros/core` (quotes) ; ici on lit/écrit en base et on orchestre.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  addDays,
  businessDate,
  buildWaLinkUrl,
  canTransition,
  computeValidUntil,
  decisionResult,
  DEFAULT_NUMBERING_CONFIG,
  depositAmount,
  discountAllowed,
  discountRequiresReason,
  globalDiscountRateEquivalent,
  isDomainError,
  laborLinePricing,
  phoneConfirmationMessage,
  portalLinkExpiry,
  quoteContentPayload,
  quoteSendMessage,
  quoteSettingsFrom,
  quoteTotals,
  renderNumberingPattern,
  SIGNATURE_ALWAYS_REQUIRED_ABOVE,
  systemClock,
  type Clock,
  type DecisionChannel,
  type LineDecisionInput,
  type NumberingConfig,
  type Permission,
  type QuoteSettings,
  type QuoteStatus,
  type QuoteTotals,
} from "@atelieros/core";
import {
  adminDb,
  tenantSequenceStore,
  type Customer,
  type Prisma,
  type Quote,
  type QuoteLine,
  type ScopedTenantClient,
} from "@atelieros/db";
import type { QuoteLineInput } from "@atelieros/validators";
import { emitDomainEvent } from "../events/emit";
import { messagingEnqueue } from "../messaging/enqueue";
import { enqueueMessageSendJob } from "../messaging/queue";
import {
  applyTransition,
  loadOrgRoContext,
  membersWithRoles,
  recomputeTotals,
  transitionFacts,
  type OrgRoContext,
} from "../repairOrders/helpers";
import { getAttachmentStorage } from "../storage";

export type Tx = ScopedTenantClient;

/** Horloge injectable (tests). */
let clock: Clock = systemClock;
export function setQuotesClock(next: Clock): void {
  clock = next;
}
export function quoteNow(): Date {
  return clock.now();
}

export interface OrgQuoteContext extends OrgRoContext {
  quotes: QuoteSettings;
  quoteNumbering: NumberingConfig;
  /** M07 (interface) : délai indicatif d'une pièce à commander (jours). */
  defaultLeadTimeDays: number;
}

export async function loadOrgQuoteContext(organizationId: string): Promise<OrgQuoteContext> {
  const base = await loadOrgRoContext(organizationId);
  const raw = (base.rawSettings ?? {}) as Record<string, unknown>;
  const numberingRaw =
    raw.numbering && typeof raw.numbering === "object"
      ? ((raw.numbering as Record<string, Partial<NumberingConfig>>).DEV ?? {})
      : {};
  const leadTime =
    typeof raw.defaultLeadTimeDays === "number" ? (raw.defaultLeadTimeDays as number) : 3;
  return {
    ...base,
    quotes: quoteSettingsFrom(raw),
    quoteNumbering: { ...DEFAULT_NUMBERING_CONFIG.DEV, ...numberingRaw },
    defaultLeadTimeDays: leadTime,
  };
}

/** RG-M05-17 : en mode REMINDERS_ONLY, le module devis est masqué. */
export function assertQuoteModule(org: Pick<OrgQuoteContext, "operatingMode">): void {
  if (org.operatingMode === "REMINDERS_ONLY") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "MODULE_DISABLED : les devis sont disponibles en gestion complète.",
    });
  }
}

export function notFound(message = "Devis introuvable."): never {
  throw new TRPCError({ code: "NOT_FOUND", message });
}

export function badRequest(message: string, cause?: unknown): never {
  throw new TRPCError({ code: "BAD_REQUEST", message, cause });
}

export function rethrowDomain(error: unknown): never {
  if (isDomainError(error)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error.message,
      cause: { code: error.code, ...(error.details ?? {}) },
    });
  }
  throw error;
}

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

// ───────────── Numérotation (RG-M05-01) ─────────────

export async function nextQuoteNumber(
  tx: Tx,
  org: OrgQuoteContext,
  siteId: string,
  now: Date,
): Promise<string> {
  const site = await tx.site.findFirst({ where: { id: siteId }, select: { code: true } });
  if (!site) badRequest("Site introuvable.");
  const year = Number(businessDate(now, org.timeZone).toISOString().slice(0, 4));
  const value = await tenantSequenceStore(tx).getAndIncrement({
    organizationId: org.id,
    siteId: org.quoteNumbering.perSite ? siteId : null,
    docType: "DEV",
    year: org.quoteNumbering.resetYearly ? year : 0,
  });
  return renderNumberingPattern(org.quoteNumbering, { siteCode: site.code, year, value });
}

// ───────────── Lignes : prix catalogue (RG-M05-05 / RG-M05-06) ─────────────

interface VehicleOverride {
  make: string;
  model?: string;
  yearFrom?: number;
  yearTo?: number;
  standardHours: number;
}

/** Temps barème spécifique au véhicule (ex. kit distribution : 3 h Corolla, 4,5 h Hilux). */
export function laborHoursForVehicle(
  op: { standardHours: number; vehicleOverrides: unknown },
  vehicle: { make: string; model: string; year: number | null } | null | undefined,
): number {
  if (!vehicle || !Array.isArray(op.vehicleOverrides)) return op.standardHours;
  const overrides = op.vehicleOverrides as VehicleOverride[];
  const match = overrides.find(
    (o) =>
      o.make.toLowerCase() === vehicle.make.toLowerCase() &&
      (!o.model || o.model.toLowerCase() === vehicle.model.toLowerCase()) &&
      (!o.yearFrom || (vehicle.year ?? 0) >= o.yearFrom) &&
      (!o.yearTo || (vehicle.year ?? 9999) <= o.yearTo),
  );
  return match?.standardHours ?? op.standardHours;
}

export interface LinePricingActor {
  permissions: Set<Permission>;
  membershipId: string | null;
}

/** Données de création d'une ligne de devis (prix, TVA, remise client, groupe…). */
export async function buildQuoteLineData(
  tx: Tx,
  org: OrgQuoteContext,
  quote: Pick<Quote, "id" | "organizationId" | "vehicleId">,
  customer: Pick<Customer, "discountRate">,
  line: QuoteLineInput,
  actor: LinePricingActor,
): Promise<Prisma.QuoteLineUncheckedCreateInput> {
  let quantity = line.quantity;
  let unitPrice = line.unitPrice;
  let vatRate = line.vatRate ?? (org.vatEnabled ? org.vatRate : 0);
  let laborOperationId: string | undefined;
  let productId: string | undefined;
  let costPrice = line.costPrice ?? undefined;

  if (line.type === "LABOR" && line.laborOperationId) {
    const op = await tx.laborOperation.findFirst({ where: { id: line.laborOperationId } });
    if (!op) badRequest("Opération de main-d'œuvre introuvable.");
    laborOperationId = op.id;
    const vehicle = quote.vehicleId
      ? await tx.vehicle.findFirst({
          where: { id: quote.vehicleId },
          select: { make: true, model: true, year: true },
        })
      : null;
    const pricing = laborLinePricing(
      { ...op, standardHours: laborHoursForVehicle(op, vehicle) },
      org.laborRates,
    );
    if (unitPrice === undefined) unitPrice = pricing.unitPrice;
    if (op.fixedPrice != null) quantity = 1;
    else if (line.quantity === 1 && vehicle && pricing.quantity !== 1) quantity = pricing.quantity;
  }
  if (line.type === "PART" && line.productId) {
    const product = await tx.product.findFirst({ where: { id: line.productId } });
    if (!product) badRequest("Pièce introuvable.");
    productId = product.id;
    if (unitPrice === undefined) unitPrice = product.salePrice;
    if (line.vatRate === undefined) vatRate = org.vatEnabled ? product.vatRate : 0;
    if (costPrice === undefined) costPrice = product.averageCost || product.purchasePrice;
    // RG-M05-03 / US-M05-03 : prix sous le minimum → `invoice:price_below_min` + motif.
    if (
      !line.isCustomerSupplied &&
      product.minSalePrice != null &&
      unitPrice < product.minSalePrice
    ) {
      if (!actor.permissions.has("invoice:price_below_min")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Prix inférieur au minimum autorisé pour « ${product.name} ». Demandez au gérant.`,
        });
      }
      if (!line.priceReason?.trim()) badRequest("Indiquez le motif du prix sous le minimum.");
    }
  }
  if (line.type === "PART" && line.isCustomerSupplied) unitPrice = 0;
  if (unitPrice === undefined) badRequest("Indiquez le prix unitaire.");

  return {
    organizationId: quote.organizationId,
    quoteId: quote.id,
    type: line.type,
    productId,
    laborOperationId,
    description: line.description,
    quantity,
    unitPrice,
    discountRate: line.discountRate ?? customer.discountRate ?? 0,
    vatRate,
    payer: line.payer ?? "CUSTOMER",
    isOptional: line.isOptional ?? false,
    priority: line.priority ?? null,
    groupKey: line.groupKey ?? null,
    groupLabel: line.groupLabel ?? null,
    requiresGroupKey: line.requiresGroupKey ?? null,
    customerExplanation: line.customerExplanation ?? null,
    inspectionItemId: line.inspectionItemId ?? null,
    photoAttachmentIds: line.photoAttachmentIds ?? [],
    costPrice: costPrice ?? null,
    isCustomerSupplied: Boolean(line.isCustomerSupplied),
  };
}

// ───────────── Totaux (RG-M05-03) ─────────────

export async function quoteDeductible(tx: Tx, quote: Pick<Quote, "insuranceClaimId">) {
  if (!quote.insuranceClaimId) return 0;
  const claim = await tx.insuranceClaim.findFirst({
    where: { id: quote.insuranceClaimId },
    select: { deductible: true },
  });
  return claim?.deductible ?? 0;
}

export function computeTotalsFor(
  org: Pick<OrgQuoteContext, "vatEnabled">,
  quote: Pick<Quote, "globalDiscountRate" | "globalDiscountAmount">,
  lines: readonly QuoteLine[],
  deductible: number,
): QuoteTotals {
  return quoteTotals(lines, {
    vatEnabled: org.vatEnabled,
    globalDiscountRate: quote.globalDiscountRate,
    globalDiscountAmount: quote.globalDiscountAmount,
    deductible,
  });
}

/** Recalcule et écrit les montants par ligne et les totaux du devis, en transaction. */
export async function recomputeQuoteTotals(
  tx: Tx,
  org: Pick<OrgQuoteContext, "vatEnabled">,
  quoteId: string,
): Promise<{ quote: Quote; lines: QuoteLine[]; totals: QuoteTotals }> {
  const quote = await tx.quote.findFirstOrThrow({ where: { id: quoteId } });
  const lines = await tx.quoteLine.findMany({
    where: { quoteId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  const deductible = await quoteDeductible(tx, quote);
  let totals: QuoteTotals;
  try {
    totals = computeTotalsFor(org, quote, lines, deductible);
  } catch (error) {
    rethrowDomain(error);
  }
  for (const [i, line] of lines.entries()) {
    const amounts = totals.lines[i]!;
    if (
      line.lineSubtotal !== amounts.lineSubtotal ||
      line.lineVat !== amounts.lineVat ||
      line.lineTotal !== amounts.lineTotal
    ) {
      await tx.quoteLine.update({
        where: { id: line.id },
        data: {
          lineSubtotal: amounts.lineSubtotal,
          lineVat: amounts.lineVat,
          lineTotal: amounts.lineTotal,
        },
      });
      line.lineSubtotal = amounts.lineSubtotal;
      line.lineVat = amounts.lineVat;
      line.lineTotal = amounts.lineTotal;
    }
  }
  const updated = await tx.quote.update({
    where: { id: quoteId },
    data: {
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      vatTotal: totals.vatTotal,
      total: totals.total,
      acceptedTotal: totals.acceptedTotal,
      insuranceShare: totals.insuranceShare,
      customerShare: totals.customerShare,
    },
  });
  return { quote: updated, lines, totals };
}

// ───────────── Remises (RG-M05-07) ─────────────

export function assessDiscount(
  org: OrgQuoteContext,
  actor: { role: string; permissions: Set<Permission> },
  quote: Pick<Quote, "globalDiscountRate" | "globalDiscountAmount">,
  lines: readonly Pick<QuoteLine, "discountRate" | "quantity" | "unitPrice">[],
) {
  const baseHt = lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPrice), 0);
  return discountAllowed({
    role: actor.role,
    caps: org.quotes.discountCaps,
    lineRates: lines.map((l) => l.discountRate),
    globalRate: quote.globalDiscountRate,
    globalRateEquivalent: quote.globalDiscountAmount
      ? globalDiscountRateEquivalent(quote.globalDiscountAmount, baseHt)
      : 0,
    hasOverride: actor.permissions.has("quote:discount_override"),
  });
}

/**
 * Après toute modification de remise : au-delà du plafond → `discountApprovalStatus = PENDING`
 * (l'envoi est bloqué) ; revenue sous le plafond → NONE. Un statut APPROVED est conservé.
 */
export async function syncDiscountApproval(
  tx: Tx,
  org: OrgQuoteContext,
  actor: { role: string; permissions: Set<Permission> },
  quoteId: string,
): Promise<{ ok: boolean; status: string }> {
  const quote = await tx.quote.findFirstOrThrow({ where: { id: quoteId } });
  const lines = await tx.quoteLine.findMany({ where: { quoteId } });
  const check = assessDiscount(org, actor, quote, lines);
  const needsReason = discountRequiresReason(
    lines.map((l) => l.discountRate),
    quote.globalDiscountRate ??
      (quote.globalDiscountAmount
        ? globalDiscountRateEquivalent(
            quote.globalDiscountAmount,
            lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPrice), 0),
          )
        : 0),
  );
  if (needsReason && !quote.discountReason) {
    badRequest("Indiquez le motif de la remise (au-delà de 5 %).");
  }
  let status = quote.discountApprovalStatus;
  if (check.ok) {
    if (status === "PENDING" || status === "REJECTED") status = "NONE";
  } else if (status !== "APPROVED") {
    status = "PENDING";
  }
  if (status !== quote.discountApprovalStatus) {
    await tx.quote.update({ where: { id: quoteId }, data: { discountApprovalStatus: status } });
  }
  return { ok: check.ok, status };
}

// ───────────── Lien portail (A2, RG-M05-09) ─────────────

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function quotePublicUrl(token: string): string {
  return `${appUrl()}/p/${token}/devis`;
}

/** Crée un jeton `QUOTE` (lecture jusqu'à validUntil + 30 j) ; `Quote.publicToken` = hash. */
export async function issueQuoteLink(
  tx: Tx,
  input: {
    organizationId: string;
    quote: Pick<Quote, "id" | "customerId" | "validUntil">;
    createdById: string | null;
    now: Date;
  },
): Promise<{ token: string; publicUrl: string }> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  await tx.portalToken.updateMany({
    where: { scope: "QUOTE", targetId: input.quote.id, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: input.now, revokeReason: "Nouveau lien généré." },
  });
  await tx.portalToken.create({
    data: {
      organizationId: input.organizationId,
      tokenHash,
      scope: "QUOTE",
      targetId: input.quote.id,
      customerId: input.quote.customerId,
      createdById: input.createdById,
      expiresAt: portalLinkExpiry(input.quote.validUntil),
    },
  });
  await tx.quote.update({ where: { id: input.quote.id }, data: { publicToken: tokenHash } });
  return { token, publicUrl: quotePublicUrl(token) };
}

export async function revokeQuoteLinks(tx: Tx, quoteId: string, reason: string, now: Date) {
  await tx.portalToken.updateMany({
    where: { scope: "QUOTE", targetId: quoteId, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: now, revokeReason: reason },
  });
}

export type ResolvedQuoteToken =
  | { status: "ACTIVE"; organizationId: string; quoteId: string; customerId: string; id: string }
  | { status: "EXPIRED" | "REVOKED" | "NOT_FOUND" };

/** Résout un jeton public hors contexte locataire (il le fournit). Compte l'ouverture. */
export async function resolveQuoteToken(
  token: string,
  now: Date,
  countOpen = true,
): Promise<ResolvedQuoteToken> {
  const row = await adminDb.portalToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.scope !== "QUOTE") return { status: "NOT_FOUND" };
  if (row.status === "REVOKED") return { status: "REVOKED" };
  if (row.status === "EXPIRED" || row.expiresAt.getTime() <= now.getTime()) {
    if (row.status !== "EXPIRED") {
      await adminDb.portalToken.update({ where: { id: row.id }, data: { status: "EXPIRED" } });
    }
    return { status: "EXPIRED" };
  }
  if (countOpen) {
    await adminDb.portalToken.update({
      where: { id: row.id },
      data: {
        openCount: { increment: 1 },
        lastOpenedAt: now,
        firstOpenedAt: row.firstOpenedAt ?? now,
      },
    });
  }
  return {
    status: "ACTIVE",
    organizationId: row.organizationId,
    quoteId: row.targetId,
    customerId: row.customerId,
    id: row.id,
  };
}

// ───────────── Contenu signé (RG-M05-10) ─────────────

export function quoteDecisionHash(
  lines: readonly Pick<
    QuoteLine,
    "id" | "type" | "description" | "quantity" | "unitPrice" | "discountRate" | "vatRate" | "payer"
  >[],
  total: number,
): string {
  return createHash("sha256").update(quoteContentPayload(lines, total)).digest("hex");
}

/** Signature (PNG) stockée comme pièce jointe `quote` / `signature` ; renvoie l'URL servie. */
export async function storeQuoteSignature(
  tx: Tx,
  organizationId: string,
  quoteId: string,
  dataUrl: string,
  membershipId: string | null,
): Promise<string> {
  const [meta, base64] = dataUrl.split(",", 2);
  const mimeType = meta!.slice(5, meta!.indexOf(";"));
  const body = Buffer.from(base64 ?? "", "base64");
  const ext = mimeType.split("/")[1];
  const key = `${organizationId}/quotes/${quoteId}/signature-${randomUUID()}.${ext}`;
  await getAttachmentStorage().upload({ key, body, contentType: mimeType, maxBytes: 200_000 });
  const attachment = await tx.attachment.create({
    data: {
      organizationId,
      entity: "quote",
      entityId: quoteId,
      kind: "signature",
      url: key,
      mimeType,
      size: body.byteLength,
      createdById: membershipId,
    },
  });
  return `/api/attachments/${attachment.id}`;
}

// ───────────── Messages (M11) ─────────────

export interface Recipient {
  customerId: string | null;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
}

export async function sendQuoteMessage(
  tx: Tx,
  organizationId: string,
  input: {
    idempotencyKey: string;
    recipient: Recipient;
    body: string;
    subject?: string;
    sentById: string | null;
    channels: ("WHATSAPP" | "SMS" | "EMAIL")[];
    attachments?: { kind: "pdf" | "image"; storageKey: string; filename: string }[];
  },
): Promise<{ id: string; channel: string } | null> {
  const result = await messagingEnqueue(tx, organizationId, {
    idempotencyKey: input.idempotencyKey,
    kind: "transactional",
    customerId: input.recipient.customerId ?? undefined,
    to: {
      phone: input.recipient.phone,
      whatsapp: input.recipient.whatsapp ?? input.recipient.phone,
      email: input.recipient.email,
      name: input.recipient.name,
    },
    channels: input.channels,
    bodyOverride: input.body,
    subjectOverride: input.subject ?? "Votre devis",
    sentById: input.sentById,
    attachments: input.attachments,
  });
  if ("message" in result) return result.message;
  return null;
}

export async function flushMessages(ids: (string | null | undefined)[]): Promise<void> {
  for (const id of ids) {
    if (!id) continue;
    try {
      await enqueueMessageSendJob(id);
    } catch {
      // Redis indisponible : le message reste QUEUED, repris par le worker (M11).
    }
  }
}

// ───────────── Envoi (RG-M05-15) ─────────────

export interface SendQuoteInput {
  org: OrgQuoteContext;
  quote: Quote;
  lines: QuoteLine[];
  channel: "WHATSAPP" | "SMS" | "EMAIL" | "LINK_ONLY" | "WA_LINK";
  recipient: Recipient;
  recipientContactId?: string | null;
  customMessage?: string;
  sentById: string | null;
  now: Date;
  /** Renvoi : le devis est déjà SENT/VIEWED. */
  resend?: boolean;
}

export interface SendQuoteResult {
  quote: Quote;
  messageId: string | null;
  waLink: string | null;
  publicUrl: string;
  body: string;
}

export function assertSendable(quote: Quote, lines: readonly QuoteLine[], resend: boolean) {
  if (!resend && quote.status !== "DRAFT") {
    badRequest(`Ce devis est déjà ${quote.status === "SENT" ? "envoyé" : "décidé"}.`);
  }
  if (resend && !["SENT", "VIEWED"].includes(quote.status)) {
    badRequest("Seul un devis en attente de décision peut être renvoyé.");
  }
  if (lines.length === 0) badRequest("Ajoutez au moins une ligne avant d'envoyer le devis.");
  const chargeable = lines.filter((l) => l.payer === "CUSTOMER" || l.payer === "INSURANCE");
  if (chargeable.length > 0 && quote.total <= 0) {
    badRequest("Le total du devis doit être supérieur à 0 FCFA.");
  }
  if (quote.discountApprovalStatus === "PENDING") {
    badRequest("Remise en attente de validation du chef d'atelier : envoi bloqué.");
  }
  if (quote.discountApprovalStatus === "REJECTED") {
    badRequest("Remise refusée par le chef d'atelier : corrigez-la avant d'envoyer.");
  }
}

export async function sendQuote(tx: Tx, input: SendQuoteInput): Promise<SendQuoteResult> {
  const { org, quote, lines, now } = input;
  assertSendable(quote, lines, Boolean(input.resend));

  let publicUrl: string;
  const activeToken = await tx.portalToken.findFirst({
    where: { scope: "QUOTE", targetId: quote.id, status: "ACTIVE" },
  });
  // Le clair du jeton n'est jamais stocké : un renvoi régénère le lien (l'ancien reste valide
  // jusqu'à sa révocation explicite, RG-M14-04).
  if (!activeToken || input.resend || !quote.publicToken) {
    const link = await issueQuoteLink(tx, {
      organizationId: org.id,
      quote,
      createdById: input.sentById,
      now,
    });
    publicUrl = link.publicUrl;
  } else {
    const link = await issueQuoteLink(tx, {
      organizationId: org.id,
      quote,
      createdById: input.sentById,
      now,
    });
    publicUrl = link.publicUrl;
  }

  const vehicle = quote.vehicleId
    ? await tx.vehicle.findFirst({
        where: { id: quote.vehicleId },
        select: { make: true, model: true, plate: true },
      })
    : null;
  const urgentTotal = lines
    .filter((l) => l.priority === "URGENT" && (l.payer === "CUSTOMER" || l.payer === "INSURANCE"))
    .reduce((s, l) => s + l.lineTotal, 0);
  const body =
    input.customMessage?.trim() ||
    quoteSendMessage({
      customerName: input.recipient.name,
      number: quote.number,
      vehicleLabel: vehicle ? `${vehicle.make} ${vehicle.model} (${vehicle.plate})` : null,
      total: quote.customerShare || quote.total,
      urgentTotal,
      link: publicUrl,
      garageName: org.name,
    });

  let messageId: string | null = null;
  let waLink: string | null = null;
  let sentTo: string | null = null;
  if (input.channel === "WA_LINK") {
    const phone = input.recipient.whatsapp ?? input.recipient.phone;
    if (!phone) badRequest("Ce destinataire n'a pas de numéro WhatsApp.");
    waLink = buildWaLinkUrl(phone, body);
    sentTo = phone;
  } else if (input.channel !== "LINK_ONLY") {
    const channels: ("WHATSAPP" | "SMS" | "EMAIL")[] =
      input.channel === "WHATSAPP" ? ["WHATSAPP", "SMS"] : [input.channel];
    const message = await sendQuoteMessage(tx, org.id, {
      idempotencyKey: `quote:${quote.id}:v${quote.version}:${now.getTime()}`,
      recipient: input.recipient,
      body,
      subject: `Devis ${quote.number} — ${org.name}`,
      sentById: input.sentById,
      channels,
    });
    if (!message) {
      badRequest(
        "Aucun canal disponible pour ce destinataire (numéro ou email manquant, ou désinscrit). Utilisez « Copier le lien ».",
      );
    }
    messageId = message.id;
    sentTo =
      message.channel === "EMAIL"
        ? input.recipient.email
        : (input.recipient.whatsapp ?? input.recipient.phone);
  }

  const updated = await tx.quote.update({
    where: { id: quote.id },
    data: {
      status: quote.status === "DRAFT" ? "SENT" : quote.status,
      sentAt: quote.sentAt ?? now,
      sentVia: input.channel,
      sentTo,
      recipientContactId: input.recipientContactId ?? quote.recipientContactId,
    },
  });

  if (!input.resend) {
    // M04 / RG-M05-12 : les lignes du devis apparaissent dans l'OR en attente d'accord
    // (`PENDING`, `quoteLineId`), puis l'OR passe AWAITING_APPROVAL (transition système).
    if (quote.repairOrderId) {
      const order = await tx.repairOrder.findFirst({ where: { id: quote.repairOrderId } });
      if (order && !["DELIVERED", "INVOICED", "CANCELLED"].includes(order.status)) {
        await mirrorQuoteLinesIntoOrder(tx, org, order.id, lines);
      }
      if (order && (order.status === "CHECKED_IN" || order.status === "DIAGNOSING")) {
        const orLines = await tx.repairOrderLine.findMany({ where: { repairOrderId: order.id } });
        const facts = await transitionFacts(tx, order);
        const result = canTransition(order, orLines, "request_approval", {
          permissions: new Set(),
          system: true,
          qcRequired: org.settings.qcRequired,
          ...facts,
        });
        if (result.ok) {
          await applyTransition(tx, {
            order,
            to: result.to,
            transition: "request_approval",
            reason: `Devis ${quote.number} envoyé`,
            membershipId: null,
            now,
          });
        }
      }
    }
    await emitDomainEvent(tx as never, org.id, "quote.sent", {
      quoteId: quote.id,
      number: quote.number,
      version: quote.version,
      channel: input.channel,
      total: quote.total,
      customerId: quote.customerId,
      vehicleId: quote.vehicleId,
      repairOrderId: quote.repairOrderId,
    });
  } else {
    // RG-M05-15 : l'envoi d'une nouvelle version / renvoi redémarre la séquence de relance.
    await tx.reminder.updateMany({
      where: {
        quoteId: quote.id,
        type: "QUOTE_FOLLOWUP",
        status: { in: ["PLANNED", "NEEDS_APPROVAL", "SNOOZED"] },
      },
      data: { status: "CANCELLED", skippedReason: "Devis renvoyé : séquence redémarrée." },
    });
  }
  return { quote: updated, messageId, waLink, publicUrl, body };
}

/** Copie dans l'OR, en attente d'accord, les lignes du devis qui n'y sont pas encore liées. */
export async function mirrorQuoteLinesIntoOrder(
  tx: Tx,
  org: OrgQuoteContext,
  repairOrderId: string,
  lines: readonly QuoteLine[],
): Promise<void> {
  const existing = await tx.repairOrderLine.findMany({ where: { repairOrderId } });
  let sortOrder = existing.length;
  for (const line of lines) {
    if (existing.some((l) => l.quoteLineId === line.id)) continue;
    if (line.payer === "INTERNAL") continue;
    await tx.repairOrderLine.create({
      data: {
        organizationId: org.id,
        repairOrderId,
        type: line.type,
        productId: line.productId,
        laborOperationId: line.laborOperationId,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountRate: line.discountRate,
        vatRate: line.vatRate,
        payer: line.payer,
        approval: line.payer === "WARRANTY" ? "NOT_REQUIRED" : "PENDING",
        quoteLineId: line.id,
        inspectionItemId: line.inspectionItemId,
        isCustomerSupplied: line.isCustomerSupplied,
        costPrice: line.costPrice,
        sortOrder: sortOrder++,
      },
    });
  }
  await recomputeTotals(tx, repairOrderId, org.vatEnabled);
}

// ───────────── Décision (RG-M05-10 / RG-M05-11 / RG-M05-12) ─────────────

export interface DecisionMeta {
  channel: DecisionChannel;
  signerName?: string | null;
  signatureUrl?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  recordedById?: string | null;
  counterpart?: string | null;
  messageId?: string | null;
  declineReason?: string | null;
  /** Décision complémentaire (refusé → accepté uniquement). */
  amendment?: boolean;
  /** Portail : décision par groupe. */
  byGroup?: boolean;
}

export interface ApplyDecisionResult {
  quote: Quote;
  lines: QuoteLine[];
  status: QuoteStatus;
  acceptedTotal: number;
  declinedTotal: number;
  depositAmount: number;
  notifyMembershipIds: string[];
}

/** Applique une décision (portail ou personnel) et tous ses effets, en transaction. */
export async function applyQuoteDecision(
  tx: Tx,
  org: OrgQuoteContext,
  quote: Quote,
  decisions: readonly LineDecisionInput[],
  meta: DecisionMeta,
  now: Date,
): Promise<ApplyDecisionResult> {
  const lines = await tx.quoteLine.findMany({
    where: { quoteId: quote.id },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  let result;
  try {
    result = decisionResult(lines, decisions, {
      amendment: meta.amendment,
      byGroup: meta.byGroup,
    });
  } catch (error) {
    rethrowDomain(error);
  }
  for (const decided of result.lines) {
    const current = lines.find((l) => l.id === decided.id)!;
    if (current.accepted !== decided.accepted || current.declineReason !== decided.declineReason) {
      await tx.quoteLine.update({
        where: { id: decided.id },
        data: { accepted: decided.accepted, declineReason: decided.declineReason },
      });
    }
  }
  const recomputed = await recomputeQuoteTotals(tx, org, quote.id);
  const acceptedLines = recomputed.lines.filter((l) => l.accepted === true);

  // RG-M05-14 : acompte (pièces commandées spécialement : coût d'achat minimum).
  const productIds = acceptedLines.map((l) => l.productId).filter((p): p is string => !!p);
  const products = productIds.length
    ? await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, isStocked: true, purchasePrice: true, averageCost: true },
      })
    : [];
  const specialPartsCost = acceptedLines.reduce((sum, l) => {
    const p = products.find((x) => x.id === l.productId);
    if (!p || p.isStocked) return sum;
    return sum + Math.round(l.quantity * (l.costPrice ?? p.averageCost ?? p.purchasePrice));
  }, 0);
  const deposit = depositAmount({
    acceptedTotal: recomputed.totals.acceptedTotal,
    rule: org.quotes.depositRule,
    specialPartsCost,
  });

  const hash = quoteDecisionHash(recomputed.lines, recomputed.totals.total);
  const updated = await tx.quote.update({
    where: { id: quote.id },
    data: {
      status: result.status,
      decidedAt: meta.amendment ? (quote.decidedAt ?? now) : now,
      decisionChannel: meta.channel,
      signerName: meta.signerName ?? quote.signerName,
      signatureUrl: meta.signatureUrl ?? quote.signatureUrl,
      decisionHash: hash,
      decisionIp: meta.ip ?? quote.decisionIp,
      decisionUserAgent: meta.userAgent ?? quote.decisionUserAgent,
      recordedById: meta.recordedById ?? quote.recordedById,
      decisionCounterpart: meta.counterpart ?? quote.decisionCounterpart,
      decisionMessageId: meta.messageId ?? quote.decisionMessageId,
      declineReason:
        result.status === "DECLINED" || meta.declineReason
          ? (meta.declineReason ?? quote.declineReason)
          : quote.declineReason,
      depositAmount: deposit > 0 ? deposit : null,
    },
  });

  // RG-M05-12 — effets sur l'OR lié.
  const notifyIds: string[] = [quote.createdById ?? ""];
  if (quote.repairOrderId) {
    const order = await tx.repairOrder.findFirst({ where: { id: quote.repairOrderId } });
    if (order) {
      const orLines = await tx.repairOrderLine.findMany({ where: { repairOrderId: order.id } });
      let sortOrder = orLines.length;
      for (const line of recomputed.lines) {
        const existing = orLines.find((l) => l.quoteLineId === line.id);
        if (existing) {
          const approval = line.accepted ? "APPROVED" : "DECLINED";
          if (existing.approval !== approval) {
            await tx.repairOrderLine.update({
              where: { id: existing.id },
              data: {
                approval,
                approvalSource: line.accepted ? "QUOTE" : existing.approvalSource,
                cancelReason: line.accepted ? null : "Refusée par le client (devis)",
                unitPrice: line.unitPrice,
                discountRate: line.discountRate,
                quantity: line.quantity,
              },
            });
          }
        } else if (line.accepted && (line.payer === "CUSTOMER" || line.payer === "INSURANCE")) {
          await tx.repairOrderLine.create({
            data: {
              organizationId: org.id,
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
              sortOrder: sortOrder++,
            },
          });
        }
      }
      await recomputeTotals(tx, order.id, org.vatEnabled);
      await settleOrderApproval(tx, org, order.id, now);
      notifyIds.push(order.advisorId ?? "");
      if (order.status === "AWAITING_APPROVAL") {
        notifyIds.push(...(await membersWithRoles(tx, ["MANAGER"])));
      }
    }
  }

  // RG-M05-12 / A8 : items d'inspection refusés → travaux conseillés (relance future).
  if (quote.vehicleId) {
    for (const line of recomputed.lines) {
      if (line.accepted === false && line.inspectionItemId && line.type === "LABOR") {
        const existing = await tx.vehicleRecommendation.findFirst({
          where: { quoteLineId: line.id },
        });
        if (existing) continue;
        await tx.vehicleRecommendation.create({
          data: {
            organizationId: org.id,
            vehicleId: quote.vehicleId,
            customerId: quote.customerId,
            repairOrderId: quote.repairOrderId,
            inspectionItemId: line.inspectionItemId,
            quoteLineId: line.id,
            label: line.groupLabel ?? line.description,
            severity: line.priority === "URGENT" ? "URGENT" : "WATCH",
            estimatedAmount: line.lineTotal,
            remindAt: addDays(businessDate(now, org.timeZone), 90),
          },
        });
      }
    }
  }

  // M10 : arrêt des relances de ce devis.
  await tx.reminder.updateMany({
    where: {
      quoteId: quote.id,
      type: "QUOTE_FOLLOWUP",
      status: { in: ["PLANNED", "NEEDS_APPROVAL", "SNOOZED"] },
    },
    data: { status: "CANCELLED", skippedReason: "Devis décidé." },
  });

  const payload = {
    quoteId: quote.id,
    number: quote.number,
    version: quote.version,
    customerId: quote.customerId,
    vehicleId: quote.vehicleId,
    repairOrderId: quote.repairOrderId,
    status: result.status,
    acceptedTotal: recomputed.totals.acceptedTotal,
    declinedTotal: recomputed.totals.declinedTotal,
    channel: meta.channel,
  };
  await emitDomainEvent(
    tx as never,
    org.id,
    result.status === "DECLINED" ? "quote.declined" : "quote.accepted",
    payload,
  );

  // §11 : montant très élevé → notification au gérant.
  if (recomputed.totals.acceptedTotal >= SIGNATURE_ALWAYS_REQUIRED_ABOVE) {
    notifyIds.push(...(await membersWithRoles(tx, ["OWNER", "MANAGER"])));
  }

  return {
    quote: updated,
    lines: recomputed.lines,
    status: result.status,
    acceptedTotal: recomputed.totals.acceptedTotal,
    declinedTotal: recomputed.totals.declinedTotal,
    depositAmount: deposit,
    notifyMembershipIds: [...new Set(notifyIds.filter(Boolean))],
  };
}

/** OR AWAITING_APPROVAL sans ligne en attente → `approve` ou `decline_all` (système). */
export async function settleOrderApproval(
  tx: Tx,
  org: OrgQuoteContext,
  repairOrderId: string,
  now: Date,
): Promise<void> {
  const order = await tx.repairOrder.findFirstOrThrow({ where: { id: repairOrderId } });
  if (order.status !== "AWAITING_APPROVAL") return;
  const lines = await tx.repairOrderLine.findMany({ where: { repairOrderId } });
  if (lines.some((l) => l.status !== "CANCELLED" && l.approval === "PENDING")) return;
  const facts = await transitionFacts(tx, order);
  for (const transition of ["approve", "decline_all"] as const) {
    const result = canTransition(order, lines, transition, {
      permissions: new Set(),
      system: true,
      qcRequired: org.settings.qcRequired,
      ...facts,
    });
    if (result.ok) {
      await applyTransition(tx, {
        order,
        to: result.to,
        transition,
        reason: "Décision du client sur le devis",
        membershipId: null,
        now,
      });
      return;
    }
  }
}

/** US-M05-07 : confirmation écrite automatique après un accord au téléphone / en personne. */
export async function sendDecisionConfirmation(
  tx: Tx,
  org: OrgQuoteContext,
  quote: Quote,
  lines: readonly QuoteLine[],
  customer: Customer,
  sentById: string | null,
  now: Date,
): Promise<{ messageId: string | null; note: string | null }> {
  const time = new Intl.DateTimeFormat("fr-FR", {
    timeZone: org.timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  const labelOf = (l: QuoteLine) => l.groupLabel ?? l.description;
  const seen = new Set<string>();
  const accepted: { label: string; total: number }[] = [];
  const declined: { label: string }[] = [];
  for (const line of lines) {
    const key = line.groupKey ?? line.id;
    if (seen.has(key)) {
      if (line.accepted) {
        const entry = accepted.find((a) => a.label === labelOf(line));
        if (entry) entry.total += line.lineTotal;
      }
      continue;
    }
    seen.add(key);
    if (line.accepted) accepted.push({ label: labelOf(line), total: line.lineTotal });
    else declined.push({ label: labelOf(line) });
  }
  const body = phoneConfirmationMessage({ time, accepted, declined });
  const message = await sendQuoteMessage(tx, org.id, {
    idempotencyKey: `quote:${quote.id}:confirm:${now.getTime()}`,
    recipient: {
      customerId: customer.id,
      name: customer.displayName,
      phone: customer.phone,
      whatsapp: customer.whatsappPhone,
      email: customer.email,
    },
    body,
    subject: `Confirmation de votre accord — devis ${quote.number}`,
    sentById,
    channels: ["WHATSAPP", "SMS", "EMAIL"],
  });
  if (!message) {
    return { messageId: null, note: "Confirmation écrite impossible (client sans mobile)." };
  }
  return { messageId: message.id, note: null };
}

// ───────────── Versions (RG-M05-01 / US-M05-08) ─────────────

export async function createQuoteVersion(
  tx: Tx,
  org: OrgQuoteContext,
  quote: Quote,
  input: { refreshPrices?: boolean; createdById: string | null; now: Date },
): Promise<{ quote: Quote; priceChanges: { lineId: string; from: number; to: number }[] }> {
  const customer = await tx.customer.findFirstOrThrow({ where: { id: quote.customerId } });
  const lines = await tx.quoteLine.findMany({
    where: { quoteId: quote.id },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  const createdOn = businessDate(input.now, org.timeZone);
  const validUntil = computeValidUntil({
    createdOn,
    settings: org.quotes,
    customerType: customer.type,
    isInsurance: Boolean(quote.insuranceClaimId),
  });
  const next = await tx.quote.create({
    data: {
      organizationId: org.id,
      siteId: quote.siteId,
      number: quote.number,
      version: quote.version + 1,
      customerId: quote.customerId,
      vehicleId: quote.vehicleId,
      repairOrderId: quote.repairOrderId,
      inspectionId: quote.inspectionId,
      insuranceClaimId: quote.insuranceClaimId,
      origin: quote.origin,
      status: "DRAFT",
      validUntil,
      notes: quote.notes,
      createdById: input.createdById,
      supersedesId: quote.id,
      globalDiscountRate: quote.globalDiscountRate,
      globalDiscountAmount: quote.globalDiscountAmount,
      discountReason: quote.discountReason,
      discountApprovalStatus:
        quote.discountApprovalStatus === "APPROVED" ? "APPROVED" : quote.discountApprovalStatus,
      discountApprovedById: quote.discountApprovedById,
      recipientContactId: quote.recipientContactId,
      customerPoNumber: quote.customerPoNumber,
    },
  });
  const priceChanges: { lineId: string; from: number; to: number }[] = [];
  for (const line of lines) {
    let unitPrice = line.unitPrice;
    let quantity = line.quantity;
    if (input.refreshPrices) {
      if (line.laborOperationId) {
        const op = await tx.laborOperation.findFirst({ where: { id: line.laborOperationId } });
        if (op) {
          const pricing = laborLinePricing(op, org.laborRates);
          unitPrice = pricing.unitPrice;
          if (op.fixedPrice != null) quantity = 1;
        }
      } else if (line.productId && !line.isCustomerSupplied) {
        const product = await tx.product.findFirst({ where: { id: line.productId } });
        if (product) unitPrice = product.salePrice;
      }
    }
    const created = await tx.quoteLine.create({
      data: {
        organizationId: org.id,
        quoteId: next.id,
        type: line.type,
        productId: line.productId,
        laborOperationId: line.laborOperationId,
        description: line.description,
        quantity,
        unitPrice,
        discountRate: line.discountRate,
        vatRate: line.vatRate,
        isOptional: line.isOptional,
        priority: line.priority,
        payer: line.payer,
        sortOrder: line.sortOrder,
        groupKey: line.groupKey,
        groupLabel: line.groupLabel,
        requiresGroupKey: line.requiresGroupKey,
        customerExplanation: line.customerExplanation,
        inspectionItemId: line.inspectionItemId,
        photoAttachmentIds: line.photoAttachmentIds,
        costPrice: line.costPrice,
        isCustomerSupplied: line.isCustomerSupplied,
      },
    });
    if (unitPrice !== line.unitPrice) {
      priceChanges.push({ lineId: created.id, from: line.unitPrice, to: unitPrice });
    }
  }
  await tx.quote.update({ where: { id: quote.id }, data: { supersededAt: input.now } });
  await revokeQuoteLinks(tx, quote.id, "Devis mis à jour (nouvelle version).", input.now);
  await tx.reminder.updateMany({
    where: {
      quoteId: quote.id,
      type: "QUOTE_FOLLOWUP",
      status: { in: ["PLANNED", "NEEDS_APPROVAL", "SNOOZED"] },
    },
    data: { status: "CANCELLED", skippedReason: "Nouvelle version du devis." },
  });
  const recomputed = await recomputeQuoteTotals(tx, org, next.id);
  return { quote: recomputed.quote, priceChanges };
}

/** Frise (§7) : créé → envoyé → vu → relances → décision → converti. */
export function quoteTimeline(
  quote: Quote,
  reminders: { sentAt: Date | null; stepKey: string }[],
): { key: string; at: Date; label: string }[] {
  const steps: { key: string; at: Date; label: string }[] = [
    { key: "created", at: quote.createdAt, label: "Créé" },
  ];
  if (quote.sentAt) steps.push({ key: "sent", at: quote.sentAt, label: `Envoyé (${quote.sentVia ?? "—"})` });
  if (quote.viewedAt) steps.push({ key: "viewed", at: quote.viewedAt, label: "Vu par le client" });
  for (const r of reminders) {
    if (r.sentAt) steps.push({ key: `reminder:${r.stepKey}`, at: r.sentAt, label: `Relance ${r.stepKey}` });
  }
  if (quote.decidedAt) {
    steps.push({ key: "decided", at: quote.decidedAt, label: `Décision (${quote.decisionChannel ?? "—"})` });
  }
  if (quote.convertedAt) steps.push({ key: "converted", at: quote.convertedAt, label: "Converti" });
  if (quote.supersededAt) steps.push({ key: "superseded", at: quote.supersededAt, label: "Remplacé par une nouvelle version" });
  return steps.sort((a, b) => a.at.getTime() - b.at.getTime());
}
