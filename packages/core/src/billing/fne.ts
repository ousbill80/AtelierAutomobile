// M08 §FNE — règles de la facture normalisée électronique (RG-M08-12 à RG-M08-17) : payload
// neutre transmis à l'adaptateur, cycle de vie `FneStatus`, reprises avec backoff, saisie manuelle
// et signalement des factures non certifiées. Aucune hypothèse sur l'API DGI ici : seul
// l'adaptateur `dgi_api` (packages/integrations) traduit ce payload.
import { DomainError } from "../errors";

export type FneStatusLike = "NOT_REQUIRED" | "PENDING" | "CERTIFIED" | "FAILED" | "MANUAL";
export type FneErrorKind = "transient" | "rejected";
export type FneDocumentType = "INVOICE" | "DEPOSIT" | "CREDIT_NOTE";

export const FNE_FINAL_STATUSES: readonly FneStatusLike[] = ["CERTIFIED", "MANUAL"];
/** Statuts « non certifiée » : badge, filtre et signalement (RG-M08-16). */
export const FNE_UNCERTIFIED_STATUSES: readonly FneStatusLike[] = ["PENDING", "FAILED"];

// ───────────── Payload (RG-M08-14) ─────────────

export interface FnePayloadLine {
  description: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  vatRate: number;
  totalHt: number;
  totalVat: number;
  totalTtc: number;
}

/** Objet neutre transmis à `FneProvider.certify` (01 §10). Montants en FCFA entiers, positifs. */
export interface FneInvoicePayload {
  invoiceId: string;
  /** Transmise à l'adaptateur pour éviter une double certification (RG-M08-15). */
  idempotencyKey: string;
  documentType: FneDocumentType;
  number: string;
  issuedAt: Date;
  seller: {
    ncc: string;
    legalName: string;
    taxRegime: string;
    establishmentId: string | null;
    pointOfSale: string | null;
  };
  customer: {
    name: string;
    type: "INDIVIDUAL" | "COMPANY";
    ncc: string | null;
    rccm: string | null;
    phone: string | null;
    address: string | null;
  };
  lines: FnePayloadLine[];
  totals: { subtotal: number; discountTotal: number; vatTotal: number; total: number };
  paymentMethod: string | null;
  /** Avoir : facture d'origine et son numéro FNE (RG-M08-12). */
  originalInvoice: { number: string; fneNumber: string } | null;
}

export interface BuildFnePayloadInput {
  invoice: {
    id: string;
    type: FneDocumentType;
    number: string | null;
    issuedAt: Date | null;
    subtotal: number;
    discountTotal: number;
    vatTotal: number;
    total: number;
  };
  lines: readonly {
    description: string;
    quantity: number;
    unitPrice: number;
    discountRate: number;
    vatRate: number;
    lineSubtotal: number;
    lineVat: number;
    lineTotal: number;
  }[];
  organization: {
    legalName: string | null;
    name: string;
    ncc: string | null;
    taxRegime: string;
    establishmentId?: string | null;
    pointOfSale?: string | null;
  };
  customer: {
    displayName: string;
    type: string;
    ncc: string | null;
    rccm: string | null;
    phone: string | null;
    address: string | null;
  };
  paymentMethod?: string | null;
  originalInvoice?: { number: string | null; fneNumber: string | null } | null;
}

