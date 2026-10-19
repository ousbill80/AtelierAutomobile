import { adminDb, Prisma } from "@atelieros/db";
import { computeDuplicateScore, type DuplicateScoreResult } from "@atelieros/core";

export interface DuplicateCandidate extends DuplicateScoreResult {
  customerId: string;
  displayName: string;
}

export interface FindDuplicateCandidatesInput {
  organizationId: string;
  name: string;
  phoneE164s: string[];
  email?: string | null;
  ncc?: string | null;
  commune?: string | null;
  vehiclePlateCompacts?: string[];
  vehicleVins?: string[];
  excludeId?: string;
}

interface CandidateRow {
  id: string;
  displayName: string;
  commune: string | null;
  phone: string | null;
  phone2: string | null;
  whatsappPhone: string | null;
  email: string | null;
  ncc: string | null;
  similarity: number;
}

const CANDIDATE_COLUMNS = Prisma.sql`id, "displayName", commune, phone, phone2, "whatsappPhone", email, ncc`;

/**
 * RG-M02-07 — recherche des candidats doublons pour un client : 5 meilleurs par similarité
 * trigram du nom (`pg_trgm`), plus toute correspondance exacte (téléphone, email, NCC,
 * véhicule partagé). Lecture directe via `adminDb` (requêtes `$queryRaw` hors des opérations
 * de modèle couvertes par `db.forTenant()`) avec filtrage manuel par organisation — même
 * exception documentée que `VehicleMake`/`VehicleModel` (packages/db/prisma/schema.prisma).
 */
export async function findDuplicateCandidates(
  input: FindDuplicateCandidatesInput,
): Promise<DuplicateCandidate[]> {
  const { organizationId, excludeId } = input;
  const excludeClause = excludeId ? Prisma.sql`AND id != ${excludeId}` : Prisma.empty;

  const trigramRows = await adminDb.$queryRaw<CandidateRow[]>`
    SELECT ${CANDIDATE_COLUMNS}, similarity("displayName", ${input.name}) AS similarity
    FROM "Customer"
    WHERE "organizationId" = ${organizationId}
      AND "deletedAt" IS NULL
      ${excludeClause}
    ORDER BY similarity DESC
    LIMIT 5
  `;

  const exactConditions: Prisma.Sql[] = [];
  if (input.phoneE164s.length > 0) {
    exactConditions.push(Prisma.sql`phone IN (${Prisma.join(input.phoneE164s)})`);
    exactConditions.push(Prisma.sql`phone2 IN (${Prisma.join(input.phoneE164s)})`);
    exactConditions.push(Prisma.sql`"whatsappPhone" IN (${Prisma.join(input.phoneE164s)})`);
  }
  if (input.email) {
    exactConditions.push(Prisma.sql`email = ${input.email}`);
  }
  if (input.ncc) {
    exactConditions.push(Prisma.sql`ncc = ${input.ncc}`);
  }

  let exactRows: CandidateRow[] = [];
  if (exactConditions.length > 0) {
    exactRows = await adminDb.$queryRaw<CandidateRow[]>`
      SELECT ${CANDIDATE_COLUMNS}, similarity("displayName", ${input.name}) AS similarity
      FROM "Customer"
      WHERE "organizationId" = ${organizationId}
        AND "deletedAt" IS NULL
        ${excludeClause}
        AND (${Prisma.join(exactConditions, " OR ")})
    `;
  }

  const plates = (input.vehiclePlateCompacts ?? []).filter(Boolean);
  const vins = (input.vehicleVins ?? []).filter(Boolean);
  let sharedVehicleCustomerIds: string[] = [];
  if (plates.length > 0 || vins.length > 0) {
    const vehicleConditions: Prisma.Sql[] = [];
    if (plates.length > 0) {
      vehicleConditions.push(Prisma.sql`"plateCompact" IN (${Prisma.join(plates)})`);
    }
    if (vins.length > 0) {
      vehicleConditions.push(Prisma.sql`vin IN (${Prisma.join(vins)})`);
    }
    const vehicleRows = await adminDb.$queryRaw<{ customerId: string }[]>`
      SELECT DISTINCT "customerId"
      FROM "Vehicle"
      WHERE "organizationId" = ${organizationId}
        AND "deletedAt" IS NULL
        AND (${Prisma.join(vehicleConditions, " OR ")})
    `;
    sharedVehicleCustomerIds = vehicleRows.map((r) => r.customerId);
  }

  const byId = new Map<string, CandidateRow>();
  for (const row of [...trigramRows, ...exactRows]) {
    byId.set(row.id, row);
  }

  const missingSharedIds = sharedVehicleCustomerIds.filter(
    (id) => !byId.has(id) && id !== excludeId,
  );
  if (missingSharedIds.length > 0) {
    const detailRows = await adminDb.$queryRaw<CandidateRow[]>`
      SELECT ${CANDIDATE_COLUMNS}, similarity("displayName", ${input.name}) AS similarity
      FROM "Customer"
      WHERE "organizationId" = ${organizationId}
        AND "deletedAt" IS NULL
        AND id IN (${Prisma.join(missingSharedIds)})
    `;
    for (const row of detailRows) {
      byId.set(row.id, row);
    }
  }

  const sharedVehicleSet = new Set(sharedVehicleCustomerIds);
  const phoneSet = new Set(input.phoneE164s);

  const candidates: DuplicateCandidate[] = [];
  for (const row of byId.values()) {
    const score = computeDuplicateScore({
      samePhone:
        (row.phone != null && phoneSet.has(row.phone)) ||
        (row.phone2 != null && phoneSet.has(row.phone2)) ||
        (row.whatsappPhone != null && phoneSet.has(row.whatsappPhone)),
      sameEmail: Boolean(input.email) && row.email === input.email,
      sameNcc: Boolean(input.ncc) && row.ncc === input.ncc,
      displayNameSimilarity: Number(row.similarity) || 0,
      sameCommune: Boolean(input.commune) && row.commune === input.commune,
      sharedVehicle: sharedVehicleSet.has(row.id),
    });
    candidates.push({ customerId: row.id, displayName: row.displayName, ...score });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}
