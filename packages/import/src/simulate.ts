/**
 * RG-M13-18/23 — dispatcheur d'application de ligne (par entité) et
 * simulation (`dryRun`) du pipeline complet pour les 4 entités câblées dans
 * cette étape (`customers`, `vehicles`, `invoices`, `payments`).
 *
 * Note d'implémentation — RG-M13-23 demande d'exécuter « tout le pipeline
 * dans une transaction annulée ». `db.forTenant()` (packages/db/src/tenant.ts)
 * ouvre sa **propre** transaction Postgres par opération (pour positionner
 * `app.organization_id` avant chaque requête RLS), ce qui empêche d'envelopper
 * l'ensemble d'une simulation multi-lignes dans une seule transaction SQL
 * annulée en fin de parcours sans contourner `db.forTenant()` — interdit par
 * CLAUDE.md (« toute requête passe par `db.forTenant(ctx)` »). On obtient le
 * même résultat observable (aucune écriture durable) par un court-circuit
 * explicite : chaque `apply*Row` reçoit `dryRun: true` et retourne l'issue
 * calculée sans jamais appeler `create`/`update`. Limite documentée, dans la
 * continuité de l'approche déjà choisie par l'agent précédent pour
 * `customers.ts`/`vehicles.ts`/`invoices.ts`.
 */
import type { db } from "@atelieros/db";
import {
  dedupeRowsInFile,
  resolveCustomerMatchKey,
  type ImportPolicy,
  type RowOutcome,
} from "@atelieros/core";
import { applyCustomerRow, type CustomerImportValues } from "./customers";
import { applyVehicleRow, type VehicleImportValues } from "./vehicles";
import { applyInvoiceRow, type InvoiceImportValues } from "./invoices";
import { applyPaymentRow, type PaymentImportValues } from "./payments";
import { rowHasBlockingError, type AnalyzedRow, type ImportEntityName } from "./pipeline";

export type TenantDb = ReturnType<typeof db.forTenant>;

/** Entités pour lesquelles l'application de ligne (simulation/exécution/annulation) est câblée dans cette étape. */
export type SupportedEntity = "customers" | "vehicles" | "invoices" | "payments";

export const SUPPORTED_ENTITIES: readonly SupportedEntity[] = [
  "customers",
  "vehicles",
  "invoices",
  "payments",
];

export function isSupportedEntity(entity: ImportEntityName): entity is SupportedEntity {
  return (SUPPORTED_ENTITIES as readonly string[]).includes(entity);
}

/** RG-M13-18 — clé de dédoublonnage intra-fichier par entité, à partir des valeurs déjà mappées/normalisées. */
function dedupeKeyFor(entity: SupportedEntity, row: AnalyzedRow): string | null {
  switch (entity) {
    case "customers": {
      const key = resolveCustomerMatchKey({
        phone: (row.values["customer.phone"] as string | undefined) ?? null,
        phone2: (row.values["customer.phone2"] as string | undefined) ?? null,
        email: (row.values["customer.email"] as string | undefined) ?? null,
      });
      return key.value;
    }
    case "vehicles":
      return (row.values["vehicle.plateCompact"] as string | undefined) ?? null;
    case "invoices": {
      const externalNumber = row.values["invoice.externalNumber"] as string | undefined;
      if (!externalNumber) return null;
      const customerRef =
        (row.values["customer.phone"] as string | undefined) ??
        (row.values["customer.ncc"] as string | undefined) ??
        (row.values["customer.displayName"] as string | undefined) ??
        "";
      return `${customerRef}:${externalNumber}`;
    }
    case "payments":
      // RG-M13-18.5 — aucune colonne provider/providerRef dans le mapping de
      // cette étape (voir payments.ts) : pas de dédoublonnage intra-fichier
      // possible, chaque ligne valide est traitée indépendamment.
      return null;
  }
}

export interface DedupeImportRowsResult {
  winningRows: AnalyzedRow[];
  mergedCount: number;
}

/** RG-M13-18 — sépare les lignes gagnantes (dernière ligne par clé) des lignes fusionnées. */
export function dedupeImportRows(
  entity: SupportedEntity,
  rows: readonly AnalyzedRow[],
): DedupeImportRowsResult {
  const { winners, merged } = dedupeRowsInFile(rows, (row) => dedupeKeyFor(entity, row));
  const winningRows = [...winners.values()]
    .map((w) => w.row)
    .concat(rows.filter((r) => dedupeKeyFor(entity, r) === null));
  return { winningRows, mergedCount: merged.length };
}

