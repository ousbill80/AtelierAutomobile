/**
 * RG-M13-18 — ordre de correspondance et dédoublonnage. Fonctions pures :
 * elles ne consultent jamais la base elles-mêmes (le worker exécute les
 * requêtes avec les clés renvoyées ici).
 */

export interface FileDedupeMerge {
  rowNumber: number;
  mergedWithRowNumber: number;
  key: string;
}

export interface FileDedupeResult<T> {
  /** Ligne gagnante (la dernière) pour chaque clé rencontrée. */
  winners: Map<string, { row: T; rowNumber: number }>;
  /** Lignes précédentes écartées, avec le numéro de la ligne qui les remplace. */
  merged: FileDedupeMerge[];
}

/**
 * Dédoublonne des lignes **au sein du même fichier** : en cas de clé
 * identique, la dernière ligne gagne, les précédentes sont marquées
 * « fusionnée avec la ligne N » (RG-M13-18). Les lignes sans clé (retournée
 * `null` par `keyFn`) ne sont jamais fusionnées entre elles.
 */
export function dedupeRowsInFile<T>(
  rows: readonly T[],
  keyFn: (row: T) => string | null,
): FileDedupeResult<T> {
  const lastIndexByKey = new Map<string, number>();

  rows.forEach((row, index) => {
    const key = keyFn(row);
    if (key === null) return;
    lastIndexByKey.set(key, index);
  });

  const winners = new Map<string, { row: T; rowNumber: number }>();
  const merged: FileDedupeMerge[] = [];

  rows.forEach((row, index) => {
    const key = keyFn(row);
    if (key === null) return;

    const winningIndex = lastIndexByKey.get(key);
    if (winningIndex === index) {
      winners.set(key, { row, rowNumber: index + 1 });
    } else if (winningIndex !== undefined) {
      merged.push({ rowNumber: index + 1, mergedWithRowNumber: winningIndex + 1, key });
    }
  });

  return { winners, merged };
}

// ─────────────── Clés de correspondance par entité (RG-M13-18) ───────────────

export type CustomerMatchStrategy = "external_ref" | "phone" | "email" | "ncc" | "none";

export interface CustomerMatchKey {
  strategy: CustomerMatchStrategy;
  value: string | null;
}

export interface CustomerMatchInput {
  externalId?: string | null;
  phone?: string | null;
  phone2?: string | null;
  whatsappPhone?: string | null;
  email?: string | null;
  ncc?: string | null;
  isCompany?: boolean;
}

/**
 * RG-M13-18.2 — client : `ExternalRef`, puis téléphone E.164 (phone, phone2
 * ou whatsappPhone), puis email, puis NCC pour une entreprise. Jamais sur le
 * nom seul.
 */
export function resolveCustomerMatchKey(input: CustomerMatchInput): CustomerMatchKey {
  if (input.externalId) return { strategy: "external_ref", value: input.externalId };
  if (input.phone) return { strategy: "phone", value: input.phone };
  if (input.phone2) return { strategy: "phone", value: input.phone2 };
  if (input.whatsappPhone) return { strategy: "phone", value: input.whatsappPhone };
  if (input.email) return { strategy: "email", value: input.email };
  if (input.isCompany && input.ncc) return { strategy: "ncc", value: input.ncc };
  return { strategy: "none", value: null };
}

export type VehicleMatchStrategy = "plate" | "vin" | "none";

export interface VehicleMatchKey {
  strategy: VehicleMatchStrategy;
  value: string | null;
}

/** RG-M13-18.3 — véhicule : plaque normalisée, puis VIN. */
export function resolveVehicleMatchKey(input: {
  plateCompact?: string | null;
  vin?: string | null;
}): VehicleMatchKey {
  if (input.plateCompact) return { strategy: "plate", value: input.plateCompact };
  if (input.vin) return { strategy: "vin", value: input.vin };
  return { strategy: "none", value: null };
}

export type InvoiceMatchStrategy = "external_ref" | "customer_external_number" | "none";

export interface InvoiceMatchKey {
  strategy: InvoiceMatchStrategy;
  value: string | null;
}

/** RG-M13-18.4 — facture : `ExternalRef`, sinon `(customerId, externalNumber)`. */
export function resolveInvoiceMatchKey(input: {
  externalId?: string | null;
  customerId?: string | null;
  externalNumber?: string | null;
}): InvoiceMatchKey {
  if (input.externalId) return { strategy: "external_ref", value: input.externalId };
  if (input.customerId && input.externalNumber) {
    return {
      strategy: "customer_external_number",
      value: `${input.customerId}:${input.externalNumber}`,
    };
  }
  return { strategy: "none", value: null };
}

export type PaymentMatchStrategy = "provider_ref" | "invoice_composite" | "none";

export interface PaymentMatchKey {
  strategy: PaymentMatchStrategy;
  value: string | null;
}

/** RG-M13-18.5 — paiement : `(provider, providerRef)` ou `(invoice, amount, receivedAt, reference)`. */
export function resolvePaymentMatchKey(input: {
  provider?: string | null;
  providerRef?: string | null;
  invoiceId?: string | null;
  amount?: number | null;
  receivedAt?: string | null;
  reference?: string | null;
}): PaymentMatchKey {
  if (input.provider && input.providerRef) {
    return { strategy: "provider_ref", value: `${input.provider}:${input.providerRef}` };
  }
  if (input.invoiceId && input.amount != null && input.receivedAt && input.reference) {
    return {
      strategy: "invoice_composite",
      value: `${input.invoiceId}:${input.amount}:${input.receivedAt}:${input.reference}`,
    };
  }
  return { strategy: "none", value: null };
}
