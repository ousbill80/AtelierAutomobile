"use client";

// M15 §7 `/parametres/jours-feries` — jours fériés ivoiriens et fermetures exceptionnelles
// (US-M15-04, RG-M15-08) : sélection de l'année, pré-remplissage (`holiday.seedYear`),
// ajout d'une fermeture (tous les sites ou un site), modification et suppression.
import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { formatDate } from "@atelieros/core/calendar";
import {
  Button,
  CheckboxRow,
  DataTable,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHead,
  Select,
  StatusBadge,
  TypeBadge,
} from "@atelieros/ui";
import type { AppRouter } from "@/server/routers/_app";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

type Holiday = inferRouterOutputs<AppRouter>["holiday"]["list"][number];
const KINDS = ["PUBLIC", "CLOSURE"] as const;
type Kind = (typeof KINDS)[number];

/** Les dates `@db.Date` sont à minuit UTC : affichage et saisie en UTC pour éviter tout décalage. */
function toDateInput(date: Date | string): string {
  return new Date(date).toISOString().slice(0, 10);
}
function fromDateInput(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-2" />
      ))}
    </div>
  );
}

type Editing = { mode: "create" } | { mode: "edit"; holiday: Holiday };

export default function HolidaySettingsPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [toDelete, setToDelete] = useState<Holiday | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const holidays = trpc.holiday.list.useQuery({ year });
  const sites = trpc.site.list.useQuery();

  const seed = trpc.holiday.seedYear.useMutation({
    onSuccess(created) {
      setActionError(null);
      setNotice(
        created.length > 0
          ? t("holidaySettings.seeded", { count: created.length, year })
          : t("holidaySettings.seededNone", { year }),
      );
      void utils.holiday.list.invalidate();
    },
    onError(err) {
      setNotice(null);
      setActionError(err.message);
    },
  });

  const remove = trpc.holiday.delete.useMutation({
    onSuccess() {
      setToDelete(null);
      setActionError(null);
      setNotice(t("holidaySettings.deleted"));
      void utils.holiday.list.invalidate();
    },
    onError(err) {
      setActionError(err.message);
    },
  });

  const siteName = (siteId: string | null) =>
    siteId
      ? (sites.data?.find((s) => s.id === siteId)?.name ?? t("holidaySettings.unknownSite"))
      : t("holidaySettings.allSites");

  const years = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHead title={t("holidaySettings.title")} description={t("holidaySettings.description")} />

      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="sm:w-40">
          <Field label={t("holidaySettings.year")}>
            <Select
              className="min-h-11"
              value={String(year)}
              onChange={(e) => {
                setYear(Number(e.target.value));
                setNotice(null);
                setActionError(null);
              }}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button
          variant="secondary"
          className="min-h-11"
          loading={seed.isPending}
          onClick={() => seed.mutate({ year })}
        >
          {t("holidaySettings.seedAction")}
        </Button>
        <Button className="min-h-11" onClick={() => setEditing({ mode: "create" })}>
          {t("holidaySettings.addClosure")}
        </Button>
      </div>

      {notice ? (
        <p role="status" className="text-sm text-status-ok">
          ✓ {notice}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="text-sm text-status-bad">
          ✕ {actionError}
        </p>
      ) : null}

      {holidays.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border p-4">
          <p className="text-sm text-status-bad">{t("holidaySettings.loadError")}</p>
          <Button variant="secondary" className="min-h-11" onClick={() => holidays.refetch()}>
            {t("holidaySettings.retry")}
          </Button>
        </div>
      ) : !holidays.data ? (
        <Skeleton />
      ) : (
        <DataTable
          columns={[
            {
              key: "date",
              header: t("holidaySettings.colDate"),
              render: (row) => formatDate(new Date(row.date), "UTC"),
            },
            {
              key: "name",
              header: t("holidaySettings.colName"),
              primary: true,
              render: (row) => (
                <span className="flex flex-wrap items-center gap-2">
                  <span>{row.name}</span>
                  {row.isEstimated ? (
                    <StatusBadge tone="warn" label={`⚠ ${t("holidaySettings.estimated")}`} />
                  ) : null}
                </span>
              ),
            },
            {
              key: "kind",
              header: t("holidaySettings.colKind"),
              render: (row) => (
                <TypeBadge
                  label={t(
                    `holidaySettings.kinds.${(KINDS as readonly string[]).includes(row.kind) ? row.kind : "PUBLIC"}`,
                  )}
                />
              ),
            },
            {
              key: "site",
              header: t("holidaySettings.colSite"),
              render: (row) => siteName(row.siteId),
            },
            {
              key: "actions",
              header: t("holidaySettings.colActions"),
              render: (row) => (
                <span className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="min-h-11"
                    onClick={() => setEditing({ mode: "edit", holiday: row })}
                  >
                    {t("holidaySettings.edit")}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    className="min-h-11"
                    onClick={() => setToDelete(row)}
                  >
                    {t("holidaySettings.delete")}
                  </Button>
                </span>
              ),
            },
          ]}
          rows={holidays.data}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              icon="📅"
              title={t("holidaySettings.emptyTitle", { year })}
              description={t("holidaySettings.emptyDescription")}
              action={
                <Button
                  className="min-h-11"
                  loading={seed.isPending}
                  onClick={() => seed.mutate({ year })}
                >
                  {t("holidaySettings.seedAction")}
                </Button>
              }
            />
          }
        />
      )}

      {editing ? (
        <HolidayModal
          key={editing.mode === "edit" ? editing.holiday.id : "create"}
          editing={editing}
          year={year}
          sites={(sites.data ?? []).map((s) => ({ id: s.id, name: s.name }))}
          siteName={siteName}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setActionError(null);
            setNotice(message);
            void utils.holiday.list.invalidate();
          }}
        />
      ) : null}

      <Modal
        open={toDelete !== null}
        title={t("holidaySettings.deleteTitle")}
        onClose={() => setToDelete(null)}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" className="min-h-11" onClick={() => setToDelete(null)}>
              {t("holidaySettings.cancel")}
            </Button>
            <Button
              variant="danger"
              className="min-h-11"
              loading={remove.isPending}
              onClick={() => toDelete && remove.mutate({ holidayId: toDelete.id })}
            >
              {t("holidaySettings.delete")}
            </Button>
          </div>
        }
      >
        {toDelete ? (
          <p className="text-sm">
            {t("holidaySettings.deleteConfirm", {
              name: toDelete.name,
              date: formatDate(new Date(toDelete.date), "UTC"),
            })}
          </p>
        ) : null}
      </Modal>
    </div>
  );
}

