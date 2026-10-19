import { adminDb, Prisma } from "@atelieros/db";

// La similarité trigramme (pg_trgm) n'a pas d'équivalent dans le query-builder Prisma :
// ces requêtes passent donc par $queryRaw sur adminDb (connexion superutilisateur, hors RLS),
// ce qui impose de rattacher organizationId à la main dans chaque requête (jamais omis ci-dessous)
// pour préserver l'isolation multi-locataire malgré le contournement de db.forTenant().

export interface CustomerNameMatch {
  id: string;
  displayName: string;
  similarity: number;
}

const NAME_SIMILARITY_THRESHOLD = 0.3;

/** RG-M02-07/19 — les displayName les plus proches de `name`, par similarité trigramme décroissante. */
export async function findSimilarCustomerNames(
  organizationId: string,
  name: string,
  excludeId?: string,
  limit = 5,
): Promise<CustomerNameMatch[]> {
  return adminDb.$queryRaw<CustomerNameMatch[]>(Prisma.sql`
    SELECT id, "displayName", similarity("displayName", ${name}) AS similarity
    FROM "Customer"
    WHERE "organizationId" = ${organizationId}
      AND "deletedAt" IS NULL
      AND similarity("displayName", ${name}) >= ${NAME_SIMILARITY_THRESHOLD}
      ${excludeId ? Prisma.sql`AND id <> ${excludeId}` : Prisma.empty}
    ORDER BY similarity DESC
    LIMIT ${limit}
  `);
}

export interface CustomerSearchHit {
  id: string;
  displayName: string;
  phone: string | null;
  rank: number;
}

/** RG-M02-19 — recherche globale (sous-ensemble clients) : exact > préfixe > similarité trigramme. */
export async function searchCustomers(
  organizationId: string,
  query: string,
  limit = 5,
): Promise<CustomerSearchHit[]> {
  return adminDb.$queryRaw<CustomerSearchHit[]>(Prisma.sql`
    SELECT id, "displayName", phone,
      CASE
        WHEN unaccent(lower("displayName")) = unaccent(lower(${query})) THEN 3
        WHEN unaccent(lower("displayName")) LIKE unaccent(lower(${query})) || '%' THEN 2
        ELSE 1
      END AS rank
    FROM "Customer"
    WHERE "organizationId" = ${organizationId}
      AND "deletedAt" IS NULL
      AND (
        unaccent(lower("displayName")) % unaccent(lower(${query}))
        OR unaccent(lower("displayName")) LIKE '%' || unaccent(lower(${query})) || '%'
        OR phone LIKE '%' || ${query}
        OR phone2 LIKE '%' || ${query}
        OR "whatsappPhone" LIKE '%' || ${query}
      )
    ORDER BY rank DESC, "lastVisitAt" DESC NULLS LAST
    LIMIT ${limit}
  `);
}

export interface VehicleSearchHit {
  id: string;
  plate: string;
  make: string;
  model: string;
  customerId: string;
  rank: number;
}

/** RG-M02-19 — recherche globale (sous-ensemble véhicules) : plaque (ILIKE puis trigramme) ou VIN. */
export async function searchVehicles(
  organizationId: string,
  query: string,
  limit = 5,
): Promise<VehicleSearchHit[]> {
  const compact = query.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return adminDb.$queryRaw<VehicleSearchHit[]>(Prisma.sql`
    SELECT id, plate, make, model, "customerId",
      CASE
        WHEN "plateCompact" = ${compact} THEN 3
        WHEN "plateCompact" LIKE ${compact} || '%' THEN 2
        ELSE 1
      END AS rank
    FROM "Vehicle"
    WHERE "organizationId" = ${organizationId}
      AND "deletedAt" IS NULL
      AND (
        "plateCompact" LIKE '%' || ${compact} || '%'
        OR "plateCompact" % ${compact}
        OR (vin IS NOT NULL AND vin ILIKE '%' || ${query} || '%')
      )
    ORDER BY rank DESC
    LIMIT ${limit}
  `);
}
