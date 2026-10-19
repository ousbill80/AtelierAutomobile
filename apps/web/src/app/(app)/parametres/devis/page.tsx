"use client";

// M05 §6 / §7 — /parametres/devis : validité, signature, plafonds de remise par rôle, acompte,
// relance véhicule sur place, affichage des prix, conditions imprimées.
import { useState } from "react";
import { Button, Input, MoneyInput, PageHead, Textarea } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/quotes/error-box";
import { t } from "@/components/quotes/i18n";
import type { QuoteSettingsOutput } from "@/components/quotes/types";

const ROLES = ["OWNER", "MANAGER", "ADVISOR", "CASHIER"] as const;

export default function QuoteSettingsPage() {
  const query = trpc.quote.settings.useQuery();
  if (query.isError) return <ErrorBox onRetry={() => query.refetch()} />;
  if (!query.data) return <ListSkeleton />;
  return <SettingsForm initial={query.data} />;
}

function SettingsForm({ initial }: { initial: QuoteSettingsOutput }) {
  const [form, setForm] = useState(initial);
  const [depositEnabled, setDepositEnabled] = useState(initial.depositRule !== null);
  const [saved, setSaved] = useState(false);
  const save = trpc.quote.updateSettings.useMutation({
    onSuccess: (data) => {
      setForm(data);
      setSaved(true);
    },
  });
  const set = (patch: Partial<QuoteSettingsOutput>) => {
    setSaved(false);
    setForm({ ...form, ...patch });
  };
  const num = (value: string) => Number(value.replace(/\D/g, "")) || 0;
  const rule = form.depositRule ?? { thresholdTtc: 300_000, rate: 50 };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          validityDays: form.validityDays,
          validityDaysCompany: form.validityDaysCompany,
          requireSignature: form.requireSignature,
          showLinePricesToCustomer: form.showLinePricesToCustomer,
          discountCaps: {
            OWNER: form.discountCaps.OWNER,
            MANAGER: form.discountCaps.MANAGER,
            ADVISOR: form.discountCaps.ADVISOR,
            CASHIER: form.discountCaps.CASHIER,
          },
          depositRule: depositEnabled ? rule : null,
          followupWhenVehicleOnSite: form.followupWhenVehicleOnSite,
          termsText: form.termsText,
        });
      }}
    >
      <PageHead title={t("settings.title")} description={t("settings.description")} />
      <section className="grid gap-3 sm:grid-cols-2">
        <Input label={t("settings.validityDays")} inputMode="numeric" value={String(form.validityDays)} onChange={(e) => set({ validityDays: Math.max(1, num(e.target.value)) })} />
        <Input label={t("settings.validityDaysCompany")} inputMode="numeric" value={String(form.validityDaysCompany)} onChange={(e) => set({ validityDaysCompany: Math.max(1, num(e.target.value)) })} />
      </section>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" className="h-5 w-5" checked={form.requireSignature} onChange={(e) => set({ requireSignature: e.target.checked })} />
        {t("settings.requireSignature")}
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" className="h-5 w-5" checked={form.showLinePricesToCustomer} onChange={(e) => set({ showLinePricesToCustomer: e.target.checked })} />
        {t("settings.showLinePrices")}
      </label>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{t("settings.caps")}</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {ROLES.map((role) => (
            <div key={role} className="flex items-end gap-2 rounded-md border border-border p-2 text-sm">
              <span className="w-28 font-medium">{role}</span>
              <Input label={t("settings.capLine")} inputMode="numeric" value={String(form.discountCaps[role].line)} onChange={(e) => set({ discountCaps: { ...form.discountCaps, [role]: { ...form.discountCaps[role], line: Math.min(100, num(e.target.value)) } } })} />
              <Input label={t("settings.capGlobal")} inputMode="numeric" value={String(form.discountCaps[role].global)} onChange={(e) => set({ discountCaps: { ...form.discountCaps, [role]: { ...form.discountCaps[role], global: Math.min(100, num(e.target.value)) } } })} />
            </div>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{t("settings.deposit")}</h2>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={depositEnabled}
            onChange={(e) => {
              setSaved(false);
              setDepositEnabled(e.target.checked);
            }}
          />
          {t("settings.depositEnabled")}
        </label>
        {depositEnabled && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span>{t("settings.depositThreshold")}</span>
              <MoneyInput aria-label={t("settings.depositThreshold")} value={rule.thresholdTtc} onChange={(v) => set({ depositRule: { ...rule, thresholdTtc: v ?? 0 } })} />
            </label>
            <Input label={t("settings.depositRate")} inputMode="numeric" value={String(rule.rate)} onChange={(e) => set({ depositRule: { ...rule, rate: Math.min(100, Math.max(1, num(e.target.value))) } })} />
          </div>
        )}
      </section>
      <Input label={t("settings.followup")} hint={t("settings.followupHint")} value={form.followupWhenVehicleOnSite} onChange={(e) => set({ followupWhenVehicleOnSite: e.target.value })} />
      <label className="flex flex-col gap-1 text-sm">
        <span>{t("settings.terms")}</span>
        <Textarea rows={3} value={form.termsText} onChange={(e) => set({ termsText: e.target.value })} />
      </label>
      {save.error && <ErrorBox message={save.error.message} />}
      <div className="flex items-center gap-3">
        <Button type="submit" className="min-h-11" loading={save.isPending}>
          {t("settings.save")}
        </Button>
        {saved && <span className="text-sm text-status-ok">✓ {t("settings.saved")}</span>}
      </div>
    </form>
  );
}
