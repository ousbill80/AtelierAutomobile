"use client";

// M18 `/tresorerie/journal` — grand livre : filtres (compte, sens, nature, période, recherche),
// totaux de la sélection, lien vers la source, contre-passation des mouvements manuels.
import { Suspense, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Search, X } from "lucide-react";
import { Button } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ListSkeleton } from "@/components/repair-orders/error-box";
import { JournalList } from "@/components/treasury/journal-list";
import { tt } from "@/components/treasury/i18n";

const KINDS = [
  "PAYMENT",
  "PAYMENT_REVERSAL",
  "REFUND",
  "EXPENSE",
  "CASH_DROP",
  "CASH_VARIANCE",
  "TRANSFER",
  "INCOME",
  "ADJUSTMENT",
] as const;

export default function TreasuryJournalPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={5} />}>
      <Journal />
    </Suspense>
  );
}

function Journal() {
  const params = useSearchParams();
  const [accountId, setAccountId] = useState(params.get("compte") ?? "");
  const [flow, setFlow] = useState<"" | "IN" | "OUT">("");
  const [kind, setKind] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const accounts = trpc.treasury.accounts.useQuery();
  const filtered = Boolean(accountId || flow || kind || from || to || q);
  const reset = () => {
    setAccountId("");
    setFlow("");
    setKind("");
    setFrom("");
    setTo("");
    setQ("");
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-5 pb-16">
      <header className="flex flex-col gap-2">
        <Link
          href="/tresorerie"
          className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={16} aria-hidden /> {tt("detail.back")}
        </Link>
        <h1 className="text-2xl font-semibold">{tt("journal.title")}</h1>
        <p className="text-sm text-muted">{tt("journal.subtitle")}</p>
      </header>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
        <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-bg px-3 focus-within:border-primary">
          <Search size={16} aria-hidden className="shrink-0 text-muted" />
          <input
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            placeholder={tt("journal.search")}
            aria-label={tt("journal.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <Filter label={tt("reports.account")} value={accountId} onChange={setAccountId}>
            <option value="">{tt("journal.allAccounts")}</option>
            {(accounts.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Filter>
          <Filter
            label={tt("journal.direction")}
            value={flow}
            onChange={(v) => setFlow(v as "" | "IN" | "OUT")}
          >
            <option value="">{tt("journal.allDirections")}</option>
            <option value="IN">{tt("direction.IN")}</option>
            <option value="OUT">{tt("direction.OUT")}</option>
          </Filter>
          <Filter label={tt("movementForm.kind")} value={kind} onChange={setKind}>
            <option value="">{tt("journal.allKinds")}</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {tt(`kinds.${k}`)}
              </option>
            ))}
          </Filter>
          <DateFilter
            label={tt("journal.from")}
            value={from}
            max={to || undefined}
            onChange={setFrom}
          />
          <DateFilter
            label={tt("journal.to")}
            value={to}
            min={from || undefined}
            onChange={setTo}
          />
          {filtered && (
            <Button variant="ghost" className="min-h-11" onClick={reset}>
              <X size={16} aria-hidden /> {tt("journal.reset")}
            </Button>
          )}
        </div>
      </div>

      <JournalList
        input={{
          accountId: accountId || undefined,
          flow: flow || undefined,
          kind: (kind || undefined) as (typeof KINDS)[number] | undefined,
          from: from || undefined,
          to: to || undefined,
          q: q.trim() || undefined,
        }}
        showAccount={!accountId}
      />
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <select
        className="h-11 max-w-full rounded-md border border-border bg-surface pr-9 pl-3 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

function DateFilter({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <input
        type="date"
        className="h-11 rounded-md border border-border bg-surface px-3 text-sm"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
