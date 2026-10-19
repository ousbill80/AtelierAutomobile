/**
 * RG-M13-20/21 — création et mise à jour incrémentale des factures importées.
 * Le client propriétaire est résolu par téléphone, NCC ou nom exact (déjà
 * présent en base, cf. `resolveCustomerByRef` — comme pour les véhicules,
 * le fichier « une ligne = client + facture » de RG-M13-17 est hors
 * périmètre de cette passe). La correspondance `ExternalRef` (stratégie n°1,
 * RG-M13-18) est hors périmètre pour les mêmes raisons que `customers.ts`.
 */
import type { db } from "@atelieros/db";
import { writeAuditLog } from "@atelieros/db";
import {
  computeBalanceChange,
  mergeFields,
  nextDocumentNumber,
  resolveInvoiceMatchKey,
  type ImportPolicy,
  type RowOutcome,
} from "@atelieros/core";
import { resolveCustomerByRef } from "./customers";
import { createSequenceStore, resolveDefaultSiteId } from "./sequence";

export type TenantDb = ReturnType<typeof db.forTenant>;

export interface InvoiceImportValues {
  "invoice.externalNumber"?: string;
  "invoice.issuedAt"?: string;
  "invoice.dueDate"?: string;
  "invoice.total"?: number;
  "invoice.amountPaid"?: number;
  "customer.phone"?: string;
  "customer.ncc"?: string;
  "customer.displayName"?: string;
}

export interface ApplyInvoiceRowResult {
  outcome: RowOutcome | "error";
  invoiceId: string | null;
  error?: string;
}

export interface ApplyInvoiceRowInput {
  tenantDb: TenantDb;
  organizationId: string;
  values: InvoiceImportValues;
  policy: ImportPolicy;
  dryRun: boolean;
  jobId: string;
  now: Date;
  userId?: string | null;
  membershipId?: string | null;
}

/** RG-M13-20 — déduit le statut d'une facture importée depuis son solde et son échéance. */
export function deriveInvoiceStatus(
  balance: number,
  dueDate: Date | null,
  now: Date,
): "PAID" | "OVERDUE" | "ISSUED" {
  if (balance <= 0) return "PAID";
  if (dueDate && dueDate.getTime() < now.getTime()) return "OVERDUE";
  return "ISSUED";
}

/** Génère le numéro de reçu (`REC-AAAA-NNNNNN`) pour un paiement de reprise, sur l'année de `receivedAt`. */
async function nextReceiptNumber(
  tenantDb: TenantDb,
  organizationId: string,
  receivedAt: Date,
): Promise<string> {
  const store = createSequenceStore(tenantDb);
  return nextDocumentNumber(store, {
    organizationId,
    docType: "REC",
    year: receivedAt.getUTCFullYear(),
  });
}

/**
 * RG-M13-20/21/§11 — applique une ligne facture (propriétaire déjà en base).
 * Création : facture `origin = IMPORTED`, `number = null`, statut dérivé du
 * solde et de l'échéance ; un déjà-payé initial génère un `Payment`
 * `reference = "OPENING"`. Mise à jour : seuls `total`/`dueDate`/`issuedAt`
 * passent par la politique de fusion standard ; une baisse de solde génère
 * un `Payment` de reprise `reference = "IMPORT-SOLDE"` (RG-M13-21), une
 * hausse est une erreur sauf `UPSERT_OVERWRITE`.
 */
