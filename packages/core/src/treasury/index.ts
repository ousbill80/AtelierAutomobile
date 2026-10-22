// M18 — Trésorerie : logique pure (comptes, rattachement des modes de paiement, projection du
// grand livre depuis M08, soldes, virements, mouvements manuels, rapprochement, rapports).
import { DomainError } from "../errors";
import { formatFCFA } from "../money/format";
import { addDaysToKey, localDateKey, startOfWeekKey } from "../planning/time";

export const TREASURY_ACCOUNT_TYPES = [
  "CASH_REGISTER",
  "SAFE",
  "BANK",
  "MOBILE_MONEY",
  "OTHER",
] as const;
export type TreasuryAccountTypeLike = (typeof TREASURY_ACCOUNT_TYPES)[number];
export type DirectionLike = "IN" | "OUT";
export type MovementKindLike =
  | "PAYMENT"
  | "PAYMENT_REVERSAL"
  | "REFUND"
  | "EXPENSE"
  | "CASH_DROP"
  | "CASH_VARIANCE"
  | "TRANSFER"
  | "INCOME"
  | "ADJUSTMENT";

/** Compte SYSCOHADA par défaut selon le type (RG-M08-31). */
export const DEFAULT_LEDGER_BY_TYPE: Record<TreasuryAccountTypeLike, string> = {
  CASH_REGISTER: "571",
  SAFE: "571",
  BANK: "521",
  MOBILE_MONEY: "585",
  OTHER: "58",
};

export interface AccountLike {
  id: string;
  name: string;
  type: TreasuryAccountTypeLike;
  siteId: string | null;
  paymentMethods: readonly string[];
  /** `@db.Date` (minuit UTC du jour civil d'ouverture). */
  openingDate: Date;
  archivedAt: Date | null;
}

const isActive = (a: AccountLike) => !a.archivedAt;

/** RG-M18-02 — compte qui reçoit un mode : caisse du site pour CASH, sinon compte rattaché. */
export function resolveMethodAccount<T extends AccountLike>(
  method: string,
  siteId: string,
  accounts: readonly T[],
): T | null {
  if (method === "CASH") {
    return (
      accounts.find((a) => isActive(a) && a.type === "CASH_REGISTER" && a.siteId === siteId) ?? null
    );
  }
  return accounts.find((a) => isActive(a) && a.paymentMethods.includes(method)) ?? null;
}

export function cashRegisterOf<T extends AccountLike>(
  siteId: string,
  accounts: readonly T[],
): T | null {
  return (
    accounts.find((a) => a.type === "CASH_REGISTER" && a.siteId === siteId && isActive(a)) ?? null
  );
}

const METHOD_NAMES: Record<string, string> = {
  CASH: "Espèces",
  WAVE: "Wave",
  ORANGE_MONEY: "Orange Money",
  MTN_MOMO: "MTN MoMo",
  MOOV_MONEY: "Moov Money",
  CARD: "Carte",
  BANK_TRANSFER: "Virement",
  CHEQUE: "Chèque",
  INSURANCE: "Assurance",
  OTHER: "Autre",
};

export const methodName = (method: string) => METHOD_NAMES[method] ?? method;

/**
 * RG-M18-01/02 — validation d'un compte (création ou modification) : nom non vide et unique,
 * CASH jamais rattaché, un mode à un seul compte actif, caisse liée à un site et unique par site.
 */
