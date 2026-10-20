// M16 — orchestration des dossiers sinistre : contexte, numérotation SIN (par site, A4), Customer
// lié à chaque compagnie (RG-M16-01), lignes du dossier, répartition (RG-M16-03) et double
// facturation en brouillons M08 (RG-M16-04). Les règles viennent de `@atelieros/core/claims`.
import { TRPCError } from "@trpc/server";
import {
  assertInvoiceable,
  buildClaimInvoices,
  businessDate,
  computeDraftTotals,
  DEFAULT_NUMBERING_CONFIG,
  isDomainError,
  renderNumberingPattern,
  splitRepairOrderLines,
  splitClaim,
  ttcToHt,
  type ClaimInvoices,
  type DraftInvoiceLine,
  type NumberingConfig,
  type RepairOrderLineForInvoice,
} from "@atelieros/core";
import {
  adminDb,
  tenantSequenceStore,
  type InsuranceClaim,
  type InsuranceCompany,
  type ScopedTenantClient,
} from "@atelieros/db";
import { requireSite } from "../trpc";
import { createDraft, loadOrgBillingContext, type OrgBillingContext } from "../billing/service";
import type { OrgCtx } from "../billing/context";

export type Tx = ScopedTenantClient;

export interface ClaimsSettings {
  releaseBeforeDeductible: boolean;
  defaultPaymentTermsDays: number;
  autoSendFollowUps: boolean;
}

export function claimsSettingsFrom(raw: unknown): ClaimsSettings {
  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const c =
    root.claims && typeof root.claims === "object" ? (root.claims as Record<string, unknown>) : {};
  const terms = c.defaultPaymentTermsDays;
  return {
    releaseBeforeDeductible: c.releaseBeforeDeductible === true,
    defaultPaymentTermsDays:
      Number.isInteger(terms) && (terms as number) >= 0 ? (terms as number) : 60,
    autoSendFollowUps: c.autoSendFollowUps === true,
  };
}

export interface OrgClaimsContext extends OrgBillingContext {
  claims: ClaimsSettings;
  sinNumbering: NumberingConfig;
}

export async function loadOrgClaimsContext(organizationId: string): Promise<OrgClaimsContext> {
  const billing = await loadOrgBillingContext(organizationId);
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { settings: true },
  });
  const raw = org.settings as Record<string, unknown> | null;
  const numbering =
    raw && typeof raw.numbering === "object" && raw.numbering
      ? ((raw.numbering as Record<string, Partial<NumberingConfig>>).SIN ?? {})
      : {};
  return {
    ...billing,
    claims: claimsSettingsFrom(raw),
    sinNumbering: { ...DEFAULT_NUMBERING_CONFIG.SIN, ...numbering },
  };
}

/** Le module sinistres n'existe qu'en gestion complète (M16 §11). */
export function assertClaimsModule(org: Pick<OrgClaimsContext, "operatingMode">): void {
  if (org.operatingMode === "REMINDERS_ONLY") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "MODULE_DISABLED : les dossiers sinistre sont disponibles en gestion complète.",
    });
  }
}

export function claimNotFound(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "Dossier sinistre introuvable." });
}

export function bad(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

export function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (isDomainError(error)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error.message,
        cause: { code: error.code },
      });
    }
    throw error;
  }
}

export async function loadClaim(tx: Tx, ctx: OrgCtx, id: string): Promise<InsuranceClaim> {
  const claim = await tx.insuranceClaim.findFirst({ where: { id, deletedAt: null } });
  if (!claim) claimNotFound();
  requireSite(ctx, claim.siteId);
  return claim;
}

/** RG-M16-02 / A4 — `SIN-{SITE}-{AAAA}-{NNNNN}`, séquence par site et par année. */
export async function nextClaimNumber(
  tx: Tx,
  org: OrgClaimsContext,
  siteId: string,
  now: Date,
): Promise<string> {
  const site = await tx.site.findFirst({ where: { id: siteId }, select: { code: true } });
  if (!site) bad("Site introuvable.");
  const year = businessDate(now, org.timeZone).getUTCFullYear();
  const value = await tenantSequenceStore(tx).getAndIncrement({
    organizationId: org.id,
    siteId: org.sinNumbering.perSite ? siteId : null,
    docType: "SIN",
    year: org.sinNumbering.resetYearly ? year : 0,
  });
  return renderNumberingPattern(org.sinNumbering, { siteCode: site.code, year, value });
}

/**
 * RG-M16-01 — chaque compagnie est facturée comme un `Customer` COMPANY lié, tenu à jour (raison
 * sociale, NCC/RCCM pour la FNE, adresse, contact, délai de paiement contractuel).
 */