/** RG-M08-14 — `core/fne/buildPayload` : facture, acompte ou avoir (montants en valeur absolue). */
export function buildFnePayload(input: BuildFnePayloadInput): FneInvoicePayload {
  const { invoice, organization } = input;
  if (!invoice.number || !invoice.issuedAt) {
    throw new DomainError("fne.not_issued", "Seule une facture émise peut être certifiée FNE.");
  }
  if (!organization.ncc) {
    throw new DomainError(
      "fne.missing_ncc",
      "Renseignez le NCC dans Paramètres > Entreprise avant la certification FNE.",
    );
  }
  let originalInvoice: FneInvoicePayload["originalInvoice"] = null;
  if (invoice.type === "CREDIT_NOTE") {
    const original = input.originalInvoice;
    if (!original?.number || !original.fneNumber) {
      throw new DomainError(
        "fne.original_not_certified",
        "La facture d'origine de cet avoir doit être certifiée FNE avant l'avoir.",
      );
    }
    originalInvoice = { number: original.number, fneNumber: original.fneNumber };
  }
  return {
    invoiceId: invoice.id,
    idempotencyKey: invoice.id,
    documentType: invoice.type,
    number: invoice.number,
    issuedAt: invoice.issuedAt,
    seller: {
      ncc: organization.ncc,
      legalName: organization.legalName || organization.name,
      taxRegime: organization.taxRegime,
      establishmentId: organization.establishmentId ?? null,
      pointOfSale: organization.pointOfSale ?? null,
    },
    customer: {
      name: input.customer.displayName,
      type: input.customer.type === "COMPANY" ? "COMPANY" : "INDIVIDUAL",
      ncc: input.customer.ncc,
      rccm: input.customer.rccm,
      phone: input.customer.phone,
      address: input.customer.address,
    },
    lines: input.lines.map((l) => ({
      description: l.description,
      quantity: Math.abs(l.quantity),
      unitPrice: l.unitPrice,
      discountRate: l.discountRate,
      vatRate: l.vatRate,
      totalHt: Math.abs(l.lineSubtotal),
      totalVat: Math.abs(l.lineVat),
      totalTtc: Math.abs(l.lineTotal),
    })),
    totals: {
      subtotal: Math.abs(invoice.subtotal),
      discountTotal: Math.abs(invoice.discountTotal),
      vatTotal: Math.abs(invoice.vatTotal),
      total: Math.abs(invoice.total),
    },
    paymentMethod: input.paymentMethod ?? null,
    originalInvoice,
  };
}

// ───────────── Reprises (RG-M08-15) ─────────────

const MINUTE = 60_000;
/** 10 min, 30 min, 1 h, 2 h, puis toutes les 6 h. */
export const FNE_RETRY_DELAYS_MS: readonly number[] = [
  10 * MINUTE,
  30 * MINUTE,
  60 * MINUTE,
  120 * MINUTE,
];
export const FNE_RETRY_STEADY_MS = 360 * MINUTE;
/** Délai d'attente d'un avoir dont la facture d'origine n'est pas encore certifiée. */
export const FNE_DEFER_MS = 10 * MINUTE;

/** Délai avant la prochaine tentative après `attempts` tentatives échouées (≥ 1). */
export function fneRetryDelayMs(attempts: number): number {
  if (attempts < 1) return 0;
  return FNE_RETRY_DELAYS_MS[attempts - 1] ?? FNE_RETRY_STEADY_MS;
}

export interface FneFailurePlan {
  fneStatus: "FAILED";
  fneErrorKind: FneErrorKind;
  fneError: string;
  /** `null` : rejet « définitif », pas de reprise automatique (correction humaine). */
  fneNextRetryAt: Date | null;
}

export function planFneFailure(input: {
  attempts: number;
  kind: FneErrorKind;
  message: string;
  now: Date;
}): FneFailurePlan {
  return {
    fneStatus: "FAILED",
    fneErrorKind: input.kind,
    fneError: input.message,
    fneNextRetryAt:
      input.kind === "rejected"
        ? null
        : new Date(input.now.getTime() + fneRetryDelayMs(input.attempts)),
  };
}

/** Classe une erreur d'adaptateur : `kind = "rejected"` (rejet de validation DGI) ou transitoire. */
export function classifyFneError(error: unknown): { kind: FneErrorKind; message: string } {
  const kind =
    typeof error === "object" && error !== null && (error as { kind?: unknown }).kind === "rejected"
      ? "rejected"
      : "transient";
  const raw = error instanceof Error ? error.message : String(error);
  const message =
    kind === "rejected"
      ? `Rejet de la DGI : ${raw}`
      : `Service FNE indisponible, nouvelle tentative automatique : ${raw}`;
  return { kind, message: message.slice(0, 500) };
}

export interface FneRetryCandidate {
  status: string;
  fneStatus: FneStatusLike;
  fneErrorKind: string | null;
  fneNextRetryAt: Date | null;
}

/** Le job `fne.retry` re-soumet une facture émise en attente / en échec transitoire arrivée à échéance. */
export function isFneRetryDue(invoice: FneRetryCandidate, now: Date): boolean {
  if (invoice.status === "DRAFT") return false;
  if (!FNE_UNCERTIFIED_STATUSES.includes(invoice.fneStatus)) return false;
  if (invoice.fneStatus === "FAILED" && invoice.fneErrorKind === "rejected") return false;
  if (!invoice.fneNextRetryAt) return false;
  return invoice.fneNextRetryAt.getTime() <= now.getTime();
}

