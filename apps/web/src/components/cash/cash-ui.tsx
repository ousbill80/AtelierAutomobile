"use client";

// M08 — briques d'écran de la caisse : tuiles de synthèse, statut de dépense (icône + texte),
// encaissements par mode, journal chronologique d'une session, décision du gérant.
import { useState, type ReactNode } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CircleCheck,
  CircleX,
  Hourglass,
  Landmark,
  Paperclip,
  Receipt,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, Modal, Textarea } from "@atelieros/ui";
import { t, tc } from "@/components/billing/i18n";
import { trpc } from "@/trpc/react";
import type { AppRouter } from "@/server/routers/_app";

type Outputs = inferRouterOutputs<AppRouter>;
export type SessionSummaryData = NonNullable<Outputs["cash"]["current"]["session"]>;
export type ExpenseStatus = "PENDING" | "APPROVED" | "REJECTED";
export type JournalSource = Pick<SessionSummaryData, "payments" | "expenses" | "drops" | "refunds">;

export type Tone = "neutral" | "ok" | "warn" | "bad";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-foreground",
  ok: "text-status-ok",
  warn: "text-status-warn",
  bad: "text-status-bad",
};

const TONE_ICON_BG: Record<Tone, string> = {
  neutral: "bg-surface-2 text-foreground",
  ok: "bg-status-ok-bg text-status-ok",
  warn: "bg-status-warn-bg text-status-warn",
  bad: "bg-status-bad-bg text-status-bad",
};

export function timeOf(date: Date | string, timeZone: string) {
  return new Intl.DateTimeFormat("fr-FR", { timeZone, hour: "2-digit", minute: "2-digit" }).format(
    new Date(date),
  );
}

/** « 185 000 FCFA » avec signe explicite pour un écart (« +500 FCFA », « −2 500 FCFA »). */
export function signedFCFA(amount: number) {
  if (amount === 0) return formatFCFA(0);
  return amount > 0 ? `+${formatFCFA(amount)}` : `−${formatFCFA(-amount)}`;
}

export function differenceTone(difference: number | null | undefined): Tone {
  if (difference === null || difference === undefined) return "neutral";
  if (difference === 0) return "ok";
  return difference < 0 ? "bad" : "warn";
}

export function Kpi({
  icon: Icon,
  label,
  value,
  tone = "neutral",
  hint,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: Tone;
  hint?: string;
  testId?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface p-3 sm:p-4">
      <span
        className={`hidden h-10 w-10 shrink-0 items-center justify-center rounded-full sm:flex ${TONE_ICON_BG[tone]}`}
      >
        <Icon size={18} aria-hidden />
      </span>
      <span className="min-w-0">
        <span
          className={`block text-lg leading-tight font-semibold break-words tabular-nums sm:text-xl ${TONE_TEXT[tone]}`}
          data-testid={testId}
        >
          {value}
        </span>
        <span className="mt-0.5 block text-xs font-medium text-muted">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </div>
  );
}

const EXPENSE_STATUS: Record<ExpenseStatus, { tone: "ok" | "warn" | "bad"; Icon: LucideIcon }> = {
  PENDING: { tone: "warn", Icon: Hourglass },
  APPROVED: { tone: "ok", Icon: CircleCheck },
  REJECTED: { tone: "bad", Icon: CircleX },
};

/** Statut d'une dépense : couleur + icône + texte. */
export function ExpenseStatusBadge({ status }: { status: ExpenseStatus }) {
  const { tone, Icon } = EXPENSE_STATUS[status];
  return (
    <span className={`pill pill-${tone}`} data-status={status}>
      <Icon size={13} aria-hidden />
      {tc(`status.${status}`)}
    </span>
  );
}

export function Section({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface ${className}`}
    >
      <header className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-border bg-bg px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </header>
      <div className="flex flex-col p-4">{children}</div>
    </section>
  );
}

/** Lignes « libellé … montant » (récapitulatif d'espèces, totaux par mode). */
export function AmountRow({
  label,
  amount,
  strong,
  tone,
  testId,
  signed,
}: {
  label: string;
  amount: number;
  strong?: boolean;
  tone?: Tone;
  testId?: string;
  signed?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 py-1.5 text-sm ${
        strong ? "mt-1 border-t border-border pt-2.5 text-base font-semibold" : ""
      }`}
    >
      <span className={strong ? "" : "text-muted"}>{label}</span>
      <span className={`tabular-nums ${tone ? TONE_TEXT[tone] : ""}`} data-testid={testId}>
        {signed ? signedFCFA(amount) : formatFCFA(amount)}
      </span>
    </div>
  );
}