export function checkAccount(input: {
  account: Omit<AccountLike, "id" | "archivedAt" | "openingDate"> & { id?: string };
  others: readonly AccountLike[];
  openingBalance: number;
}): void {
  const { account, others } = input;
  const name = account.name.trim();
  if (!name) throw new DomainError("treasury.name_required", "Donnez un nom au compte.");
  const peers = others.filter((o) => o.id !== account.id);
  if (peers.some((o) => o.name.trim().toLowerCase() === name.toLowerCase())) {
    throw new DomainError("treasury.name_taken", `Un compte « ${name} » existe déjà.`);
  }
  if (!Number.isInteger(input.openingBalance)) {
    throw new DomainError(
      "INVALID_AMOUNT",
      "Le solde d'ouverture doit être un montant entier en FCFA.",
    );
  }
  if (account.type === "CASH_REGISTER") {
    if (!account.siteId) {
      throw new DomainError("treasury.site_required", "Une caisse doit être rattachée à un site.");
    }
    if (
      peers.some((o) => isActive(o) && o.type === "CASH_REGISTER" && o.siteId === account.siteId)
    ) {
      throw new DomainError("treasury.register_exists", "Ce site a déjà une caisse.");
    }
  }
  if (account.paymentMethods.includes("CASH")) {
    throw new DomainError(
      "treasury.cash_method",
      "Les espèces vont toujours dans la caisse du site : ne les rattachez pas à un autre compte.",
    );
  }
  for (const method of account.paymentMethods) {
    const owner = peers.find((o) => isActive(o) && o.paymentMethods.includes(method));
    if (owner) {
      throw new DomainError(
        "treasury.method_taken",
        `${methodName(method)} est déjà rattaché au compte « ${owner.name} ».`,
      );
    }
  }
}

/** RG-M18-01 — un compte ne s'archive que soldé ; une caisse ne s'archive pas. */
export function checkArchive(balance: number, type: TreasuryAccountTypeLike): void {
  if (balance !== 0) {
    throw new DomainError(
      "treasury.not_empty",
      `Soldez le compte avant de l'archiver (solde actuel : ${formatFCFA(balance)}).`,
    );
  }
  if (type === "CASH_REGISTER") {
    throw new DomainError(
      "treasury.register_archive",
      "La caisse d'un site ne peut pas être archivée.",
    );
  }
}

/** « •••• 1234 » — un numéro de compte n'est jamais affiché en entier. */
export function maskAccountRef(ref: string | null | undefined): string | null {
  const compact = (ref ?? "").replace(/\s+/g, "");
  if (!compact) return null;
  return compact.length <= 4 ? compact : `•••• ${compact.slice(-4)}`;
}

// ── Projection du grand livre (RG-M18-03) ────────────────────────────────────────────────

export interface MovementDraft {
  accountId: string;
  siteId: string | null;
  direction: DirectionLike;
  kind: MovementKindLike;
  amount: number;
  occurredAt: Date;
  label: string;
  category: string | null;
  reference: string | null;
  sourceType: string;
  sourceId: string;
  counterpartAccountId: string | null;
}

export interface PostedKey {
  accountId: string;
  sourceType: string | null;
  sourceId: string | null;
  kind: MovementKindLike;
}

export interface ProjectionInput {
  timeZone: string;
  now: Date;
  accounts: readonly AccountLike[];
  payments: readonly {
    id: string;
    number: string;
    method: string;
    amount: number;
    status: string;
    voidedAt: Date | null;
    receivedAt: Date;
    siteId: string;
    customerName: string | null;
    reference: string | null;
  }[];
  refunds: readonly {
    id: string;
    method: string;
    amount: number;
    createdAt: Date;
    siteId: string;
    reason: string;
    reference: string | null;
  }[];
  expenses: readonly {
    id: string;
    amount: number;
    category: string;
    description: string;
    paidAt: Date;
    siteId: string;
    cashSessionId: string | null;
    treasuryAccountId: string | null;
    status: string;
  }[];
  drops: readonly {
    id: string;
    amount: number;
    createdAt: Date;
    siteId: string;
    destination: string;
    toAccountId: string | null;
    reference: string | null;
  }[];
  sessions: readonly {
    id: string;
    siteId: string;
    closedAt: Date | null;
    difference: number | null;
  }[];
  posted: readonly PostedKey[];
}

export interface Unassigned {
  sourceType: "payment" | "refund" | "cash_drop" | "expense";
  sourceId: string;
  method: string | null;
  amount: number;
  reason: "no_account" | "no_register" | "no_destination";
}

/** Destination par défaut d'un versement sans compte choisi : premier coffre / banque actif. */
export function defaultDropAccount<T extends AccountLike>(
  destination: string,
  accounts: readonly T[],
): T | null {
  const type = destination === "bank" ? "BANK" : "SAFE";
  return accounts.find((a) => isActive(a) && a.type === type) ?? null;
}

const key = (k: PostedKey) => `${k.accountId}|${k.sourceType}|${k.sourceId}|${k.kind}`;

