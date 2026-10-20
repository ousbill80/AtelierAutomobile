// RG-M17-22 — détection d'anomalies (statistiques déterministes, sans IA). Chaque détecteur
// reçoit des données simples déjà chargées et renvoie des anomalies dédoublonnables par objet
// (`dedupeKey`). L'IA ne sert, au mieux, qu'à reformuler le libellé (jamais à détecter).
import { formatFCFA } from "../money/format";

export type AnomalyCode =
  | "anomaly.discount"
  | "anomaly.cash_gap"
  | "anomaly.stock_shrink"
  | "anomaly.part_not_billed"
  | "anomaly.price_below_cost"
  | "anomaly.void_spike"
  | "anomaly.time_overrun";

export interface Anomaly {
  code: AnomalyCode;
  /** Objet concerné (facture, caissier, produit…), clé de dédoublonnage. */
  objectId: string;
  title: string;
  body: string;
  link: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function mean(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}

export interface DiscountDoc {
  id: string;
  number: string | null;
  advisorId: string | null;
  advisorName: string;
  issuedAt: Date;
  /** Remise du document en % du montant avant remise. */
  documentRate: number;
  /** Plus forte remise de ligne en %. */
  maxLineRate: number;
}

/**
 * `anomaly.discount` — remise de ligne ou de document > max(15 %, moyenne 90 j du conseiller
 * + 3 écarts-types). `docs` = factures émises sur les 90 derniers jours ; `since` = début de la
 * fenêtre d'analyse (ex. hier) : seules les factures plus récentes sont signalées.
 */
export function detectDiscountAnomalies(docs: DiscountDoc[], since: Date): Anomaly[] {
  const byAdvisor = new Map<string, number[]>();
  for (const doc of docs) {
    const key = doc.advisorId ?? "-";
    byAdvisor.set(key, [...(byAdvisor.get(key) ?? []), doc.documentRate]);
  }
  const out: Anomaly[] = [];
  for (const doc of docs) {
    if (doc.issuedAt < since) continue;
    const history = (byAdvisor.get(doc.advisorId ?? "-") ?? []).filter(
      (r) => r !== doc.documentRate,
    );
    const threshold = Math.max(15, mean(history) + 3 * stdDev(history));
    const rate = Math.max(doc.documentRate, doc.maxLineRate);
    if (rate > threshold) {
      const pct = Math.round(rate);
      out.push({
        code: "anomaly.discount",
        objectId: doc.id,
        title: `Remise inhabituelle : ${pct} % sur ${doc.number ?? "une facture"} (${doc.advisorName})`,
        body: `Remise moyenne du conseiller sur 90 jours : ${Math.round(mean(history))} %.`,
        link: `/factures/${doc.id}`,
      });
    }
  }
  return out;
}

export interface CashSessionLike {
  id: string;
  cashierId: string;
  cashierName: string;
  closedAt: Date;
  difference: number;
}

/**
 * `anomaly.cash_gap` — écarts cumulés d'un même caissier < −20 000 FCFA sur 30 j, ou
 * 3 écarts négatifs consécutifs.
 */
export function detectCashGapAnomalies(sessions: CashSessionLike[], now: Date): Anomaly[] {
  const since = now.getTime() - 30 * DAY_MS;
  const byCashier = new Map<string, CashSessionLike[]>();
  for (const s of sessions) {
    if (s.closedAt.getTime() < since) continue;
    byCashier.set(s.cashierId, [...(byCashier.get(s.cashierId) ?? []), s]);
  }
  const out: Anomaly[] = [];
  for (const [cashierId, rows] of byCashier) {
    const sorted = [...rows].sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime());
    const total = sorted.reduce((s, r) => s + r.difference, 0);
    let streak = 0;
    let maxStreak = 0;
    for (const r of sorted) {
      streak = r.difference < 0 ? streak + 1 : 0;
      maxStreak = Math.max(maxStreak, streak);
    }
    if (total < -20_000 || maxStreak >= 3) {
      out.push({
        code: "anomaly.cash_gap",
        objectId: cashierId,
        title: `Écarts de caisse répétés : ${sorted[0]!.cashierName}`,
        body: `Écart cumulé sur 30 jours : ${formatFCFA(total)} (${sorted.length} sessions).`,
        link: "/caisse",
      });
    }
  }
  return out;
}

