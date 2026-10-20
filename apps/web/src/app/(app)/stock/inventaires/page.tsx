"use client";

// M07 §7 — /stock/inventaires : liste des inventaires et création (complet, par catégorie,
// par emplacement). Le stock théorique est figé au démarrage du comptage (RG-M07-10).
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  Layers,
  Plus,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import {
  Button,
  CheckboxRow,
  DataTable,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  StatusBadge,
} from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import {
  ErrorBox,
  InlineError,
  ListSkeleton,
  ModuleNav,
  PageTitle,
  SiteSelect,
  useCan,
  useDefaultSite,
} from "../_lib/components";
import { COUNT_TONE, errorMessage, formatDay, t } from "../_lib/i18n";

type CountScope = {
  categories?: string[];
  bins?: string[];
};

export default function CountsPage() {
  const router = useRouter();
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [onlyVariance, setOnlyVariance] = useState(false);

  const list = trpc.stockCount.list.useQuery({});
  const items = useMemo(() => list.data ?? [], [list.data]);

  // Statistiques KPIs
  const stats = useMemo(() => {
    let inProgress = 0;
    let withVariance = 0;
    let netVarianceValue = 0;

    for (const c of items) {
      if (c.status === "IN_PROGRESS" || c.status === "SUBMITTED" || c.status === "DRAFT") {
        inProgress += 1;
      }
      if (c.status === "VALIDATED") {
        if (c.varianceValue != null && c.varianceValue !== 0) {
          withVariance += 1;
        }
        if (c.varianceValue != null) {
          netVarianceValue += c.varianceValue;
        }
      }
    }

    return {
      total: items.length,
      inProgress,
      withVariance,
      netVarianceValue,
    };
  }, [items]);

  // Filtrage combiné recherche et statuts
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((c) => {
      if (statusFilter !== "ALL" && c.status !== statusFilter) {
        return false;
      }
      if (onlyVariance && (c.status !== "VALIDATED" || !c.varianceValue)) {
        return false;
      }
      if (!q) return true;

      const numberMatch = c.number.toLowerCase().includes(q);
      const siteMatch =
        c.site.name.toLowerCase().includes(q) || c.site.code.toLowerCase().includes(q);
      const scopeObj = (c.scope ?? {}) as CountScope;
      const catMatch = scopeObj.categories?.some((cat) => cat.toLowerCase().includes(q)) ?? false;
      const binMatch = scopeObj.bins?.some((bin) => bin.toLowerCase().includes(q)) ?? false;

      return numberMatch || siteMatch || catMatch || binMatch;
    });
  }, [items, search, statusFilter, onlyVariance]);

  const hasActiveFilters = search.length > 0 || statusFilter !== "ALL" || onlyVariance;

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("ALL");
    setOnlyVariance(false);
  };

  const getScopeDescription = (rawScope: unknown) => {
    const scope = (rawScope ?? {}) as CountScope;
    if (scope.categories && scope.categories.length > 0) {
      return t("counts.scopeCatCount", { count: scope.categories.length });
    }
    if (scope.bins && scope.bins.length > 0) {
      return t("counts.scopeBinCount", { count: scope.bins.length });
    }
    return t("counts.scopeFull");
  };

  return (
    <div className="flex flex-col gap-5">
      <ModuleNav section="stock" />

      {/* En-tête de page moderne */}
      <PageTitle
        title={t("counts.title")}
        description={t("counts.subtitle")}
        actions={
          can("stock:count") ? (
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-1.5 size-4" aria-hidden />
              {t("counts.new")}
            </Button>
          ) : null
        }
      />

      {/* 4 Cartes KPIs interactives */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Total inventaires */}
        <button
          type="button"
          onClick={() => {
            setStatusFilter("ALL");
            setOnlyVariance(false);
          }}
          className={`flex flex-col justify-between rounded-xl border p-4 text-left transition ${
            statusFilter === "ALL" && !onlyVariance
              ? "border-accent bg-accent/5 ring-1 ring-accent"
              : "border-border bg-surface hover:border-accent/40"
          }`}
        >
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider">
              {t("counts.kpis.total")}
            </span>
            <Layers className="size-4 text-accent" aria-hidden />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {stats.total}
          </div>
          <span className="mt-1 text-xs text-muted">
            {t("counts.kpis.totalHint", { count: stats.total })}
          </span>
        </button>

        {/* En cours de comptage */}
        <button
          type="button"
          onClick={() => {
            setStatusFilter("IN_PROGRESS");
            setOnlyVariance(false);
          }}
          className={`flex flex-col justify-between rounded-xl border p-4 text-left transition ${
            statusFilter === "IN_PROGRESS"
              ? "border-status-warn bg-status-warn-bg/20 ring-1 ring-status-warn"
              : "border-border bg-surface hover:border-status-warn/40"
          }`}
        >
          <div className="flex items-center justify-between text-status-warn">
            <span className="text-xs font-semibold uppercase tracking-wider">
              {t("counts.kpis.inProgress")}
            </span>
            <Clock className="size-4" aria-hidden />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {stats.inProgress}
          </div>
          <span className="mt-1 text-xs text-muted">
            {t("counts.kpis.inProgressHint", { count: stats.inProgress })}
          </span>
        </button>

        {/* Clôturés avec écart */}
        <button
          type="button"
          onClick={() => {
            setStatusFilter("VALIDATED");
            setOnlyVariance(true);
          }}
          className={`flex flex-col justify-between rounded-xl border p-4 text-left transition ${
            onlyVariance
              ? "border-status-bad bg-status-bad-bg/20 ring-1 ring-status-bad"
              : "border-border bg-surface hover:border-status-bad/40"
          }`}
        >
          <div className="flex items-center justify-between text-status-bad">
            <span className="text-xs font-semibold uppercase tracking-wider">
              {t("counts.kpis.withVariance")}
            </span>
            <AlertTriangle className="size-4" aria-hidden />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {stats.withVariance}
          </div>
          <span className="mt-1 text-xs text-muted">{t("counts.kpis.withVarianceHint")}</span>
        </button>

        {/* Valeur nette des écarts */}
        <button
          type="button"
          onClick={() => {
            setStatusFilter("VALIDATED");
            setOnlyVariance(false);
          }}
          className={`flex flex-col justify-between rounded-xl border p-4 text-left transition ${
            statusFilter === "VALIDATED" && !onlyVariance
              ? "border-accent bg-accent/5 ring-1 ring-accent"
              : "border-border bg-surface hover:border-accent/40"
          }`}
        >
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider">
              {t("counts.kpis.netVariance")}
            </span>
            <CheckCircle2 className="size-4 text-status-ok" aria-hidden />
          </div>
          <div
            className={`mt-2 text-xl font-bold tracking-tight ${
              stats.netVarianceValue !== 0 ? "text-status-warn" : "text-status-ok"
            }`}
          >
            {formatFCFA(stats.netVarianceValue)}
          </div>
          <span className="mt-1 text-xs text-muted">{t("counts.kpis.netVarianceHint")}</span>
        </button>
      </div>

      {/* Barre de recherche instantanée et filtres */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("counts.searchPlaceholder")}
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
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setOnlyVariance(false);
            }}
            className="h-10 text-xs"
          >
            <option value="ALL">{t("counts.allStatuses")}</option>
            <option value="DRAFT">{t("counts.status.DRAFT")}</option>
            <option value="IN_PROGRESS">{t("counts.status.IN_PROGRESS")}</option>
            <option value="SUBMITTED">{t("counts.status.SUBMITTED")}</option>
            <option value="VALIDATED">{t("counts.status.VALIDATED")}</option>
            <option value="CANCELLED">{t("counts.status.CANCELLED")}</option>
          </Select>

          {hasActiveFilters ? (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="h-10 text-xs">
              <RotateCcw className="mr-1.5 size-3.5" aria-hidden />
              {t("counts.resetFilters")}
            </Button>
          ) : null}
        </div>
      </div>

      {list.isLoading ? <ListSkeleton rows={5} /> : null}
      {list.isError ? <ErrorBox onRetry={() => list.refetch()} /> : null}

      {/* Affichage des données ou empty state */}
      {list.data ? (
        filteredItems.length === 0 ? (
          items.length === 0 ? (
            <EmptyState
              title={t("counts.empty")}
              description={t("counts.subtitle")}
              action={
                can("stock:count") ? (
                  <Button onClick={() => setOpen(true)}>
                    <Plus className="mr-1.5 size-4" aria-hidden />
                    {t("counts.new")}
                  </Button>
                ) : null
              }
            />
          ) : (
            <EmptyState
              title={t("counts.emptyFiltered")}
              description={t("counts.emptyFilteredHint")}
              action={
                <Button variant="secondary" onClick={resetFilters}>
                  <RotateCcw className="mr-1.5 size-3.5" aria-hidden />
                  {t("counts.resetFilters")}
                </Button>
              }
            />
          )
        ) : (
          <DataTable
            rows={filteredItems}
            rowKey={(c) => c.id}
            onRowClick={(c) => router.push(`/stock/inventaires/${c.id}`)}
            columns={[
              {
                key: "number",
                header: t("counts.columns.number"),
                primary: true,
                render: (c) => (
                  <span className="rounded bg-surface-2 px-2.5 py-1 font-mono text-xs font-semibold text-foreground">
                    {c.number}
                  </span>
                ),
              },
              {
                key: "site",
                header: t("counts.columns.site"),
                render: (c) => (
                  <span className="inline-flex items-center gap-1.5 text-sm">
                    <Building2 className="size-3.5 text-muted shrink-0" aria-hidden />
                    <span>{c.site.name}</span>
                  </span>
                ),
              },
              {
                key: "scope",
                header: t("counts.columns.scope"),
                render: (c) => (
                  <span className="text-xs text-muted">{getScopeDescription(c.scope)}</span>
                ),
              },
              {
                key: "status",
                header: t("counts.columns.status"),
                render: (c) => (
                  <StatusBadge
                    tone={COUNT_TONE[c.status] ?? "off"}
                    label={t(`counts.status.${c.status}`)}
                  />
                ),
              },
              {
                key: "lines",
                header: t("counts.columns.lines"),
                render: (c) => (
                  <span className="text-xs font-medium">
                    {t("counts.lines", { count: c.lines })}
                  </span>
                ),
              },
              {
                key: "variance",
                header: t("counts.columns.variance"),
                render: (c) => {
                  if (c.status !== "VALIDATED" || c.varianceValue == null) {
                    return <span className="text-muted">—</span>;
                  }
                  if (c.varianceValue === 0) {
                    return (
                      <span className="text-xs font-medium text-status-ok">
                        {t("counts.zeroVariance")}
                      </span>
                    );
                  }
                  return (
                    <span className="font-semibold text-status-warn">
                      {formatFCFA(c.varianceValue)}
                    </span>
                  );
                },
              },
              {
                key: "createdAt",
                header: t("counts.columns.createdAt"),
                render: (c) => <span className="text-xs text-muted">{formatDay(c.createdAt)}</span>,
              },
              {
                key: "validatedAt",
                header: t("counts.columns.validatedAt"),
                render: (c) => (
                  <span className="text-xs text-muted">
                    {c.validatedAt ? formatDay(c.validatedAt) : "—"}
                  </span>
                ),
              },
            ]}
          />
        )
      ) : null}

      {open ? (
        <CreateCountModal
          onClose={() => setOpen(false)}
          onCreated={(id) => router.push(`/stock/inventaires/${id}`)}
        />
      ) : null}
    </div>
  );
}

function CreateCountModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [siteId, setSiteId] = useDefaultSite();
  const [scope, setScope] = useState<"all" | "categories" | "bins">("all");
  const [categories, setCategories] = useState<string[]>([]);
  const [bins, setBins] = useState("");
  const [note, setNote] = useState("");
  const allCategories = trpc.product.categories.useQuery();
  const create = trpc.stockCount.create.useMutation({ onSuccess: (c) => onCreated(c.id) });

  return (
    <Modal
      open
      title={t("counts.createModal.title")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={create.isPending}
            disabled={!siteId || create.isPending}
            onClick={() =>
              create.mutate({
                siteId,
                scope:
                  scope === "categories"
                    ? { categories }
                    : scope === "bins"
                      ? {
                          bins: bins
                            .split(",")
                            .map((b) => b.trim())
                            .filter(Boolean),
                        }
                      : {},
              })
            }
          >
            {t("counts.createModal.submit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-muted">{t("counts.createModal.description")}</p>

        <SiteSelect value={siteId} onChange={setSiteId} />

        <Field label={t("counts.scope")}>
          <Select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
            <option value="all">{t("counts.scopeAll")}</option>
            <option value="categories">{t("counts.scopeCategories")}</option>
            <option value="bins">{t("counts.scopeBins")}</option>
          </Select>
        </Field>

        {scope === "categories" ? (
          <fieldset className="flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-semibold text-muted">
              {t("counts.categories")}
            </legend>
            {(allCategories.data ?? []).map((c) => (
              <CheckboxRow
                key={c}
                label={c}
                checked={categories.includes(c)}
                onChange={(e) =>
                  setCategories((list) =>
                    e.target.checked ? [...list, c] : list.filter((x) => x !== c),
                  )
                }
              />
            ))}
          </fieldset>
        ) : null}

        {scope === "bins" ? (
          <Input
            label={t("counts.bins")}
            value={bins}
            onChange={(e) => setBins(e.target.value)}
            placeholder="A-01, B-02, ETG-3…"
          />
        ) : null}

        <Input
          label={t("counts.createModal.noteLabel")}
          placeholder={t("counts.createModal.notePlaceholder")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <div className="rounded-lg bg-surface-2 p-3 text-xs text-muted">
          💡 {t("counts.draftHint")}
        </div>

        <InlineError message={create.error ? errorMessage(create.error) : null} />
      </div>
    </Modal>
  );
}