function HolidayModal({
  editing,
  year,
  sites,
  siteName,
  onClose,
  onSaved,
}: {
  editing: Editing;
  year: number;
  sites: Array<{ id: string; name: string }>;
  siteName: (siteId: string | null) => string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const initial = editing.mode === "edit" ? editing.holiday : null;
  const [date, setDate] = useState(initial ? toDateInput(initial.date) : `${year}-01-01`);
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<Kind>(
    initial && (KINDS as readonly string[]).includes(initial.kind)
      ? (initial.kind as Kind)
      : "CLOSURE",
  );
  const [siteId, setSiteId] = useState<string>("");
  const [isEstimated, setIsEstimated] = useState(initial?.isEstimated ?? false);
  const [error, setError] = useState<string | null>(null);

  const create = trpc.holiday.create.useMutation({
    onSuccess: () => onSaved(t("holidaySettings.created")),
    onError: (err) => setError(err.message),
  });
  const update = trpc.holiday.update.useMutation({
    onSuccess: () => onSaved(t("holidaySettings.updated")),
    onError: (err) => setError(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!date || !name.trim()) {
      setError(t("holidaySettings.requiredFields"));
      return;
    }
    setError(null);
    if (initial) {
      update.mutate({
        holidayId: initial.id,
        date: fromDateInput(date),
        name: name.trim(),
        kind,
        isEstimated,
      });
    } else {
      create.mutate({
        date: fromDateInput(date),
        name: name.trim(),
        kind,
        siteId: siteId || null,
        isEstimated: false,
      });
    }
  }

  return (
    <Modal
      open
      title={initial ? t("holidaySettings.editTitle") : t("holidaySettings.addClosure")}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
        <Field label={t("holidaySettings.date")}>
          <Input
            className="min-h-11"
            type="date"
            value={date}
            required
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label={t("holidaySettings.name")}>
          <Input
            className="min-h-11"
            value={name}
            required
            maxLength={200}
            placeholder={t("holidaySettings.namePlaceholder")}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label={t("holidaySettings.kind")}>
          <Select
            className="min-h-11"
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`holidaySettings.kinds.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        {initial ? (
          <>
            <p className="text-sm text-muted">
              {t("holidaySettings.siteValue", { name: siteName(initial.siteId) })}
            </p>
            <div className="min-h-11">
              <CheckboxRow
                label={t("holidaySettings.estimatedCheckbox")}
                checked={isEstimated}
                onChange={(e) => setIsEstimated(e.target.checked)}
              />
            </div>
          </>
        ) : (
          <Field label={t("holidaySettings.siteOptional")} hint={t("holidaySettings.siteHint")}>
            <Select className="min-h-11" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="">{t("holidaySettings.allSites")}</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {error ? (
          <p role="alert" className="text-sm text-status-bad">
            ✕ {error}
          </p>
        ) : null}
        <Button
          type="submit"
          block
          className="min-h-11"
          loading={create.isPending || update.isPending}
        >
          {t("holidaySettings.save")}
        </Button>
      </form>
    </Modal>
  );
}
