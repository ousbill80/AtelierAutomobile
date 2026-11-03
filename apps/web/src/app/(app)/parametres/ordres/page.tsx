"use client";

// M04 §6 / §7 — /parametres/ordres : plafond par défaut, photos minimales, contrôle qualité et
// check-list, garanties, taux horaires (A3 : settings.labor.rates), gardiennage.
// autoDraftInvoiceOnReady et consumablesRate restent lus/validés (données existantes) mais ne
// sont pas exposés : aucun traitement ne les applique encore.
import { useState } from "react";
import { Button, Input, MoneyInput, PageHead, Textarea } from "@atelieros/ui";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { t } from "@/components/repair-orders/i18n";
import type { RouterOutputs } from "@/components/repair-orders/types";
import { trpc } from "@/trpc/react";

type Settings = RouterOutputs["repairOrder"]["settings"];
const RATES = ["STANDARD", "DIAGNOSTIC", "BODYWORK", "ELECTRICAL"] as const;
const WARRANTY = [
  "laborMonths",
  "laborKm",
  "partMonths",
  "partKm",
  "customerSuppliedLaborMonths",
] as const;

export default function RepairOrderSettingsPage() {
  const query = trpc.repairOrder.settings.useQuery();
  if (query.isError) return <ErrorBox onRetry={() => query.refetch()} />;
  if (!query.data) return <ListSkeleton />;
  return <SettingsForm initial={query.data} />;
}

function SettingsForm({ initial }: { initial: Settings }) {
  const [form, setForm] = useState<Settings>(initial);
  const [checklist, setChecklist] = useState(initial.qcChecklist.map((i) => i.label).join("\n"));
  const [saved, setSaved] = useState(false);
  const utils = trpc.useUtils();
  const save = trpc.repairOrder.updateSettings.useMutation({
    onSuccess: (data) => {
      setForm(data);
      setSaved(true);
      // La réception (check-list, photos minimales, plafond) relit ces paramètres.
      void utils.repairOrder.settings.invalidate();
    },
  });

  const set = (patch: Partial<Settings>) => {
    setSaved(false);
    setForm({ ...form, ...patch });
  };
  const num = (value: string) => Number(value.replace(/\D/g, "")) || 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHead title={t("settings.title")} description={t("settings.description")} />
      <section className="grid gap-3 sm:grid-cols-2">
        <Input
          label={t("settings.minPhotos")}
          inputMode="numeric"
          value={String(form.minCheckInPhotos)}
          onChange={(e) => set({ minCheckInPhotos: num(e.target.value) })}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("settings.defaultCeiling")}</span>
          <MoneyInput
            aria-label={t("settings.defaultCeiling")}
            value={form.defaultAuthorizationCeiling}
            onChange={(v) => set({ defaultAuthorizationCeiling: v ?? 0 })}
          />
        </label>
      </section>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={form.qcRequired}
          onChange={(e) => set({ qcRequired: e.target.checked })}
        />
        {t("settings.qcRequired")}
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>{t("settings.qcChecklist")}</span>
        <Textarea
          rows={7}
          value={checklist}
          onChange={(e) => {
            setSaved(false);
            setChecklist(e.target.value);
          }}
        />
      </label>

      <h2 className="font-semibold">{t("settings.laborRates")}</h2>
      <section className="grid gap-3 sm:grid-cols-2">
        {RATES.map((rate) => (
          <label key={rate} className="flex flex-col gap-1 text-sm">
            <span>{t(`settings.rates.${rate}`)}</span>
            <MoneyInput
              aria-label={t(`settings.rates.${rate}`)}
              value={form.laborRates[rate]}
              onChange={(v) => set({ laborRates: { ...form.laborRates, [rate]: v ?? 0 } })}
            />
          </label>
        ))}
      </section>

      <h2 className="font-semibold">{t("settings.warranty")}</h2>
      <section className="grid gap-3 sm:grid-cols-2">
        {WARRANTY.map((key) => (
          <Input
            key={key}
            label={t(`settings.${key}`)}
            inputMode="numeric"
            value={String(form.warranty[key])}
            onChange={(e) => set({ warranty: { ...form.warranty, [key]: num(e.target.value) } })}
          />
        ))}
      </section>

      <h2 className="font-semibold">{t("settings.storageFee")}</h2>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={form.storageFeeEnabled}
          onChange={(e) => set({ storageFeeEnabled: e.target.checked })}
        />
        {t("settings.storageFeeEnabled")}
      </label>
      <section className="grid gap-3 sm:grid-cols-2">
        <Input
          label={t("settings.storageFeeAfterDays")}
          inputMode="numeric"
          value={String(form.storageFeeAfterDays)}
          onChange={(e) => set({ storageFeeAfterDays: num(e.target.value) })}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("settings.storageFeePerDay")}</span>
          <MoneyInput
            aria-label={t("settings.storageFeePerDay")}
            value={form.storageFeePerDay}
            onChange={(v) => set({ storageFeePerDay: v ?? 0 })}
          />
        </label>
        <Input
          label={t("settings.readyReminderAfterDays")}
          inputMode="numeric"
          value={String(form.readyReminderAfterDays)}
          onChange={(e) => set({ readyReminderAfterDays: num(e.target.value) || 1 })}
        />
      </section>

      {save.error && <ErrorBox message={save.error.message} />}
      {saved && (
        <p role="status" className="text-sm text-status-ok">
          ✓ {t("saved")}
        </p>
      )}
      <Button
        className="self-start"
        loading={save.isPending}
        onClick={() => {
          const labels = checklist
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          save.mutate({
            minCheckInPhotos: form.minCheckInPhotos,
            qcRequired: form.qcRequired,
            qcChecklist: checklistItems(labels, form.qcChecklist),
            defaultAuthorizationCeiling: form.defaultAuthorizationCeiling,
            storageFeeEnabled: form.storageFeeEnabled,
            storageFeeAfterDays: form.storageFeeAfterDays,
            storageFeePerDay: form.storageFeePerDay,
            readyReminderAfterDays: form.readyReminderAfterDays,
            laborRates: form.laborRates,
            warranty: form.warranty,
          });
        }}
      >
        {t("save")}
      </Button>
    </div>
  );
}

/**
 * Clés stables et uniques des points de contrôle : un libellé inchangé garde sa clé ; un
 * nouveau libellé reçoit `point_N` avec N jamais déjà utilisé (ni par l'ancienne liste ni par
 * la nouvelle), ce qui évite les collisions après suppression/réordonnancement.
 */
function checklistItems(labels: string[], previous: Settings["qcChecklist"]) {
  const byLabel = new Map<string, string>();
  for (const item of previous) if (!byLabel.has(item.label)) byLabel.set(item.label, item.key);
  const used = new Set<string>(previous.map((i) => i.key));
  const taken = new Set<string>();
  let n = 1;
  return labels.map((label) => {
    const existing = byLabel.get(label);
    if (existing && !taken.has(existing)) {
      taken.add(existing);
      return { key: existing, label };
    }
    while (used.has(`point_${n}`) || taken.has(`point_${n}`)) n++;
    const key = `point_${n}`;
    taken.add(key);
    return { key, label };
  });
}
