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
}

/** RG-M08-28/29 — écart de clôture ; commentaire obligatoire si ≠ 0, alerte au-delà du seuil. */
export function closeCash(input: CloseCashInput): { difference: number; alert: boolean } {
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

/** RG-M08-30 — validation MANAGER/OWNER au-delà de `settings.cash.expenseApproval`. */
export function checkExpense(input: {
  amount: number;
  category: string;
  description: string;
  categories: readonly string[];
  approvalThreshold: number;
  canApprove: boolean;
  sessionClosed: boolean;
}): { approved: boolean } {
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
  if (input.amount > input.approvalThreshold && !input.canApprove) {
    throw new DomainError(
      "cash.expense_needs_approval",
      `Dépense supérieure à ${formatFCFA(input.approvalThreshold)} : elle doit être validée par le gérant.`,
    );
  }
  return { approved: input.amount > input.approvalThreshold };
}
