/**
 * RG-M13-16/18/19 — dédoublonnage et fusion incrémentale pour l'entité
 * `vehicles`. Le propriétaire est résolu par téléphone, NCC ou nom exact du
 * client (déjà présent en base — le fichier « une ligne = client + véhicule »
 * de RG-M13-17, entité `mixed`, est hors périmètre de cette passe).
 */
import type { db } from "@atelieros/db";
import { writeAuditLog } from "@atelieros/db";
import {
  mergeFields,
  normalizePlate,
  resolveVehicleMatchKey,
  type ImportPolicy,
  type RowOutcome,
} from "@atelieros/core";
import { resolveCustomerByRef } from "./customers";

export type TenantDb = ReturnType<typeof db.forTenant>;

export interface VehicleImportValues {
  "vehicle.plate"?: string;
  "vehicle.plateCompact"?: string;
  "vehicle.make"?: string;
  "vehicle.model"?: string;
  "vehicle.vin"?: string;
  "vehicle.year"?: number;
  "vehicle.inspectionExpiryDate"?: string;
  "vehicle.lastServiceDate"?: string;
  "vehicle.lastServiceMileage"?: number;
  "vehicle.currentMileage"?: number;
  "customer.phone"?: string;
  "customer.ncc"?: string;
  "customer.displayName"?: string;
}

function toVehicleFields(values: VehicleImportValues): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (values["vehicle.plate"] !== undefined) fields.plate = values["vehicle.plate"];
  if (values["vehicle.make"] !== undefined) fields.make = values["vehicle.make"];
  if (values["vehicle.model"] !== undefined) fields.model = values["vehicle.model"];
  if (values["vehicle.vin"] !== undefined) fields.vin = values["vehicle.vin"];
  if (values["vehicle.year"] !== undefined) fields.year = values["vehicle.year"];
  if (values["vehicle.inspectionExpiryDate"] !== undefined) {
    fields.inspectionExpiryDate = new Date(values["vehicle.inspectionExpiryDate"]!);
  }
  if (values["vehicle.lastServiceDate"] !== undefined) {
    fields.lastServiceDate = new Date(values["vehicle.lastServiceDate"]!);
  }
  if (values["vehicle.lastServiceMileage"] !== undefined)
    fields.lastServiceMileage = values["vehicle.lastServiceMileage"];
  if (values["vehicle.currentMileage"] !== undefined)
    fields.currentMileage = values["vehicle.currentMileage"];
  return fields;
}

export interface ApplyVehicleRowResult {
  outcome: RowOutcome | "error";
  vehicleId: string | null;
  error?: string;
}

export interface ApplyVehicleRowInput {
  tenantDb: TenantDb;
  organizationId: string;
  values: VehicleImportValues;
  policy: ImportPolicy;
  dryRun: boolean;
  jobId: string;
  userId?: string | null;
  membershipId?: string | null;
}

/** RG-M13-16/18/19/§11 — applique une ligne véhicule (propriétaire déjà en base). */
export async function applyVehicleRow(input: ApplyVehicleRowInput): Promise<ApplyVehicleRowResult> {
  const { tenantDb, organizationId, values, policy, dryRun, jobId } = input;
  const fields = toVehicleFields(values);
  const plate = (fields.plate as string | undefined) ?? null;
  const vin = (values["vehicle.vin"] as string | undefined) ?? null;

  const owner = await resolveCustomerByRef(tenantDb, {
    phone: values["customer.phone"] ?? null,
    ncc: values["customer.ncc"] ?? null,
    displayName: values["customer.displayName"] ?? null,
  });
  if (!owner) {
    return {
      outcome: "error",
      vehicleId: null,
      error: "Propriétaire introuvable en base pour cette ligne.",
    };
  }

  const matchKey = resolveVehicleMatchKey({
    plateCompact: plate ? plate.replace(/\s/g, "") : null,
    vin,
  });

  let existing: { id: string; customerId: string; [key: string]: unknown } | null = null;
  if (matchKey.strategy === "plate" && plate) {
    existing = await tenantDb.vehicle.findFirst({ where: { plate } });
  } else if (matchKey.strategy === "vin" && vin) {
    existing = await tenantDb.vehicle.findFirst({ where: { vin } });
  }

  const merge = mergeFields(existing as Record<string, unknown> | null, fields, policy);

  // RG-M13 §11 — plaque déjà rattachée à un autre client : changement de propriétaire
  // seulement en UPSERT_OVERWRITE (sinon le véhicule garde son propriétaire actuel).
  const ownerChanged = existing && existing.customerId !== owner.id;
  const applyOwnerChange = ownerChanged && policy === "UPSERT_OVERWRITE";

  if (dryRun || merge.outcome === "skip" || merge.outcome === "unchanged") {
    if (!applyOwnerChange) {
      return { outcome: merge.outcome, vehicleId: existing?.id ?? null };
    }
  }

  if (dryRun) {
    return {
      outcome: applyOwnerChange ? "update" : merge.outcome,
      vehicleId: existing?.id ?? null,
    };
  }

  if (merge.outcome === "create") {
    // RG-M13-16 garantit `plate` déjà présent en amont (ligne invalidée et
    // exclue de l'apply sinon) : `plate` est requis en base (`Vehicle.plate`).
    const created = await tenantDb.vehicle.create({
      data: {
        organizationId,
        customerId: owner.id,
        origin: "IMPORTED",
        make: "Inconnue",
        model: "Inconnu",
        ...fields,
        plate: plate!,
        // M02 (RG-M02-05) : unicité par organisation sur plateCompact.
        plateCompact: normalizePlate(plate!).plateCompact,
        plateType: normalizePlate(plate!).plateType,
      },
    });
    await writeAuditLog({
      organizationId,
      userId: input.userId ?? null,
      membershipId: input.membershipId ?? null,
      action: "import.vehicle.created",
      entity: "Vehicle",
      entityId: created.id,
      after: created,
      reason: `import:${jobId}`,
    });
    return { outcome: "create", vehicleId: created.id };
  }

  if (merge.outcome === "update" || applyOwnerChange) {
    const before = existing!;
    const patch = { ...merge.patch, ...(applyOwnerChange ? { customerId: owner.id } : {}) };
    const updated = await tenantDb.vehicle.update({ where: { id: before.id }, data: patch });
    if (applyOwnerChange) {
      await tenantDb.vehicleEvent.create({
        data: {
          organizationId,
          vehicleId: before.id,
          type: "OWNER_CHANGED",
          occurredAt: new Date(),
          data: { fromCustomerId: before.customerId, toCustomerId: owner.id, source: "import" },
        },
      });
    }
    await writeAuditLog({
      organizationId,
      userId: input.userId ?? null,
      membershipId: input.membershipId ?? null,
      action: "import.vehicle.updated",
      entity: "Vehicle",
      entityId: updated.id,
      before,
      after: updated,
      reason: `import:${jobId}`,
    });
    return { outcome: "update", vehicleId: updated.id };
  }

  return { outcome: merge.outcome, vehicleId: existing?.id ?? null };
}
