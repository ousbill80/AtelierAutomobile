"use client";

// M15 §7 (RG-M15-18) — /parametres/fne : mode (manuel, API, désactivé avec motif), service de
// certification (API DGI ou simulateur hors production), identifiants DGI saisis mais jamais
// réaffichés (chiffrés côté serveur), test de la connexion et dernières certifications.
import { useState } from "react";
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import { Button, Input, PageHead, Select, Textarea } from "@atelieros/ui";
import type { AppRouter } from "@/server/routers/_app";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { FneBadge } from "@/components/billing/badges";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/react";

type Config = inferRouterOutputs<AppRouter>["fne"]["getConfig"];
const MODES = ["manual", "api", "disabled"] as const;

export default function FneSettingsPage() {
  const query = trpc.fne.getConfig.useQuery();
  if (query.isError) {
    return <ErrorBox onRetry={() => query.refetch()} message={t("fneSettings.loadError")} />;
  }
  if (!query.data) return <ListSkeleton />;
  return <FneForm initial={query.data} onSaved={() => query.refetch()} />;
}

function FneForm({ initial, onSaved }: { initial: Config; onSaved: () => void }) {
  const [mode, setMode] = useState<Config["mode"]>(initial.mode);
  const [provider, setProvider] = useState<"dgi_api" | "fake">(
    initial.provider === "fake" ? "fake" : "dgi_api",
  );
  const [establishmentId, setEstablishmentId] = useState(initial.establishmentId ?? "");
  const [pointOfSale, setPointOfSale] = useState(initial.pointOfSale ?? "");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState(false);
  const save = trpc.fne.updateConfig.useMutation({
    onSuccess: () => {
      setSaved(true);
      setApiKey("");
      onSaved();
    },
  });
  const test = trpc.fne.test.useMutation({ onSuccess: onSaved });
  const providers = initial.simulatorAllowed
    ? (["dgi_api", "fake"] as const)
    : (["dgi_api"] as const);
  const certified = (initial.counts.CERTIFIED ?? 0) + (initial.counts.MANUAL ?? 0);
  const pending = (initial.counts.PENDING ?? 0) + (initial.counts.FAILED ?? 0);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHead title={t("fneSettings.title")} description={t("fneSettings.intro")} />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">{t("fneSettings.mode")}</legend>
        {MODES.map((m) => (
          <label key={m} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name="fne-mode"
              checked={mode === m}
              onChange={() => {
                setSaved(false);
                setMode(m);
              }}
            />
            {t(`fneSettings.modes.${m}`)}
          </label>
        ))}
      </fieldset>

      {mode === "api" && (
        <section className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            {t("fneSettings.provider")}
            <Select
              className="min-h-11"
              value={provider}
              onChange={(e) => setProvider(e.target.value as "dgi_api" | "fake")}
            >
              {providers.map((p) => (
                <option key={p} value={p}>
                  {t(`fneSettings.providers.${p}`)}
                </option>
              ))}
            </Select>
          </label>
          {provider === "dgi_api" && (
            <>
              <Input
                label={t("fneSettings.baseUrl")}
                value={baseUrl}
                placeholder="https://"
                onChange={(e) => setBaseUrl(e.target.value)}
                className="min-h-11"
                autoComplete="off"
              />
              <Input
                label={t("fneSettings.apiKey")}
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="min-h-11"
                autoComplete="new-password"
              />
              <p className="text-sm text-muted sm:col-span-2">
                {initial.hasCredentials
                  ? t("fneSettings.credentialsSaved")
                  : t("fneSettings.credentialsMissing")}
              </p>
            </>
          )}
          <Input
            label={t("fneSettings.establishmentId")}
            value={establishmentId}
            onChange={(e) => setEstablishmentId(e.target.value)}
            className="min-h-11"
          />
          <Input
            label={t("fneSettings.pointOfSale")}
            value={pointOfSale}
            onChange={(e) => setPointOfSale(e.target.value)}
            className="min-h-11"
          />
        </section>
      )}

      {mode === "disabled" && initial.mode !== "disabled" && (
        <section className="flex flex-col gap-2">
          <p
            role="alert"
            className="rounded-md border border-status-warn bg-status-warn-bg p-2 text-sm"
          >
            ⚠ {t("fneSettings.disabledWarning")}
          </p>
          <label className="flex flex-col gap-1 text-sm">
            {t("fneSettings.reason")}
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          loading={save.isPending}
          onClick={() => {
            setSaved(false);
            save.mutate({
              mode,
              provider,
              establishmentId: establishmentId || null,
              pointOfSale: pointOfSale || null,
              credentials:
                mode === "api" && provider === "dgi_api" && (baseUrl || apiKey)
                  ? { baseUrl, apiKey }
                  : undefined,
              reason: reason || undefined,
            });
          }}
        >
          {t("fneSettings.save")}
        </Button>
        {initial.mode !== "disabled" && (
          <Button variant="secondary" loading={test.isPending} onClick={() => test.mutate()}>
            {t("fneSettings.test")}
          </Button>
        )}
      </div>
      {saved && <p className="text-sm text-status-ok">✓ {t("fneSettings.saved")}</p>}
      {save.error && (
        <p role="alert" className="text-sm text-status-bad">
          ⚠ {save.error.message}
        </p>
      )}
      {test.data && (
        <p
          role="status"
          className={`text-sm ${test.data.ok ? "text-status-ok" : "text-status-bad"}`}
        >
          {test.data.ok ? "✓" : "⚠"} {test.data.detail}
        </p>
      )}
      {!test.data && initial.lastTestedAt && (
        <p className="text-sm text-muted">
          {t("fneSettings.lastTest", {
            date: formatDateTime(initial.lastTestedAt, initial.timeZone),
            result: initial.lastTestOk ? t("fneSettings.testOk") : t("fneSettings.testKo"),
          })}
          {initial.lastError ? ` — ${initial.lastError}` : ""}
        </p>
      )}

      <section className="flex flex-col gap-2" aria-label={t("fneSettings.recent")}>
        <h2 className="font-semibold">{t("fneSettings.recent")}</h2>
        <p className="text-sm text-muted">{t("fneSettings.counts", { certified, pending })}</p>
        {initial.recent.length === 0 ? (
          <p className="text-sm text-muted">{t("fneSettings.recentEmpty")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {initial.recent.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm"
              >
                <Link
                  href={`/factures/${inv.id}`}
                  className="min-h-11 content-center font-mono text-accent"
                >
                  {inv.number}
                </Link>
                <span className="min-w-0 break-all font-mono text-xs">{inv.fneNumber ?? ""}</span>
                <FneBadge status={inv.fneStatus} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
