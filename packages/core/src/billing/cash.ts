// RG-M08-27/28/29/30 — caisse : ouverture, espèces attendues, clôture et écart, dépenses.
import { DomainError } from "../errors";
import { businessDate } from "../calendar";
import { formatFCFA } from "../money/format";

/** Coupures et pièces FCFA proposées au comptage (M08 §7). */
export const CASH_DENOMINATIONS = [10_000, 5_000, 2_000, 1_000, 500, 250, 200, 100, 50, 25, 10, 5];

/** Σ (coupure × nombre) ; refuse une coupure inconnue ou un nombre négatif / décimal. */
export function denominationsTotal(denominations: Record<string, number>): number {
  let total = 0;
  for (const [key, count] of Object.entries(denominations)) {
    const value = Number(key);
    if (!CASH_DENOMINATIONS.includes(value)) {
      throw new DomainError("cash.unknown_denomination", `Coupure inconnue : ${key} FCFA.`);
    }
    if (!Number.isInteger(count) || count < 0) {
      throw new DomainError(
        "cash.invalid_count",
        "Le nombre de billets doit être un entier positif.",
      );
    }
    total += value * count;
  }
  return total;
}

export interface ExpectedCashInput {
  openingFloat: number;
  /** Σ Payment(CASH, CONFIRMED) rattachés à la session. */
  cashPayments: number;
  expenses: number;
  cashRefunds: number;
  drops: number;
}

/** RG-M08-28 — fond + espèces encaissées − dépenses − remboursements espèces − versements. */
export function expectedCash(input: ExpectedCashInput): number {
  return input.openingFloat + input.cashPayments - input.expenses - input.cashRefunds - input.drops;
}

export interface CloseCashInput {
  expected: number;
  counted: number;
  notes: string | null | undefined;
  varianceAlert: number;
  /** Dépenses de la session encore en attente de validation (RG-M08-30). */
  pendingExpenses?: number;
}

/**
 * RG-M08-28/29 — écart de clôture ; commentaire obligatoire si ≠ 0, alerte au-delà du seuil.
 * Une dépense en attente bloque la clôture : l'espèce attendue ne serait pas définitive.
 */
export function closeCash(input: CloseCashInput): { difference: number; alert: boolean } {
  if (input.pendingExpenses && input.pendingExpenses > 0) {
    throw new DomainError(
      "cash.pending_expenses",
      input.pendingExpenses === 1
        ? "Une dépense attend la validation du gérant : faites-la valider ou refuser avant de clôturer."
        : `${input.pendingExpenses} dépenses attendent la validation du gérant : faites-les valider ou refuser avant de clôturer.`,
    );
  }
  if (!Number.isInteger(input.counted) || input.counted < 0) {
    throw new DomainError("cash.invalid_count", "Le montant compté doit être un entier positif.");
  }
  const difference = input.counted - input.expected;
  if (difference !== 0 && !input.notes?.trim()) {
    throw new DomainError(
      "cash.comment_required",
      `Écart de ${formatFCFA(difference)} : un commentaire est obligatoire pour clôturer.`,
    );
  }
  return { difference, alert: Math.abs(difference) > input.varianceAlert };
}

export interface OpenSessionLike {
  id: string;
  openedById: string;
  openedAt: Date;
}

/**
 * RG-M08-27/29 — une session ouverte au plus par site (ou par caissier si le paramètre
 * `cash.oneSessionPerSite` est désactivé) ; une session d'un jour précédent non clôturée
 * bloque toute nouvelle ouverture sur le site.
 */