/**
 * RG-M18-03 — mouvements à créer pour refléter M08 dans le grand livre. Idempotent : ce qui est
 * déjà passé (`posted`) n'est jamais repassé ; une source antérieure à la date d'ouverture du
 * compte n'est pas projetée ; un paiement annulé après projection est contre-passé sur le même
 * compte. Renvoie aussi ce qui n'a pas de compte (alerte « non rattachés »).
 */
export function planProjection(input: ProjectionInput): {
  movements: MovementDraft[];
  unassigned: Unassigned[];
} {
  const { accounts, timeZone } = input;
  const done = new Set(input.posted.map(key));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const postedIn = new Map<string, string>(); // paymentId → accountId
  for (const p of input.posted) {
    if (p.sourceType === "payment" && p.kind === "PAYMENT" && p.sourceId) {
      postedIn.set(p.sourceId, p.accountId);
    }
  }
  const movements: MovementDraft[] = [];
  const unassigned: Unassigned[] = [];
  const opened = (account: AccountLike, at: Date) =>
    localDateKey(at, timeZone) >= account.openingDate.toISOString().slice(0, 10);
  const push = (m: MovementDraft) => {
    const k = key(m);
    if (done.has(k)) return;
    done.add(k);
    movements.push(m);
  };

  for (const p of input.payments) {
    const reversed = Boolean(p.voidedAt) || p.status === "FAILED";
    const postedAccount = postedIn.get(p.id);
    if (postedAccount) {
      if (reversed) {
        push({
          accountId: postedAccount,
          siteId: p.siteId,
          direction: "OUT",
          kind: "PAYMENT_REVERSAL",
          amount: p.amount,
          occurredAt: p.voidedAt ?? input.now,
          label: `Annulation ${p.number}${p.customerName ? ` — ${p.customerName}` : ""}`,
          category: p.method,
          reference: p.reference,
          sourceType: "payment",
          sourceId: p.id,
          counterpartAccountId: null,
        });
      }
      continue;
    }
    if (reversed || (p.status !== "CONFIRMED" && p.status !== "REFUNDED")) continue;
    const account = resolveMethodAccount(p.method, p.siteId, accounts);
    if (!account) {
      unassigned.push({
        sourceType: "payment",
        sourceId: p.id,
        method: p.method,
        amount: p.amount,
        reason: p.method === "CASH" ? "no_register" : "no_account",
      });
      continue;
    }
    if (!opened(account, p.receivedAt)) continue;
    push({
      accountId: account.id,
      siteId: p.siteId,
      direction: "IN",
      kind: "PAYMENT",
      amount: p.amount,
      occurredAt: p.receivedAt,
      label: `${methodName(p.method)} ${p.number}${p.customerName ? ` — ${p.customerName}` : ""}`,
      category: p.method,
      reference: p.reference,
      sourceType: "payment",
      sourceId: p.id,
      counterpartAccountId: null,
    });
  }

  for (const r of input.refunds) {
    const account = resolveMethodAccount(r.method, r.siteId, accounts);
    if (!account) {
      unassigned.push({
        sourceType: "refund",
        sourceId: r.id,
        method: r.method,
        amount: r.amount,
        reason: "no_account",
      });
      continue;
    }
    if (!opened(account, r.createdAt)) continue;
    push({
      accountId: account.id,
      siteId: r.siteId,
      direction: "OUT",
      kind: "REFUND",
      amount: r.amount,
      occurredAt: r.createdAt,
      label: `Remboursement ${methodName(r.method)} — ${r.reason}`,
      category: r.method,
      reference: r.reference,
      sourceType: "refund",
      sourceId: r.id,
      counterpartAccountId: null,
    });
  }

  for (const e of input.expenses) {
    if (e.status !== "APPROVED") continue;
    const account = e.treasuryAccountId
      ? (byId.get(e.treasuryAccountId) ?? null)
      : e.cashSessionId
        ? cashRegisterOf(e.siteId, accounts)
        : null;
    if (!account) {
      unassigned.push({
        sourceType: "expense",
        sourceId: e.id,
        method: null,
        amount: e.amount,
        reason: "no_register",
      });
      continue;
    }
    if (!opened(account, e.paidAt)) continue;
    push({
      accountId: account.id,
      siteId: e.siteId,
      direction: "OUT",
      kind: "EXPENSE",
      amount: e.amount,
      occurredAt: e.paidAt,
      label: `${e.category} — ${e.description}`,
      category: e.category,
      reference: null,
      sourceType: "expense",
      sourceId: e.id,
      counterpartAccountId: null,
    });
  }

  for (const d of input.drops) {
    const register = cashRegisterOf(d.siteId, accounts);
    const target = d.toAccountId
      ? (byId.get(d.toAccountId) ?? null)
      : defaultDropAccount(d.destination, accounts);
    if (register && opened(register, d.createdAt)) {
      push({
        accountId: register.id,
        siteId: d.siteId,
        direction: "OUT",
        kind: "CASH_DROP",
        amount: d.amount,
        occurredAt: d.createdAt,
        label: `Versement vers ${target?.name ?? (d.destination === "bank" ? "la banque" : "le coffre")}`,
        category: null,
        reference: d.reference,
        sourceType: "cash_drop",
        sourceId: d.id,
        counterpartAccountId: target?.id ?? null,
      });
    } else if (!register) {
      unassigned.push({
        sourceType: "cash_drop",
        sourceId: d.id,
        method: "CASH",
        amount: d.amount,
        reason: "no_register",
      });
    }
    if (!target) {
      unassigned.push({
        sourceType: "cash_drop",
        sourceId: d.id,
        method: null,
        amount: d.amount,
        reason: "no_destination",
      });
      continue;
    }
    if (!opened(target, d.createdAt)) continue;
    push({
      accountId: target.id,
      siteId: d.siteId,
      direction: "IN",
      kind: "CASH_DROP",
      amount: d.amount,
      occurredAt: d.createdAt,
      label: `Versement depuis ${register?.name ?? "la caisse"}`,
      category: null,
      reference: d.reference,
      sourceType: "cash_drop",
      sourceId: d.id,
      counterpartAccountId: register?.id ?? null,
    });
  }

  for (const s of input.sessions) {
    if (!s.closedAt || !s.difference) continue;
    const register = cashRegisterOf(s.siteId, accounts);
    if (!register || !opened(register, s.closedAt)) continue;
    push({
      accountId: register.id,
      siteId: s.siteId,
      direction: s.difference > 0 ? "IN" : "OUT",
      kind: "CASH_VARIANCE",
      amount: Math.abs(s.difference),
      occurredAt: s.closedAt,
      label:
        s.difference > 0 ? "Excédent de caisse à la clôture" : "Manquant de caisse à la clôture",
      category: null,
      reference: null,
      sourceType: "cash_session",
      sourceId: s.id,
      counterpartAccountId: null,
    });
  }

  return { movements, unassigned };
}