export async function applyInvoiceRow(input: ApplyInvoiceRowInput): Promise<ApplyInvoiceRowResult> {
  const { tenantDb, organizationId, values, policy, dryRun, jobId, now } = input;

  const externalNumber = values["invoice.externalNumber"] ?? null;
  const total = values["invoice.total"] ?? null;
  const amountPaid = values["invoice.amountPaid"] ?? 0;
  const issuedAt = values["invoice.issuedAt"] ? new Date(values["invoice.issuedAt"]) : null;
  const dueDate = values["invoice.dueDate"] ? new Date(values["invoice.dueDate"]) : null;

  if (!externalNumber || total === null) {
    return {
      outcome: "error",
      invoiceId: null,
      error: "Numéro de facture externe ou montant total manquant.",
    };
  }

  const owner = await resolveCustomerByRef(tenantDb, {
    phone: values["customer.phone"] ?? null,
    ncc: values["customer.ncc"] ?? null,
    displayName: values["customer.displayName"] ?? null,
  });
  if (!owner) {
    return {
      outcome: "error",
      invoiceId: null,
      error: "Client introuvable en base pour cette ligne.",
    };
  }

  const matchKey = resolveInvoiceMatchKey({ customerId: owner.id, externalNumber });

  let existing: {
    id: string;
    total: number;
    amountPaid: number;
    balance: number;
    dueDate: Date | null;
    issuedAt: Date | null;
    externalNumber: string | null;
    [key: string]: unknown;
  } | null = null;
  if (matchKey.strategy === "customer_external_number") {
    existing = await tenantDb.invoice.findFirst({
      where: { customerId: owner.id, externalNumber },
    });
  }

  const importedBalance = total - amountPaid;

  // ───────────── Création ─────────────
  if (!existing) {
    const status = deriveInvoiceStatus(importedBalance, dueDate, now);

    if (dryRun) {
      return { outcome: "create", invoiceId: null };
    }

    const created = await tenantDb.invoice.create({
      data: {
        organizationId,
        siteId: await resolveDefaultSiteId(tenantDb),
        customerId: owner.id,
        origin: "IMPORTED",
        number: null,
        externalNumber,
        fneStatus: "NOT_REQUIRED",
        status,
        issuedAt,
        dueDate,
        total,
        amountPaid,
        balance: importedBalance,
      },
    });

    if (amountPaid > 0) {
      const receivedAt = issuedAt ?? now;
      const number = await nextReceiptNumber(tenantDb, organizationId, receivedAt);
      const payment = await tenantDb.payment.create({
        data: {
          organizationId,
          siteId: created.siteId,
          customerId: owner.id,
          number,
          method: "OTHER",
          amount: amountPaid,
          receivedAt,
          reference: "OPENING",
          origin: "IMPORTED",
        },
      });
      await tenantDb.paymentAllocation.create({
        data: { organizationId, paymentId: payment.id, invoiceId: created.id, amount: amountPaid },
      });
    }

    await writeAuditLog({
      organizationId,
      userId: input.userId ?? null,
      membershipId: input.membershipId ?? null,
      action: "import.invoice.created",
      entity: "Invoice",
      entityId: created.id,
      after: created,
      reason: `import:${jobId}`,
    });
    return { outcome: "create", invoiceId: created.id };
  }

  // ───────────── Mise à jour ─────────────
  const fields: Record<string, unknown> = {};
  if (total !== undefined) fields.total = total;
  if (dueDate !== null) fields.dueDate = dueDate;
  if (issuedAt !== null) fields.issuedAt = issuedAt;

  const merge = mergeFields(existing, fields, policy);
  // CREATE_ONLY : une facture déjà importée n'est jamais retouchée (même pas
  // son solde) — le `skip` de `mergeFields` prime sur RG-M13-21.
  if (merge.outcome === "skip") {
    return { outcome: "skip", invoiceId: existing.id };
  }

  const balanceChange = computeBalanceChange(
    existing.balance,
    importedBalance,
    policy,
    externalNumber,
  );
  if (balanceChange.error) {
    return { outcome: "error", invoiceId: existing.id, error: balanceChange.error };
  }

  const hasBalanceWrite = balanceChange.kind !== "unchanged";
  if (merge.outcome !== "update" && !hasBalanceWrite) {
    return { outcome: "unchanged", invoiceId: existing.id };
  }

  if (dryRun) {
    return { outcome: "update", invoiceId: existing.id };
  }

  const patch: Record<string, unknown> = { ...merge.patch };
  if (hasBalanceWrite) {
    patch.amountPaid = amountPaid;
    patch.balance = importedBalance;
    patch.status = deriveInvoiceStatus(importedBalance, dueDate ?? existing.dueDate, now);
  }

  const updated = await tenantDb.invoice.update({ where: { id: existing.id }, data: patch });

  if (balanceChange.kind === "decrease") {
    // RG-M13-21 — date du fichier (aucune colonne « date de règlement » sur
    // une ligne facture : hors périmètre tant que RG-M13-17 « mixed » n'est
    // pas câblé) à défaut d'une date de paiement mappée.
    const receivedAt = now;
    const number = await nextReceiptNumber(tenantDb, organizationId, receivedAt);
    const payment = await tenantDb.payment.create({
      data: {
        organizationId,
        siteId: updated.siteId,
        customerId: owner.id,
        number,
        method: "OTHER",
        amount: balanceChange.delta,
        receivedAt,
        reference: "IMPORT-SOLDE",
        origin: "IMPORTED",
      },
    });
    await tenantDb.paymentAllocation.create({
      data: {
        organizationId,
        paymentId: payment.id,
        invoiceId: updated.id,
        amount: balanceChange.delta,
      },
    });
  }

  await writeAuditLog({
    organizationId,
    userId: input.userId ?? null,
    membershipId: input.membershipId ?? null,
    action: "import.invoice.updated",
    entity: "Invoice",
    entityId: updated.id,
    before: existing,
    after: updated,
    reason: `import:${jobId}`,
  });
  return { outcome: "update", invoiceId: updated.id };
}
