// M08 — orchestration de la facturation : contexte d'organisation, brouillons (totaux recalculés),
// émission (numéro sans trou, échéance, FNE en attente, sorties de stock, OR facturé), solde et
// statut dérivé, avoirs. Toute règle métier vient de `@atelieros/core` (billing, money).
import { TRPCError } from "@trpc/server";
import {
  billingSettingsFrom,
  buildDepositDeduction,
  businessDate,
  computeDraftTotals,
  creditNoteEffect,
  DEFAULT_NUMBERING_CONFIG,
  deriveInvoiceStatus,
  isDomainError,
  lineBaseQty,
  planCreditNote,
  planIssue,
  renderNumberingPattern,
  type BillingSettings,
  type CreditNoteSelection,
  type DraftInvoiceLine,
  type FneModeLike,
  type NumberingConfig,
} from "@atelieros/core";
import {
  adminDb,
  collectionSettingsFrom,
  issueReservedForLine,
  issueStock,
  loadStockContext,
  releaseReservation,
  syncCustomerReceivables,
  tenantSequenceStore,
  type CollectionSettings,
  type Invoice,
  type InvoiceLine,
  type InvoiceStatus,
  type Prisma,
  type ScopedTenantClient,
} from "@atelieros/db";
import { writeAuditLog } from "../audit";
import { emitDomainEvent } from "../events/emit";
import { receivablesNow } from "../receivables/helpers";
import { applyTransition } from "../repairOrders/helpers";

export type Tx = ScopedTenantClient;

/** Horloge partagée avec M09 (`setReceivablesClock`) : paiements et factures voient le même « maintenant ». */
export function billingNow(): Date {
  return receivablesNow();
}

export interface OrgBillingContext {
  id: string;
  name: string;
  legalName: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  rccm: string | null;
  ncc: string | null;
  taxRegime: string;
  vatEnabled: boolean;
  vatRate: number;
  timeZone: string;
  operatingMode: string;
  logoUrl: string | null;
  invoiceFooter: string | null;
  settings: BillingSettings;
  collection: CollectionSettings;
  numbering: Record<"FAC" | "AV" | "REC", NumberingConfig>;
  fneMode: FneModeLike | null;
  now: Date;
  today: Date;
}

export async function loadOrgBillingContext(organizationId: string): Promise<OrgBillingContext> {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    include: { fneConfig: { select: { mode: true } } },
  });
  const raw = org.settings as Record<string, unknown> | null;
  const numberingRaw =
    raw && typeof raw.numbering === "object" && raw.numbering
      ? (raw.numbering as Record<string, Partial<NumberingConfig>>)
      : {};
  // A4 : documents fiscaux numérotés par organisation, réinitialisés chaque année.
  const fiscal = (docType: "FAC" | "AV" | "REC"): NumberingConfig => ({
    ...DEFAULT_NUMBERING_CONFIG[docType],
    ...numberingRaw[docType],
    perSite: false,
    resetYearly: true,
  });
  const now = billingNow();
  const mode = org.fneConfig?.mode;
  return {
    id: org.id,
    name: org.name,
    legalName: org.legalName,
    address: org.address,
    city: org.city,
    phone: org.phone,
    email: org.email,
    rccm: org.rccm,
    ncc: org.ncc,
    taxRegime: org.taxRegime,
    vatEnabled: org.vatEnabled,
    vatRate: org.vatRate,
    timeZone: org.timezone,
    operatingMode: org.operatingMode,
    logoUrl: org.logoUrl,
    invoiceFooter: org.invoiceFooter,
    settings: billingSettingsFrom(org.settings),
    collection: collectionSettingsFrom(org.settings),
    numbering: { FAC: fiscal("FAC"), AV: fiscal("AV"), REC: fiscal("REC") },
    fneMode: mode === "api" || mode === "manual" || mode === "disabled" ? mode : null,
    now,
    today: businessDate(now, org.timezone),
  };
}

/** La facturation complète (OR, ventes, avoirs, caisse) n'existe qu'en mode `FULL` (RG-M17). */
export function assertBillingModule(org: Pick<OrgBillingContext, "operatingMode">): void {
  if (org.operatingMode === "REMINDERS_ONLY") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "MODULE_DISABLED : la facturation est disponible en gestion complète.",
    });
  }
}

export function invoiceNotFound(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "Facture introuvable." });
}

