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

/** Échappe `%`, `_` et `\\` pour un motif LIKE construit à partir d'une saisie utilisateur. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface CustomerSearchHit {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  lastVisitAt: Date | null;
  /** RG-M02-19 : plus grand = plus pertinent (exact > préfixe > similarité). */
  rank: number;
  /** Nom du contact (`CustomerContact`) par lequel le client a été trouvé, le cas échéant. */
  matchedContactName: string | null;
}

/**
 * RG-M02-19 — clients dont un téléphone (fiche ou contact) se termine par `digits`. Téléphone
 * principal (3) > secondaire/WhatsApp (2) > contact (1), puis dernière visite.
 */
export async function searchCustomersByPhone(
  organizationId: string,
  digits: string,
  limit = 5,
): Promise<CustomerSearchHit[]> {
  const suffix = `%${escapeLike(digits)}`;
  return adminDb.$queryRaw<CustomerSearchHit[]>(Prisma.sql`
    SELECT c.id, c."displayName", c.phone, c.email, c."lastVisitAt",
      CASE
        WHEN c.phone LIKE ${suffix} THEN 3
        WHEN c.phone2 LIKE ${suffix} OR c."whatsappPhone" LIKE ${suffix} THEN 2
        ELSE 1
      END AS rank,
      (
        SELECT cc.name FROM "CustomerContact" cc
        WHERE cc."customerId" = c.id AND cc."organizationId" = ${organizationId}
          AND cc."deletedAt" IS NULL
          AND (cc.phone LIKE ${suffix} OR cc.phone2 LIKE ${suffix})
        LIMIT 1
      ) AS "matchedContactName"
    FROM "Customer" c
    WHERE c."organizationId" = ${organizationId}
      AND c."deletedAt" IS NULL
      AND (
        c.phone LIKE ${suffix} OR c.phone2 LIKE ${suffix} OR c."whatsappPhone" LIKE ${suffix}
        OR EXISTS (
          SELECT 1 FROM "CustomerContact" cc
          WHERE cc."customerId" = c.id AND cc."organizationId" = ${organizationId}
            AND cc."deletedAt" IS NULL
            AND (cc.phone LIKE ${suffix} OR cc.phone2 LIKE ${suffix})
        )
      )
    ORDER BY rank DESC, c."lastVisitAt" DESC NULLS LAST
    LIMIT ${limit}
  `);
}

/**
 * RG-M02-19 — clients par nom : `displayName`, `companyName` et noms de contacts, sans accents
 * ni casse. Exact > préfixe > (sous-chaîne ou similarité trigramme ≥ 0,3), puis similarité,
 * puis dernière visite.
 */
export async function searchCustomersByName(
  organizationId: string,
  query: string,
  limit = 5,
): Promise<CustomerSearchHit[]> {
  const q = query.toLowerCase();
  const contains = `%${escapeLike(q)}%`;
  const prefix = `${escapeLike(q)}%`;
  return adminDb.$queryRaw<CustomerSearchHit[]>(Prisma.sql`
    WITH contact_match AS (
      SELECT DISTINCT ON (cc."customerId") cc."customerId", cc.name,
        similarity(unaccent(lower(cc.name)), unaccent(${q})) AS score
      FROM "CustomerContact" cc
      WHERE cc."organizationId" = ${organizationId}
        AND cc."deletedAt" IS NULL
        AND (
          unaccent(lower(cc.name)) % unaccent(${q})
          OR unaccent(lower(cc.name)) LIKE unaccent(${contains})
        )
      ORDER BY cc."customerId", score DESC
    )
    SELECT c.id, c."displayName", c.phone, c.email, c."lastVisitAt",
      CASE
        WHEN unaccent(lower(c."displayName")) = unaccent(${q})
          OR unaccent(lower(COALESCE(c."companyName", ''))) = unaccent(${q}) THEN 3
        WHEN unaccent(lower(c."displayName")) LIKE unaccent(${prefix})
          OR unaccent(lower(COALESCE(c."companyName", ''))) LIKE unaccent(${prefix}) THEN 2
        ELSE 1
      END AS rank,
      CASE
        WHEN unaccent(lower(c."displayName")) % unaccent(${q})
          OR unaccent(lower(c."displayName")) LIKE unaccent(${contains})
          OR unaccent(lower(COALESCE(c."companyName", ''))) % unaccent(${q})
          OR unaccent(lower(COALESCE(c."companyName", ''))) LIKE unaccent(${contains})
        THEN NULL ELSE m.name
      END AS "matchedContactName"
    FROM "Customer" c
    LEFT JOIN contact_match m ON m."customerId" = c.id
    WHERE c."organizationId" = ${organizationId}
      AND c."deletedAt" IS NULL
      AND (
        unaccent(lower(c."displayName")) % unaccent(${q})
        OR unaccent(lower(c."displayName")) LIKE unaccent(${contains})
        OR unaccent(lower(COALESCE(c."companyName", ''))) % unaccent(${q})
        OR unaccent(lower(COALESCE(c."companyName", ''))) LIKE unaccent(${contains})
        OR m."customerId" IS NOT NULL
      )
    ORDER BY rank DESC,
      GREATEST(
        similarity(unaccent(lower(c."displayName")), unaccent(${q})),
        similarity(unaccent(lower(COALESCE(c."companyName", ''))), unaccent(${q})),
        COALESCE(m.score, 0)
      ) DESC,
      c."lastVisitAt" DESC NULLS LAST
    LIMIT ${limit}
  `);
}