export interface StockAdjustmentLike {
  productId: string;
  productName: string;
  type: "ADJUSTMENT" | "COUNT_CORRECTION";
  quantity: number;
  unitCost: number;
  createdAt: Date;
}

/**
 * `anomaly.stock_shrink` — écart d'inventaire valorisé > 50 000 FCFA sur un produit, ou plus de
 * 3 sorties `ADJUSTMENT` négatives sur 30 j.
 */
export function detectStockShrinkAnomalies(moves: StockAdjustmentLike[], now: Date): Anomaly[] {
  const since = now.getTime() - 30 * DAY_MS;
  const byProduct = new Map<string, StockAdjustmentLike[]>();
  for (const m of moves) {
    if (m.createdAt.getTime() < since || m.quantity >= 0) continue;
    byProduct.set(m.productId, [...(byProduct.get(m.productId) ?? []), m]);
  }
  const out: Anomaly[] = [];
  for (const [productId, rows] of byProduct) {
    const countLoss = rows
      .filter((r) => r.type === "COUNT_CORRECTION")
      .reduce((s, r) => s + Math.abs(r.quantity) * r.unitCost, 0);
    const adjustments = rows.filter((r) => r.type === "ADJUSTMENT").length;
    if (countLoss > 50_000 || adjustments > 3) {
      out.push({
        code: "anomaly.stock_shrink",
        objectId: productId,
        title: `Démarque inhabituelle : ${rows[0]!.productName}`,
        body:
          countLoss > 50_000
            ? `Écart d'inventaire valorisé : ${formatFCFA(countLoss)}.`
            : `${adjustments} sorties pour ajustement en 30 jours.`,
        link: `/stock/${productId}`,
      });
    }
  }
  return out;
}

export interface BilledOrder {
  repairOrderId: string;
  repairOrderNumber: string;
  invoiceId: string;
  invoiceNumber: string | null;
  /** Quantités nettes sorties vers l'OR (sorties − retours), par produit. */
  issued: { productId: string; productName: string; quantity: number }[];
  billedProductIds: string[];
  /** Heures pointées (travail) et heures vendues (lignes MO facturées). */
  workedHours: number;
  soldHours: number;
}

/** `anomaly.part_not_billed` et `anomaly.time_overrun` sur les OR facturés. */
export function detectBillingGapAnomalies(orders: BilledOrder[]): Anomaly[] {
  const out: Anomaly[] = [];
  for (const order of orders) {
    const billed = new Set(order.billedProductIds);
    const missing = order.issued.filter((i) => i.quantity > 0 && !billed.has(i.productId));
    if (missing.length) {
      out.push({
        code: "anomaly.part_not_billed",
        objectId: order.invoiceId,
        title: `Pièce sortie non facturée : ${order.repairOrderNumber}`,
        body: `${missing.map((m) => `${m.productName} ×${m.quantity}`).join(", ")} absente(s) de ${
          order.invoiceNumber ?? "la facture"
        }.`,
        link: `/ordres/${order.repairOrderId}`,
      });
    }
    if (order.soldHours > 0 && order.workedHours > 2 * order.soldHours) {
      out.push({
        code: "anomaly.time_overrun",
        objectId: order.repairOrderId,
        title: `Temps dépassé : ${order.repairOrderNumber}`,
        body: `${order.workedHours.toFixed(1).replace(".", ",")} h pointées pour ${order.soldHours
          .toFixed(1)
          .replace(".", ",")} h vendues.`,
        link: `/ordres/${order.repairOrderId}`,
      });
    }
  }
  return out;
}

