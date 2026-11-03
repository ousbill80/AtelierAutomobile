"use client";

// M15 §7 `/parametres/sites` — liste, création, modification (coordonnées, horaires, ponts) et
// désactivation des sites (US-M15-03, RG-M15-05, RG-M15-07). Les refus du serveur (code déjà
// utilisé ou figé par la numérotation, OR ouverts, stock restant, caisse ouverte, offre) sont
// affichés en clair. Sans horaires, aucun créneau de RDV n'est proposé : le serveur applique des
// horaires par défaut à la création.
import Link from "next/link";
import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { normalizePhoneCI } from "@atelieros/core/src/phone";
import {
  Button,
  CheckboxRow,
  DataTable,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHead,
  PhoneInput,
  Select,
  StatusBadge,
} from "@atelieros/ui";
import type { AppRouter } from "@/server/routers/_app";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

type SiteRow = inferRouterOutputs<AppRouter>["site"]["list"][number];

const CODE_PATTERN = /^[A-Z]{2,5}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type Weekday = (typeof WEEKDAYS)[number];
const BAY_TYPES = ["LIFT", "DIAGNOSTIC", "BODYWORK", "PAINT", "WASH", "OTHER"] as const;
type BayType = (typeof BAY_TYPES)[number];

type Range = { from: string; to: string };
type HoursDraft = Record<Weekday, Range[]>;
type BayDraft = { id?: string; name: string; type: BayType; isActive: boolean };

function cleanCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 5);
}

function isPhoneValid(value: string): boolean {
  if (!value.trim()) return true;
  try {
    return Boolean(normalizePhoneCI(value).e164);
  } catch {
    return false;
  }
}

function hoursFromSite(raw: unknown): HoursDraft {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const draft = {} as HoursDraft;
  for (const day of WEEKDAYS) {
    const ranges = Array.isArray(source[day]) ? (source[day] as unknown[]) : [];
    draft[day] = ranges
      .filter((r): r is [string, string] => Array.isArray(r) && r.length === 2)
      .map(([from, to]) => ({ from: String(from), to: String(to) }));
  }
  return draft;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Première erreur lisible des horaires saisis (mêmes règles que `validateOpeningHours`). */
function hoursError(hours: HoursDraft): string | null {
  for (const day of WEEKDAYS) {
    const dayLabel = t(`settings.sites.weekdays.${day}`);
    const sorted = [...hours[day]].sort((a, b) => a.from.localeCompare(b.from));
    for (const range of sorted) {
      if (!TIME_PATTERN.test(range.from) || !TIME_PATTERN.test(range.to)) {
        return t("settings.sites.hoursInvalidTime", { day: dayLabel });
      }
      const span = toMinutes(range.to) - toMinutes(range.from);
      if (span <= 0) return t("settings.sites.hoursEndBeforeStart", { day: dayLabel });
      if (span % 15 !== 0) return t("settings.sites.hoursStep", { day: dayLabel });
    }
    for (let i = 1; i < sorted.length; i++) {
      if (toMinutes(sorted[i]!.from) < toMinutes(sorted[i - 1]!.to)) {
        return t("settings.sites.hoursOverlap", { day: dayLabel });
      }
    }
  }
  return null;
}

function hoursSummary(raw: unknown): string {
  const hours = hoursFromSite(raw);
  const openDays = WEEKDAYS.filter((day) => hours[day].length > 0);
  if (openDays.length === 0) return t("settings.sites.noHours");
  return openDays
    .map(
      (day) =>
        `${t(`settings.sites.weekdaysShort.${day}`)} ${hours[day]
          .map((r) => `${r.from}–${r.to}`)
          .join(", ")}`,
    )
    .join(" · ");
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label={t("common.loading")}>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-2" />
      ))}
    </div>
  );
}