// ── Soldes, virements, mouvements manuels, rapprochement ─────────────────────────────────

/** RG-M18-04 — solde = ouverture + Σ entrées − Σ sorties. */
export function accountBalance(openingBalance: number, totalIn: number, totalOut: number): number {
  return openingBalance + totalIn - totalOut;
}

/** RG-M18-05 — virement entre deux comptes actifs ; pas de solde négatif hors banque. */
export function checkTransfer(input: {
  from: AccountLike | null;
  to: AccountLike | null;
  amount: number;
  fromBalance: number;
}): void {
  const { from, to, amount } = input;
  if (!from || !to) throw new DomainError("treasury.account_not_found", "Compte introuvable.");
  if (from.id === to.id) {
    throw new DomainError("treasury.same_account", "Choisissez deux comptes différents.");
  }
  if (from.archivedAt || to.archivedAt) {
    throw new DomainError("treasury.archived", "Un compte archivé ne reçoit plus de mouvement.");
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new DomainError("INVALID_AMOUNT", "Le montant doit être un entier positif en FCFA.");
  }
  if (from.type !== "BANK" && amount > input.fromBalance) {
    throw new DomainError(
      "treasury.insufficient",
      `Solde insuffisant sur « ${from.name} » (${formatFCFA(input.fromBalance)} disponibles).`,
    );
  }
}

