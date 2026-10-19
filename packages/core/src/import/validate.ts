/**
 * RG-M13-16/17 — validation ligne par ligne. Ces fonctions opèrent sur des
 * champs **déjà normalisés** (voir `normalize.ts`, qui produit ses propres
 * erreurs de format) et vérifient les règles obligatoires et de cohérence
 * propres à chaque entité.
 */

export type IssueSeverity = "ERROR" | "WARNING";

export interface RowIssue {
  field?: string;
  message: string;
  severity: IssueSeverity;
}

export function hasBlockingError(issues: readonly RowIssue[]): boolean {
  return issues.some((issue) => issue.severity === "ERROR");
}

export interface CustomerRowInput {
  displayName: string | null;
  phone: string | null;
  email: string | null;
}

/** RG-M13-16 — `customers` : displayName (ou nom + prénom) ; phone ou email. */
export function validateCustomerRow(input: CustomerRowInput): RowIssue[] {
  const issues: RowIssue[] = [];

  if (!input.displayName) {
    issues.push({
      field: "displayName",
      message: "Le nom du client est obligatoire.",
      severity: "ERROR",
    });
  }
  if (!input.phone && !input.email) {
    issues.push({ message: "Un téléphone ou un email est obligatoire.", severity: "ERROR" });
  }

  return issues;
}

export interface VehicleRowInput {
  plate: string | null;
  ownerPhone: string | null;
  ownerExternalId: string | null;
  ownerName: string | null;
  make: string | null;
  year: number | null;
  nowYear: number;
}

/** RG-M13-16 — `vehicles` : plate ; propriétaire ; make ; year ∈ [1960 ; année+1]. */
export function validateVehicleRow(input: VehicleRowInput): RowIssue[] {
  const issues: RowIssue[] = [];

  if (!input.plate) {
    issues.push({
      field: "plate",
      message: "La plaque d'immatriculation est obligatoire.",
      severity: "ERROR",
    });
  }
  if (!input.ownerPhone && !input.ownerExternalId && !input.ownerName) {
    issues.push({
      message: "Le propriétaire est obligatoire (téléphone, n° client externe ou nom exact).",
      severity: "ERROR",
    });
  }
  if (!input.make) {
    issues.push({ field: "make", message: "La marque est obligatoire.", severity: "ERROR" });
  }
  if (input.year !== null && (input.year < 1960 || input.year > input.nowYear + 1)) {
    issues.push({
      field: "year",
      message: `Année de fabrication invalide : ${input.year}.`,
      severity: "ERROR",
    });
  }

  return issues;
}

export interface InvoiceRowInput {
  externalNumber: string | null;
  customerRef: string | null;
  issuedAt: Date | null;
  dueDate: Date | null;
  total: number | null;
  amountPaid: number | null;
}

/** RG-M13-16 — `invoices` : n° externe, client, issuedAt, total ; amountPaid ≤ total ; dueDate ≥ issuedAt. */
export function validateInvoiceRow(input: InvoiceRowInput): RowIssue[] {
  const issues: RowIssue[] = [];

  if (!input.externalNumber) {
    issues.push({
      field: "externalNumber",
      message: "Le numéro de facture externe est obligatoire.",
      severity: "ERROR",
    });
  }
  if (!input.customerRef) {
    issues.push({ field: "customer", message: "Le client est obligatoire.", severity: "ERROR" });
  }
  if (!input.issuedAt) {
    issues.push({
      field: "issuedAt",
      message: "La date de facture est obligatoire.",
      severity: "ERROR",
    });
  }
  if (input.total === null) {
    issues.push({
      field: "total",
      message: "Le montant total est obligatoire.",
      severity: "ERROR",
    });
  }
  if (input.total !== null && input.amountPaid !== null && input.amountPaid > input.total) {
    issues.push({
      field: "amountPaid",
      message: "Le montant réglé ne peut pas dépasser le montant total.",
      severity: "ERROR",
    });
  }
  if (input.issuedAt && input.dueDate && input.dueDate.getTime() < input.issuedAt.getTime()) {
    issues.push({
      field: "dueDate",
      message: "La date d'échéance doit être postérieure ou égale à la date de facture.",
      severity: "ERROR",
    });
  }

  return issues;
}

