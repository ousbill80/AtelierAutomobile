"use client";

// M08 §7 `/caisse` — session en cours : synthèse (espèces attendues, encaissé, dépenses,
// versements), encaissements par mode, calcul des espèces, journal chronologique ; Ouvrir,
// Dépense (justificatif, validation au-delà du seuil), Versement, Clôturer (comptage par
// coupures, écart, commentaire). Dépenses en attente : bandeau, décision du gérant, clôture
// bloquée (RG-M08-30).
import { useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Banknote,
  Camera,
  CircleCheck,
  HandCoins,
  History,
  Hourglass,
  Landmark,
  Lock,
  Paperclip,
  Receipt,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { CASH_DENOMINATIONS } from "@atelieros/core/billing";
import { formatFCFA } from "@atelieros/core/money";
import { Button, Input, Modal, MoneyInput, Select, compressImage } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox } from "@/components/repair-orders/error-box";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { t, tc } from "@/components/billing/i18n";
import {
  AmountRow,
  CashJournal,
  ExpenseDecisionModal,
  Kpi,
  MethodTotals,
  Section,
  differenceTone,
  signedFCFA,
  type SessionSummaryData,
} from "@/components/cash/cash-ui";

type ModalKind = "expense" | "drop" | "close" | null;

export default function CashPage() {
  const me = trpc.me.get.useQuery();
  const perms = new Set(me.data?.permissions ?? []);
  const utils = trpc.useUtils();
  const q = trpc.cash.current.useQuery({});
  const refresh = () => utils.cash.invalidate();
  const [modal, setModal] = useState<ModalKind>(null);
  const [float, setFloat] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [decision, setDecision] = useState<{ id: string; decision: "approve" | "reject" } | null>(
    null,
  );
  const [closedId, setClosedId] = useState<string | null>(null);
  const open = trpc.cash.open.useMutation({
    onSuccess: () => {
      setNotice(null);
      void refresh();
    },
  });

  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data)
    return <ErrorBox onRetry={() => q.refetch()} message={t("loadError")} />;
  const { session, site, timeZone } = q.data;
  const canApprove = perms.has("cash:expense_approve");

  return (
    <div className="flex w-full min-w-0 flex-col gap-5 pb-16">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{tc("title")}</h1>
          <p className="mt-1 text-sm text-muted">
            {tc("site", { site: site.name })} · {tc("subtitle")}
          </p>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label={tc("title")}>
          <Link href="/caisse/depenses" className="btn btn-secondary min-h-11">
            <HandCoins size={16} aria-hidden /> {tc("expensesLink")}
          </Link>
          <Link href="/caisse/paiements" className="btn btn-secondary min-h-11">
            <Receipt size={16} aria-hidden /> {tc("payments")}
          </Link>
          <Link href="/caisse/sessions" className="btn btn-secondary min-h-11">
            <History size={16} aria-hidden /> {tc("history")}
          </Link>
        </nav>
      </header>

      {notice && (
        <p
          role="status"
          className={`flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm ${
            notice.tone === "ok"
              ? "border-status-ok bg-status-ok-bg text-status-ok"
              : "border-status-warn bg-status-warn-bg text-status-warn"
          }`}
        >
          {notice.tone === "ok" ? (
            <CircleCheck size={16} aria-hidden />
          ) : (
            <Hourglass size={16} aria-hidden />
          )}
          <span className="min-w-0 flex-1">{notice.text}</span>
          {closedId && (
            <Link href={`/caisse/sessions/${closedId}`} className="font-semibold underline">
              {tc("closeForm.seeZ")}
            </Link>
          )}
        </p>
      )}

      {!session ? (
        <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 sm:p-8">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2">
              <Lock size={20} aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold">{tc("noSession")}</h2>
              <p className="text-sm text-muted">{tc("noSessionHint")}</p>
            </div>
          </div>
          {perms.has("cash:operate") && (
            <div className="flex flex-wrap items-start gap-3">
              <div className="w-full max-w-sm min-w-0 [&_.field]:mb-0">
                <MoneyInput
                  label={tc("float")}
                  value={float ?? q.data.suggestedFloat}
                  onChange={setFloat}
                  hint={q.data.suggestedFloat > 0 ? tc("suggestedFloat") : undefined}
                />
              </div>
              <Button
                className="min-h-11 sm:mt-[27px]"
                loading={open.isPending}
                onClick={() => open.mutate({ openingFloat: float ?? q.data.suggestedFloat })}
              >
                <Wallet size={16} aria-hidden /> {tc("open")}
              </Button>
            </div>
          )}
          {open.error && (
            <p role="alert" className="text-sm text-status-bad">
              {open.error.message}
            </p>
          )}
        </section>
      ) : (
        <OpenSession
          session={session}
          timeZone={timeZone}
          perms={perms}
          onAction={setModal}
          onDecide={(id, d) => setDecision({ id, decision: d })}
        />
      )}

      {session && modal === "expense" && (
        <ExpenseModal
          sessionId={session.id}
          categories={q.data.expenseCategories}
          approval={q.data.expenseApproval}
          onClose={() => setModal(null)}
          onDone={(pending) => {
            setModal(null);
            setClosedId(null);
            setNotice({
              tone: pending ? "warn" : "ok",
              text: pending ? tc("expenseForm.pendingDone") : tc("expenseForm.done"),
            });
            void refresh();
          }}
        />
      )}
      {session && modal === "drop" && (
        <DropModal
          sessionId={session.id}
          max={session.expectedCash}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            setClosedId(null);
            setNotice({ tone: "ok", text: tc("dropForm.done") });
            void refresh();
          }}
        />
      )}
      {session && modal === "close" && (
        <CloseModal
          session={session}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            setClosedId(session.id);
            setNotice({ tone: "ok", text: tc("closeForm.done") });
            void refresh();
          }}
        />
      )}
      {decision && canApprove && (
        <ExpenseDecisionModal
          expenseId={decision.id}
          decision={decision.decision}
          onClose={() => setDecision(null)}
          onDone={(d) => {
            setDecision(null);
            setNotice({
              tone: "ok",
              text: d === "approve" ? tc("expensesPage.approved") : tc("expensesPage.rejected"),
            });
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function OpenSession({
  session,
  timeZone,
  perms,
  onAction,
  onDecide,
}: {
  session: SessionSummaryData;
  timeZone: string;
  perms: Set<string>;
  onAction: (kind: ModalKind) => void;
  onDecide: (id: string, decision: "approve" | "reject") => void;
}) {
  const canApprove = perms.has("cash:expense_approve");
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-status-ok bg-status-ok-bg px-4 py-3 text-sm text-status-ok">
        <span className="flex items-center gap-2 font-medium">
          <CircleCheck size={16} aria-hidden />
          {tc("sessionOpen")} ·{" "}
          {tc("openedBy", {
            name: session.openedByName,
            date: formatDateTime(session.openedAt, timeZone),
          })}
        </span>
        <div className="flex flex-wrap gap-2">
          {perms.has("cash:expense") && (
            <Button variant="secondary" className="min-h-11" onClick={() => onAction("expense")}>
              <ArrowUpRight size={16} aria-hidden /> {tc("newExpense")}
            </Button>
          )}
          {perms.has("cash:operate") && (
            <Button variant="secondary" className="min-h-11" onClick={() => onAction("drop")}>
              <Landmark size={16} aria-hidden /> {tc("drop")}
            </Button>
          )}
          {perms.has("cash:close") && (
            <Button className="min-h-11" onClick={() => onAction("close")}>
              <Lock size={16} aria-hidden /> {tc("close")}
            </Button>
          )}
        </div>
      </div>

      {session.pendingExpensesCount > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-status-warn bg-status-warn-bg p-3 text-sm text-status-warn"
        >
          <TriangleAlert size={16} aria-hidden className="shrink-0" />
          <span className="min-w-0 flex-1">
            {tc("pendingBanner", {
              count: session.pendingExpensesCount,
              amount: formatFCFA(session.pendingExpensesTotal),
            })}
          </span>
          <Link href="/caisse/depenses?status=PENDING" className="font-semibold underline">
            {tc("pendingReview")}
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={Banknote}
          label={tc("kpi.expected")}
          value={formatFCFA(session.expectedCash)}
          tone="ok"
          testId="expected-cash"
        />
        <Kpi icon={Wallet} label={tc("kpi.received")} value={formatFCFA(session.totalReceived)} />
        <Kpi
          icon={ArrowUpRight}
          label={tc("kpi.expenses")}
          value={formatFCFA(session.expensesTotal)}
          tone={session.pendingExpensesCount > 0 ? "warn" : "neutral"}
          hint={
            session.pendingExpensesCount > 0
              ? `+ ${formatFCFA(session.pendingExpensesTotal)} ${tc("status.PENDING").toLowerCase()}`
              : undefined
          }
        />
        <Kpi icon={Landmark} label={tc("kpi.drops")} value={formatFCFA(session.dropsTotal)} />
      </div>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <CashJournal
          session={session}
          timeZone={timeZone}
          renderExpenseActions={
            canApprove
              ? (id, status) =>
                  status === "PENDING" ? (
                    <>
                      <Button size="sm" className="min-h-9" onClick={() => onDecide(id, "approve")}>
                        {tc("expensesPage.approve")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="min-h-9"
                        onClick={() => onDecide(id, "reject")}
                      >
                        {tc("expensesPage.reject")}
                      </Button>
                    </>
                  ) : null
              : undefined
          }
        />
        <div className="flex min-w-0 flex-col gap-5">
          <Section title={tc("byMethod")}>
            <MethodTotals byMethod={session.byMethod} emptyLabel={t("payments.empty")} />
            {session.pendingCheques > 0 && (
              <p className="mt-2 text-xs text-muted">
                {tc("pendingCheques")} : {formatFCFA(session.pendingCheques)}
              </p>
            )}
          </Section>
          <Section title={tc("summary")}>
            <AmountRow label={tc("float")} amount={session.openingFloat} />
            <AmountRow label={`+ ${tc("cashIn")}`} amount={session.cashPayments} />
            <AmountRow label={`− ${tc("expenses")}`} amount={session.expensesTotal} />
            <AmountRow label={`− ${tc("refunds")}`} amount={session.cashRefunds} />
            <AmountRow label={`− ${tc("drops")}`} amount={session.dropsTotal} />
            <AmountRow label={tc("expected")} amount={session.expectedCash} strong />
          </Section>
        </div>
      </div>
    </>
  );
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <div className="h-14 animate-pulse rounded-lg bg-surface-2" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[74px] animate-pulse rounded-lg bg-surface-2" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-surface-2" />
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
  onDone: (pending: boolean) => void;
}) {
  const [category, setCategory] = useState(categories[0] ?? "");
  const [amount, setAmount] = useState<number | null>(null);
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<{ name: string; mimeType: string; base64: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = trpc.cash.uploadExpenseReceipt.useMutation();
  const m = trpc.cash.expense.useMutation({
    async onSuccess(expense) {
      if (file) {
        try {
          await upload.mutateAsync({
            expenseId: expense.id,
            mimeType: file.mimeType as "image/webp",
            dataBase64: file.base64,
          });
        } catch {
          // La dépense est enregistrée : le justificatif pourra être rajouté plus tard.
        }
      }
      onDone(expense.status === "PENDING");
    },
  });
  const pending = (amount ?? 0) > approval;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setFileError(null);
    try {
      if (f.type === "application/pdf") {
        const buf = new Uint8Array(await f.arrayBuffer());
        let binary = "";
        for (const byte of buf) binary += String.fromCharCode(byte);
        setFile({ name: f.name, mimeType: f.type, base64: btoa(binary) });
      } else {
        const img = await compressImage(f, 1600, 0.8);
        setFile({ name: f.name, mimeType: img.mimeType, base64: img.base64 });
      }
    } catch {
      setFileError(tc("receiptError"));
    }
  }

  return (
    <Modal
      open
      title={tc("expenseForm.title")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" className="min-h-11" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button
            className="min-h-11"
            loading={m.isPending || upload.isPending}
            disabled={!amount || !description.trim() || !category}
            onClick={() => amount && m.mutate({ sessionId, category, amount, description })}
          >
            {tc("expenseForm.submit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1">
        <label className="field">
          <span className="text-[13px] font-semibold">{tc("expenseForm.category")}</span>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </label>
        <MoneyInput label={tc("expenseForm.amount")} value={amount} onChange={setAmount} />
        <Input
          label={tc("expenseForm.description")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="field">
          <span className="text-[13px] font-semibold">{tc("expenseForm.receipt")}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={() => inputRef.current?.click()}
            >
              {file ? <Paperclip size={16} aria-hidden /> : <Camera size={16} aria-hidden />}
              {file ? tc("expenseForm.receiptChange") : tc("expenseForm.receiptTake")}
            </Button>
            {file && <span className="min-w-0 truncate text-sm text-muted">{file.name}</span>}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            className="hidden"
            onChange={(e) => void onFile(e)}
          />
          {fileError && <span className="error">{fileError}</span>}
        </div>
        <p
          className={`flex items-start gap-2 rounded-md p-3 text-sm ${
            pending ? "bg-status-warn-bg text-status-warn" : "bg-surface-2 text-muted"
          }`}
        >
          <Hourglass size={15} aria-hidden className="mt-0.5 shrink-0" />
          {tc("expenseForm.pendingHint", { amount: formatFCFA(approval) })}
        </p>
        {m.error && (
          <p role="alert" className="mt-2 text-sm text-status-bad">
            {m.error.message}
          </p>
        )}
      </div>
    </Modal>
  );
}

function DropModal({
  sessionId,
  max,
  onClose,
  onDone,
}: {
  sessionId: string;
  max: number;
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
        <>
          <Button variant="secondary" className="min-h-11" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button
            className="min-h-11"
            loading={m.isPending}
            disabled={!amount || amount > max}
            onClick={() =>
              amount &&
              m.mutate({ sessionId, amount, destination, reference: reference || undefined })
            }
          >
            {tc("dropForm.submit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1">
        <MoneyInput
          label={tc("expenseForm.amount")}
          value={amount}
          onChange={setAmount}
          hint={tc("dropForm.max", { amount: formatFCFA(max) })}
        />
        <div className="field">
          <span className="text-[13px] font-semibold">{tc("dropForm.destination")}</span>
          <div className="grid grid-cols-2 gap-2" role="radiogroup">
            {(["safe", "bank"] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={destination === d}
                onClick={() => setDestination(d)}
                className={`flex min-h-12 items-center justify-center gap-2 rounded-md border text-sm font-medium transition-colors ${
                  destination === d
                    ? "border-accent bg-accent/10 text-foreground"
                    : "border-border bg-surface text-muted hover:border-accent"
                }`}
              >
                {d === "safe" ? <Lock size={16} aria-hidden /> : <Landmark size={16} aria-hidden />}
                {d === "safe" ? tc("dropForm.safe") : tc("dropForm.bank")}
              </button>
            ))}
          </div>
        </div>
        <Input
          label={tc("dropForm.reference")}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        {m.error && (
          <p role="alert" className="text-sm text-status-bad">
            {m.error.message}
          </p>
        )}
      </div>
    </Modal>
  );
}

function CloseModal({
  session,
  onClose,
  onDone,
}: {
  session: SessionSummaryData;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"total" | "detail">("total");
  const [counted, setCounted] = useState<number | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const m = trpc.cash.close.useMutation({ onSuccess: onDone });
  const expected = session.expectedCash;
  const fromCounts = Object.entries(counts).reduce((s, [k, n]) => s + Number(k) * n, 0);
  const total = mode === "detail" ? fromCounts : counted;
  const difference = total === null ? null : total - expected;
  const blocked = session.pendingExpensesCount > 0;
  const needsNote = difference !== null && difference !== 0 && !notes.trim();
  const tone = differenceTone(difference);
  return (
    <Modal
      open
      size="lg"
      title={tc("closeForm.title")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" className="min-h-11" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button
            className="min-h-11"
            loading={m.isPending}
            disabled={blocked || total === null || needsNote}
            onClick={() =>
              m.mutate({
                id: session.id,
                ...(mode === "detail"
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
            <Lock size={16} aria-hidden /> {tc("closeForm.submit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 text-sm">
        {blocked && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-status-warn bg-status-warn-bg p-3 text-status-warn"
          >
            <TriangleAlert size={16} aria-hidden className="mt-0.5 shrink-0" />
            {tc("closeForm.blocked")}
          </p>
        )}

        <section className="flex flex-col gap-1">
          <h3 className="font-semibold">{tc("closeForm.step1")}</h3>
          <MethodTotals byMethod={session.byMethod} emptyLabel={t("payments.empty")} />
          <AmountRow label={tc("expected")} amount={expected} strong />
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{tc("closeForm.step2")}</h3>
            <div
              className="flex gap-1 rounded-lg bg-surface-2 p-1"
              role="group"
              aria-label={tc("closeForm.countMode")}
            >
              {(["total", "detail"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={mode === k}
                  onClick={() => setMode(k)}
                  className={`h-9 rounded-md px-3 text-sm font-medium ${
                    mode === k ? "bg-surface text-foreground shadow-sm" : "text-muted"
                  }`}
                >
                  {k === "total" ? tc("closeForm.countTotal") : tc("closeForm.countDetail")}
                </button>
              ))}
            </div>
          </div>
          {mode === "total" ? (
            <MoneyInput label={tc("closeForm.counted")} value={counted} onChange={setCounted} />
          ) : (
            <div className="grid grid-cols-2 gap-x-3 sm:grid-cols-3 lg:grid-cols-4">
              {CASH_DENOMINATIONS.map((d) => (
                <Input
                  key={d}
                  label={`× ${formatFCFA(d)}`}
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
              <div className="col-span-full">
                <AmountRow label={tc("closeForm.subtotal")} amount={fromCounts} strong />
              </div>
            </div>
          )}
          {difference !== null && (
            <p
              data-testid="close-difference"
              className={`flex items-center gap-2 rounded-md p-3 font-semibold ${
                tone === "ok"
                  ? "bg-status-ok-bg text-status-ok"
                  : tone === "bad"
                    ? "bg-status-bad-bg text-status-bad"
                    : "bg-status-warn-bg text-status-warn"
              }`}
            >
              {tone === "ok" ? (
                <CircleCheck size={16} aria-hidden />
              ) : (
                <TriangleAlert size={16} aria-hidden />
              )}
              {difference === 0
                ? tc("closeForm.exact")
                : difference > 0
                  ? tc("closeForm.over", { amount: signedFCFA(difference) })
                  : tc("closeForm.short", { amount: signedFCFA(difference) })}
            </p>
          )}
        </section>

        <section className="flex flex-col gap-1.5">
          <h3 className="font-semibold">{tc("closeForm.step3")}</h3>
          <label className="flex flex-col gap-1.5">
            <span className="text-muted">{tc("closeForm.notes")}</span>
            <textarea
              className={`textarea ${needsNote ? "invalid" : ""}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </label>
        </section>
        {m.error && (
          <p role="alert" className="text-status-bad">
            {m.error.message}
          </p>
        )}
      </div>
    </Modal>
  );
}