export interface CostLine {
  invoiceId: string;
  invoiceNumber: string | null;
  description: string;
  /** Prix unitaire net (après remise de ligne), HT. */
  netUnitPrice: number;
  /** Coût moyen unitaire (CMP) figé à l'émission. */
  averageCost: number;
}

/** `anomaly.price_below_cost` — ligne facturée avec prix < coût moyen. Une alerte par facture. */
export function detectPriceBelowCostAnomalies(lines: CostLine[]): Anomaly[] {
  const byInvoice = new Map<string, CostLine[]>();
  for (const line of lines) {
    if (line.averageCost > 0 && line.netUnitPrice < line.averageCost) {
      byInvoice.set(line.invoiceId, [...(byInvoice.get(line.invoiceId) ?? []), line]);
    }
  }
  return [...byInvoice.entries()].map(([invoiceId, rows]) => ({
    code: "anomaly.price_below_cost" as const,
    objectId: invoiceId,
    title: `Vente à perte sur ${rows[0]!.invoiceNumber ?? "une facture"}`,
    body: rows
      .map(
        (r) =>
          `${r.description} : ${formatFCFA(Math.round(r.netUnitPrice))} pour un coût de ${formatFCFA(r.averageCost)}`,
      )
      .join(" ; "),
    link: `/factures/${invoiceId}`,
  }));
}

export interface VoidLike {
  userId: string;
  userName: string;
  at: Date;
}

/** `anomaly.void_spike` — plus de 3 factures annulées / avoirs par un même utilisateur sur 7 j. */
export function detectVoidSpikeAnomalies(voids: VoidLike[], now: Date): Anomaly[] {
  const since = now.getTime() - 7 * DAY_MS;
  const counts = new Map<string, { name: string; count: number }>();
  for (const v of voids) {
    if (v.at.getTime() < since) continue;
    const current = counts.get(v.userId) ?? { name: v.userName, count: 0 };
    counts.set(v.userId, { ...current, count: current.count + 1 });
  }
  return [...counts.entries()]
    .filter(([, c]) => c.count > 3)
    .map(([userId, c]) => ({
      code: "anomaly.void_spike" as const,
      objectId: userId,
      title: `Annulations répétées : ${c.name}`,
      body: `${c.count} factures annulées ou avoirs en 7 jours.`,
      link: "/factures",
    }));
}

/**
 * Clé de dédoublonnage (« dédoublonnée par objet ») : une même anomalie sur un même objet
 * n'est signalée qu'une fois par semaine ISO pour les cumuls glissants, une fois pour toujours
 * pour un document.
 */
export function anomalyDedupeKey(anomaly: Anomaly, now: Date): string {
  const documentScoped =
    anomaly.code === "anomaly.discount" ||
    anomaly.code === "anomaly.price_below_cost" ||
    anomaly.code === "anomaly.part_not_billed" ||
    anomaly.code === "anomaly.time_overrun";
  if (documentScoped) return `${anomaly.code}:${anomaly.objectId}`;
  const week = Math.floor(now.getTime() / (7 * DAY_MS));
  return `${anomaly.code}:${anomaly.objectId}:${week}`;
}

/** Page de l'objet concerné, recalculée depuis la clé de dédoublonnage `code:objectId[:semaine]`. */
export function anomalyObjectLink(dedupeKey: string | null | undefined): string | null {
  if (!dedupeKey) return null;
  const [code, objectId] = dedupeKey.split(":");
  if (!objectId) return null;
  switch (code) {
    case "anomaly.discount":
    case "anomaly.price_below_cost":
    case "anomaly.part_not_billed":
      return `/factures/${objectId}`;
    case "anomaly.time_overrun":
      return `/ordres/${objectId}`;
    case "anomaly.stock_shrink":
      return `/stock/${objectId}`;
    case "anomaly.cash_gap":
      return "/caisse";
    case "anomaly.void_spike":
      return "/factures";
    default:
      return null;
  }
}

/** Page de traitement des anomalies (lien des alertes du tableau de bord). */
export const ANOMALIES_PAGE = "/tableau-de-bord/anomalies";