/** Bouton « Réessayer » (`fne.retry`) : FAILED → PENDING, mode `api` seulement. */
export function assertCanRetryFne(input: {
  status: string;
  fneStatus: FneStatusLike;
  mode: string | null;
}): void {
  if (input.status === "DRAFT" || !FNE_UNCERTIFIED_STATUSES.includes(input.fneStatus)) {
    throw new DomainError(
      "fne.not_retryable",
      "Cette facture n'est pas en attente de certification FNE.",
    );
  }
  if (input.mode !== "api") {
    throw new DomainError(
      "fne.retry_requires_api",
      "La certification automatique demande le mode FNE « API » (Paramètres > FNE). En mode manuel, saisissez le numéro FNE.",
    );
  }
}

// ───────────── Saisie manuelle (RG-M08-17) ─────────────

export interface ManualFneInput {
  fneNumber: string;
  qrCode?: string | null;
  hasQrImage?: boolean;
}

/** PENDING/FAILED → MANUAL : numéro obligatoire, QR (contenu décodé ou image) obligatoire. */
export function validateManualFne(
  invoice: { status: string; fneStatus: FneStatusLike },
  input: ManualFneInput,
): { fneNumber: string; qrCode: string | null } {
  if (invoice.status === "DRAFT") {
    throw new DomainError("fne.not_issued", "Émettez la facture avant de saisir son numéro FNE.");
  }
  if (FNE_FINAL_STATUSES.includes(invoice.fneStatus)) {
    throw new DomainError("fne.already_certified", "Cette facture est déjà certifiée FNE.");
  }
  if (invoice.fneStatus === "NOT_REQUIRED") {
    throw new DomainError("fne.not_required", "La FNE n'est pas requise pour cette facture.");
  }
  const fneNumber = input.fneNumber.trim();
  if (fneNumber.length < 3 || fneNumber.length > 64) {
    throw new DomainError(
      "fne.invalid_number",
      "Saisissez le numéro FNE tel qu'il figure sur la plateforme DGI (3 à 64 caractères).",
    );
  }
  const qrCode = input.qrCode?.trim() || null;
  if (!qrCode && !input.hasQrImage) {
    throw new DomainError(
      "fne.qr_required",
      "Ajoutez le QR code FNE : importez son image ou collez son contenu.",
    );
  }
  if (qrCode && qrCode.length > 2_000) {
    throw new DomainError(
      "fne.qr_too_long",
      "Le contenu du QR code FNE est trop long (2 000 caractères au plus).",
    );
  }
  return { fneNumber, qrCode };
}

// ───────────── Signalement (RG-M08-16) ─────────────

export const FNE_ALERT_AFTER_MS = 60 * MINUTE;

/** Facture émise non certifiée depuis plus d'1 h → notification ACCOUNTANT et OWNER. */
export function isFneAlertDue(
  invoice: { status: string; fneStatus: FneStatusLike; issuedAt: Date | null },
  now: Date,
): boolean {
  if (invoice.status === "DRAFT" || !invoice.issuedAt) return false;
  if (!FNE_UNCERTIFIED_STATUSES.includes(invoice.fneStatus)) return false;
  return now.getTime() - invoice.issuedAt.getTime() > FNE_ALERT_AFTER_MS;
}

// ───────────── Paramètres (M15 RG-M15-18) ─────────────

export type FneModeValue = "api" | "manual" | "disabled";

/** Passage en `disabled` : motif obligatoire ; mode `api` : identifiants obligatoires. */
export function assertFneConfigChange(input: {
  from: FneModeValue | null;
  to: FneModeValue;
  reason?: string | null;
  hasCredentials: boolean;
}): void {
  if (input.to === "disabled" && input.from !== "disabled" && !input.reason?.trim()) {
    throw new DomainError(
      "fne.disable_reason_required",
      "Indiquez un motif : depuis l'arrêté n°0337 du 9 mai 2025, vos factures doivent être normalisées.",
    );
  }
  if (input.to === "api" && !input.hasCredentials) {
    throw new DomainError(
      "fne.credentials_required",
      "Renseignez les identifiants DGI pour activer la certification automatique.",
    );
  }
}
