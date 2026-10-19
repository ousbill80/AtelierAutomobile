/**
 * RG-M13-24 — annulation d'un import (`imports.rollback`) via l'historique
 * `AuditLog` (chaque ligne créée/mise à jour par `apply*Row` écrit une entrée
 * `reason = "import:{jobId}"`). Refus si un enregistrement a été modifié par
 * une action postérieure non liée à cet import (conflit listé, rien n'est
 * annulé).
 *
 * Portée actuelle — limitée à `customers` et `vehicles` :
 * - `invoices`/`payments` touchent de l'argent (soldes, paiements de reprise
 *   `OPENING`/`IMPORT-SOLDE`, allocations). Les annuler automatiquement
 *   risquerait de laisser un solde de facture incohérent (ex. une facture
 *   dont le paiement de reprise est supprimé mais dont le statut `PAID` ne
 *   serait pas recalculé). CLAUDE.md impose que les corrections financières
 *   passent par un mécanisme explicite (avoir) plutôt qu'une réécriture
 *   automatique de l'historique : l'annulation de ces deux entités est donc
 *   refusée ici avec un message clair, plutôt que d'être implémentée à moitié.
 *   Limite documentée, à lever dans une étape ultérieure si besoin.
 */
import type { db } from "@atelieros/db";
import type { SupportedEntity } from "./simulate";

export type TenantDb = ReturnType<typeof db.forTenant>;

export interface RollbackConflict {
  entityId: string;
  reason: string;
}

export interface RollbackImportResult {
  reverted: number;
  conflicts: RollbackConflict[];
}

export interface RollbackImportInput {
  tenantDb: TenantDb;
  entity: SupportedEntity;
  jobId: string;
}

type RollbackableEntity = "customers" | "vehicles";

const DELEGATE_BY_ENTITY: Record<RollbackableEntity, string> = {
  customers: "customer",
  vehicles: "vehicle",
};

const AUDIT_ENTITY_LABEL: Record<RollbackableEntity, string> = {
  customers: "Customer",
  vehicles: "Vehicle",
};

/** Champs restaurables depuis `AuditLog.before` (sous-ensemble des champs que l'import écrit réellement). */
const RESTORABLE_FIELDS: Record<RollbackableEntity, readonly string[]> = {
  customers: ["displayName", "firstName", "lastName", "phone", "phone2", "email", "ncc"],
  vehicles: [
    "plate",
    "make",
    "model",
    "vin",
    "year",
    "inspectionExpiryDate",
    "lastServiceDate",
    "lastServiceMileage",
    "currentMileage",
  ],
};

function isRollbackable(entity: SupportedEntity): entity is RollbackableEntity {
  return entity === "customers" || entity === "vehicles";
}

function restorablePatch(
  entity: RollbackableEntity,
  before: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const field of RESTORABLE_FIELDS[entity]) {
    if (field in before) patch[field] = before[field];
  }
  return patch;
}

/** RG-M13-24 — annule un import `customers`/`vehicles` pendant sa fenêtre de 7 jours, via `AuditLog`. */
export async function rollbackImport(input: RollbackImportInput): Promise<RollbackImportResult> {
  const { tenantDb, entity, jobId } = input;

  if (!isRollbackable(entity)) {
    return {
      reverted: 0,
      conflicts: [
        {
          entityId: "*",
          reason:
            "L'annulation automatique n'est pas prise en charge pour les factures et paiements importés (risque d'incohérence du solde) : corrigez via un avoir ou un paiement manuel.",
        },
      ],
    };
  }

  const delegateName = DELEGATE_BY_ENTITY[entity];
  const delegate = (
    tenantDb as unknown as Record<string, Record<string, (args: unknown) => Promise<unknown>>>
  )[delegateName]!;
  const auditEntity = AUDIT_ENTITY_LABEL[entity];
  const createdAction = `import.${entity === "customers" ? "customer" : "vehicle"}.created`;
  const updatedAction = `import.${entity === "customers" ? "customer" : "vehicle"}.updated`;

  const entries = (await tenantDb.auditLog.findMany({
    where: { entity: auditEntity, reason: `import:${jobId}` },
    orderBy: { createdAt: "asc" },
  })) as Array<{
    entityId: string;
    action: string;
    createdAt: Date;
    before: unknown;
  }>;

  const conflicts: RollbackConflict[] = [];
  for (const entry of entries) {
    const laterAction = await tenantDb.auditLog.findFirst({
      where: {
        entity: auditEntity,
        entityId: entry.entityId,
        createdAt: { gt: entry.createdAt },
        NOT: { reason: `import:${jobId}` },
      },
    });
    if (laterAction) {
      conflicts.push({ entityId: entry.entityId, reason: "Modifié depuis l'import." });
    }
  }

  if (conflicts.length > 0) {
    return { reverted: 0, conflicts };
  }

  let reverted = 0;
  for (const entry of entries) {
    if (entry.action === createdAction) {
      try {
        await delegate.delete!({ where: { id: entry.entityId } });
        reverted += 1;
      } catch {
        conflicts.push({
          entityId: entry.entityId,
          reason: "Enregistrement référencé ailleurs, suppression impossible.",
        });
      }
    } else if (entry.action === updatedAction && entry.before) {
      const patch = restorablePatch(entity, entry.before as Record<string, unknown>);
      await delegate.update!({ where: { id: entry.entityId }, data: patch });
      reverted += 1;
    }
  }

  await tenantDb.importJob.update({
    where: { id: jobId },
    data: { status: "ROLLED_BACK", rolledBackAt: new Date() },
  });

  return { reverted, conflicts };
}
