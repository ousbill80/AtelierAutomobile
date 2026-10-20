"use client";

// M15 §7 (RG-M15-17) — /parametres/paiements : fournisseurs de liens de paiement (CinetPay,
// Wave Business, simulateur hors production), moyens proposés, identifiants saisis mais jamais
// réaffichés (chiffrés côté serveur), test, URL de notification, numéros marchands.
import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { Button, CheckboxRow, Input, PageHead, PhoneInput, StatusBadge } from "@atelieros/ui";
import type { AppRouter } from "@/server/routers/_app";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/react";

type Data = inferRouterOutputs<AppRouter>["paymentProviders"]["list"];
type ProviderRow = Data["providers"][number];
const METHODS = ["WAVE", "ORANGE_MONEY", "MTN_MOMO", "MOOV_MONEY", "CARD"] as const;
type Method = (typeof METHODS)[number];
const MERCHANTS = ["wave", "orangeMoney", "mtn", "moov"] as const;

export default function PaymentSettingsPage() {
  const query = trpc.paymentProviders.list.useQuery();
  if (query.isError) {
    return <ErrorBox onRetry={() => query.refetch()} message={t("paymentSettings.loadError")} />;
  }
  if (!query.data) return <ListSkeleton />;
  const data = query.data;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHead title={t("paymentSettings.title")} description={t("paymentSettings.description")} />
      {data.providers.map((p) => (
        <ProviderCard key={p.provider} row={p} onSaved={() => query.refetch()} />
      ))}
      <MerchantNumbers initial={data.merchantNumbers} />
    </div>
  );
}

function ProviderCard({ row, onSaved }: { row: ProviderRow; onSaved: () => void }) {
  const [methods, setMethods] = useState<Method[]>(
    row.methods.length > 0
      ? (row.methods.filter((m) => (METHODS as readonly string[]).includes(m)) as Method[])
      : row.provider === "wave"
        ? ["WAVE"]
        : ["WAVE", "ORANGE_MONEY", "MTN_MOMO", "MOOV_MONEY"],
  );
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const upsert = trpc.paymentProviders.upsert.useMutation({
    onSuccess: () => {
      setSaved(true);
      setCredentials({});
      onSaved();
    },
  });
  const test = trpc.paymentProviders.test.useMutation({ onSuccess: onSaved });
  const isFake = row.provider === "fake";
  const error = upsert.error ?? test.error;

  function save(isActive: boolean) {
    setSaved(false);
    upsert.mutate({ provider: row.provider, methods, credentials, isActive });
  }

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      data-testid={`provider-${row.provider}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{t(`paymentSettings.providers.${row.provider}`)}</h3>
        <StatusBadge
          tone={row.isActive ? "ok" : "off"}
          label={row.isActive ? t("paymentSettings.active") : t("paymentSettings.inactive")}
        />
      </header>
      {isFake ? (
        <p className="text-sm text-muted">{t("paymentSettings.simulatorHint")}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {row.fields.map((f) => (
            <Input
              key={f.name}
              type="password"
              autoComplete="off"
              label={`${t(`paymentSettings.fields.${f.name}`)}${f.filled ? ` (${t("paymentSettings.filled")})` : ""}`}
              placeholder={f.filled ? t("paymentSettings.keepHint") : ""}
              value={credentials[f.name] ?? ""}
              onChange={(e) => setCredentials({ ...credentials, [f.name]: e.target.value })}
            />
          ))}
        </div>
      )}
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">{t("paymentSettings.methods")}</legend>
        <div className="grid gap-1 sm:grid-cols-3">
          {METHODS.map((m) => (
            <CheckboxRow
              key={m}
              label={t(`invoicePortal.methods.${m}`)}
              checked={methods.includes(m)}
              onChange={(e) =>
                setMethods(e.target.checked ? [...methods, m] : methods.filter((x) => x !== m))
              }
            />
          ))}
        </div>
      </fieldset>
      {row.configured && (
        <p className="break-all text-xs text-muted">
          {t("paymentSettings.webhookUrl")} : <code>{row.webhookUrl}</code>
        </p>
      )}
      {row.lastTestedAt && (
        <p className={row.lastTestOk ? "text-sm text-status-ok" : "text-sm text-status-bad"}>
          {row.lastTestOk
            ? `✓ ${t("paymentSettings.testOk", { date: formatDateTime(row.lastTestedAt) })}`
            : `⚠ ${t("paymentSettings.testKo", { error: row.lastError ?? "" })}`}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-status-bad">
          ⚠ {error.message}
        </p>
      )}
      {saved && <p className="text-sm text-status-ok">✓ {t("paymentSettings.saved")}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          loading={upsert.isPending}
          disabled={methods.length === 0}
          onClick={() => save(!row.isActive)}
        >
          {row.isActive ? t("paymentSettings.deactivate") : t("paymentSettings.activate")}
        </Button>
        <Button
          variant="secondary"
          disabled={methods.length === 0 || upsert.isPending}
          onClick={() => save(row.isActive)}
        >
          {t("paymentSettings.save")}
        </Button>
        {row.configured && (
          <Button
            variant="secondary"
            loading={test.isPending}
            onClick={() => test.mutate({ provider: row.provider })}
          >
            {t("paymentSettings.test")}
          </Button>
        )}
      </div>
    </section>
  );
}

function MerchantNumbers({ initial }: { initial: Data["merchantNumbers"] }) {
  const [values, setValues] = useState<Record<(typeof MERCHANTS)[number], string>>({
    wave: initial.wave ?? "",
    orangeMoney: initial.orangeMoney ?? "",
    mtn: initial.mtn ?? "",
    moov: initial.moov ?? "",
  });
  const update = trpc.paymentProviders.updateMerchantNumbers.useMutation();
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h3 className="font-semibold">{t("paymentSettings.merchantTitle")}</h3>
      <p className="text-sm text-muted">{t("paymentSettings.merchantHint")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {MERCHANTS.map((m) => (
          <label key={m} className="flex flex-col gap-1 text-sm">
            {t(`paymentSettings.merchant.${m}`)}
            <PhoneInput value={values[m]} onChange={(v) => setValues({ ...values, [m]: v })} />
          </label>
        ))}
      </div>
      {update.error && (
        <p role="alert" className="text-sm text-status-bad">
          ⚠ {update.error.message}
        </p>
      )}
      {update.isSuccess && <p className="text-sm text-status-ok">✓ {t("paymentSettings.saved")}</p>}
      <div>
        <Button
          loading={update.isPending}
          onClick={() =>
            update.mutate({
              wave: values.wave || null,
              orangeMoney: values.orangeMoney || null,
              mtn: values.mtn || null,
              moov: values.moov || null,
            })
          }
        >
          {t("paymentSettings.save")}
        </Button>
      </div>
    </section>
  );
}