/** RG-M18-06 — entrée hors facturation ou ajustement : catégorie et motif obligatoires. */
export function checkManualMovement(input: {
  account: AccountLike | null;
  direction: DirectionLike;
  kind: MovementKindLike;
  amount: number;
  category: string;
  label: string;
  balance: number;
}): void {
  if (!input.account) throw new DomainError("treasury.account_not_found", "Compte introuvable.");
  if (input.account.archivedAt) {
    throw new DomainError("treasury.archived", "Un compte archivé ne reçoit plus de mouvement.");
  }
  if (input.kind !== "INCOME" && input.kind !== "ADJUSTMENT") {
    throw new DomainError(
      "treasury.manual_kind",
      "Seules les entrées diverses et les ajustements se saisissent ici.",
    );
  }
  if (input.kind === "INCOME" && input.direction !== "IN") {
    throw new DomainError("treasury.manual_kind", "Une entrée diverse augmente le solde.");
  }
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new DomainError("INVALID_AMOUNT", "Le montant doit être un entier positif en FCFA.");
  }
  if (!input.category.trim()) {
    throw new DomainError("treasury.category_required", "Choisissez une catégorie.");
  }
  if (input.label.trim().length < 3) {
    throw new DomainError(
      "treasury.reason_required",
      "Décrivez le mouvement (3 caractères minimum).",
    );
  }
  if (input.direction === "OUT" && input.account.type !== "BANK" && input.amount > input.balance) {
    throw new DomainError(
      "treasury.insufficient",
      `Solde insuffisant sur « ${input.account.name} » (${formatFCFA(input.balance)} disponibles).`,
    );
  }
}

/** RG-M18-06 — contre-passation : uniquement les mouvements manuels et virements, une fois. */
export function checkReversal(
  movement: { kind: MovementKindLike; reversalOfId: string | null; alreadyReversed: boolean },
  reason: string,
): void {
  if (
    movement.kind !== "INCOME" &&
    movement.kind !== "ADJUSTMENT" &&
    movement.kind !== "TRANSFER"
  ) {
    throw new DomainError(
      "treasury.not_manual",
      "Ce mouvement vient de la caisse ou de la facturation : corrigez sa source (annulation du paiement, refus de la dépense).",
    );
  }
  if (movement.reversalOfId) {
    throw new DomainError("treasury.is_reversal", "Une contre-passation ne se contre-passe pas.");
  }
  if (movement.alreadyReversed) {
    throw new DomainError("treasury.already_reversed", "Ce mouvement est déjà contre-passé.");
  }
  if (reason.trim().length < 3) {
    throw new DomainError("treasury.reason_required", "Indiquez le motif de la contre-passation.");
  }
}

/** RG-M18-07 — écart = relevé − calculé. */
export function reconcile(
  statementBalance: number,
  computedBalance: number,
): { difference: number; balanced: boolean } {
  if (!Number.isInteger(statementBalance)) {
    throw new DomainError(
      "INVALID_AMOUNT",
      "Le solde du relevé doit être un montant entier en FCFA.",
    );
  }
  const difference = statementBalance - computedBalance;
  return { difference, balanced: difference === 0 };
}

// ── Rapports par période (RG-M18-08) ────────────────────────────────────────────────────

export type GroupBy = "day" | "week" | "month";

export interface ReportMovement {
  accountId: string;
  direction: DirectionLike;
  kind: MovementKindLike;
  amount: number;
  occurredAt: Date;
  category: string | null;
}

export interface PeriodReport {
  opening: number;
  inflow: number;
  outflow: number;
  closing: number;
  net: number;
  series: { key: string; inflow: number; outflow: number; net: number }[];
  inflowByKind: { kind: MovementKindLike; amount: number }[];
  outflowByKind: { kind: MovementKindLike; amount: number }[];
  inflowByMethod: { method: string; amount: number }[];
  outflowByCategory: { category: string; amount: number }[];
}

export function bucketKey(date: Date, groupBy: GroupBy, timeZone: string): string {
  const d = localDateKey(date, timeZone);
  if (groupBy === "day") return d;
  if (groupBy === "week") return startOfWeekKey(d);
  return d.slice(0, 7);
}

