import { analyzeSearchQuery, matchRank, type SearchDocumentPrefix } from "@atelieros/core";
import { db } from "@atelieros/db";
import { searchGlobalInputSchema } from "@atelieros/validators";
import { requirePermission, router } from "../trpc";
import {
  searchCustomersByName,
  searchCustomersByPhone,
  searchVehiclesByDriverPhone,
  searchVehiclesByIdentifier,
  searchVehiclesByPlate,
  type CustomerSearchHit,
  type VehicleSearchHit,
} from "../customers/trigram";

type TenantDb = ReturnType<typeof db.forTenant>;

export type SearchDocumentType =
  "repair_order" | "quote" | "invoice" | "credit_note" | "receipt" | "purchase_order";

export interface DocumentSearchHit {
  id: string;
  type: SearchDocumentType;
  number: string;
  customerId: string | null;
  customerDisplayName: string | null;
  rank: number;
  createdAt: Date;
}

/** Tables interrogées pour chaque préfixe RG-M02-19 (sans préfixe : toutes). */
const PREFIX_TYPES: Record<SearchDocumentPrefix, SearchDocumentType[]> = {
  "OR-": ["repair_order"],
  "DEV-": ["quote"],
  "FAC-": ["invoice"],
  "AV-": ["credit_note"],
  "REC-": ["receipt"],
  "BC-": ["purchase_order"],
};
const ALL_DOCUMENT_TYPES: SearchDocumentType[] = [
  "repair_order",
  "quote",
  "invoice",
  "credit_note",
  "receipt",
  "purchase_order",
];

/** Fusionne des listes de résultats en gardant le premier rencontré par id (ordre = priorité). */
function mergeById<T extends { id: string }>(lists: T[][], limit: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of lists.flat()) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out.slice(0, limit);
}

function sortByRank<T extends { rank: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.rank - a.rank);
}

