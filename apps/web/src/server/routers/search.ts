import { adminDb, Prisma } from "@atelieros/db";
import { searchGlobalInputSchema } from "@atelieros/validators";
import { requirePermission, router } from "../trpc";

/** Préfixes de numéro de document reconnus par RG-M02-19 (seuls `OR`/`DEV`/`FAC`/`BC` ont un modèle à ce jour). */
const DOCUMENT_PREFIXES = ["OR-", "DEV-", "FAC-", "AV-", "REC-", "BC-"] as const;

interface CustomerResult {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  rank: number;
  lastVisitAt: Date | null;
}

interface VehicleResult {
  id: string;
  plate: string;
  make: string;
  model: string;
  customerId: string;
  customerDisplayName: string;
  rank: number;
}

interface DocumentResult {
  id: string;
  type: "repair_order" | "quote" | "invoice" | "purchase_order";
  number: string;
  customerId: string | null;
  rank: number;
  createdAt: Date;
}

/**
 * Routeur `search.*` — recherche globale (RG-M02-19). Déviation documentée : `AV-`/`REC-`
 * (avoir, réception) n'ont pas encore de modèle (modules pas construits) ; seuls
 * `OR-`/`DEV-`/`FAC-`/`BC-` sont cherchés par numéro. Lecture via `adminDb.$queryRaw`
 * (fonctions SQL `similarity`/`unaccent` hors du client Prisma typé), filtrage manuel par
 * organisation ; documents en plus filtrés par site autorisé (RG-M01-09).
 */