export function bad(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

/** Traduit une `DomainError` du core en erreur tRPC (message français, code conservé). */
export function domainToTrpc(error: unknown): never {
  if (isDomainError(error)) {
    throw new TRPCError({
      code: error.code === "cash.already_open" ? "CONFLICT" : "BAD_REQUEST",
      message: error.message,
      cause: { code: error.code, details: error.details },
    });
  }
  throw error;
}

export function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    domainToTrpc(error);
  }
}

/** RG-M08-01 — numéro fiscal (FAC / AV / REC) dans la transaction appelante. */
export async function nextFiscalNumber(
  tx: Tx,
  org: Pick<OrgBillingContext, "id" | "numbering">,
  docType: "FAC" | "AV" | "REC",
  year: number,
): Promise<string> {
  const value = await tenantSequenceStore(tx).getAndIncrement({
    organizationId: org.id,
    siteId: null,
    docType,
    year,
  });
  return renderNumberingPattern(org.numbering[docType], { year, value });
}

// ───────────── Brouillons ─────────────

type LineWithRefs = InvoiceLine & {
  product: { averageCost: number; isStocked: boolean } | null;
};

/** Montants imposés : facture d'acompte (saisie TTC), déduction d'acompte, ligne d'avoir figée. */
function fixedOf(invoice: Pick<Invoice, "type">, line: InvoiceLine) {
  if (invoice.type === "DEPOSIT" || line.depositInvoiceId || invoice.type === "CREDIT_NOTE") {
    return { lineSubtotal: line.lineSubtotal, lineVat: line.lineVat };
  }
  return null;
}

export function draftOf(
  invoice: Pick<Invoice, "type">,
  line: LineWithRefs,
  roCost?: number | null,
): DraftInvoiceLine {
  const isStockLine = (line.type === "PART" || line.type === "CONSUMABLE") && line.product;
  return {
    type: line.type,
    productId: line.productId,
    laborOperationId: line.laborOperationId,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountRate: line.discountRate,
    vatRate: line.vatRate,
    payer: line.payer,
    repairOrderLineId: line.repairOrderLineId,
    depositInvoiceId: line.depositInvoiceId,
    unitCost: isStockLine ? line.product!.averageCost || null : (roCost ?? null),
    fixed: fixedOf(invoice, line),
  };
}