async function searchDocuments(
  tenantDb: TenantDb,
  number: string,
  types: SearchDocumentType[],
  siteIds: string[] | "ALL",
  limit: number,
): Promise<DocumentSearchHit[]> {
  const numberFilter = { contains: number, mode: "insensitive" as const };
  // RG-M01-09 — un document reste limité aux sites autorisés pour l'utilisateur.
  const siteFilter = siteIds === "ALL" ? {} : { siteId: { in: siteIds } };
  const customerSelect = { select: { displayName: true } } as const;
  const wanted = new Set(types);

  const [orders, quotes, invoices, payments, purchaseOrders] = await Promise.all([
    wanted.has("repair_order")
      ? tenantDb.repairOrder.findMany({
          where: { number: numberFilter, ...siteFilter },
          orderBy: { createdAt: "desc" },
          take: limit,
          select: {
            id: true,
            number: true,
            customerId: true,
            createdAt: true,
            customer: customerSelect,
          },
        })
      : [],
    wanted.has("quote")
      ? tenantDb.quote.findMany({
          where: { number: numberFilter, ...siteFilter },
          orderBy: { createdAt: "desc" },
          take: limit,
          select: {
            id: true,
            number: true,
            customerId: true,
            createdAt: true,
            customer: customerSelect,
          },
        })
      : [],
    wanted.has("invoice") || wanted.has("credit_note")
      ? tenantDb.invoice.findMany({
          where: {
            number: numberFilter,
            type: {
              in: [
                ...(wanted.has("invoice") ? (["INVOICE", "DEPOSIT"] as const) : []),
                ...(wanted.has("credit_note") ? (["CREDIT_NOTE"] as const) : []),
              ],
            },
            ...siteFilter,
          },
          orderBy: { createdAt: "desc" },
          take: limit,
          select: {
            id: true,
            number: true,
            type: true,
            customerId: true,
            createdAt: true,
            customer: customerSelect,
          },
        })
      : [],
    wanted.has("receipt")
      ? tenantDb.payment.findMany({
          where: { number: numberFilter, ...siteFilter },
          orderBy: { receivedAt: "desc" },
          take: limit,
          select: {
            id: true,
            number: true,
            customerId: true,
            receivedAt: true,
            customer: customerSelect,
          },
        })
      : [],
    wanted.has("purchase_order")
      ? tenantDb.purchaseOrder.findMany({
          where: { number: numberFilter, ...siteFilter },
          take: limit,
          select: { id: true, number: true, orderedAt: true, expectedAt: true },
        })
      : [],
  ]);

  const hits: DocumentSearchHit[] = [
    ...orders.map((r) => ({
      id: r.id,
      type: "repair_order" as const,
      number: r.number,
      customerId: r.customerId,
      customerDisplayName: r.customer.displayName,
      createdAt: r.createdAt,
    })),
    ...quotes.map((r) => ({
      id: r.id,
      type: "quote" as const,
      number: r.number,
      customerId: r.customerId,
      customerDisplayName: r.customer.displayName,
      createdAt: r.createdAt,
    })),
    ...invoices.map((r) => ({
      id: r.id,
      type: r.type === "CREDIT_NOTE" ? ("credit_note" as const) : ("invoice" as const),
      // `number` est filtré par `contains`, il n'est donc jamais nul ici.
      number: r.number ?? "",
      customerId: r.customerId,
      customerDisplayName: r.customer.displayName,
      createdAt: r.createdAt,
    })),
    ...payments.map((r) => ({
      id: r.id,
      type: "receipt" as const,
      number: r.number,
      customerId: r.customerId,
      customerDisplayName: r.customer?.displayName ?? null,
      createdAt: r.receivedAt,
    })),
    ...purchaseOrders.map((r) => ({
      id: r.id,
      type: "purchase_order" as const,
      number: r.number,
      customerId: null,
      customerDisplayName: null,
      createdAt: r.orderedAt ?? r.expectedAt ?? new Date(0),
    })),
  ].map((hit) => ({ ...hit, rank: matchRank(hit.number.replace(/\s+/g, ""), number) }));

  return hits
    .sort((a, b) => b.rank - a.rank || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}

/**
 * RG-M02-19 — recherche globale : clients, véhicules, documents, groupés (5 max/groupe).
 * La requête est classée par `core/search` (téléphone, n° de document, plaque, nom) ; chaque
 * groupe est trié exact > préfixe > similarité, puis dernière activité. Les recherches
 * trigramme passent par `customers/trigram` (SQL brut filtré par organisation) ; les documents
 * passent par `db.forTenant` et sont limités aux sites autorisés (RG-M01-09).
 */
export const searchRouter = router({
  global: requirePermission("customer:read")
    .input(searchGlobalInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const organizationId = ctx.organizationId;
      const limit = input.limit;
      const analysis = analyzeSearchQuery(input.q);

      const customerLists: Promise<CustomerSearchHit[]>[] = [];
      const vehicleLists: Promise<VehicleSearchHit[]>[] = [];
      let documents: Promise<DocumentSearchHit[]> = Promise.resolve([]);

      for (const kind of analysis.kinds) {
        switch (kind) {
          case "PHONE":
            customerLists.push(searchCustomersByPhone(organizationId, analysis.digits, limit));
            vehicleLists.push(searchVehiclesByDriverPhone(organizationId, analysis.digits, limit));
            break;
          case "DOCUMENT":
            documents = searchDocuments(
              tenantDb,
              analysis.documentPrefix ? analysis.documentNumber : analysis.digits,
              analysis.documentPrefix ? PREFIX_TYPES[analysis.documentPrefix] : ALL_DOCUMENT_TYPES,
              ctx.allowedSiteIds,
              limit,
            );
            break;
          case "PLATE":
            vehicleLists.push(searchVehiclesByPlate(organizationId, analysis.plateLoose, limit));
            break;
          case "NAME":
            customerLists.push(searchCustomersByName(organizationId, analysis.text, limit));
            vehicleLists.push(searchVehiclesByIdentifier(organizationId, analysis.text, limit));
            break;
        }
      }

      const [customerResults, vehicleResults, documentResults] = await Promise.all([
        Promise.all(customerLists),
        Promise.all(vehicleLists),
        documents,
      ]);

      return {
        customers: mergeById(customerResults.map(sortByRank), limit),
        vehicles: mergeById(vehicleResults.map(sortByRank), limit),
        documents: documentResults,
      };
    }),
});
