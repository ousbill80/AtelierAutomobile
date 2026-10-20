"use client";

// M08 §7 `/caisse/sessions` — historique des sessions, écarts, clôtures tardives ; validation
// de l'écart par le propriétaire (`cash:review`).
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  DollarSign,
  RotateCcw,
  Search,
  ShieldCheck,
  User,
  Wallet,
  X,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, EmptyState, Modal, Select, StatusBadge, Textarea } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { t, tc } from "@/components/billing/i18n";

type FilterStatus = "ALL" | "OPEN" | "NEEDS_REVIEW" | "REGULAR" | "WITH_DIFF";

export default function CashSessionsPage() {
  const me = trpc.me.get.useQuery();
  const perms = useMemo(() => new Set(me.data?.permissions ?? []), [me.data?.permissions]);
  const q = trpc.cash.sessions.useQuery({ limit: 100 }, { refetchInterval: 30_000 });

  const [reviewing, setReviewing] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("ALL");
  const [siteFilter, setSiteFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");

  const review = trpc.cash.review.useMutation({
    onSuccess: () => {
      setReviewing(null);
      setComment("");
      void q.refetch();
    },
  });

  const rawItems = useMemo(() => q.data?.items ?? [], [q.data?.items]);

  // Sites distincts pour le filtre
  const sites = useMemo(() => {
    const list = Array.from(new Set(rawItems.map((s) => s.site)));
    return list.sort();
  }, [rawItems]);

  // Statistiques des 4 KPIs de caisse
  const stats = useMemo(() => {
    let openCount = 0;
    let withDiff = 0;
    let lateCount = 0;
    let totalControlled = 0;
    let needsReview = 0;
    let regularCount = 0;

    for (const s of rawItems) {
      if (!s.closedAt) {
        openCount += 1;
      } else {
        const hasDiff = s.difference !== null && s.difference !== 0;
        if (hasDiff) {
          withDiff += 1;
          if (!s.reviewedAt) {
            needsReview += 1;
          }
        } else {
          regularCount += 1;
        }

        if (s.lateClose) {
          lateCount += 1;
        }

        totalControlled += s.countedCash ?? s.expectedCash ?? 0;
      }
    }

    return {
      total: rawItems.length,
      openCount,
      withDiff,
      lateCount,
      totalControlled,
      needsReview,
      regularCount,
    };
  }, [rawItems]);

  // Filtrage combiné (statut, site, recherche)
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rawItems.filter((s) => {
      // Filtre statut
      if (statusFilter === "OPEN" && s.closedAt) return false;
      if (statusFilter === "NEEDS_REVIEW" && (!s.closedAt || !s.difference || s.reviewedAt)) {
        return false;
      }
      if (statusFilter === "REGULAR" && (!s.closedAt || s.difference !== 0)) return false;
      if (statusFilter === "WITH_DIFF" && (!s.closedAt || s.difference === 0)) return false;

      // Filtre site
      if (siteFilter !== "ALL" && s.site !== siteFilter) return false;

      // Recherche textuelle
      if (query) {
        const matchSite = s.site.toLowerCase().includes(query);
        const matchOpen = s.openedBy.toLowerCase().includes(query);
        const matchClose = s.closedBy?.toLowerCase().includes(query) ?? false;
        const matchNotes = s.notes?.toLowerCase().includes(query) ?? false;
        if (!matchSite && !matchOpen && !matchClose && !matchNotes) return false;
      }

      return true;
    });
  }, [rawItems, statusFilter, siteFilter, search]);

  const hasActiveFilters =
    statusFilter !== "ALL" || siteFilter !== "ALL" || search.trim().length > 0;

  const resetFilters = () => {
    setStatusFilter("ALL");
    setSiteFilter("ALL");
    setSearch("");
  };

  const currentReviewSession = useMemo(
    () => rawItems.find((s) => s.id === reviewing),
    [rawItems, reviewing],
  );

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {/* En-tête */}
      <div className="flex flex-col gap-2">
        <Link
          href="/caisse"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {t("back")}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {tc("sessions.title")}
            </h1>
            <p className="text-sm text-muted">{tc("sessions.subtitle")}</p>
          </div>
        </div>
      </div>

      {/* 4 Cartes KPIs interactives */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* 1. Sessions ouvertes */}
        <button
          type="button"
          onClick={() => setStatusFilter("OPEN")}
          className={`flex flex-col justify-between rounded-xl border p-4 text-left transition ${
            statusFilter === "OPEN"
              ? "border-status-warn bg-status-warn-bg/20 ring-1 ring-status-warn"
              : "border-border bg-surface hover:border-status-warn/40"
          }`}
        >
          <div className="flex items-center justify-between text-status-warn">
            <span className="text-xs font-semibold uppercase tracking-wider">
              {tc("sessions.kpis.open")}
            </span>
            <Wallet className="size-4" aria-hidden />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {stats.openCount}
          </div>
          <span className="mt-1 text-xs text-muted">{tc("sessions.kpis.openHint")}</span>
        </button>

        {/* 2. Clôturées avec écart */}
        <button
          type="button"
          onClick={() => setStatusFilter("WITH_DIFF")}
          className={`flex flex-col justify-between rounded-xl border p-4 text-left transition ${
            statusFilter === "WITH_DIFF"
              ? "border-status-bad bg-status-bad-bg/20 ring-1 ring-status-bad"
              : "border-border bg-surface hover:border-status-bad/40"
          }`}
        >
          <div className="flex items-center justify-between text-status-bad">
            <span className="text-xs font-semibold uppercase tracking-wider">
              {tc("sessions.kpis.withDifference")}
            </span>
            <AlertTriangle className="size-4" aria-hidden />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {stats.withDiff}
          </div>
          <span className="mt-1 text-xs text-muted">{tc("sessions.kpis.withDifferenceHint")}</span>
        </button>

        {/* 3. Clôtures tardives */}
        <button
          type="button"
          onClick={() => {
            resetFilters();
          }}
          className="flex flex-col justify-between rounded-xl border border-border bg-surface p-4 text-left transition hover:border-status-bad/40"
        >
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider">
              {tc("sessions.kpis.late")}
            </span>
            <Clock className="size-4 text-status-bad" aria-hidden />
          </div>
          <div
            className={`mt-2 text-2xl font-bold tracking-tight ${
              stats.lateCount > 0 ? "text-status-bad" : "text-foreground"
            }`}
          >
            {stats.lateCount}
          </div>
          <span className="mt-1 text-xs text-muted">{tc("sessions.kpis.lateHint")}</span>
        </button>

        {/* 4. Total espèces contrôlé */}
        <button
          type="button"
          onClick={() => setStatusFilter("ALL")}
          className={`flex flex-col justify-between rounded-xl border p-4 text-left transition ${
            statusFilter === "ALL" && !hasActiveFilters
              ? "border-status-ok bg-status-ok-bg/10 ring-1 ring-status-ok"
              : "border-border bg-surface hover:border-status-ok/40"
          }`}
        >
          <div className="flex items-center justify-between text-status-ok">
            <span className="text-xs font-semibold uppercase tracking-wider">
              {tc("sessions.kpis.totalControlled")}
            </span>
            <DollarSign className="size-4" aria-hidden />
          </div>
          <div className="mt-2 text-xl font-bold tracking-tight text-status-ok">
            {formatFCFA(stats.totalControlled)}
          </div>
          <span className="mt-1 text-xs text-muted">{tc("sessions.kpis.totalControlledHint")}</span>
        </button>
      </div>

      {/* Barre d'outils, filtres et recherche instantanée */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              type="search"
              value={search}
              placeholder={tc("sessions.filters.searchPlaceholder")}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-surface-2 pl-9 pr-8 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as FilterStatus)}
              className="h-10 text-xs"
            >
              <option value="ALL">{tc("sessions.filters.all")}</option>
              <option value="OPEN">{tc("sessions.filters.onlyOpen")}</option>
              <option value="NEEDS_REVIEW">{tc("sessions.filters.needsReview")}</option>
              <option value="REGULAR">{tc("sessions.filters.regular")}</option>
              <option value="WITH_DIFF">{tc("sessions.filters.hasDifference")}</option>
            </Select>

            {sites.length > 1 ? (
              <Select
                value={siteFilter}
                onChange={(e) => setSiteFilter(e.target.value)}
                className="h-10 text-xs"
              >
                <option value="ALL">{tc("sessions.filters.allSites")}</option>
                {sites.map((site) => (
                  <option key={site} value={site}>
                    {site}
                  </option>
                ))}
              </Select>
            ) : null}

            {hasActiveFilters ? (
              <Button variant="ghost" size="sm" onClick={resetFilters} className="h-10 text-xs">
                <RotateCcw className="mr-1.5 size-3.5" aria-hidden />
                {tc("sessions.filters.reset")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {q.isLoading ? (
        <ListSkeleton rows={3} />
      ) : q.isError || !q.data ? (
        <ErrorBox onRetry={() => q.refetch()} message={t("loadError")} />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          title={rawItems.length === 0 ? tc("sessions.empty") : tc("sessions.emptyFiltered")}
          description={rawItems.length === 0 ? undefined : tc("sessions.emptyFilteredHint")}
          action={
            hasActiveFilters ? (
              <Button variant="secondary" onClick={resetFilters}>
                <RotateCcw className="mr-1.5 size-3.5" aria-hidden />
                {tc("sessions.filters.reset")}
              </Button>
            ) : null
          }
        />
      ) : (
        <ul className="flex flex-col gap-3.5">
          {filteredItems.map((s) => {
            const hasDiff = s.difference !== null && s.difference !== 0;
            const diffNegative = (s.difference ?? 0) < 0;

            return (
              <li
                key={s.id}
                className={`flex flex-col justify-between gap-3.5 rounded-xl border bg-surface p-4 shadow-sm transition ${
                  hasDiff
                    ? "border-status-bad/40 bg-status-bad-bg/5"
                    : "border-border hover:border-accent/40"
                }`}
              >
                {/* En-tête de session */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-semibold text-foreground text-sm">{s.site}</span>
                    <span className="inline-flex items-center gap-1 text-xs text-muted">
                      <Clock className="size-3.5" aria-hidden />
                      {tc("sessions.openedAt", {
                        date: formatDateTime(s.openedAt, q.data.timeZone),
                      })}
                    </span>
                    {s.closedAt ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted">
                        ·{" "}
                        {tc("sessions.closedAt", {
                          date: formatDateTime(s.closedAt, q.data.timeZone),
                        })}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {!s.closedAt ? (
                      <StatusBadge tone="warn" label={tc("sessions.open")} />
                    ) : s.reviewedAt ? (
                      <StatusBadge tone="ok" label={`✓ ${tc("sessions.reviewed")}`} />
                    ) : hasDiff ? (
                      <StatusBadge tone="bad" label={tc("sessions.reviewRequired")} />
                    ) : (
                      <StatusBadge tone="off" label={tc("sessions.closed")} />
                    )}
                    {s.lateClose && <StatusBadge tone="bad" label={`⚠ ${tc("sessions.late")}`} />}
                  </div>
                </div>

                {/* Données financières et détails */}
                <div className="grid grid-cols-2 gap-3 rounded-lg bg-surface-2/60 p-3 sm:grid-cols-4">
                  <div className="flex flex-col">
                    <span className="text-xs text-muted">{tc("float")}</span>
                    <span className="font-semibold text-foreground">
                      {formatFCFA(s.openingFloat)}
                    </span>
                  </div>

                  <div className="flex flex-col">
                    <span className="text-xs text-muted">{tc("expected")}</span>
                    <span className="font-semibold text-foreground">
                      {s.expectedCash !== null ? formatFCFA(s.expectedCash) : "—"}
                    </span>
                  </div>

                  <div className="flex flex-col">
                    <span className="text-xs text-muted">{tc("closeForm.counted")}</span>
                    <span className="font-semibold text-foreground">
                      {s.countedCash !== null ? formatFCFA(s.countedCash) : "—"}
                    </span>
                  </div>

                  <div className="flex flex-col">
                    <span className="text-xs text-muted">{tc("sessions.difference")}</span>
                    {s.closedAt ? (
                      <span
                        className={`font-bold ${
                          hasDiff
                            ? diffNegative
                              ? "text-status-bad"
                              : "text-status-warn"
                            : "text-status-ok"
                        }`}
                      >
                        {s.difference === 0
                          ? tc("sessions.perfectMatch")
                          : formatFCFA(s.difference ?? 0)}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </div>
                </div>

                {/* Caissier et note de clôture */}
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 font-medium text-foreground">
                      <User className="size-3 text-muted" aria-hidden />
                      {tc("sessions.openedBy", { name: s.openedBy })}
                    </span>
                    {s.closedBy ? (
                      <span>→ {tc("sessions.closedBy", { name: s.closedBy })}</span>
                    ) : null}
                  </div>

                  {s.notes ? (
                    <span className="italic">{tc("sessions.notes", { notes: s.notes })}</span>
                  ) : null}
                </div>

                {/* Visa et approbation gérant */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/40 pt-2.5">
                  <div>
                    {s.reviewedAt ? (
                      <div className="flex items-center gap-1.5 text-xs text-status-ok font-medium">
                        <CheckCircle2 className="size-3.5" aria-hidden />
                        <span>{tc("sessions.reviewedBadge")}</span>
                      </div>
                    ) : null}
                  </div>

                  {s.closedAt && !s.reviewedAt && hasDiff && perms.has("cash:review") ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setReviewing(s.id)}
                      className="h-8 text-xs font-semibold"
                    >
                      <ShieldCheck className="mr-1.5 size-3.5" aria-hidden />
                      {tc("sessions.review")}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Modale de revue gérant */}
      {reviewing && (
        <Modal
          open
          title={tc("sessions.reviewTitle")}
          onClose={() => setReviewing(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setReviewing(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                loading={review.isPending}
                disabled={comment.trim().length < 3 || review.isPending}
                onClick={() => review.mutate({ id: reviewing, comment: comment.trim() })}
              >
                {tc("sessions.reviewSubmit")}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {currentReviewSession ? (
              <div className="rounded-lg border border-status-bad/30 bg-status-bad-bg/10 p-3 text-xs">
                <div className="font-semibold text-status-bad">
                  {tc("sessions.difference")} : {formatFCFA(currentReviewSession.difference ?? 0)}
                </div>
                <div className="text-muted mt-0.5">
                  {currentReviewSession.site} ·{" "}
                  {tc("sessions.openedBy", { name: currentReviewSession.openedBy })}
                </div>
              </div>
            ) : null}

            <label className="flex flex-col gap-1.5 text-sm font-medium">
              <span>{tc("sessions.reviewComment")}</span>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={tc("sessions.reviewCommentHint")}
                rows={3}
              />
            </label>

            <span className="text-xs text-muted">{tc("sessions.reviewCommentHint")}</span>

            {review.error && (
              <p role="alert" className="text-sm text-status-bad">
                ⚠ {review.error.message}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