/** Recalcule (RG-M08-05) et écrit les montants des lignes et les totaux d'un document. */
export async function persistTotals(tx: Tx, org: OrgBillingContext, invoiceId: string) {
  const invoice = await tx.invoice.findFirstOrThrow({ where: { id: invoiceId } });
  const lines = (await tx.invoiceLine.findMany({
    where: { invoiceId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: { product: { select: { averageCost: true, isStocked: true } } },
  })) as LineWithRefs[];
  const roLineIds = lines.map((l) => l.repairOrderLineId).filter((x): x is string => !!x);
  const roCosts = new Map(
    roLineIds.length
      ? (
          await tx.repairOrderLine.findMany({
            where: { id: { in: roLineIds } },
            select: { id: true, costPrice: true },
          })
        ).map((r) => [r.id, r.costPrice])
      : [],
  );
  const computed = guard(() =>
    computeDraftTotals(
      lines.map((l) =>
        draftOf(invoice, l, l.repairOrderLineId ? roCosts.get(l.repairOrderLineId) : null),
      ),
      { vatEnabled: org.vatEnabled, vatRounding: org.settings.vatRounding },
    ),
  );
  for (const [i, c] of computed.lines.entries()) {
    const l = lines[i]!;
    if (
      l.lineSubtotal !== c.lineSubtotal ||
      l.lineVat !== c.lineVat ||
      l.lineTotal !== c.lineTotal ||
      l.costAmount !== c.costAmount ||
      l.vatRate !== c.vatRate
    ) {
      await tx.invoiceLine.update({
        where: { id: l.id },
        data: {
          lineSubtotal: c.lineSubtotal,
          lineVat: c.lineVat,
          lineTotal: c.lineTotal,
          costAmount: c.costAmount,
          vatRate: c.vatRate,
        },
      });
    }
  }
  const t = computed.totals;
  return tx.invoice.update({
    where: { id: invoiceId },
    data: {
      subtotal: t.subtotal,
      discountTotal: t.discountTotal,
      vatTotal: t.vatTotal,
      total: t.total,
      balance: invoice.type === "CREDIT_NOTE" ? 0 : t.total,
      costTotal: computed.costTotal,
    },
  });
}

export interface DraftHeader {
  siteId: string;
  customerId: string;
  vehicleId?: string | null;
  repairOrderId?: string | null;
  quoteId?: string | null;
  type?: "INVOICE" | "DEPOSIT" | "CREDIT_NOTE";
  billTo?: "CUSTOMER" | "INSURANCE";
  insuranceClaimId?: string | null;
  creditedInvoiceId?: string | null;
  mileage?: number | null;
  notes?: string | null;
  createdById: string;
}

export function lineCreateData(
  organizationId: string,
  lines: readonly DraftInvoiceLine[],
): Omit<Prisma.InvoiceLineUncheckedCreateInput, "invoiceId">[] {
  return lines.map((l, i) => ({
    organizationId,
    type: l.type,
    productId: l.productId,
    laborOperationId: l.laborOperationId,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discountRate: l.discountRate,
    vatRate: l.vatRate,
    lineSubtotal: l.fixed?.lineSubtotal ?? 0,
    lineVat: l.fixed?.lineVat ?? 0,
    lineTotal: (l.fixed?.lineSubtotal ?? 0) + (l.fixed?.lineVat ?? 0),
    payer: l.payer,
    repairOrderLineId: l.repairOrderLineId,
    depositInvoiceId: l.depositInvoiceId,
    sortOrder: i,
  }));
}

export async function createDraft(
  tx: Tx,
  org: OrgBillingContext,
  header: DraftHeader,
  lines: readonly DraftInvoiceLine[],
): Promise<Invoice> {
  const invoice = await tx.invoice.create({
    data: {
      organizationId: org.id,
      siteId: header.siteId,
      type: header.type ?? "INVOICE",
      status: "DRAFT",
      customerId: header.customerId,
      vehicleId: header.vehicleId ?? null,
      repairOrderId: header.repairOrderId ?? null,
      quoteId: header.quoteId ?? null,
      billTo: header.billTo ?? "CUSTOMER",
      insuranceClaimId: header.insuranceClaimId ?? null,
      creditedInvoiceId: header.creditedInvoiceId ?? null,
      mileage: header.mileage ?? null,
      notes: header.notes ?? null,
      createdById: header.createdById,
    },
  });
  for (const data of lineCreateData(org.id, lines)) {
    await tx.invoiceLine.create({ data: { ...data, invoiceId: invoice.id } });
  }
  return persistTotals(tx, org, invoice.id);
}

// ───────────── Solde et statut (RG-M08-10/11) ─────────────

/** Recalcule `amountPaid`, `balance` et le statut dérivé d'une facture émise. */
export async function recomputeInvoiceBalance(tx: Tx, invoiceId: string, today: Date) {
  const invoice = await tx.invoice.findFirstOrThrow({ where: { id: invoiceId } });
  if (invoice.status === "DRAFT") return invoice;
  const allocations = await tx.paymentAllocation.findMany({
    where: { invoiceId, voidedAt: null },
    select: { amount: true, paymentId: true, payment: { select: { status: true } } },
  });
  const amountPaid = allocations
    .filter((a) => !a.paymentId || a.payment?.status === "CONFIRMED")
    .reduce((s, a) => s + a.amount, 0);
  const next = deriveInvoiceStatus({
    status: invoice.status,
    type: invoice.type,
    total: invoice.total,
    amountPaid,
    creditedAmount: invoice.creditedAmount,
    dueDate: invoice.dueDate,
    today,
  });
  if (
    next.amountPaid === invoice.amountPaid &&
    next.balance === invoice.balance &&
    next.status === invoice.status
  ) {
    return invoice;
  }
  return tx.invoice.update({
    where: { id: invoiceId },
    data: {
      amountPaid: next.amountPaid,
      balance: next.balance,
      status: next.status as InvoiceStatus,
    },
  });
}

/** M09 : solde client, dossier de recouvrement et promesses après un mouvement de facture. */
export async function syncReceivables(tx: Tx, org: OrgBillingContext, customerId: string) {
  return syncCustomerReceivables(tx, {
    organizationId: org.id,
    customerId,
    today: org.today,
    now: org.now,
    settings: org.collection,
  });
}

// ───────────── Émission (RG-M08-01..04, §5) ─────────────

export interface Actor {
  organizationId: string;
  userId: string;
  membershipId: string;
  ip?: string | null;
  userAgent?: string | null;
}

export async function audit(
  actor: Actor,
  action: string,
  entity: string,
  entityId: string,
  extra: { before?: unknown; after?: unknown; reason?: string | null; siteId?: string | null } = {},
) {
  await writeAuditLog({
    organizationId: actor.organizationId,
    userId: actor.userId,
    membershipId: actor.membershipId,
    siteId: extra.siteId ?? null,
    action,
    entity,
    entityId,
    before: extra.before as never,
    after: extra.after as never,
    reason: extra.reason ?? null,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  });
}

async function lastIssuedAt(tx: Tx): Promise<Date | null> {
  const last = await tx.invoice.findFirst({
    where: { issuedAt: { not: null }, origin: "NATIVE" },
    orderBy: { issuedAt: "desc" },
    select: { issuedAt: true },
  });
  return last?.issuedAt ?? null;
}

/**
 * M07 §9 (`invoice.issued`) : toute pièce facturée doit être sortie du stock. Pour un OR, les
 * réservations encore ouvertes sont sorties puis le reste est sorti au CMP (« auto à la
 * facturation ») ; pour une vente comptoir, chaque pièce stockée est sortie à l'émission.
 */
async function issueMissingStock(
  tx: Tx,
  invoice: Invoice,
  lines: readonly LineWithRefs[],
  now: Date,
  membershipId: string,
) {
  const stockLines = lines.filter(
    (l) =>
      (l.type === "PART" || l.type === "CONSUMABLE") &&
      l.productId &&
      l.product?.isStocked &&
      l.quantity > 0 &&
      l.unitPrice >= 0,
  );
  if (stockLines.length === 0) return;
  const base = await loadStockContext(invoice.organizationId);
  const stock = { ...base, settings: { ...base.settings, allowNegative: true } };
  const reason = "auto à la facturation";
  for (const line of stockLines) {
    const product = await tx.product.findFirstOrThrow({
      where: { id: line.productId! },
      select: { id: true, quantityScale: true },
    });
    if (line.repairOrderLineId && invoice.repairOrderId) {
      const roLine = await tx.repairOrderLine.findFirst({
        where: { id: line.repairOrderLineId },
        select: { id: true, quantity: true, isCustomerSupplied: true },
      });
      if (!roLine || roLine.isCustomerSupplied) continue;
      await issueReservedForLine(tx, stock, roLine.id, now, membershipId);
      const movements = await tx.stockMovement.findMany({
        where: { repairOrderLineId: roLine.id, type: { in: ["ISSUE_TO_RO", "RETURN_FROM_RO"] } },
        select: { quantity: true },
      });
      const issued = -movements.reduce((s, m) => s + m.quantity, 0);
      const missing = lineBaseQty(roLine.quantity, product.quantityScale) - issued;
      const open = await tx.stockReservation.findMany({
        where: { repairOrderLineId: roLine.id, status: { in: ["RESERVED", "BACKORDERED"] } },
        select: { id: true },
      });
      for (const r of open) await releaseReservation(tx, stock, r.id, now);
      if (missing > 0) {
        await issueStock(
          tx,
          stock,
          {
            productId: product.id,
            siteId: invoice.siteId,
            quantity: missing,
            repairOrderId: invoice.repairOrderId,
            repairOrderLineId: roLine.id,
            createdById: membershipId,
            reason,
          },
          now,
        );
      }
    } else {
      const quantity = lineBaseQty(line.quantity, product.quantityScale);
      if (quantity <= 0) continue;
      await issueStock(
        tx,
        stock,
        {
          productId: product.id,
          siteId: invoice.siteId,
          quantity,
          createdById: membershipId,
          reason: `Vente ${invoice.number ?? ""}`.trim(),
        },
        now,
      );
    }
  }
}

/** Ajoute les lignes de déduction des acomptes choisis (US-M08-03). */
async function applyDeposits(
  tx: Tx,
  org: OrgBillingContext,
  invoice: Invoice,
  depositIds: readonly string[],
) {
  const existing = await tx.invoiceLine.count({ where: { invoiceId: invoice.id } });
  let order = existing;
  for (const depositId of [...new Set(depositIds)]) {
    const deposit = await tx.invoice.findFirst({
      where: { id: depositId },
      include: { lines: { select: { vatRate: true }, take: 1 } },
    });
    if (!deposit) bad("Acompte introuvable.");
    const deducted = await tx.invoiceLine.count({
      where: { depositInvoiceId: deposit.id, invoice: { status: { not: "VOID" } } },
    });
    const line = guard(() =>
      buildDepositDeduction(
        {
          id: deposit.id,
          number: deposit.number,
          type: deposit.type,
          status: deposit.status,
          customerId: deposit.customerId,
          subtotal: deposit.subtotal,
          vatTotal: deposit.vatTotal,
          vatRate: deposit.lines[0]?.vatRate ?? (org.vatEnabled ? org.vatRate : 0),
          alreadyDeducted: deducted > 0,
        },
        invoice.customerId,
      ),
    );
    const [data] = lineCreateData(org.id, [line]);
    await tx.invoiceLine.create({ data: { ...data!, sortOrder: order++, invoiceId: invoice.id } });
  }
}

export async function issueInvoice(
  tx: Tx,
  actor: Actor,
  org: OrgBillingContext,
  invoiceId: string,
  applyDepositIds: readonly string[] = [],
) {
  const draft = await tx.invoice.findFirst({ where: { id: invoiceId } });
  if (!draft) invoiceNotFound();
  if (draft.status !== "DRAFT") bad("Cette facture est déjà émise.");
  if (applyDepositIds.length > 0) {
    if (draft.type !== "INVOICE") bad("Un acompte ne se déduit que d'une facture.");
    await applyDeposits(tx, org, draft, applyDepositIds);
  }
  const invoice = await persistTotals(tx, org, draft.id);
  const lines = (await tx.invoiceLine.findMany({
    where: { invoiceId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: { product: { select: { averageCost: true, isStocked: true } } },
  })) as LineWithRefs[];
  const customer = await tx.customer.findFirstOrThrow({ where: { id: invoice.customerId } });
  const last = await lastIssuedAt(tx);
  const plan = guard(() =>
    planIssue({
      invoice: {
        status: invoice.status,
        type: invoice.type,
        total: invoice.total,
        lineCount: lines.length,
      },
      organization: {
        legalName: org.legalName,
        ncc: org.ncc,
        rccm: org.rccm,
        address: org.address,
        phone: org.phone,
        taxRegime: org.taxRegime,
      },
      now: org.now,
      timeZone: org.timeZone,
      lastIssuedAt: last,
      paymentTermsDays: invoice.billTo === "CUSTOMER" ? customer.paymentTermsDays : 30,
      fneMode: org.fneMode,
    }),
  );
  const number = await nextFiscalNumber(tx, org, plan.docType, plan.year);
  await tx.invoice.update({
    where: { id: invoice.id },
    data: {
      number,
      status: "ISSUED",
      issuedAt: plan.issuedAt,
      dueDate: plan.dueDate,
      fneStatus: plan.fneStatus,
    },
  });
  const issued = await recomputeInvoiceBalance(tx, invoice.id, org.today);
  if (issued.type !== "CREDIT_NOTE") {
    await issueMissingStock(tx, issued, lines, org.now, actor.membershipId);
  }
  if (issued.repairOrderId) {
    const order = await tx.repairOrder.findFirst({ where: { id: issued.repairOrderId } });
    // M04 §5 : `invoice_issued` fait passer un OR restitué en INVOICED ; un OR encore READY
    // passera INVOICED à sa restitution (la facture émise y est constatée).
    if (order?.status === "DELIVERED") {
      await applyTransition(tx, {
        order,
        to: "INVOICED",
        transition: "invoice_issued",
        membershipId: actor.membershipId,
        now: org.now,
      });
    }
  }
  if (issued.quoteId && issued.type === "INVOICE") {
    await tx.quote.updateMany({
      where: { id: issued.quoteId, status: { in: ["ACCEPTED", "PARTIALLY_ACCEPTED"] } },
      data: { status: "CONVERTED", convertedAt: org.now },
    });
  }
  await emitDomainEvent(tx as never, org.id, "invoice.issued", {
    invoiceId: issued.id,
    number,
    customerId: issued.customerId,
    repairOrderId: issued.repairOrderId,
    total: issued.total,
    fneStatus: issued.fneStatus,
  });
  await audit(actor, "invoice.issued", "Invoice", issued.id, {
    siteId: issued.siteId,
    after: { number, total: issued.total, dueDate: plan.dueDate.toISOString().slice(0, 10) },
  });
  if (issued.billTo === "CUSTOMER" && issued.type !== "CREDIT_NOTE") {
    await syncReceivables(tx, org, issued.customerId);
  }
  return tx.invoice.findFirstOrThrow({ where: { id: issued.id } });
}

// ───────────── Avoirs (US-M08-04, RG-M08-12/13) ─────────────

export async function createCreditNote(
  tx: Tx,
  actor: Actor,
  org: OrgBillingContext,
  input: { invoiceId: string; selection: "FULL" | CreditNoteSelection[]; reason: string },
) {
  const original = await tx.invoice.findFirst({ where: { id: input.invoiceId } });
  if (!original) invoiceNotFound();
  if (original.status === "DRAFT") {
    bad("Une facture brouillon ne s'annule pas par avoir : modifiez-la ou supprimez-la.");
  }
  if (original.type === "CREDIT_NOTE") bad("Un avoir ne peut pas lui-même être crédité.");
  if (original.status === "VOID") bad("Cette facture est déjà annulée par un avoir total.");
  const lines = await tx.invoiceLine.findMany({
    where: { invoiceId: original.id },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  const plan = guard(() =>
    planCreditNote({
      invoice: { total: original.total, creditedAmount: original.creditedAmount, lines },
      selection: input.selection,
      vatEnabled: org.vatEnabled,
    }),
  );
  const credit = await tx.invoice.create({
    data: {
      organizationId: org.id,
      siteId: original.siteId,
      type: "CREDIT_NOTE",
      status: "DRAFT",
      customerId: original.customerId,
      vehicleId: original.vehicleId,
      repairOrderId: original.repairOrderId,
      creditedInvoiceId: original.id,
      billTo: original.billTo,
      insuranceClaimId: original.insuranceClaimId,
      mileage: original.mileage,
      notes: input.reason,
      createdById: actor.membershipId,
    },
  });
  for (const [i, l] of plan.lines.entries()) {
    await tx.invoiceLine.create({
      data: {
        organizationId: org.id,
        invoiceId: credit.id,
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
        costAmount: l.costAmount,
        payer: l.payer,
        sortOrder: i,
      },
    });
  }
  await tx.invoice.update({
    where: { id: credit.id },
    data: {
      subtotal: plan.totals.subtotal,
      discountTotal: plan.totals.discountTotal,
      vatTotal: plan.totals.vatTotal,
      total: plan.totals.total,
      balance: 0,
      costTotal: plan.lines.reduce((s, l) => s + l.costAmount, 0),
    },
  });
  // Émission immédiate de l'avoir : numéro AV, FNE (RG-M08-12 : toujours soumis).
  const day = businessDate(org.now, org.timeZone);
  const number = await nextFiscalNumber(tx, org, "AV", day.getUTCFullYear());
  await tx.invoice.update({
    where: { id: credit.id },
    data: {
      number,
      status: "ISSUED",
      issuedAt: org.now,
      dueDate: day,
      fneStatus: org.fneMode === "disabled" ? "NOT_REQUIRED" : "PENDING",
    },
  });
  const effect = creditNoteEffect({
    total: original.total,
    amountPaid: original.amountPaid,
    creditedAmount: original.creditedAmount,
    amount: plan.amount,
  });
  await tx.invoice.update({
    where: { id: original.id },
    data: {
      creditedAmount: effect.creditedAmount,
      ...(plan.isFull ? { status: "VOID", voidedAt: org.now, voidReason: input.reason } : {}),
    },
  });
  const updated = await recomputeInvoiceBalance(tx, original.id, org.today);
  if (effect.customerCredit > 0) {
    await tx.customerCredit.create({
      data: {
        organizationId: org.id,
        customerId: original.customerId,
        sourceType: "credit_note",
        sourceId: credit.id,
        amount: effect.customerCredit,
        remaining: effect.customerCredit,
      },
    });
  }
  await emitDomainEvent(tx as never, org.id, "invoice.credit_note_issued", {
    invoiceId: original.id,
    creditNoteId: credit.id,
    number,
    amount: plan.amount,
  });
  if (plan.isFull) {
    await emitDomainEvent(tx as never, org.id, "invoice.voided", {
      invoiceId: original.id,
      creditNoteId: credit.id,
    });
  }
  await audit(actor, "invoice.credit_note", "Invoice", original.id, {
    siteId: original.siteId,
    before: { status: original.status, balance: original.balance },
    after: {
      creditNote: number,
      amount: plan.amount,
      status: updated.status,
      customerCredit: effect.customerCredit,
    },
    reason: input.reason,
  });
  if (original.billTo === "CUSTOMER") await syncReceivables(tx, org, original.customerId);
  return {
    creditNote: await tx.invoice.findFirstOrThrow({ where: { id: credit.id } }),
    invoice: updated,
  };
}