export interface VehicleSearchHit {
  id: string;
  plate: string;
  make: string;
  model: string;
  customerId: string;
  customerDisplayName: string;
  rank: number;
}

/**
 * RG-M02-19 — véhicules par plaque : sous-chaîne de `plateCompact` (confusions 0/O et 1/I
 * tolérées, RG-M02-05) puis similarité trigramme. Exact > préfixe > le reste.
 */
export async function searchVehiclesByPlate(
  organizationId: string,
  plateLoose: string,
  limit = 5,
): Promise<VehicleSearchHit[]> {
  const contains = `%${escapeLike(plateLoose)}%`;
  const prefix = `${escapeLike(plateLoose)}%`;
  return adminDb.$queryRaw<VehicleSearchHit[]>(Prisma.sql`
    SELECT v.id, v.plate, v.make, v.model, v."customerId", c."displayName" AS "customerDisplayName",
      CASE
        WHEN translate(v."plateCompact", 'OI', '01') = ${plateLoose} THEN 3
        WHEN translate(v."plateCompact", 'OI', '01') LIKE ${prefix} THEN 2
        ELSE 1
      END AS rank
    FROM "Vehicle" v
    JOIN "Customer" c ON c.id = v."customerId"
    WHERE v."organizationId" = ${organizationId}
      AND v."deletedAt" IS NULL
      AND (
        translate(v."plateCompact", 'OI', '01') LIKE ${contains}
        OR v."plateCompact" % ${plateLoose}
      )
    ORDER BY rank DESC, similarity(translate(v."plateCompact", 'OI', '01'), ${plateLoose}) DESC,
      c."lastVisitAt" DESC NULLS LAST
    LIMIT ${limit}
  `);
}

/** RG-M02-19 — véhicules dont le téléphone du chauffeur se termine par `digits`. */
export async function searchVehiclesByDriverPhone(
  organizationId: string,
  digits: string,
  limit = 5,
): Promise<VehicleSearchHit[]> {
  const suffix = `%${escapeLike(digits)}`;
  return adminDb.$queryRaw<VehicleSearchHit[]>(Prisma.sql`
    SELECT v.id, v.plate, v.make, v.model, v."customerId", c."displayName" AS "customerDisplayName",
      1 AS rank
    FROM "Vehicle" v
    JOIN "Customer" c ON c.id = v."customerId"
    WHERE v."organizationId" = ${organizationId}
      AND v."deletedAt" IS NULL
      AND v."driverPhone" LIKE ${suffix}
    ORDER BY c."lastVisitAt" DESC NULLS LAST
    LIMIT ${limit}
  `);
}

/** RG-M02-19 — véhicules par VIN ou numéro de flotte (sous-chaîne puis similarité trigramme). */
export async function searchVehiclesByIdentifier(
  organizationId: string,
  query: string,
  limit = 5,
): Promise<VehicleSearchHit[]> {
  const q = query.toLowerCase();
  const contains = `%${escapeLike(q)}%`;
  return adminDb.$queryRaw<VehicleSearchHit[]>(Prisma.sql`
    SELECT v.id, v.plate, v.make, v.model, v."customerId", c."displayName" AS "customerDisplayName",
      CASE
        WHEN lower(COALESCE(v.vin, '')) = ${q} OR lower(COALESCE(v."fleetNumber", '')) = ${q} THEN 3
        WHEN lower(COALESCE(v.vin, '')) LIKE ${`${escapeLike(q)}%`}
          OR lower(COALESCE(v."fleetNumber", '')) LIKE ${`${escapeLike(q)}%`} THEN 2
        ELSE 1
      END AS rank
    FROM "Vehicle" v
    JOIN "Customer" c ON c.id = v."customerId"
    WHERE v."organizationId" = ${organizationId}
      AND v."deletedAt" IS NULL
      AND (
        lower(COALESCE(v.vin, '')) LIKE ${contains}
        OR lower(COALESCE(v."fleetNumber", '')) LIKE ${contains}
        OR lower(COALESCE(v.vin, '')) % ${q}
        OR lower(COALESCE(v."fleetNumber", '')) % ${q}
      )
    ORDER BY rank DESC,
      GREATEST(
        similarity(lower(COALESCE(v.vin, '')), ${q}),
        similarity(lower(COALESCE(v."fleetNumber", '')), ${q})
      ) DESC
    LIMIT ${limit}
  `);
}