export function assertCanOpenSession(input: {
  openSessions: readonly OpenSessionLike[];
  membershipId: string;
  oneSessionPerSite: boolean;
  openingFloat: number;
  now: Date;
  timeZone: string;
}): void {
  if (!Number.isInteger(input.openingFloat) || input.openingFloat < 0) {
    throw new DomainError("cash.invalid_float", "Le fond de caisse doit être un entier positif.");
  }
  const today = businessDate(input.now, input.timeZone).getTime();
  const stale = input.openSessions.find(
    (s) => businessDate(s.openedAt, input.timeZone).getTime() < today,
  );
  if (stale) {
    throw new DomainError(
      "cash.previous_not_closed",
      "La caisse d'un jour précédent n'est pas clôturée : clôturez-la avant d'ouvrir une nouvelle session.",
      { sessionId: stale.id },
    );
  }
  const conflict = input.oneSessionPerSite
    ? input.openSessions[0]
    : input.openSessions.find((s) => s.openedById === input.membershipId);
  if (conflict) {
    throw new DomainError(
      "cash.already_open",
      input.oneSessionPerSite
        ? "Une caisse est déjà ouverte sur ce site."
        : "Vous avez déjà une caisse ouverte sur ce site.",
      { sessionId: conflict.id },
    );
  }
}

/** RG-M08-29 — clôture tardive : autre jour que l'ouverture, ou après 23:00 (fuseau org). */
export function isLateClose(openedAt: Date, closedAt: Date, timeZone: string): boolean {
  if (businessDate(openedAt, timeZone).getTime() !== businessDate(closedAt, timeZone).getTime()) {
    return true;
  }
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(
      closedAt,
    ),
  );
  return hour >= 23;
}

export type ExpenseStatusLike = "PENDING" | "APPROVED" | "REJECTED";

/**
 * RG-M08-30 — validation MANAGER/OWNER au-delà de `settings.cash.expenseApproval`. Sous le
 * seuil : validée d'office. Au-delà : validée par l'auteur s'il a `cash:expense_approve`,
 * sinon enregistrée « en attente » (elle ne réduit pas les espèces attendues tant qu'elle
 * n'est pas validée). `approved` = une validation explicite est à tracer.
 */
export function checkExpense(input: {
  amount: number;
  category: string;
  description: string;
  categories: readonly string[];
  approvalThreshold: number;
  canApprove: boolean;
  sessionClosed: boolean;
}): { approved: boolean; status: ExpenseStatusLike } {
  if (input.sessionClosed) {
    throw new DomainError(
      "cash.session_closed",
      "Cette caisse est clôturée : la dépense ne peut plus être enregistrée ni modifiée.",
    );
  }
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new DomainError("INVALID_AMOUNT", "Le montant doit être un entier positif en FCFA.");
  }
  if (!input.categories.includes(input.category)) {
    throw new DomainError("cash.unknown_category", "Catégorie de dépense inconnue.");
  }
  if (!input.description.trim()) {
    throw new DomainError("cash.description_required", "Décrivez la dépense.");
  }
  const aboveThreshold = input.amount > input.approvalThreshold;
  if (aboveThreshold && !input.canApprove) return { approved: false, status: "PENDING" };
  return { approved: aboveThreshold, status: "APPROVED" };
}

/**
 * RG-M08-30 — décision du gérant sur une dépense en attente. Refus : motif obligatoire.
 * Une session clôturée ne contient jamais de dépense en attente (la clôture l'interdit).
 */
export function decideExpense(input: {
  status: ExpenseStatusLike;
  decision: "approve" | "reject";
  comment: string | null | undefined;
  sessionClosed: boolean;
}): ExpenseStatusLike {
  if (input.status !== "PENDING") {
    throw new DomainError(
      "cash.expense_already_decided",
      input.status === "APPROVED"
        ? "Cette dépense est déjà validée."
        : "Cette dépense est déjà refusée.",
    );
  }
  if (input.sessionClosed) {
    throw new DomainError(
      "cash.session_closed",
      "Cette caisse est clôturée : la dépense ne peut plus être modifiée.",
    );
  }
  if (input.decision === "reject" && (input.comment?.trim().length ?? 0) < 3) {
    throw new DomainError("cash.reject_reason_required", "Indiquez le motif du refus.");
  }
  return input.decision === "approve" ? "APPROVED" : "REJECTED";
}