export function MethodTotals({
  byMethod,
  emptyLabel,
}: {
  byMethod: Partial<Record<string, number>>;
  emptyLabel: string;
}) {
  const rows = Object.entries(byMethod)
    .filter(([, amount]) => (amount ?? 0) !== 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  const total = rows.reduce((s, [, amount]) => s + (amount ?? 0), 0);
  if (rows.length === 0) return <p className="text-sm text-muted">{emptyLabel}</p>;
  return (
    <div className="flex flex-col" data-testid="method-totals">
      {rows.map(([method, amount]) => {
        const share = total > 0 ? Math.round(((amount ?? 0) / total) * 100) : 0;
        return (
          <div key={method} className="flex flex-col gap-1 py-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span>{t(`method.${method}`)}</span>
              <span className="font-medium tabular-nums">{formatFCFA(amount ?? 0)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div className="h-full rounded-full bg-accent" style={{ width: `${share}%` }} />
            </div>
          </div>
        );
      })}
      <AmountRow label={tc("kpi.received")} amount={total} strong />
    </div>
  );
}

type JournalKind = "payment" | "expense" | "drop" | "refund";

interface JournalEntry {
  id: string;
  kind: JournalKind;
  at: Date;
  title: string;
  detail: string | null;
  amount: number;
  /** Effet sur l'espèce attendue : entrée (+), sortie (−) ou neutre (mode non espèces). */
  effect: "in" | "out" | "none";
  status?: ExpenseStatus;
  link?: { href: string; label: string };
  pendingCheque?: boolean;
}

const KIND_ICON: Record<JournalKind, LucideIcon> = {
  payment: ArrowDownLeft,
  expense: ArrowUpRight,
  drop: Landmark,
  refund: Undo2,
};

export function buildJournal(session: JournalSource): JournalEntry[] {
  const entries: JournalEntry[] = [
    ...session.payments.map((p) => ({
      id: `p-${p.id}`,
      kind: "payment" as const,
      at: new Date(p.receivedAt),
      title: `${t(`method.${p.method}`)} — ${p.customer?.displayName ?? "—"}`,
      detail: [
        p.number,
        p.reference,
        p.receivedByName && tc("journal.by", { name: p.receivedByName }),
      ]
        .filter(Boolean)
        .join(" · "),
      amount: p.amount,
      effect: p.method === "CASH" && p.status !== "PENDING" ? ("in" as const) : ("none" as const),
      link: { href: `/api/caisse/recus/${p.id}/pdf`, label: tc("journal.receipt") },
      pendingCheque: p.status === "PENDING",
    })),
    ...session.expenses.map((e) => ({
      id: `e-${e.id}`,
      kind: "expense" as const,
      at: new Date(e.paidAt),
      title: `${e.category} — ${e.description}`,
      detail: [
        e.createdByName && tc("journal.by", { name: e.createdByName }),
        e.decisionComment && `« ${e.decisionComment} »`,
      ]
        .filter(Boolean)
        .join(" · "),
      amount: e.amount,
      effect: e.status === "APPROVED" ? ("out" as const) : ("none" as const),
      status: e.status as ExpenseStatus,
      link: e.receiptUrl ? { href: e.receiptUrl, label: tc("journal.proof") } : undefined,
    })),
    ...session.drops.map((d) => ({
      id: `d-${d.id}`,
      kind: "drop" as const,
      at: new Date(d.createdAt),
      title: `${tc("journal.drop")} — ${d.destination === "bank" ? tc("dropForm.bank") : tc("dropForm.safe")}`,
      detail: d.reference,
      amount: d.amount,
      effect: "out" as const,
    })),
    ...session.refunds.map((r) => ({
      id: `r-${r.id}`,
      kind: "refund" as const,
      at: new Date(r.createdAt),
      title: `${tc("journal.refund")} — ${t(`method.${r.method}`)}`,
      detail: r.reason ?? null,
      amount: r.amount,
      effect: r.method === "CASH" ? ("out" as const) : ("none" as const),
    })),
  ];
  return entries.sort((a, b) => b.at.getTime() - a.at.getTime());
}

const FILTERS: Array<"all" | JournalKind> = ["all", "payment", "expense", "drop", "refund"];

export function CashJournal({
  session,
  timeZone,
  renderExpenseActions,
}: {
  session: JournalSource;
  timeZone: string;
  renderExpenseActions?: (expenseId: string, status: ExpenseStatus) => ReactNode;
}) {
  const [filter, setFilter] = useState<"all" | JournalKind>("all");
  const all = buildJournal(session);
  const entries = filter === "all" ? all : all.filter((e) => e.kind === filter);
  return (
    <Section
      title={`${tc("journal.title")} (${all.length})`}
      action={
        <div className="flex flex-wrap gap-1" role="group" aria-label={tc("journal.title")}>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`h-9 rounded-full px-3 text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              {f === "all" ? tc("journal.all") : tc(`journal.filters.${f}`)}
            </button>
          ))}
        </div>
      }
    >
      {entries.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{tc("journal.empty")}</p>
      ) : (
        <ul className="-my-1 divide-y divide-border" data-testid="cash-journal">
          {entries.map((e) => {
            const Icon = KIND_ICON[e.kind];
            const sign = e.effect === "in" ? "+" : e.effect === "out" ? "−" : "";
            return (
              <li key={e.id} className="flex flex-wrap items-start gap-3 py-3">
                <span
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    e.kind === "payment"
                      ? "bg-status-ok-bg text-status-ok"
                      : e.kind === "drop"
                        ? "bg-surface-2 text-foreground"
                        : "bg-status-warn-bg text-status-warn"
                  }`}
                  title={tc(`journal.${e.kind}`)}
                >
                  <Icon size={15} aria-hidden />
                </span>
                <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="min-w-0 break-words">{e.title}</span>
                    {e.status && <ExpenseStatusBadge status={e.status} />}
                    {e.pendingCheque && (
                      <span className="pill pill-warn">
                        <Hourglass size={13} aria-hidden />
                        {tc("pendingCheques")}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted">
                    {timeOf(e.at, timeZone)}
                    {e.detail ? ` · ${e.detail}` : ""}
                  </span>
                  {(e.link || (e.status && renderExpenseActions)) && (
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      {e.link && (
                        <a
                          href={e.link.href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-accent hover:underline"
                        >
                          {e.kind === "payment" ? (
                            <Receipt size={13} aria-hidden />
                          ) : (
                            <Paperclip size={13} aria-hidden />
                          )}
                          {e.link.label}
                        </a>
                      )}
                      {e.status && renderExpenseActions?.(e.id.slice(2), e.status)}
                    </span>
                  )}
                </div>
                <span
                  className={`shrink-0 text-sm font-semibold tabular-nums ${
                    e.effect === "in"
                      ? "text-status-ok"
                      : e.effect === "out"
                        ? "text-foreground"
                        : "text-muted"
                  } ${e.status === "REJECTED" ? "line-through" : ""}`}
                >
                  {sign}
                  {formatFCFA(e.amount)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/** Décision du gérant sur une dépense en attente (motif obligatoire au refus). */
export function ExpenseDecisionModal({
  expenseId,
  decision,
  onClose,
  onDone,
}: {
  expenseId: string;
  decision: "approve" | "reject";
  onClose: () => void;
  onDone: (decision: "approve" | "reject") => void;
}) {
  const [comment, setComment] = useState("");
  const m = trpc.cash.decideExpense.useMutation({ onSuccess: () => onDone(decision) });
  const reject = decision === "reject";
  return (
    <Modal
      open
      title={reject ? tc("expensesPage.rejectTitle") : tc("expensesPage.approveTitle")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" className="min-h-11" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button
            variant={reject ? "danger" : "primary"}
            className="min-h-11"
            loading={m.isPending}
            disabled={reject && comment.trim().length < 3}
            onClick={() =>
              m.mutate({ id: expenseId, decision, comment: comment.trim() || undefined })
            }
          >
            {reject ? tc("expensesPage.reject") : tc("expensesPage.approve")}
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">
          {reject ? tc("expensesPage.rejectReason") : tc("expensesPage.approveComment")}
        </span>
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} autoFocus />
      </label>
      {m.error && (
        <p role="alert" className="mt-3 text-sm text-status-bad">
          {m.error.message}
        </p>
      )}
    </Modal>
  );
}

/** Validation de l'écart d'une session clôturée par le propriétaire (`cash:review`). */
export function ReviewModal({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [comment, setComment] = useState("");
  const review = trpc.cash.review.useMutation({ onSuccess: onDone });
  return (
    <Modal
      open
      title={tc("sessions.review")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" className="min-h-11" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button
            className="min-h-11"
            loading={review.isPending}
            disabled={comment.trim().length < 3}
            onClick={() => review.mutate({ id, comment })}
          >
            {tc("sessions.review")}
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">{tc("sessions.reviewComment")}</span>
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} autoFocus />
      </label>
      {review.error && (
        <p role="alert" className="mt-3 text-sm text-status-bad">
          {review.error.message}
        </p>
      )}
    </Modal>
  );
}