export default function SitesPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<SiteRow | null>(null);
  const [toDeactivate, setToDeactivate] = useState<SiteRow | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const sites = trpc.site.list.useQuery();

  return (
    <>
      <PageHead
        title={t("settings.sites.title")}
        description={t("settings.sites.description")}
        actions={
          <Button
            className="min-h-11"
            onClick={() => {
              setFeedback(null);
              setCreateOpen(true);
            }}
          >
            {t("settings.sites.createAction")}
          </Button>
        }
      />
      {feedback ? (
        <p role="status" className="text-sm text-status-ok">
          ✓ {feedback}
        </p>
      ) : null}

      {sites.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border p-4">
          <p className="text-sm text-status-bad">✕ {t("settings.sites.loadError")}</p>
          <Button variant="secondary" className="min-h-11" onClick={() => void sites.refetch()}>
            {t("settings.sites.retry")}
          </Button>
        </div>
      ) : sites.isPending ? (
        <TableSkeleton />
      ) : (
        <DataTable
          columns={[
            {
              key: "name",
              header: t("settings.sites.nameLabel"),
              primary: true,
              render: (row) => row.name,
            },
            { key: "code", header: t("settings.sites.codeLabel"), render: (row) => row.code },
            {
              key: "address",
              header: t("settings.sites.addressLabel"),
              render: (row) =>
                [row.address, row.commune].filter((part): part is string => !!part).join(", ") ||
                "—",
            },
            {
              key: "phone",
              header: t("settings.sites.phoneLabel"),
              render: (row) => row.phone ?? "—",
            },
            {
              key: "hours",
              header: t("settings.sites.hoursLabel"),
              render: (row) => <span className="text-xs">{hoursSummary(row.openingHours)}</span>,
            },
            {
              key: "status",
              header: t("settings.team.table.status"),
              render: (row) => (
                <StatusBadge
                  tone={row.isActive ? "ok" : "off"}
                  label={
                    row.isActive
                      ? t("settings.team.statusActive")
                      : t("settings.team.statusInactive")
                  }
                />
              ),
            },
            {
              key: "actions",
              header: t("settings.sites.actionsLabel"),
              render: (row) => (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="min-h-11"
                    onClick={() => {
                      setFeedback(null);
                      setEditing(row);
                    }}
                  >
                    {t("common.edit")}
                  </Button>
                  {row.isActive ? (
                    <Button
                      variant="danger"
                      size="sm"
                      className="min-h-11"
                      onClick={() => {
                        setFeedback(null);
                        setToDeactivate(row);
                      }}
                    >
                      {t("common.deactivate")}
                    </Button>
                  ) : null}
                </div>
              ),
            },
          ]}
          rows={sites.data}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              title={t("settings.sites.emptyTitle")}
              description={t("settings.sites.emptyDescription")}
            />
          }
        />
      )}

      {createOpen ? (
        <CreateSiteModal
          onClose={() => setCreateOpen(false)}
          onCreated={(name) => {
            setCreateOpen(false);
            setFeedback(t("settings.sites.created", { name }));
            void utils.site.list.invalidate();
          }}
        />
      ) : null}

      {editing ? (
        <EditSiteModal
          key={editing.id}
          site={editing}
          onClose={() => setEditing(null)}
          onSaved={(name) => {
            setEditing(null);
            setFeedback(t("settings.sites.saved", { name }));
            void utils.site.list.invalidate();
          }}
        />
      ) : null}

      {toDeactivate ? (
        <DeactivateSiteModal
          key={toDeactivate.id}
          site={toDeactivate}
          onClose={() => setToDeactivate(null)}
          onDone={(name) => {
            setToDeactivate(null);
            setFeedback(t("settings.sites.deactivated", { name }));
            void utils.site.list.invalidate();
          }}
        />
      ) : null}
    </>
  );
}

function CreateSiteModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [commune, setCommune] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // M15 RG-M15-20 : limite de l'offre atteinte → lien vers /parametres/abonnement.
  const [planLimit, setPlanLimit] = useState(false);

  const createSite = trpc.site.create.useMutation({
    onSuccess: (site) => onCreated(site.name),
    onError(err) {
      setError(err.message);
      setPlanLimit(err.data?.domainCode === "PLAN_LIMIT_REACHED");
    },
  });

  const nameValid = name.trim().length > 0;
  const codeValid = CODE_PATTERN.test(code);
  const phoneValid = isPhoneValid(phone);
  const whatsappValid = isPhoneValid(whatsapp);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!nameValid || !codeValid || !phoneValid || !whatsappValid) {
      setError(t("settings.sites.fixErrors"));
      return;
    }
    setError(null);
    createSite.mutate({
      name: name.trim(),
      code,
      address: address.trim() || undefined,
      commune: commune.trim() || undefined,
      phone: phone.trim() || undefined,
      whatsappNumber: whatsapp.trim() || undefined,
    });
  }

  return (
    <Modal open title={t("settings.sites.createAction")} onClose={onClose}>
      <form onSubmit={handleCreate} className="stack" noValidate>
        <Field
          label={t("settings.sites.nameLabel")}
          error={submitted && !nameValid ? t("settings.sites.nameRequired") : null}
        >
          <Input
            className="min-h-11"
            value={name}
            invalid={submitted && !nameValid}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field
          label={t("settings.sites.codeLabel")}
          hint={t("settings.sites.codeHint")}
          error={submitted && !codeValid ? t("settings.sites.codeInvalid") : null}
        >
          <Input
            className="min-h-11 font-mono"
            value={code}
            maxLength={5}
            autoCapitalize="characters"
            invalid={submitted && !codeValid}
            onChange={(e) => setCode(cleanCode(e.target.value))}
          />
        </Field>
        <Field label={`${t("settings.sites.addressLabel")} ${t("common.optional")}`}>
          <Input
            className="min-h-11"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </Field>
        <Field label={`${t("settings.sites.cityLabel")} ${t("common.optional")}`}>
          <Input
            className="min-h-11"
            value={commune}
            onChange={(e) => setCommune(e.target.value)}
          />
        </Field>
        <Field
          label={`${t("settings.sites.phoneLabel")} ${t("common.optional")}`}
          error={submitted && !phoneValid ? t("settings.sites.phoneInvalid") : null}
        >
          <PhoneInput className="min-h-11" value={phone} onChange={setPhone} />
        </Field>
        <Field
          label={`${t("settings.sites.whatsappLabel")} ${t("common.optional")}`}
          error={submitted && !whatsappValid ? t("settings.sites.phoneInvalid") : null}
        >
          <PhoneInput className="min-h-11" value={whatsapp} onChange={setWhatsapp} />
        </Field>
        <p className="text-xs text-muted">{t("settings.sites.defaultHoursNote")}</p>
        {error ? (
          <p role="alert" className="error">
            ✕ {error}
          </p>
        ) : null}
        {planLimit ? (
          <Link className="btn btn-secondary min-h-11" href="/parametres/abonnement">
            {t("settings.sites.seePlans")}
          </Link>
        ) : null}
        <Button type="submit" block className="min-h-11" loading={createSite.isPending}>
          {t("settings.sites.createAction")}
        </Button>
      </form>
    </Modal>
  );
}