const BALANCE_TOLERANCE_FCFA = 1;

/**
 * RG-M13-16 — vérifie la cohérence `balance = total − amountPaid` (tolérance
 * 1 FCFA) quand une colonne `balance` est également mappée dans le fichier.
 */
export function validateInvoiceBalanceColumn(
  total: number,
  amountPaid: number,
  mappedBalance: number,
): RowIssue[] {
  const expected = total - amountPaid;
  if (Math.abs(expected - mappedBalance) > BALANCE_TOLERANCE_FCFA) {
    return [
      {
        field: "balance",
        message: `Solde incohérent : attendu ${expected}, trouvé ${mappedBalance}.`,
        severity: "ERROR",
      },
    ];
  }
  return [];
}

export interface PaymentRowInput {
  invoiceRef: string | null;
  amount: number | null;
  receivedAt: Date | null;
}

/** RG-M13-16 — `payments` : n° facture externe ou client, amount > 0, receivedAt. */
export function validatePaymentRow(input: PaymentRowInput): RowIssue[] {
  const issues: RowIssue[] = [];

  if (!input.invoiceRef) {
    issues.push({
      field: "invoice",
      message: "La facture (n° externe ou client) est obligatoire.",
      severity: "ERROR",
    });
  }
  if (input.amount === null || input.amount <= 0) {
    issues.push({
      field: "amount",
      message: "Le montant doit être strictement positif.",
      severity: "ERROR",
    });
  }
  if (!input.receivedAt) {
    issues.push({
      field: "receivedAt",
      message: "La date de règlement est obligatoire.",
      severity: "ERROR",
    });
  }

  return issues;
}

export interface ProductRowInput {
  sku: string | null;
  name: string | null;
  salePrice: number | null;
  onHand: number | null;
}

/** RG-M13-16 — `products` : sku, name ; prix ≥ 0 ; onHand entier. */
export function validateProductRow(input: ProductRowInput): RowIssue[] {
  const issues: RowIssue[] = [];

  if (!input.sku) {
    issues.push({ field: "sku", message: "La référence est obligatoire.", severity: "ERROR" });
  }
  if (!input.name) {
    issues.push({ field: "name", message: "La désignation est obligatoire.", severity: "ERROR" });
  }
  if (input.salePrice !== null && input.salePrice < 0) {
    issues.push({
      field: "salePrice",
      message: "Le prix de vente doit être positif ou nul.",
      severity: "ERROR",
    });
  }
  if (input.onHand !== null && !Number.isInteger(input.onHand)) {
    issues.push({
      field: "onHand",
      message: "Le stock doit être un nombre entier.",
      severity: "ERROR",
    });
  }

  return issues;
}

export interface RepairOrderRowInput {
  plate: string | null;
  date: Date | null;
  mileage: number | null;
}

/** RG-M13-16 — `repair_orders` (historique) : plaque, date ; km ≥ 0. */
export function validateRepairOrderRow(input: RepairOrderRowInput): RowIssue[] {
  const issues: RowIssue[] = [];

  if (!input.plate) {
    issues.push({
      field: "plate",
      message: "La plaque d'immatriculation est obligatoire.",
      severity: "ERROR",
    });
  }
  if (!input.date) {
    issues.push({ field: "date", message: "La date est obligatoire.", severity: "ERROR" });
  }
  if (input.mileage !== null && input.mileage < 0) {
    issues.push({
      field: "mileage",
      message: "Le kilométrage doit être positif ou nul.",
      severity: "ERROR",
    });
  }

  return issues;
}