/** Toutes les clés de la période (y compris celles sans mouvement), dans l'ordre. */
export function periodBuckets(from: string, to: string, groupBy: GroupBy): string[] {
  const keys: string[] = [];
  let cursor =
    groupBy === "week"
      ? startOfWeekKey(from)
      : groupBy === "month"
        ? `${from.slice(0, 7)}-01`
        : from;
  const last =
    groupBy === "week" ? startOfWeekKey(to) : groupBy === "month" ? `${to.slice(0, 7)}-01` : to;
  while (cursor <= last && keys.length < 1000) {
    keys.push(groupBy === "month" ? cursor.slice(0, 7) : cursor);
    if (groupBy === "day") cursor = addDaysToKey(cursor, 1);
    else if (groupBy === "week") cursor = addDaysToKey(cursor, 7);
    else {
      const [y, m] = cursor.split("-").map(Number) as [number, number];
      cursor = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    }
  }
  return keys;
}

const sumBy = <K extends string>(rows: { k: K; amount: number }[]) => {
  const map = new Map<K, number>();
  for (const r of rows) map.set(r.k, (map.get(r.k) ?? 0) + r.amount);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
};

/**
 * RG-M18-08 — rapport d'une période : ouverture, entrées, sorties, clôture, série et
 * ventilations. `excludeInternal` (vue « tous comptes ») retire virements et versements de
 * caisse, qui ne changent pas l'argent total du garage.
 */
export function periodReport(input: {
  opening: number;
  movements: readonly ReportMovement[];
  from: string;
  to: string;
  groupBy: GroupBy;
  timeZone: string;
  excludeInternal: boolean;
}): PeriodReport {
  const internal = (m: ReportMovement) => m.kind === "TRANSFER" || m.kind === "CASH_DROP";
  const rows = input.excludeInternal
    ? input.movements.filter((m) => !internal(m))
    : input.movements;
  const series = new Map(
    periodBuckets(input.from, input.to, input.groupBy).map((k) => [k, { inflow: 0, outflow: 0 }]),
  );
  let inflow = 0;
  let outflow = 0;
  for (const m of rows) {
    const bucket = series.get(bucketKey(m.occurredAt, input.groupBy, input.timeZone));
    if (m.direction === "IN") {
      inflow += m.amount;
      if (bucket) bucket.inflow += m.amount;
    } else {
      outflow += m.amount;
      if (bucket) bucket.outflow += m.amount;
    }
  }
  const ins = rows.filter((m) => m.direction === "IN");
  const outs = rows.filter((m) => m.direction === "OUT");
  return {
    opening: input.opening,
    inflow,
    outflow,
    net: inflow - outflow,
    closing: input.opening + inflow - outflow,
    series: [...series.entries()].map(([k, v]) => ({ key: k, ...v, net: v.inflow - v.outflow })),
    inflowByKind: sumBy(ins.map((m) => ({ k: m.kind, amount: m.amount }))).map(
      ([kind, amount]) => ({ kind, amount }),
    ),
    outflowByKind: sumBy(outs.map((m) => ({ k: m.kind, amount: m.amount }))).map(
      ([kind, amount]) => ({ kind, amount }),
    ),
    inflowByMethod: sumBy(
      ins
        .filter((m) => m.kind === "PAYMENT")
        .map((m) => ({ k: m.category ?? "OTHER", amount: m.amount })),
    ).map(([method, amount]) => ({ method, amount })),
    outflowByCategory: sumBy(
      outs
        .filter((m) => m.kind === "EXPENSE" || m.kind === "ADJUSTMENT" || m.kind === "REFUND")
        .map((m) => ({
          k: m.kind === "REFUND" ? "Remboursements clients" : (m.category ?? "Divers"),
          amount: m.amount,
        })),
    ).map(([category, amount]) => ({ category, amount })),
  };
}

/** Catégories proposées pour les mouvements manuels et dépenses hors caisse. */
export const DEFAULT_TREASURY_CATEGORIES = {
  income: ["Apport du gérant", "Remboursement assurance", "Intérêts", "Vente d'actif", "Divers"],
  expense: [
    "Loyer",
    "Salaires",
    "Fournisseurs",
    "Électricité et eau",
    "Téléphone et internet",
    "Frais bancaires",
    "Impôts et taxes",
    "Carburant",
    "Transport",
    "Divers",
  ],
  adjustment: ["Écart de rapprochement", "Frais bancaires", "Correction de saisie", "Divers"],
} as const;
