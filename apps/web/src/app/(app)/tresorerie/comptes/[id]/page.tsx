"use client";

// M18 `/tresorerie/comptes/[id]` — un compte : solde, modes encaissés, 30 derniers jours,
// rapprochements, mouvements ; Rapprocher, Virement, Modifier, Archiver.
import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArrowLeft, ArrowLeftRight, CircleCheck, Pencil, Scale } from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDay } from "@/components/repair-orders/i18n";
import { t } from "@/components/billing/i18n";
import { Section, signedFCFA } from "@/components/cash/cash-ui";
import { JournalList } from "@/components/treasury/journal-list";
import { tt } from "@/components/treasury/i18n";
import {
  AccountIcon,
  AccountModal,
  InOutChart,
  ReconcileModal,
  TransferModal,
} from "@/components/treasury/treasury-ui";

export default function TreasuryAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const me = trpc.me.get.useQuery();
  const canManage = (me.data?.permissions ?? []).includes("treasury:manage");
  const utils = trpc.useUtils();
  const q = trpc.treasury.account.useQuery({ id });
  const overview = trpc.treasury.overview.useQuery();
  const [modal, setModal] = useState<"reconcile" | "edit" | "transfer" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const archive = trpc.treasury.archiveAccount.useMutation({
    onSuccess: () => {
      void utils.treasury.invalidate();
      router.push("/tresorerie");
    },
  });
  const done = (text: string) => {
    setModal(null);
    setNotice(text);
    void utils.treasury.invalidate();
  };

  if (q.isLoading) return <ListSkeleton rows={4} />;
  if (q.isError || !q.data)
    return (
      <ErrorBox
        onRetry={() => q.refetch()}
        message={q.error?.data?.code === "NOT_FOUND" ? tt("detail.notFound") : tt("loadError")}
      />
    );
  const a = q.data;
  const active = (overview.data?.accounts ?? []).filter((x) => !x.archived);
  const taken = Object.fromEntries(
    active.flatMap((x) => x.paymentMethods.map((m) => [m, x.name] as const)),
  );

  return (
    <div className="flex w-full min-w-0 flex-col gap-5 pb-16">
      <header className="flex flex-col gap-2">
        <Link
          href="/tresorerie"
          className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={16} aria-hidden /> {tt("detail.back")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <AccountIcon type={a.type} size={20} />
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold break-words">{a.name}</h1>
              <p className="mt-1 text-sm text-muted">
                {tt(`types.${a.type}`)}
                {a.bankName ? ` · ${a.bankName}` : ""}
                {a.accountRef ? ` · ${a.accountRef}` : ""}
                {a.site ? ` · ${tt("account.site", { site: a.site })}` : ""}
                {a.ledgerAccount ? ` · ${tt("account.ledger", { code: a.ledgerAccount })}` : ""}
              </p>
              <p className="text-xs text-muted">
                {tt("account.openedOn", {
                  date: formatDay(a.openingDate),
                  amount: formatFCFA(a.openingBalance),
                })}
              </p>
            </div>
          </div>
          {canManage && !a.archived && (
            <div className="flex flex-wrap gap-2">
              <Button className="min-h-11" onClick={() => setModal("reconcile")}>
                <Scale size={16} aria-hidden /> {tt("actions.reconcile")}
              </Button>
              <Button
                variant="secondary"
                className="min-h-11"
                onClick={() => setModal("transfer")}
                disabled={active.length < 2}
              >
                <ArrowLeftRight size={16} aria-hidden /> {tt("actions.transfer")}
              </Button>
              <Button variant="secondary" className="min-h-11" onClick={() => setModal("edit")}>
                <Pencil size={16} aria-hidden /> {tt("actions.edit")}
              </Button>
              {a.type !== "CASH_REGISTER" && (
                <Button
                  variant="ghost"
                  className="min-h-11"
                  loading={archive.isPending}
                  onClick={() => {
                    if (window.confirm(tt("accountForm.archiveConfirm")))
                      archive.mutate({ id: a.id });
                  }}
                >
                  <Archive size={16} aria-hidden /> {tt("actions.archive")}
                </Button>
              )}
            </div>
          )}
        </div>
      </header>

      {notice && (
        <p
          role="status"
          className="rounded-lg border border-status-ok bg-status-ok-bg p-3 text-sm text-status-ok"
        >
          {notice}
        </p>
      )}
      {archive.error && (
        <p
          role="alert"
          className="rounded-lg border border-status-bad bg-status-bad-bg p-3 text-sm text-status-bad"
        >
          {archive.error.message}
        </p>
      )}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <Section title={tt("account.balance")}>
          <span
            className={`text-3xl font-semibold tabular-nums ${a.balance < 0 ? "text-status-bad" : ""}`}
            data-testid="account-balance"
          >
            {formatFCFA(a.balance)}
          </span>
          <div className="mt-3 flex flex-col gap-1 text-sm">
            <span className="flex justify-between gap-3">
              <span className="text-muted">
                {tt("reports.inflow")} · {tt("detail.last30")}
              </span>
              <span className="text-status-ok tabular-nums">+{formatFCFA(a.last30.inflow)}</span>
            </span>
            <span className="flex justify-between gap-3">
              <span className="text-muted">
                {tt("reports.outflow")} · {tt("detail.last30")}
              </span>
              <span className="tabular-nums">−{formatFCFA(a.last30.outflow)}</span>
            </span>
          </div>
          <div className="mt-4 flex flex-col gap-1">
            <span className="text-xs text-muted">{tt("account.methods")}</span>
            <span className="flex flex-wrap gap-1">
              {a.type === "CASH_REGISTER" ? (
                <span className="pill pill-type">{tt("account.cashMethod")}</span>
              ) : a.paymentMethods.length === 0 ? (
                <span className="text-sm text-muted">{tt("account.noMethods")}</span>
              ) : (
                a.paymentMethods.map((m) => (
                  <span key={m} className="pill pill-type">
                    {t(`method.${m}`)}
                  </span>
                ))
              )}
            </span>
          </div>
        </Section>
        <Section title={tt("detail.last30")}>
          <InOutChart
            series={a.last30.series}
            labelOf={(k) => `${k.slice(8, 10)}/${k.slice(5, 7)}`}
          />
        </Section>
      </div>

      <Section title={tt("detail.reconciliations")}>
        {a.reconciliations.length === 0 ? (
          <p className="text-sm text-muted">{tt("detail.noReconciliations")}</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[420px] text-sm" data-testid="reconciliations">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">{tt("reconcileForm.date")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{tt("detail.statement")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{tt("detail.computed")}</th>
                  <th className="py-2 text-right font-medium">{tt("detail.difference")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {a.reconciliations.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2.5 pr-3">
                      {formatDay(r.statementDate)}
                      {r.notes && <span className="block text-xs text-muted">{r.notes}</span>}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {formatFCFA(r.statementBalance)}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {formatFCFA(r.computedBalance)}
                    </td>
                    <td
                      className={`py-2.5 text-right font-semibold whitespace-nowrap tabular-nums ${
                        r.difference === 0 ? "text-status-ok" : "text-status-warn"
                      }`}
                    >
                      {r.difference === 0 && (
                        <CircleCheck size={13} aria-hidden className="mr-1 inline" />
                      )}
                      {signedFCFA(r.difference)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{tt("detail.movements")}</h2>
        <JournalList input={{ accountId: a.id }} showAccount={false} />
      </section>

      {modal === "reconcile" && (
        <ReconcileModal
          account={a}
          todayKey={a.today}
          onClose={() => setModal(null)}
          onDone={done}
        />
      )}
      {modal === "edit" && overview.data && (
        <AccountModal
          account={a}
          sites={overview.data.sites}
          takenMethods={taken}
          todayKey={a.today}
          onClose={() => setModal(null)}
          onDone={done}
        />
      )}
      {modal === "transfer" && (
        <TransferModal
          accounts={active}
          defaultFrom={a.id}
          todayKey={a.today}
          onClose={() => setModal(null)}
          onDone={done}
        />
      )}
    </div>
  );
}