/** Totaux des dépenses par catégorie (montant décroissant) — liste et rapports de caisse. */
export function expensesByCategory(
  expenses: readonly { category: string; amount: number }[],
): { category: string; amount: number; count: number }[] {
  const map = new Map<string, { amount: number; count: number }>();
  for (const e of expenses) {
    const row = map.get(e.category) ?? { amount: 0, count: 0 };
    row.amount += e.amount;
    row.count += 1;
    map.set(e.category, row);
  }
  return [...map.entries()]
    .map(([category, row]) => ({ category, ...row }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category, "fr"));
}

export interface VarianceSessionLike {
  cashierId: string;
  cashierName: string;
  difference: number | null;
  closedAt: Date | null;
}

export interface CashierVariance {
  cashierId: string;
  cashierName: string;
  sessions: number;
  /** Sessions clôturées avec un écart ≠ 0. */
  withVariance: number;
  /** Σ écarts signés (manquants négatifs). */
  net: number;
  /** Σ |écart| — mesure le désordre même si manquants et excédents se compensent. */
  absolute: number;
  /** Plus grand manquant (valeur ≤ 0). */
  worstShortage: number;
}

/**
 * M08 §11 — « OWNER voit l'historique des écarts par caissier » : agrège les sessions clôturées
 * par caissier ; tri par écart absolu décroissant (les profils à surveiller en premier).
 */
export function varianceByCashier(sessions: readonly VarianceSessionLike[]): CashierVariance[] {
  const map = new Map<string, CashierVariance>();
  for (const s of sessions) {
    if (!s.closedAt || s.difference === null) continue;
    const row = map.get(s.cashierId) ?? {
      cashierId: s.cashierId,
      cashierName: s.cashierName,
      sessions: 0,
      withVariance: 0,
      net: 0,
      absolute: 0,
      worstShortage: 0,
    };
    row.sessions += 1;
    if (s.difference !== 0) row.withVariance += 1;
    row.net += s.difference;
    row.absolute += Math.abs(s.difference);
    row.worstShortage = Math.min(row.worstShortage, s.difference);
    map.set(s.cashierId, row);
  }
  return [...map.values()].sort(
    (a, b) => b.absolute - a.absolute || a.cashierName.localeCompare(b.cashierName, "fr"),
  );
}

/** Instantané figé à la clôture (`CashSession.closingSummary`) — source du Z de caisse. */
export interface ClosingSummary {
  openingFloat: number;
  /** Encaissements confirmés par mode (hors chèques en attente). */
  byMethod: Record<string, number>;
  totalReceived: number;
  cashPayments: number;
  expensesTotal: number;
  dropsTotal: number;
  cashRefunds: number;
  expectedCash: number;
  countedCash: number;
  difference: number;
  pendingCheques: number;
  counts: { payments: number; expenses: number; drops: number; refunds: number };
}

/** Lit un `closingSummary` JSON persisté (tolère l'absence pour les sessions antérieures). */
export function readClosingSummary(value: unknown): ClosingSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  const byMethodRaw =
    v.byMethod && typeof v.byMethod === "object" ? (v.byMethod as Record<string, unknown>) : {};
  const countsRaw =
    v.counts && typeof v.counts === "object" ? (v.counts as Record<string, unknown>) : {};
  return {
    openingFloat: num(v.openingFloat),
    byMethod: Object.fromEntries(Object.entries(byMethodRaw).map(([k, x]) => [k, num(x)])),
    totalReceived: num(v.totalReceived),
    cashPayments: num(v.cashPayments),
    expensesTotal: num(v.expensesTotal),
    dropsTotal: num(v.dropsTotal),
    cashRefunds: num(v.cashRefunds),
    expectedCash: num(v.expectedCash),
    countedCash: num(v.countedCash),
    difference: num(v.difference),
    pendingCheques: num(v.pendingCheques),
    counts: {
      payments: num(countsRaw.payments),
      expenses: num(countsRaw.expenses),
      drops: num(countsRaw.drops),
      refunds: num(countsRaw.refunds),
    },
  };
}
