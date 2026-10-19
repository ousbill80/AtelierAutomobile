"use client";

// M08 §7 `/caisse` — session en cours : fond, encaissements par mode, dépenses, versements,
// espèces attendues ; Ouvrir, Dépense, Versement, Clôturer (comptage par coupures).
import { useState } from "react";
import Link from "next/link";
import { formatFCFA } from "@atelieros/core/money";
import { Button, Input, Modal, MoneyInput, Select, Textarea } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { t, tc } from "@/components/billing/i18n";

const DENOMINATIONS = [10_000, 5_000, 2_000, 1_000, 500, 250, 200, 100, 50, 25, 10, 5];

export default function CashPage() {
  const me = trpc.me.get.useQuery();
  const perms = new Set(me.data?.permissions ?? []);
  const utils = trpc.useUtils();
  const q = trpc.cash.current.useQuery({});
  const refresh = () => utils.cash.current.invalidate();
  const [modal, setModal] = useState<"expense" | "drop" | "close" | null>(null);
  const [float, setFloat] = useState<number | null>(null);
  const open = trpc.cash.open.useMutation({ onSuccess: refresh });

  if (q.isLoading) return <ListSkeleton rows={3} />;
  if (q.isError || !q.data)
    return <ErrorBox onRetry={() => q.refetch()} message={t("loadError")} />;
  const { session, site } = q.data;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{tc("title")}</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/caisse/paiements" className="btn btn-secondary min-h-11">
            {tc("payments")}
          </Link>
          <Link href="/caisse/sessions" className="btn btn-secondary min-h-11">
            {tc("history")}
          </Link>
        </div>
      </div>
      <p className="text-sm text-muted">{tc("site", { site: site.name })}</p>

      {!session ? (
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
          <p>{tc("noSession")}</p>
          {perms.has("cash:operate") && (
            <>
              <MoneyInput
                label={tc("float")}
                value={float ?? q.data.suggestedFloat}
                onChange={setFloat}
              />
              {open.error && (
                <p role="alert" className="text-sm text-status-bad">
                  ⚠ {open.error.message}
                </p>
              )}
              <Button
                loading={open.isPending}
                onClick={() => open.mutate({ openingFloat: float ?? q.data.suggestedFloat })}
              >
                {tc("open")}
              </Button>
            </>
          )}
        </section>
      ) : (
        <>
          <p className="text-sm">
            {tc("openedBy", {
              name: session.openedByName,
              date: formatDateTime(session.openedAt, q.data.timeZone),
            })}
          </p>
          <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
            <h2 className="font-semibold">{tc("byMethod")}</h2>
            {Object.entries(session.byMethod).length === 0 ? (
              <p className="text-muted">{t("payments.empty")}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {Object.entries(session.byMethod).map(([method, amount]) => (
                  <li key={method} className="flex justify-between">
                    <span>{t(`method.${method}`)}</span>
                    <span className="font-semibold">{formatFCFA(amount ?? 0)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3 text-sm">
            <h2 className="font-semibold">{tc("summary")}</h2>
            <Row label={tc("float")} value={session.openingFloat} />
            <Row label={tc("cashIn")} value={session.cashPayments} />
            <Row label={tc("expenses")} value={-session.expensesTotal} />
            <Row label={tc("refunds")} value={-session.cashRefunds} />
            <Row label={tc("drops")} value={-session.dropsTotal} />
            <div className="mt-1 flex justify-between border-t border-border pt-1 text-base font-semibold">
              <span>{tc("expected")}</span>
              <span data-testid="expected-cash">{formatFCFA(session.expectedCash)}</span>
            </div>
          </section>
          <div className="flex flex-wrap gap-2">
            {perms.has("cash:expense") && (
              <Button variant="secondary" onClick={() => setModal("expense")}>
                {tc("expense")}
              </Button>
            )}
            {perms.has("cash:operate") && (
              <Button variant="secondary" onClick={() => setModal("drop")}>
                {tc("drop")}
              </Button>
            )}
            {perms.has("cash:close") && (
              <Button onClick={() => setModal("close")}>{tc("close")}</Button>
            )}
          </div>
          {modal === "expense" && (
            <ExpenseModal
              sessionId={session.id}
              categories={q.data.expenseCategories}
              approval={q.data.expenseApproval}
              onClose={() => setModal(null)}
              onDone={() => {
                setModal(null);
                refresh();
              }}
            />
          )}
          {modal === "drop" && (
            <DropModal
              sessionId={session.id}
              onClose={() => setModal(null)}
              onDone={() => {
                setModal(null);
                refresh();
              }}
            />
          )}
          {modal === "close" && (
            <CloseModal
              sessionId={session.id}
              expected={session.expectedCash}
              onClose={() => setModal(null)}
              onDone={() => {
                setModal(null);
                refresh();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span>{formatFCFA(value)}</span>
    </div>
  );
}

function ExpenseModal({
  sessionId,
  categories,
  approval,
  onClose,
  onDone,
}: {
  sessionId: string;
  categories: string[];
  approval: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [category, setCategory] = useState(categories[0] ?? "");
  const [amount, setAmount] = useState<number | null>(null);
  const [description, setDescription] = useState("");
  const m = trpc.cash.expense.useMutation({ onSuccess: onDone });
  return (
    <Modal
      open
      title={tc("expenseForm.title")}
      onClose={onClose}
      footer={
        <Button
          loading={m.isPending}
          disabled={!amount || !description.trim()}
          onClick={() => amount && m.mutate({ sessionId, category, amount, description })}
        >
          {tc("expenseForm.submit")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          {tc("expenseForm.category")}
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </label>
        <MoneyInput label={tc("expenseForm.amount")} value={amount} onChange={setAmount} />
        <p className="text-xs text-muted">
          {tc("expenseForm.approvalHint", { amount: formatFCFA(approval) })}
        </p>
        <Input
          label={tc("expenseForm.description")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {m.error && (
          <p role="alert" className="text-status-bad">
            ⚠ {m.error.message}
          </p>
        )}
      </div>
    </Modal>
  );
}

function DropModal({
  sessionId,
  onClose,
  onDone,
}: {
  sessionId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState<number | null>(null);
  const [destination, setDestination] = useState<"safe" | "bank">("safe");
  const [reference, setReference] = useState("");
  const m = trpc.cash.drop.useMutation({ onSuccess: onDone });
  return (
    <Modal
      open
      title={tc("dropForm.title")}
      onClose={onClose}
      footer={
        <Button
          loading={m.isPending}
          disabled={!amount}
          onClick={() =>
            amount &&
            m.mutate({ sessionId, amount, destination, reference: reference || undefined })
          }
        >
          {tc("dropForm.submit")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <MoneyInput label={tc("expenseForm.amount")} value={amount} onChange={setAmount} />
        <label className="flex flex-col gap-1">
          {tc("dropForm.destination")}
          <Select
            value={destination}
            onChange={(e) => setDestination(e.target.value as "safe" | "bank")}
          >
            <option value="safe">{tc("dropForm.safe")}</option>
            <option value="bank">{tc("dropForm.bank")}</option>
          </Select>
        </label>
        <Input
          label={tc("dropForm.reference")}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        {m.error && (
          <p role="alert" className="text-status-bad">
            ⚠ {m.error.message}
          </p>
        )}
      </div>
    </Modal>
  );
}

function CloseModal({
  sessionId,
  expected,
  onClose,
  onDone,
}: {
  sessionId: string;
  expected: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [counted, setCounted] = useState<number | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const m = trpc.cash.close.useMutation({ onSuccess: onDone });
  const fromCounts = Object.entries(counts).reduce((s, [k, n]) => s + Number(k) * n, 0);
  const useCounts = Object.values(counts).some((n) => n > 0);
  const total = useCounts ? fromCounts : counted;
  const difference = total === null ? null : total - expected;
  return (
    <Modal
      open
      title={tc("closeForm.title")}
      onClose={onClose}
      footer={
        <Button
          loading={m.isPending}
          disabled={total === null}
          onClick={() =>
            m.mutate({
              id: sessionId,
              ...(useCounts
                ? {
                    denominations: Object.fromEntries(
                      Object.entries(counts).filter(([, n]) => n > 0),
                    ),
                  }
                : { countedCash: counted ?? 0 }),
              notes: notes.trim() || undefined,
            })
          }
        >
          {tc("closeForm.submit")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p>
          {tc("expected")} : <strong>{formatFCFA(expected)}</strong>
        </p>
        {!useCounts && (
          <MoneyInput label={tc("closeForm.counted")} value={counted} onChange={setCounted} />
        )}
        <details>
          <summary className="min-h-11 cursor-pointer py-2">
            {tc("closeForm.denominations")}
          </summary>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {DENOMINATIONS.map((d) => (
              <Input
                key={d}
                label={formatFCFA(d)}
                type="number"
                inputMode="numeric"
                min={0}
                value={counts[d] ?? ""}
                onChange={(e) =>
                  setCounts((c) => ({
                    ...c,
                    [d]: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                  }))
                }
              />
            ))}
          </div>
        </details>
        {difference !== null && (
          <p className={difference === 0 ? "text-status-ok" : "font-semibold text-status-warn"}>
            {difference === 0 ? "✓ " : "⚠ "}
            {tc("closeForm.difference", { amount: formatFCFA(difference) })}
          </p>
        )}
        <label className="flex flex-col gap-1">
          {tc("closeForm.notes")}
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </label>
        {m.error && (
          <p role="alert" className="text-status-bad">
            ⚠ {m.error.message}
          </p>
        )}
      </div>
    </Modal>
  );
}
