/**
 * RG-M13-16/18 — import de paiements autonomes (fichier « historique des
 * règlements », distinct des paiements de reprise `OPENING`/`IMPORT-SOLDE`
 * générés automatiquement par `invoices.ts`, RG-M13-20/21). La facture
 * cible est résolue par son n° externe (`invoice.externalNumber`), avec le
 * client comme repère de désambiguïsation ou, à défaut, comme seul critère
 * (facture ouverte unique de ce client).
 *
 * Portée actuelle : aucune colonne « provider »/« référence transaction »
 * n'existe encore dans `TARGET_FIELDS_BY_ENTITY.payments` — la stratégie
 * `(provider, providerRef)` de `resolvePaymentMatchKey` (RG-M13-18.5) est
 * donc câblée mais pratiquement toujours `"none"` tant que ces colonnes ne
 * sont pas ajoutées ; chaque ligne valide crée un nouveau `Payment` (pas de
 * dédoublonnage en base — seul le dédoublonnage intra-fichier de
 * RG-M13-18 s'applique en amont).
 */
import type { db } from "@atelieros/db";
import { writeAuditLog, type PaymentMethod } from "@atelieros/db";
import { nextDocumentNumber, type RowOutcome } from "@atelieros/core";
import { resolveCustomerByRef } from "./customers";
import { deriveInvoiceStatus } from "./invoices";
import { createSequenceStore } from "./sequence";

export type TenantDb = ReturnType<typeof db.forTenant>;

export interface PaymentImportValues {
  "invoice.externalNumber"?: string;
  "payment.amount"?: number;
  "payment.method"?: string;
  "payment.receivedAt"?: string;
  "customer.phone"?: string;
  "customer.ncc"?: string;
  "customer.displayName"?: string;
}

export interface ApplyPaymentRowResult {
  outcome: RowOutcome | "error";
  paymentId: string | null;
  error?: string;
}

export interface ApplyPaymentRowInput {
  tenantDb: TenantDb;
  organizationId: string;
  values: PaymentImportValues;
  dryRun: boolean;
  jobId: string;
  now: Date;
  userId?: string | null;
  membershipId?: string | null;
}

type ExistingInvoice = {
  id: string;
  siteId: string;
  customerId: string;
  total: number;
  amountPaid: number;
  balance: number;
  dueDate: Date | null;
};

/** Résout la facture cible : n° externe (+ client pour désambiguïser), ou client seul si unique facture ouverte. */
async function resolveTargetInvoice(
  tenantDb: TenantDb,
  values: PaymentImportValues,
): Promise<{ invoice: ExistingInvoice | null; error?: string }> {
  const externalNumber = values["invoice.externalNumber"] ?? null;
  const customerRef = {
    phone: values["customer.phone"] ?? null,
    ncc: values["customer.ncc"] ?? null,
    displayName: values["customer.displayName"] ?? null,
  };
  const hasCustomerRef = Boolean(customerRef.phone || customerRef.ncc || customerRef.displayName);

  if (externalNumber) {
    let customerId: string | undefined;
    if (hasCustomerRef) {
      const owner = await resolveCustomerByRef(tenantDb, customerRef);
      if (!owner)
        return {
          invoice: null,
          error: "Client introuvable en base pour désambiguïser la facture.",
        };
      customerId = owner.id;
    }
    const where = customerId ? { externalNumber, customerId } : { externalNumber };
    const invoice = await tenantDb.invoice.findFirst({ where });
    if (!invoice)
      return { invoice: null, error: `Facture externe « ${externalNumber} » introuvable en base.` };
    return { invoice };
  }

  if (hasCustomerRef) {
    const owner = await resolveCustomerByRef(tenantDb, customerRef);
    if (!owner)
      return { invoice: null, error: "Client introuvable en base pour cette ligne de paiement." };
    const openInvoices = await tenantDb.invoice.findMany({
      where: { customerId: owner.id, balance: { gt: 0 } },
    });
    if (openInvoices.length === 0) {
      return { invoice: null, error: "Aucune facture ouverte trouvée pour ce client." };
    }
    if (openInvoices.length > 1) {
      return {
        invoice: null,
        error: "Plusieurs factures ouvertes pour ce client : précisez le n° de facture externe.",
      };
    }
    return { invoice: openInvoices[0]! };
  }

  return { invoice: null, error: "Facture (n° externe ou client) introuvable pour cette ligne." };
}

/**
 * RG-M13-16/18.5 — applique une ligne de paiement autonome : résout la
 * facture cible, crée le `Payment` et son `PaymentAllocation`, et met à
 * jour `amountPaid`/`balance`/`status` de la facture.
 */
export async function applyPaymentRow(input: ApplyPaymentRowInput): Promise<ApplyPaymentRowResult> {
  const { tenantDb, organizationId, values, dryRun, jobId, now } = input;

  const amount = values["payment.amount"] ?? null;
  const receivedAt = values["payment.receivedAt"] ? new Date(values["payment.receivedAt"]) : null;
  if (amount === null || amount <= 0 || !receivedAt) {
    return {
      outcome: "error",
      paymentId: null,
      error: "Montant ou date de règlement manquant/invalide.",
    };
  }

  const { invoice, error } = await resolveTargetInvoice(tenantDb, values);
  if (!invoice) {
    return { outcome: "error", paymentId: null, error: error ?? "Facture introuvable." };
  }

  if (dryRun) {
    return { outcome: "create", paymentId: null };
  }

  const method = ((values["payment.method"] as PaymentMethod | undefined) ??
    "OTHER") satisfies PaymentMethod;

  const store = createSequenceStore(tenantDb);
  const number = await nextDocumentNumber(store, {
    organizationId,
    docType: "REC",
    year: receivedAt.getUTCFullYear(),
  });

  const payment = await tenantDb.payment.create({
    data: {
      organizationId,
      siteId: invoice.siteId,
      customerId: invoice.customerId,
      number,
      method,
      amount,
      receivedAt,
      origin: "IMPORTED",
    },
  });
  await tenantDb.paymentAllocation.create({
    data: { organizationId, paymentId: payment.id, invoiceId: invoice.id, amount },
  });

  const newAmountPaid = invoice.amountPaid + amount;
  const newBalance = invoice.total - newAmountPaid;
  await tenantDb.invoice.update({
    where: { id: invoice.id },
    data: {
      amountPaid: newAmountPaid,
      balance: newBalance,
      status: deriveInvoiceStatus(newBalance, invoice.dueDate, now),
    },
  });

  await writeAuditLog({
    organizationId,
    userId: input.userId ?? null,
    membershipId: input.membershipId ?? null,
    action: "import.payment.created",
    entity: "Payment",
    entityId: payment.id,
    after: payment,
    reason: `import:${jobId}`,
  });

  return { outcome: "create", paymentId: payment.id };
}
