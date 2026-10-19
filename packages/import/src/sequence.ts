/**
 * Implémentation DB de `SequenceStore` (contrat défini dans
 * `@atelieros/core/numbering`) : incrémente `DocumentSequence.lastValue`.
 * Utilisée ici pour numéroter les reçus (`REC-AAAA-NNNNNN`) des paiements de
 * reprise importés (RG-M13-20/21).
 *
 * Note d'implémentation — `DocumentSequence.siteId` est nullable (un document
 * fiscal comme `REC`/`FAC` force `siteId = null`, cf. `isFiscalDocumentType`
 * dans `core/numbering`), ce que l'index unique Postgres
 * `organizationId_siteId_docType_year` ne peut pas garantir (`NULL` n'est
 * jamais égal à `NULL`, donc deux lignes `siteId = null` pour le même
 * `(organizationId, docType, year)` ne sont jamais détectées en conflit) —
 * un `UPSERT` `ON CONFLICT DO UPDATE` typé sur cette clé composée est donc à
 * la fois rejeté par Prisma à la compilation (`siteId` y est typé `string`,
 * pas `string | null`) et, même contourné, non atomique pour les documents
 * fiscaux. On utilise donc un `findFirst` + `update`/`create` : correct et
 * sans trou pour l'usage réel (lignes d'un même job traitées séquentiellement
 * dans le worker, jamais en parallèle sur la même clé), mais pas protégé
 * contre deux appels strictement concurrents sur la même clé entre deux
 * processus — hors périmètre de cette étape (nécessiterait soit des index
 * partiels Postgres maintenus à la main hors `schema.prisma`, soit un verrou
 * applicatif explicite).
 */
import type { db } from "@atelieros/db";
import type { DocumentSequenceKey, SequenceStore } from "@atelieros/core";

export type TenantDb = ReturnType<typeof db.forTenant>;

export function createSequenceStore(tenantDb: TenantDb): SequenceStore {
  return {
    async getAndIncrement(key: DocumentSequenceKey): Promise<number> {
      const where = {
        organizationId: key.organizationId,
        siteId: key.siteId,
        docType: key.docType,
        year: key.year,
      };
      const existing = await tenantDb.documentSequence.findFirst({ where });
      if (existing) {
        const updated = await tenantDb.documentSequence.update({
          where: { id: existing.id },
          data: { lastValue: { increment: 1 } },
        });
        return updated.lastValue;
      }
      const created = await tenantDb.documentSequence.create({ data: { ...where, lastValue: 1 } });
      return created.lastValue;
    },
  };
}

/**
 * Site par défaut utilisé pour les écritures d'import (`Payment.siteId`,
 * `Invoice.siteId` sont obligatoires alors qu'un fichier importé ne précise
 * pas de site) : le premier site actif créé pour l'organisation. Hypothèse
 * documentée — une sélection explicite du site cible sera nécessaire pour
 * les organisations multi-sites (hors périmètre de cette étape).
 */
export async function resolveDefaultSiteId(tenantDb: TenantDb): Promise<string> {
  const site = await tenantDb.site.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (!site) {
    throw new Error(
      "Aucun site actif : créez un site avant d'importer des factures ou des paiements.",
    );
  }
  return site.id;
}
