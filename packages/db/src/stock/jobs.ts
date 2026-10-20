// M07 §9 — tâches du worker : `stock.reorder_suggestions` (03:00), `stock.integrity_check`
// (03:30, RG-M07-17) et `purchase.late_alerts` (08:00). Chaque fonction traite une
// organisation et produit des notifications dédoublonnées par jour.
import { isPurchaseOrderLate } from "@atelieros/core";
import { db } from "../tenant";
import { notifyMembers } from "./context";
import { computeReorderSuggestions } from "./purchase";

function day(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Suggestions de réapprovisionnement par site → notification magasinier. */
export async function runReorderSuggestions(organizationId: string, now: Date): Promise<number> {
  const tenantDb = db.forTenant({ organizationId });
  const sites = await tenantDb.site.findMany({ where: { isActive: true } });
  let notified = 0;
  for (const site of sites) {
    const count = await tenantDb.transaction(async (tx) => {
      const groups = await computeReorderSuggestions(tx, site.id);
      const lines = groups.reduce((s, g) => s + g.lines.length, 0);
      if (lines === 0) return 0;
      return notifyMembers(
        tx,
        organizationId,
        { roles: ["STOREKEEPER", "MANAGER"] },
        {
          type: "stock.reorder_suggestions",
          title: `${lines} produit${lines > 1 ? "s" : ""} à réapprovisionner (${site.code})`,
          body: "Ouvrez les suggestions d'achat pour créer les bons de commande.",
          link: "/achats/suggestions",
          severity: "info",
          dedupeKey: `stock.reorder:${site.id}:${day(now)}`,
        },
      );
    });
    notified += count;
  }
  return notified;
}

export interface IntegrityMismatch {
  siteId: string;
  productId: string;
  onHand: number;
  movementsSum: number;
}

/** RG-M07-17 : contrôle `onHand = Σ quantity` ; écart → alerte technique au propriétaire. */
export async function runIntegrityCheck(
  organizationId: string,
  now: Date,
): Promise<IntegrityMismatch[]> {
  const tenantDb = db.forTenant({ organizationId });
  const levels = await tenantDb.stockLevel.findMany({
    select: { siteId: true, productId: true, onHand: true },
  });
  const sums = await tenantDb.stockMovement.groupBy({
    by: ["siteId", "productId"],
    _sum: { quantity: true },
  });
  const sumOf = new Map(sums.map((s) => [`${s.siteId}|${s.productId}`, s._sum.quantity ?? 0]));
  const mismatches: IntegrityMismatch[] = [];
  const seen = new Set<string>();
  for (const l of levels) {
    const key = `${l.siteId}|${l.productId}`;
    seen.add(key);
    const movementsSum = sumOf.get(key) ?? 0;
    if (movementsSum !== l.onHand) mismatches.push({ ...l, movementsSum });
  }
  for (const s of sums) {
    const key = `${s.siteId}|${s.productId}`;
    if (!seen.has(key) && (s._sum.quantity ?? 0) !== 0) {
      mismatches.push({
        siteId: s.siteId,
        productId: s.productId,
        onHand: 0,
        movementsSum: s._sum.quantity ?? 0,
      });
    }
  }
  if (mismatches.length > 0) {
    await tenantDb.transaction((tx) =>
      notifyMembers(
        tx,
        organizationId,
        { roles: ["OWNER"] },
        {
          type: "stock.integrity_mismatch",
          title: `Contrôle du stock : ${mismatches.length} écart${mismatches.length > 1 ? "s" : ""} détecté${mismatches.length > 1 ? "s" : ""}`,
          body: "Le stock enregistré ne correspond pas à l'historique des mouvements. Contactez le support.",
          link: "/stock/mouvements",
          severity: "critical",
          dedupeKey: `stock.integrity:${day(now)}`,
        },
      ),
    );
  }
  return mismatches;
}

/** Commandes SENT dont `expectedAt` est dépassée → notification magasinier. */
export async function runLatePurchaseAlerts(organizationId: string, now: Date): Promise<number> {
  const tenantDb = db.forTenant({ organizationId });
  const open = await tenantDb.purchaseOrder.findMany({
    where: { status: { in: ["SENT", "PARTIALLY_RECEIVED"] }, expectedAt: { lt: now } },
    include: { supplier: { select: { name: true } } },
  });
  const late = open.filter((po) => isPurchaseOrderLate(po, now));
  if (late.length === 0) return 0;
  let notified = 0;
  await tenantDb.transaction(async (tx) => {
    for (const po of late) {
      notified += await notifyMembers(
        tx,
        organizationId,
        { roles: ["STOREKEEPER", "MANAGER"] },
        {
          type: "purchase.late",
          title: `Commande ${po.number} en retard — ${po.supplier.name}`,
          body: "La date de livraison prévue est dépassée. Relancez le fournisseur.",
          link: `/achats/${po.id}`,
          severity: "warning",
          dedupeKey: `purchase.late:${po.id}:${day(now)}`,
        },
      );
    }
  });
  return notified;
}