function EditSiteModal({
  site,
  onClose,
  onSaved,
}: {
  site: SiteRow;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const [name, setName] = useState(site.name);
  const [code, setCode] = useState(site.code);
  const [address, setAddress] = useState(site.address ?? "");
  const [commune, setCommune] = useState(site.commune ?? "");
  const [phone, setPhone] = useState(site.phone ?? "");
  const [whatsapp, setWhatsapp] = useState(site.whatsappNumber ?? "");
  const [hours, setHours] = useState<HoursDraft>(() => hoursFromSite(site.openingHours));
  const [bays, setBays] = useState<BayDraft[]>(() =>
    site.bays.map((bay) => ({
      id: bay.id,
      name: bay.name,
      type: (BAY_TYPES as readonly string[]).includes(bay.type) ? (bay.type as BayType) : "OTHER",
      isActive: bay.isActive,
    })),
  );
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = trpc.site.update.useMutation({
    onSuccess: (updated) => onSaved(updated.name),
    onError: (err) => setError(err.message),
  });

  const nameValid = name.trim().length > 0;
  const codeValid = CODE_PATTERN.test(code);
  const phoneValid = isPhoneValid(phone);
  const whatsappValid = isPhoneValid(whatsapp);
  const hoursProblem = hoursError(hours);
  const baysValid = bays.every((bay) => bay.name.trim().length > 0);

  function setDayOpen(day: Weekday, open: boolean) {
    setHours((prev) => ({
      ...prev,
      [day]: open ? [{ from: "08:00", to: day === "sat" ? "13:00" : "18:00" }] : [],
    }));
  }

  function setRange(day: Weekday, index: number, patch: Partial<Range>) {
    setHours((prev) => ({
      ...prev,
      [day]: prev[day].map((range, i) => (i === index ? { ...range, ...patch } : range)),
    }));
  }

  function addRange(day: Weekday) {
    setHours((prev) => {
      const last = prev[day][prev[day].length - 1];
      const from = last ? last.to : "08:00";
      return { ...prev, [day]: [...prev[day], { from, to: from }] };
    });
  }

  function removeRange(day: Weekday, index: number) {
    setHours((prev) => ({ ...prev, [day]: prev[day].filter((_, i) => i !== index) }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!nameValid || !codeValid || !phoneValid || !whatsappValid || hoursProblem || !baysValid) {
      setError(hoursProblem ?? t("settings.sites.fixErrors"));
      return;
    }
    setError(null);
    const openingHours = Object.fromEntries(
      WEEKDAYS.map((day) => [day, hours[day].map((r) => [r.from, r.to] as [string, string])]),
    );
    update.mutate({
      siteId: site.id,
      name: name.trim(),
      ...(code !== site.code ? { code } : {}),
      address: address.trim() || null,
      commune: commune.trim() || null,
      phone: phone.trim() || null,
      whatsappNumber: whatsapp.trim() || null,
      openingHours,
      bays: bays.map((bay) => ({
        ...(bay.id ? { id: bay.id } : {}),
        name: bay.name.trim(),
        type: bay.type,
        isActive: bay.isActive,
      })),
    });
  }

  return (
    <Modal
      open
      size="lg"
      title={t("settings.sites.editTitle", { name: site.name })}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="stack" noValidate>
        <Field
          label={t("settings.sites.nameLabel")}
          error={submitted && !nameValid ? t("settings.sites.nameRequired") : null}
        >
          <Input
            className="min-h-11"
            value={name}
            invalid={submitted && !nameValid}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field
          label={t("settings.sites.codeLabel")}
          hint={t("settings.sites.codeEditHint")}
          error={submitted && !codeValid ? t("settings.sites.codeInvalid") : null}
        >
          <Input
            className="min-h-11 font-mono"
            value={code}
            maxLength={5}
            autoCapitalize="characters"
            invalid={submitted && !codeValid}
            onChange={(e) => setCode(cleanCode(e.target.value))}
          />
        </Field>
        <Field label={`${t("settings.sites.addressLabel")} ${t("common.optional")}`}>
          <Input
            className="min-h-11"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </Field>
        <Field label={`${t("settings.sites.cityLabel")} ${t("common.optional")}`}>
          <Input
            className="min-h-11"
            value={commune}
            onChange={(e) => setCommune(e.target.value)}
          />
        </Field>
        <Field
          label={`${t("settings.sites.phoneLabel")} ${t("common.optional")}`}
          error={submitted && !phoneValid ? t("settings.sites.phoneInvalid") : null}
        >
          <PhoneInput className="min-h-11" value={phone} onChange={setPhone} />
        </Field>
        <Field
          label={`${t("settings.sites.whatsappLabel")} ${t("common.optional")}`}
          error={submitted && !whatsappValid ? t("settings.sites.phoneInvalid") : null}
        >
          <PhoneInput className="min-h-11" value={whatsapp} onChange={setWhatsapp} />
        </Field>

        <fieldset className="flex flex-col gap-2 rounded-md border p-3">
          <legend className="px-1 text-sm font-semibold">{t("settings.sites.hoursLabel")}</legend>
          <p className="text-xs text-muted">{t("settings.sites.hoursHint")}</p>
          {WEEKDAYS.map((day) => {
            const dayLabel = t(`settings.sites.weekdays.${day}`);
            const open = hours[day].length > 0;
            return (
              <div key={day} className="flex flex-col gap-2 border-t pt-2 first:border-t-0">
                <div className="min-h-11">
                  <CheckboxRow
                    label={`${dayLabel} — ${open ? t("settings.sites.open") : t("settings.sites.closed")}`}
                    checked={open}
                    onChange={(e) => setDayOpen(day, e.target.checked)}
                  />
                </div>
                {hours[day].map((range, index) => (
                  <div key={index} className="flex flex-wrap items-end gap-2">
                    <Field label={t("settings.sites.from")}>
                      <Input
                        className="min-h-11"
                        type="time"
                        step={900}
                        value={range.from}
                        aria-label={`${dayLabel} ${t("settings.sites.from")}`}
                        onChange={(e) => setRange(day, index, { from: e.target.value })}
                      />
                    </Field>
                    <Field label={t("settings.sites.to")}>
                      <Input
                        className="min-h-11"
                        type="time"
                        step={900}
                        value={range.to}
                        aria-label={`${dayLabel} ${t("settings.sites.to")}`}
                        onChange={(e) => setRange(day, index, { to: e.target.value })}
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="min-h-11"
                      onClick={() => removeRange(day, index)}
                    >
                      {t("settings.sites.removeRange")}
                    </Button>
                  </div>
                ))}
                {open ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="min-h-11 self-start"
                    onClick={() => addRange(day)}
                  >
                    {t("settings.sites.addRange")}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </fieldset>

        <fieldset className="flex flex-col gap-2 rounded-md border p-3">
          <legend className="px-1 text-sm font-semibold">{t("settings.sites.baysLabel")}</legend>
          {bays.length === 0 ? (
            <p className="text-xs text-muted">{t("settings.sites.noBays")}</p>
          ) : null}
          {bays.map((bay, index) => (
            <div key={bay.id ?? `new-${index}`} className="flex flex-wrap items-end gap-2">
              <Field
                label={t("settings.sites.bayName")}
                error={submitted && !bay.name.trim() ? t("settings.sites.bayNameRequired") : null}
              >
                <Input
                  className="min-h-11"
                  value={bay.name}
                  invalid={submitted && !bay.name.trim()}
                  onChange={(e) =>
                    setBays((prev) =>
                      prev.map((b, i) => (i === index ? { ...b, name: e.target.value } : b)),
                    )
                  }
                />
              </Field>
              <Field label={t("settings.sites.bayType")}>
                <Select
                  className="min-h-11"
                  value={bay.type}
                  onChange={(e) =>
                    setBays((prev) =>
                      prev.map((b, i) =>
                        i === index ? { ...b, type: e.target.value as BayType } : b,
                      ),
                    )
                  }
                >
                  {BAY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`settings.sites.bayTypes.${type}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              {bay.id ? (
                <div className="min-h-11">
                  <CheckboxRow
                    label={t("settings.sites.bayActive")}
                    checked={bay.isActive}
                    onChange={(e) =>
                      setBays((prev) =>
                        prev.map((b, i) =>
                          i === index ? { ...b, isActive: e.target.checked } : b,
                        ),
                      )
                    }
                  />
                </div>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="min-h-11"
                  onClick={() => setBays((prev) => prev.filter((_, i) => i !== index))}
                >
                  {t("settings.sites.removeBay")}
                </Button>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-11 self-start"
            onClick={() => setBays((prev) => [...prev, { name: "", type: "LIFT", isActive: true }])}
          >
            {t("settings.sites.addBay")}
          </Button>
        </fieldset>

        {error ? (
          <p role="alert" className="error">
            ✕ {error}
          </p>
        ) : null}
        <Button type="submit" block className="min-h-11" loading={update.isPending}>
          {t("common.save")}
        </Button>
      </form>
    </Modal>
  );
}

function DeactivateSiteModal({
  site,
  onClose,
  onDone,
}: {
  site: SiteRow;
  onClose: () => void;
  onDone: (name: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const deactivate = trpc.site.deactivate.useMutation({
    onSuccess: (updated) => onDone(updated.name),
    onError: (err) => setError(err.message),
  });

  return (
    <Modal
      open
      title={t("settings.sites.deactivateTitle", { name: site.name })}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" className="min-h-11" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            className="min-h-11"
            loading={deactivate.isPending}
            onClick={() => {
              setError(null);
              deactivate.mutate({ siteId: site.id });
            }}
          >
            {t("common.deactivate")}
          </Button>
        </div>
      }
    >
      <div className="stack">
        <p className="text-sm">{t("settings.sites.deactivateBody")}</p>
        {error ? (
          <p role="alert" className="error">
            ✕ {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
