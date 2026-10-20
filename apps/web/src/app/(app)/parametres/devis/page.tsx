"use client";

// M05 §6 / §7 — /parametres/devis : validité, signature obligatoire, plafonds de remise par
// rôle (RG-M05-07), acompte (RG-M05-14), premier rappel si véhicule sur place, conditions
// imprimées, affichage des prix par ligne. Paliers de relance : renvoi vers M10.
import { useState } from "react";
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import { Button, CheckboxRow, Input, MoneyInput, PageHead, Textarea } from "@atelieros/ui";
import type { AppRouter } from "@/server/routers/_app";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { t } from "@/components/quotes/i18n";
import { trpc } from "@/trpc/react";

type Settings = inferRouterOutputs<AppRouter>["quote"]["settings"];
const ROLES = ["ADVISOR", "MANAGER", "CASHIER", "OWNER"] as const;

export default function QuoteSettingsPage() {
  const query = trpc.quote.settings.useQuery();
  if (query.isError) return <ErrorBox onRetry={() => query.refetch()} />;
  if (!query.data) return <ListSkeleton />;
  return <SettingsForm initial={query.data} />;
}

function SettingsForm({ initial }: { initial: Settings }) {
  const [form, setForm] = useState<Settings>(initial);
  const [saved, setSaved] = useState(false);
  const save = trpc.quote.updateSettings.useMutation({
    onSuccess: (data) => {
      setForm(data);
      setSaved(true);
    },
  });
  const set = (patch: Partial<Settings>) => {
    setSaved(false);
    setForm({ ...form, ...patch });
  };
  const num = (value: string) => Math.min(100_000_000, Number(value.replace(/\D/g, "")) || 0);
  return (
    <div className="flex flex-col gap-4">
      <PageHead title={t("settings.title")} description={t("settings.description")} />
      <section className="grid gap-3 sm:grid-cols-2">
        <Input
          label={t("settings.validityDays")}
          inputMode="numeric"
          value={String(form.validityDays)}
          onChange={(e) => set({ validityDays: num(e.target.value) })}
        />
        <Input
          label={t("settings.validityDaysCompany")}
          inputMode="numeric"
          value={String(form.validityDaysCompany)}
          onChange={(e) => set({ validityDaysCompany: num(e.target.value) })}
        />
      </section>
      <CheckboxRow
        label={t("settings.requireSignature")}
        checked={form.requireSignature}
        onChange={(e) => set({ requireSignature: e.target.checked })}
      />
      <CheckboxRow
        label={t("settings.showLinePrices")}
        checked={form.showLinePricesToCustomer}
        onChange={(e) => set({ showLinePricesToCustomer: e.target.checked })}
      />
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{t("settings.caps")}</h2>
        {ROLES.map((role) => (
          <div key={role} className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:items-end">
            <span className="text-sm font-semibold">{t(`roles.${role}`)}</span>
            <Input
              label={t("settings.capLine")}
              inputMode="numeric"
              value={String(form.discountCaps[role].line)}
              onChange={(e) =>
                set({
                  discountCaps: {
                    ...form.discountCaps,
                    [role]: {
                      ...form.discountCaps[role],
                      line: Math.min(100, num(e.target.value)),
                    },
                  },
                })
              }
            />
            <Input
              label={t("settings.capGlobal")}
              inputMode="numeric"
              value={String(form.discountCaps[role].global)}
              onChange={(e) =>
                set({
                  discountCaps: {
                    ...form.discountCaps,
                    [role]: {
                      ...form.discountCaps[role],
                      global: Math.min(100, num(e.target.value)),
                    },
                  },
                })
              }
            />
          </div>
        ))}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{t("settings.deposit")}</h2>
        <CheckboxRow
          label={t("settings.depositEnabled")}
          checked={form.depositRule != null}
          onChange={(e) =>
            set({ depositRule: e.target.checked ? { thresholdTtc: 300_000, rate: 50 } : null })
          }
        />
        {form.depositRule && (
          <div className="grid gap-2 sm:grid-cols-2">
            <MoneyInput
              label={t("settings.depositThreshold")}
              value={form.depositRule.thresholdTtc}
              onChange={(v) => set({ depositRule: { ...form.depositRule!, thresholdTtc: v ?? 0 } })}
            />
            <Input
              label={t("settings.depositRate")}
              inputMode="numeric"
              value={String(form.depositRule.rate)}
              onChange={(e) =>
                set({
                  depositRule: { ...form.depositRule!, rate: Math.min(100, num(e.target.value)) },
                })
              }
            />
          </div>
        )}
      </section>
      <Input
        label={t("settings.followupOnSite")}
        value={form.followupWhenVehicleOnSite}
        onChange={(e) => set({ followupWhenVehicleOnSite: e.target.value })}
        hint={t("settings.followupHint")}
      />
      <Link href="/parametres/relances" className="text-sm text-accent">
        {t("settings.reminderRules")} →
      </Link>
      <label className="flex flex-col gap-1 text-sm">
        <span>{t("settings.terms")}</span>
        <Textarea
          rows={3}
          value={form.termsText}
          onChange={(e) => set({ termsText: e.target.value })}
        />
      </label>
      {save.error && (
        <p role="alert" className="text-sm text-status-bad">
          ⚠ {save.error.message}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-status-ok">
          ✓ {t("settings.saved")}
        </p>
      )}
      <Button
        loading={save.isPending}
        onClick={() =>
          save.mutate({
            validityDays: form.validityDays,
            validityDaysCompany: form.validityDaysCompany,
            requireSignature: form.requireSignature,
            showLinePricesToCustomer: form.showLinePricesToCustomer,
            discountCaps: form.discountCaps,
            depositRule: form.depositRule,
            followupWhenVehicleOnSite: form.followupWhenVehicleOnSite,
            termsText: form.termsText,
          })
        }
      >
        {t("settings.save")}
      </Button>
    </div>
  );
}
