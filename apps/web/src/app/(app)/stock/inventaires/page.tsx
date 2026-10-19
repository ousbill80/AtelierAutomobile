"use client";

// M07 §7 — /stock/inventaires : liste des inventaires et création (complet, par catégorie,
// par emplacement). Le stock théorique est figé au démarrage du comptage (RG-M07-10).
import { useState } from "react";
import { useRouter } from "next/navigation";
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
  useDefaultSite,
} from "../_lib/components";
import { COUNT_TONE, errorMessage, formatDay, t } from "../_lib/i18n";

export default function CountsPage() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const list = trpc.stockCount.list.useQuery({});
  return (
    <div className="flex flex-col gap-4">
      <ModuleNav section="stock" />
      <PageTitle
        title={t("counts.title")}
        actions={<Button onClick={() => setOpen(true)}>{t("counts.new")}</Button>}
      />
      {list.isLoading ? <ListSkeleton /> : null}
      {list.isError ? <ErrorBox onRetry={() => list.refetch()} /> : null}
      {list.data ? (
        <DataTable
          rows={list.data}
          rowKey={(c) => c.id}
          onRowClick={(c) => router.push(`/stock/inventaires/${c.id}`)}
          empty={<EmptyState title={t("counts.empty")} />}
          columns={[
            {
              key: "number",
              header: t("purchases.columns.number"),
              primary: true,
              render: (c) => <span className="font-medium">{c.number}</span>,
            },
            { key: "site", header: t("common.site"), render: (c) => c.site.name },
            {
              key: "status",
              header: t("common.status"),
              render: (c) => (
                <StatusBadge
                  tone={COUNT_TONE[c.status] ?? "off"}
                  label={t(`counts.status.${c.status}`)}
                />
              ),
            },
            {
              key: "lines",
              header: t("purchases.lines"),
              render: (c) => t("counts.lines", { count: c.lines }),
            },
            {
              key: "variance",
              header: t("counts.varianceValue"),
              render: (c) =>
                c.varianceValue != null && c.status === "VALIDATED"
                  ? formatFCFA(c.varianceValue)
                  : "—",
            },
            {
              key: "date",
              header: t("common.date"),
              render: (c) => formatDay(c.validatedAt ?? c.startedAt ?? c.createdAt),
            },
          ]}
        />
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
  const allCategories = trpc.product.categories.useQuery();
  const create = trpc.stockCount.create.useMutation({ onSuccess: (c) => onCreated(c.id) });
  return (
    <Modal
      open
      title={t("counts.new")}
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
            {t("counts.create")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <SiteSelect value={siteId} onChange={setSiteId} />
        <Field label={t("counts.scope")}>
          <Select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
            <option value="all">{t("counts.scopeAll")}</option>
            <option value="categories">{t("counts.scopeCategories")}</option>
            <option value="bins">{t("counts.scopeBins")}</option>
          </Select>
        </Field>
        {scope === "categories" ? (
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">{t("counts.categories")}</legend>
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
          <Input label={t("counts.bins")} value={bins} onChange={(e) => setBins(e.target.value)} />
        ) : null}
        <p className="text-sm text-muted">{t("counts.draftHint")}</p>
        <InlineError message={create.error ? errorMessage(create.error) : null} />
      </div>
    </Modal>
  );
}
