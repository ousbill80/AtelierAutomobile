"use client";

// M04 §6 / §7 — /parametres/ordres : plafond par défaut, photos minimales, contrôle qualité et
// check-list, garanties, taux horaires (A3 : settings.labor.rates), gardiennage, consommables.
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
  const save = trpc.repairOrder.updateSettings.useMutation({
    onSuccess: (data) => {
      setForm(data);
      setSaved(true);
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
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={form.autoDraftInvoiceOnReady}
          onChange={(e) => set({ autoDraftInvoiceOnReady: e.target.checked })}
        />
        {t("settings.autoDraftInvoice")}
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
        <Input
          label={t("settings.consumablesRate")}
          inputMode="numeric"
          value={String(form.consumablesRate)}
          onChange={(e) => set({ consumablesRate: num(e.target.value) })}
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
          const previous = new Map(form.qcChecklist.map((i) => [i.label, i.key]));
          save.mutate({
            minCheckInPhotos: form.minCheckInPhotos,
            qcRequired: form.qcRequired,
            qcChecklist: labels.map((label, i) => ({
              key: previous.get(label) ?? `point_${i + 1}`,
              label,
            })),
            autoDraftInvoiceOnReady: form.autoDraftInvoiceOnReady,
            defaultAuthorizationCeiling: form.defaultAuthorizationCeiling,
            storageFeeEnabled: form.storageFeeEnabled,
            storageFeeAfterDays: form.storageFeeAfterDays,
            storageFeePerDay: form.storageFeePerDay,
            readyReminderAfterDays: form.readyReminderAfterDays,
            consumablesRate: form.consumablesRate,
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