export interface ApplyImportRowInput {
  tenantDb: TenantDb;
  organizationId: string;
  entity: SupportedEntity;
  values: Record<string, unknown>;
  policy: ImportPolicy;
  dryRun: boolean;
  jobId: string;
  now: Date;
  userId?: string | null;
  membershipId?: string | null;
}

export interface ApplyImportRowResult {
  outcome: RowOutcome | "error";
  id: string | null;
  error?: string;
}

/** Dispatche l'application d'une ligne déjà mappée/validée vers la fonction propre à l'entité. */
export async function applyImportRow(input: ApplyImportRowInput): Promise<ApplyImportRowResult> {
  const {
    entity,
    tenantDb,
    organizationId,
    values,
    policy,
    dryRun,
    jobId,
    now,
    userId,
    membershipId,
  } = input;

  switch (entity) {
    case "customers": {
      const result = await applyCustomerRow({
        tenantDb,
        organizationId,
        values: values as CustomerImportValues,
        policy,
        dryRun,
        jobId,
        userId,
        membershipId,
      });
      return { outcome: result.outcome, id: result.customerId };
    }
    case "vehicles": {
      const result = await applyVehicleRow({
        tenantDb,
        organizationId,
        values: values as VehicleImportValues,
        policy,
        dryRun,
        jobId,
        userId,
        membershipId,
      });
      return { outcome: result.outcome, id: result.vehicleId, error: result.error };
    }
    case "invoices": {
      const result = await applyInvoiceRow({
        tenantDb,
        organizationId,
        values: values as InvoiceImportValues,
        policy,
        dryRun,
        jobId,
        now,
        userId,
        membershipId,
      });
      return { outcome: result.outcome, id: result.invoiceId, error: result.error };
    }
    case "payments": {
      const result = await applyPaymentRow({
        tenantDb,
        organizationId,
        values: values as PaymentImportValues,
        dryRun,
        jobId,
        now,
        userId,
        membershipId,
      });
      return { outcome: result.outcome, id: result.paymentId, error: result.error };
    }
  }
}

export interface SimulationCounts {
  create: number;
  update: number;
  unchanged: number;
  skip: number;
  error: number;
}

export interface SimulationSampleEntry {
  rowNumber: number;
  outcome: string;
  before?: unknown;
  after?: unknown;
}

export interface SimulationSummary extends SimulationCounts {
  sample: SimulationSampleEntry[];
}

export interface SimulateImportInput {
  tenantDb: TenantDb;
  organizationId: string;
  entity: SupportedEntity;
  rows: readonly AnalyzedRow[];
  policy: ImportPolicy;
  jobId: string;
  now: Date;
}

const SAMPLE_SIZE = 20; // RG-M13-23

/** RG-M13-23 — exécute tout le pipeline en `dryRun` ; aucune écriture, compteurs + échantillon de 20 changements avant/après. */
export async function simulateImport(input: SimulateImportInput): Promise<SimulationSummary> {
  const { tenantDb, organizationId, entity, rows, policy, jobId, now } = input;
  const { winningRows, mergedCount } = dedupeImportRows(entity, rows);

  let create = 0;
  let update = 0;
  let unchanged = 0;
  let skip = mergedCount;
  let error = 0;
  const sample: SimulationSampleEntry[] = [];

  for (const row of winningRows) {
    if (rowHasBlockingError(row)) {
      error += 1;
      continue;
    }

    const result = await applyImportRow({
      tenantDb,
      organizationId,
      entity,
      values: row.values,
      policy,
      dryRun: true,
      jobId,
      now,
    });

    if (result.outcome === "create") create += 1;
    else if (result.outcome === "update") update += 1;
    else if (result.outcome === "unchanged") unchanged += 1;
    else if (result.outcome === "error") error += 1;
    else skip += 1;

    if (
      (result.outcome === "create" || result.outcome === "update") &&
      sample.length < SAMPLE_SIZE
    ) {
      sample.push({ rowNumber: row.rowNumber, outcome: result.outcome, after: row.values });
    }
  }

  return { create, update, unchanged, skip, error, sample };
}
