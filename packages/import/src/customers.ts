/**
 * RG-M13-18/19 — dédoublonnage et fusion incrémentale pour l'entité
 * `customers`. Déroule les fonctions pures de `@atelieros/core` sur la base
 * réelle (le seul point touchant la DB dans tout le pipeline d'import).
 *
 * Portée actuelle : la correspondance `ExternalRef` (stratégie n°1,
 * RG-M13-18) suppose une `DataSource`, hors périmètre de l'import fichier
 * ad hoc (pas de colonne « identifiant externe » dans
 * `TARGET_FIELDS_BY_ENTITY.customers` actuel) — seules les stratégies
 * téléphone/email/NCC sont câblées ici.
 */
import type { db } from "@atelieros/db";
import { writeAuditLog } from "@atelieros/db";
import {
  detectCompanyFromName,
  mergeFields,
  resolveCustomerMatchKey,
  type ImportPolicy,
  type RowOutcome,
} from "@atelieros/core";

export type TenantDb = ReturnType<typeof db.forTenant>;

export interface CustomerImportValues {
  "customer.displayName"?: string;
  "customer.firstName"?: string;
  "customer.lastName"?: string;
  "customer.phone"?: string;
  "customer.phone2"?: string;
  "customer.email"?: string;
  "customer.type"?: string;
  "customer.ncc"?: string;
}

function toCustomerFields(values: CustomerImportValues): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (values["customer.displayName"] !== undefined)
    fields.displayName = values["customer.displayName"];
  if (values["customer.firstName"] !== undefined) fields.firstName = values["customer.firstName"];
  if (values["customer.lastName"] !== undefined) fields.lastName = values["customer.lastName"];
  if (values["customer.phone"] !== undefined) fields.phone = values["customer.phone"];
  if (values["customer.phone2"] !== undefined) fields.phone2 = values["customer.phone2"];
  if (values["customer.email"] !== undefined) fields.email = values["customer.email"];
  if (values["customer.ncc"] !== undefined) fields.ncc = values["customer.ncc"];
  return fields;
}

export interface ApplyCustomerRowResult {
  outcome: RowOutcome;
  customerId: string | null;
}

export interface ApplyCustomerRowInput {
  tenantDb: TenantDb;
  organizationId: string;
  values: CustomerImportValues;
  policy: ImportPolicy;
  dryRun: boolean;
  jobId: string;
  userId?: string | null;
  membershipId?: string | null;
}

/**
 * RG-M13-18/19 — résout le client correspondant (téléphone > email > NCC
 * entreprise), calcule le patch selon la politique, et l'applique si
 * `dryRun` est faux. Retourne le même résultat (`outcome`) que l'écriture
 * soit réelle ou simulée, pour partager le code entre `simulate` et `run`.
 */
export async function applyCustomerRow(
  input: ApplyCustomerRowInput,
): Promise<ApplyCustomerRowResult> {
  const { tenantDb, organizationId, values, policy, dryRun, jobId } = input;
  const fields = toCustomerFields(values);
  const displayName = (fields.displayName as string | undefined) ?? null;
  const isCompany = displayName ? detectCompanyFromName(displayName) : false;

  const matchKey = resolveCustomerMatchKey({
    phone: (fields.phone as string | undefined) ?? null,
    phone2: (fields.phone2 as string | undefined) ?? null,
    email: (fields.email as string | undefined) ?? null,
    ncc: (fields.ncc as string | undefined) ?? null,
    isCompany,
  });

  let existing: { id: string; [key: string]: unknown } | null = null;
  if (matchKey.strategy === "phone" && matchKey.value) {
    existing = await tenantDb.customer.findFirst({
      where: {
        OR: [
          { phone: matchKey.value },
          { phone2: matchKey.value },
          { whatsappPhone: matchKey.value },
        ],
      },
    });
  } else if (matchKey.strategy === "email" && matchKey.value) {
    existing = await tenantDb.customer.findFirst({ where: { email: matchKey.value } });
  } else if (matchKey.strategy === "ncc" && matchKey.value) {
    existing = await tenantDb.customer.findFirst({ where: { ncc: matchKey.value } });
  }

  const merge = mergeFields(existing as Record<string, unknown> | null, fields, policy);

  if (dryRun || merge.outcome === "skip" || merge.outcome === "unchanged") {
    return { outcome: merge.outcome, customerId: existing?.id ?? null };
  }

  if (merge.outcome === "create") {
    const created = await tenantDb.customer.create({
      data: {
        organizationId,
        displayName: displayName ?? "Client importé",
        type: isCompany ? "COMPANY" : "INDIVIDUAL",
        origin: "IMPORTED",
        ...fields,
      },
    });
    await writeAuditLog({
      organizationId,
      userId: input.userId ?? null,
      membershipId: input.membershipId ?? null,
      action: "import.customer.created",
      entity: "Customer",
      entityId: created.id,
      after: created,
      reason: `import:${jobId}`,
    });
    return { outcome: "create", customerId: created.id };
  }

  // update
  const before = existing!;
  const updated = await tenantDb.customer.update({ where: { id: before.id }, data: merge.patch });
  await writeAuditLog({
    organizationId,
    userId: input.userId ?? null,
    membershipId: input.membershipId ?? null,
    action: "import.customer.updated",
    entity: "Customer",
    entityId: updated.id,
    before,
    after: updated,
    reason: `import:${jobId}`,
  });
  return { outcome: "update", customerId: updated.id };
}

/** Résout un client existant depuis une référence libre (téléphone, NCC ou nom exact). RG-M13-16 (véhicules/factures/paiements). */
export async function resolveCustomerByRef(
  tenantDb: TenantDb,
  ref: { phone?: string | null; ncc?: string | null; displayName?: string | null },
): Promise<{ id: string } | null> {
  if (ref.phone) {
    return tenantDb.customer.findFirst({
      where: { OR: [{ phone: ref.phone }, { phone2: ref.phone }, { whatsappPhone: ref.phone }] },
      select: { id: true },
    });
  }
  if (ref.ncc) {
    return tenantDb.customer.findFirst({ where: { ncc: ref.ncc }, select: { id: true } });
  }
  if (ref.displayName) {
    return tenantDb.customer.findFirst({
      where: { displayName: ref.displayName },
      select: { id: true },
    });
  }
  return null;
}