export const searchRouter = router({
  global: requirePermission("customer:read")
    .input(searchGlobalInputSchema)
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId;
      const limit = input.limit;
      const q = input.q.trim();
      const digits = q.replace(/\D/g, "");
      const plateCandidate = q.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const upperQ = q.toUpperCase();
      // Un numéro de téléphone ne contient jamais de lettres (contrairement à une plaque
      // « 1234 AB 01 ») : on l'exige pour départager les deux cas, tous deux ≥ 4 chiffres.
      const isPhoneLike = digits.length >= 4 && !/[A-Za-z]/.test(q);
      const isPlateLike = plateCandidate.length >= 4 && /\d/.test(plateCandidate);
      const documentPrefix = DOCUMENT_PREFIXES.find((p) => upperQ.startsWith(p));
      const isDocumentLike = Boolean(documentPrefix) || /^\d+$/.test(digits.length > 0 ? q : "");

      // RG-M01-09 — documents limités aux sites autorisés pour la session.
      const siteFilter =
        ctx.allowedSiteIds === "ALL"
          ? Prisma.empty
          : Prisma.sql`AND "siteId" IN (${Prisma.join(ctx.allowedSiteIds)})`;

      let customers: CustomerResult[] = [];
      let vehicles: VehicleResult[] = [];
      let documents: DocumentResult[] = [];

      if (isPhoneLike) {
        // RG-M02-19 — numéro ressemblant à un téléphone : recherche par suffixe.
        const suffix = `%${digits}`;
        customers = await adminDb.$queryRaw<CustomerResult[]>`
          SELECT id, "displayName", phone, email, 3 AS rank, "lastVisitAt"
          FROM "Customer"
          WHERE "organizationId" = ${organizationId} AND "deletedAt" IS NULL
            AND (phone LIKE ${suffix} OR phone2 LIKE ${suffix} OR "whatsappPhone" LIKE ${suffix})
          ORDER BY "lastVisitAt" DESC NULLS LAST
          LIMIT ${limit}
        `;
        vehicles = await adminDb.$queryRaw<VehicleResult[]>`
          SELECT v.id, v.plate, v.make, v.model, v."customerId", c."displayName" AS "customerDisplayName",
                 3 AS rank
          FROM "Vehicle" v
          JOIN "Customer" c ON c.id = v."customerId"
          WHERE v."organizationId" = ${organizationId} AND v."deletedAt" IS NULL
            AND v."driverPhone" LIKE ${suffix}
          LIMIT ${limit}
        `;
        if (vehicles.length < limit) {
          const viaContact = await adminDb.$queryRaw<VehicleResult[]>`
            SELECT v.id, v.plate, v.make, v.model, v."customerId", c."displayName" AS "customerDisplayName",
                   3 AS rank
            FROM "CustomerContact" cc
            JOIN "Customer" c ON c.id = cc."customerId"
            JOIN "Vehicle" v ON v."customerId" = c.id
            WHERE cc."organizationId" = ${organizationId} AND cc."deletedAt" IS NULL AND v."deletedAt" IS NULL
              AND cc.phone LIKE ${suffix}
            LIMIT ${limit}
          `;
          vehicles = [...vehicles, ...viaContact].slice(0, limit);
        }
      } else if (isDocumentLike) {
        // RG-M02-19 — préfixe de document ou nombre : recherche par `number`.
        const pattern = `%${q.toUpperCase()}%`;
        const [orders, quotes, invoices, purchaseOrders] = await Promise.all([
          adminDb.$queryRaw<DocumentResult[]>`
            SELECT id, 'repair_order' AS type, number, "customerId", 3 AS rank, "createdAt"
            FROM "RepairOrder"
            WHERE "organizationId" = ${organizationId} AND UPPER(number) LIKE ${pattern}
              ${siteFilter}
            ORDER BY "createdAt" DESC
            LIMIT ${limit}
          `,
          adminDb.$queryRaw<DocumentResult[]>`
            SELECT id, 'quote' AS type, number, "customerId", 3 AS rank, "createdAt"
            FROM "Quote"
            WHERE "organizationId" = ${organizationId} AND UPPER(number) LIKE ${pattern}
              ${siteFilter}
            ORDER BY "createdAt" DESC
            LIMIT ${limit}
          `,
          adminDb.$queryRaw<DocumentResult[]>`
            SELECT id, 'invoice' AS type, number, "customerId", 3 AS rank, "createdAt"
            FROM "Invoice"
            WHERE "organizationId" = ${organizationId} AND number IS NOT NULL AND UPPER(number) LIKE ${pattern}
              ${siteFilter}
            ORDER BY "createdAt" DESC
            LIMIT ${limit}
          `,
          adminDb.$queryRaw<DocumentResult[]>`
            SELECT id, 'purchase_order' AS type, number, NULL AS "customerId", 3 AS rank,
                   COALESCE("orderedAt", "expectedAt", "receivedAt", TIMESTAMP '1970-01-01') AS "createdAt"
            FROM "PurchaseOrder"
            WHERE "organizationId" = ${organizationId} AND UPPER(number) LIKE ${pattern}
              ${siteFilter}
            LIMIT ${limit}
          `,
        ]);
        documents = [...orders, ...quotes, ...invoices, ...purchaseOrders]
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, limit);
      } else if (isPlateLike) {
        // RG-M02-19 — ressemble à une plaque : ILIKE d'abord, similarité trigram ensuite.
        const pattern = `%${plateCandidate}%`;
        vehicles = await adminDb.$queryRaw<VehicleResult[]>`
          SELECT v.id, v.plate, v.make, v.model, v."customerId", c."displayName" AS "customerDisplayName",
                 CASE WHEN v."plateCompact" = ${plateCandidate} THEN 3
                      WHEN v."plateCompact" LIKE ${pattern} THEN 2
                      ELSE 1 END AS rank
          FROM "Vehicle" v
          JOIN "Customer" c ON c.id = v."customerId"
          WHERE v."organizationId" = ${organizationId} AND v."deletedAt" IS NULL
            AND (v."plateCompact" LIKE ${pattern} OR similarity(v."plateCompact", ${plateCandidate}) > 0.3)
          ORDER BY rank DESC, similarity(v."plateCompact", ${plateCandidate}) DESC
          LIMIT ${limit}
        `;
      } else {
        // RG-M02-19 — similarité trigram sur noms (clients, contacts) et véhicules (VIN, n° flotte).
        const normalized = q.toLowerCase();
        customers = await adminDb.$queryRaw<CustomerResult[]>`
          SELECT id, "displayName", phone, email,
                 GREATEST(
                   similarity(unaccent(lower("displayName")), unaccent(${normalized})),
                   similarity(unaccent(lower(COALESCE("companyName", ''))), unaccent(${normalized}))
                 ) AS rank,
                 "lastVisitAt"
          FROM "Customer"
          WHERE "organizationId" = ${organizationId} AND "deletedAt" IS NULL
            AND (
              similarity(unaccent(lower("displayName")), unaccent(${normalized})) > 0.3
              OR similarity(unaccent(lower(COALESCE("companyName", ''))), unaccent(${normalized})) > 0.3
            )
          ORDER BY rank DESC, "lastVisitAt" DESC NULLS LAST
          LIMIT ${limit}
        `;
        if (customers.length < limit) {
          const viaContact = await adminDb.$queryRaw<CustomerResult[]>`
            SELECT c.id, c."displayName", c.phone, c.email,
                   similarity(unaccent(lower(cc.name)), unaccent(${normalized})) AS rank,
                   c."lastVisitAt"
            FROM "CustomerContact" cc
            JOIN "Customer" c ON c.id = cc."customerId"
            WHERE cc."organizationId" = ${organizationId} AND cc."deletedAt" IS NULL AND c."deletedAt" IS NULL
              AND similarity(unaccent(lower(cc.name)), unaccent(${normalized})) > 0.3
            ORDER BY rank DESC
            LIMIT ${limit}
          `;
          const seen = new Set(customers.map((c) => c.id));
          for (const row of viaContact) {
            if (!seen.has(row.id)) {
              customers.push(row);
              seen.add(row.id);
            }
          }
          customers = customers.slice(0, limit);
        }
        vehicles = await adminDb.$queryRaw<VehicleResult[]>`
          SELECT v.id, v.plate, v.make, v.model, v."customerId", c."displayName" AS "customerDisplayName",
                 GREATEST(
                   similarity(lower(COALESCE(v.vin, '')), ${normalized}),
                   similarity(lower(COALESCE(v."fleetNumber", '')), ${normalized})
                 ) AS rank
          FROM "Vehicle" v
          JOIN "Customer" c ON c.id = v."customerId"
          WHERE v."organizationId" = ${organizationId} AND v."deletedAt" IS NULL
            AND (
              similarity(lower(COALESCE(v.vin, '')), ${normalized}) > 0.3
              OR similarity(lower(COALESCE(v."fleetNumber", '')), ${normalized}) > 0.3
            )
          ORDER BY rank DESC
          LIMIT ${limit}
        `;
      }

      return { customers, vehicles, documents };
    }),
});