export async function ensureInsurerCustomer(tx: Tx, insurer: InsuranceCompany): Promise<string> {
  const data = {
    type: "COMPANY" as const,
    displayName: insurer.legalName || insurer.name,
    companyName: insurer.legalName || insurer.name,
    ncc: insurer.ncc,
    rccm: insurer.rccm,
    address: insurer.address,
    email: insurer.accountingEmail || insurer.claimsEmail || insurer.email,
    phone: insurer.claimsPhone || insurer.phone,
    paymentTermsDays: insurer.paymentTermsDays,
  };
  if (insurer.customerId) {
    await tx.customer.update({ where: { id: insurer.customerId }, data });
    return insurer.customerId;
  }
  const customer = await tx.customer.create({
    data: {
      ...data,
      organizationId: insurer.organizationId,
      source: "assureur",
      // Les relances de l'assureur passent par M16 (ClaimFollowUp), jamais par M10.
      remindersConsent: false,
      doNotRemind: true,
      doNotRemindReason: "Compagnie d'assurance : relances gérées par le module sinistres.",
    },
  });
  await tx.insuranceCompany.update({
    where: { id: insurer.id },
    data: { customerId: customer.id },
  });
  return customer.id;
}

/** OR rattaché au dossier (le plus récent non annulé). */
export async function claimRepairOrder(tx: Tx, claimId: string) {
  return tx.repairOrder.findFirst({
    where: { insuranceClaimId: claimId, deletedAt: null, status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
  });
}

/** Devis assurance retenu, sinon la dernière version liée au dossier. */
export async function claimQuote(tx: Tx, claim: Pick<InsuranceClaim, "id" | "quoteId">) {
  if (claim.quoteId) {
    const retained = await tx.quote.findFirst({ where: { id: claim.quoteId, deletedAt: null } });
    if (retained) return retained;
  }
  return tx.quote.findFirst({
    where: { insuranceClaimId: claim.id, deletedAt: null, supersededAt: null },
    orderBy: { createdAt: "desc" },
  });
}

export interface ClaimLines {
  source: "repair_order" | "quote" | "none";
  insurance: DraftInvoiceLine[];
  customer: DraftInvoiceLine[];
  repairOrderId: string | null;
  quoteId: string | null;
}

/** Lignes du dossier : celles de l'OR (travaux réels) ou, à défaut, celles du devis retenu. */
export async function claimLines(tx: Tx, claim: InsuranceClaim): Promise<ClaimLines> {
  const order = await claimRepairOrder(tx, claim.id);
  if (order) {
    const lines = await tx.repairOrderLine.findMany({
      where: { repairOrderId: order.id },
      include: { product: { select: { averageCost: true } } },
    });
    const split = splitRepairOrderLines(
      lines.map((l): RepairOrderLineForInvoice => ({
        ...l,
        productAverageCost: l.product?.averageCost || null,
      })),
    );
    return {
      source: "repair_order",
      insurance: split.insurance,
      customer: split.customer,
      repairOrderId: order.id,
      quoteId: claim.quoteId,
    };
  }
  const quote = await claimQuote(tx, claim);
  if (!quote)
    return { source: "none", insurance: [], customer: [], repairOrderId: null, quoteId: null };
  const lines = await tx.quoteLine.findMany({
    where: { quoteId: quote.id, accepted: { not: false } },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  const toDraft = (l: (typeof lines)[number]): DraftInvoiceLine => ({
    type: l.type,
    productId: l.productId,
    laborOperationId: l.laborOperationId,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.isCustomerSupplied ? 0 : l.unitPrice,
    discountRate: l.discountRate,
    vatRate: l.vatRate,
    payer: l.payer === "INSURANCE" ? "INSURANCE" : "CUSTOMER",
    repairOrderLineId: null,
    depositInvoiceId: null,
    unitCost: l.costPrice ?? null,
    fixed: null,
  });
  return {
    source: "quote",
    insurance: lines.filter((l) => l.payer === "INSURANCE").map(toDraft),
    customer: lines.filter((l) => l.payer === "CUSTOMER").map(toDraft),
    repairOrderId: null,
    quoteId: quote.id,
  };
}

/** Lignes de l'écart absorbé par le garage (RG-M16-05 c) : ligne négative sur la facture assurance. */
function garageGapLine(amount: number, vatRate: number, claimNumber: string): DraftInvoiceLine {
  const { ht, vat } = ttcToHt(amount, vatRate);
  return {
    type: "FEE",
    productId: null,
    laborOperationId: null,
    description: `Geste commercial garage — écart non pris en charge (sinistre ${claimNumber})`,
    quantity: 1,
    unitPrice: -ht,
    discountRate: 0,
    vatRate,
    payer: "INSURANCE",
    repairOrderLineId: null,
    depositInvoiceId: null,
    unitCost: null,
    fixed: { lineSubtotal: -ht, lineVat: -vat },
  };
}

/** Écart absorbé par le garage (stocké dans la chronologie lors de l'accord). */
export function absorbedGap(claim: InsuranceClaim, insuranceTotal: number): number {
  if (claim.gapHandling !== "GARAGE" || claim.approvedAmount == null) return 0;
  return Math.max(0, insuranceTotal - claim.approvedAmount);
}

/** RG-M16-03/04 — aperçu des deux factures (ou simple répartition sans lignes). */
export async function previewClaim(
  tx: Tx,
  org: OrgBillingContext,
  claim: InsuranceClaim,
  insuredName: string,
): Promise<{
  lines: ClaimLines;
  invoices: ClaimInvoices | null;
  split: ReturnType<typeof splitClaim>;
}> {
  const lines = await claimLines(tx, claim);
  if (lines.insurance.length === 0) {
    return {
      lines,
      invoices: null,
      split: splitClaim({
        insuranceTotal: 0,
        deductible: claim.deductible,
        depreciation: claim.depreciationAmount,
        gap: claim.gapAmount,
        approvedAmount: claim.approvedAmount,
      }),
    };
  }
  const vatRate = org.vatEnabled ? org.vatRate : 0;
  const base = { vatEnabled: org.vatEnabled };
  const E = computeDraftTotals(lines.insurance, base).totals.total;
  const gap = absorbedGap(claim, E);
  const insurance =
    gap > 0 ? [...lines.insurance, garageGapLine(gap, vatRate, claim.number)] : lines.insurance;
  const invoices = guard(() =>
    buildClaimInvoices({
      insuranceLines: insurance,
      customerLines: lines.customer,
      deductible: claim.deductible,
      depreciation: claim.depreciationAmount,
      gap: claim.gapAmount,
      vatPaidBy: claim.vatPaidBy === "CUSTOMER" ? "CUSTOMER" : "INSURANCE",
      vatRate,
      vatEnabled: org.vatEnabled,
      labels: { claimNumber: claim.number, insuredName, policyNumber: claim.policyNumber },
    }),
  );
  return {
    lines,
    invoices,
    split: {
      ...splitClaim({
        insuranceTotal: E,
        deductible: claim.deductible,
        depreciation: claim.depreciationAmount,
        gap: claim.gapAmount,
        customerTotal: invoices.customerLinesTotal,
        approvedAmount: claim.approvedAmount,
      }),
      insurerShare: invoices.insurer.totals.total,
      customerShare: invoices.customer.totals.total,
    },
  };
}

/**
 * US-M16-06 — « Facturer le sinistre » : brouillon assurance (Customer de la compagnie,
 * `billTo = INSURANCE`) et brouillon client (franchise, vétusté, écart, lignes client).
 */
export async function createClaimInvoices(
  tx: Tx,
  org: OrgClaimsContext,
  claim: InsuranceClaim,
  membershipId: string,
) {
  const existing = await tx.invoice.findMany({
    where: { insuranceClaimId: claim.id, type: "INVOICE", status: { not: "VOID" } },
  });
  if (existing.some((i) => i.status !== "DRAFT")) {
    bad("Ce dossier est déjà facturé : corrigez par un avoir si besoin.");
  }
  const attachments = await tx.attachment.findMany({
    where: { entity: "claim", entityId: claim.id },
    select: { kind: true },
  });
  guard(() =>
    assertInvoiceable({
      claimNumber: claim.claimNumber,
      attachmentKinds: attachments.map((a) => a.kind),
    }),
  );
  if (!["APPROVED", "REPAIRING"].includes(claim.status)) {
    bad("Le dossier doit être accordé par l'assureur avant d'être facturé.");
  }
  const [customer, insurer] = await Promise.all([
    tx.customer.findFirstOrThrow({ where: { id: claim.customerId } }),
    tx.insuranceCompany.findFirstOrThrow({ where: { id: claim.insuranceCompanyId } }),
  ]);
  const preview = await previewClaim(tx, org, claim, customer.displayName);
  if (!preview.invoices)
    bad("Aucune ligne à la charge de l'assurance sur l'OR ou le devis du dossier.");
  // Brouillons précédents (ex. lignes de l'OR modifiées depuis) : remplacés.
  for (const draft of existing) {
    await tx.invoiceLine.deleteMany({ where: { invoiceId: draft.id } });
    await tx.invoice.delete({ where: { id: draft.id } });
  }
  const insurerCustomerId = await ensureInsurerCustomer(tx, insurer);
  const siteId =
    claim.siteId ?? (await tx.site.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const order = preview.lines.repairOrderId
    ? await tx.repairOrder.findFirst({ where: { id: preview.lines.repairOrderId } })
    : null;
  const header = {
    siteId,
    vehicleId: claim.vehicleId,
    repairOrderId: preview.lines.repairOrderId,
    quoteId: preview.lines.quoteId,
    insuranceClaimId: claim.id,
    mileage: order?.mileageIn ?? null,
    createdById: membershipId,
  };
  const insurerNote = [
    `Sinistre ${claim.number} — n° assureur ${claim.claimNumber}`,
    claim.policyNumber ? `police ${claim.policyNumber}` : null,
    `assuré ${customer.displayName}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const insurerInvoice = await createDraft(
    tx,
    org,
    { ...header, customerId: insurerCustomerId, billTo: "INSURANCE", notes: insurerNote },
    preview.invoices.insurer.lines,
  );
  const customerInvoice =
    preview.invoices.customer.lines.length > 0
      ? await createDraft(
          tx,
          org,
          {
            ...header,
            customerId: claim.customerId,
            billTo: "CUSTOMER",
            notes: `Sinistre ${claim.number}`,
          },
          preview.invoices.customer.lines,
        )
      : null;
  return { insurerInvoice, customerInvoice, split: preview.split };
}
