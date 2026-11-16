"use client";

// RG-M11 §7.4 : canaux WhatsApp/SMS/Email avec formulaire de configuration.
// Les identifiants sont chiffrés côté serveur et jamais renvoyés : en modification, un champ
// laissé vide conserve la valeur enregistrée.
import { useEffect, useState } from "react";
import { Button, Modal, StatusBadge, type StatusTone } from "@atelieros/ui";
import { DEFAULT_TIME_ZONE, formatDateTime } from "@/components/repair-orders/i18n";
import { trpc } from "@/trpc/react";
import { t } from "@/i18n/t";

type Channel = "WHATSAPP" | "SMS" | "EMAIL";
type Provider =
  | "console"
  | "wa_link"
  | "whatsapp_cloud"
  | "orange_sms"
  | "twilio"
  | "http_sms"
  | "smpp"
  | "resend"
  | "smtp";

const CHANNELS: Channel[] = ["WHATSAPP", "SMS", "EMAIL"];
const PROVIDERS_BY_CHANNEL: Record<Channel, Provider[]> = {
  WHATSAPP: ["console", "wa_link", "whatsapp_cloud"],
  SMS: ["console", "orange_sms", "twilio", "http_sms", "smpp"],
  EMAIL: ["console", "resend", "smtp"],
};

const CHANNEL_LABELS: Record<Channel, string> = {
  WHATSAPP: t("settings.channelsPage.channels.WHATSAPP"),
  SMS: t("settings.channelsPage.channels.SMS"),
  EMAIL: t("settings.channelsPage.channels.EMAIL"),
};

const PROVIDER_LABELS: Record<Provider, string> = {
  console: t("settings.channelsPage.providers.console"),
  wa_link: t("settings.channelsPage.providers.wa_link"),
  whatsapp_cloud: t("settings.channelsPage.providers.whatsapp_cloud"),
  orange_sms: t("settings.channelsPage.providers.orange_sms"),
  twilio: t("settings.channelsPage.providers.twilio"),
  http_sms: t("settings.channelsPage.providers.http_sms"),
  smpp: t("settings.channelsPage.providers.smpp"),
  resend: t("settings.channelsPage.providers.resend"),
  smtp: t("settings.channelsPage.providers.smtp"),
};

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider as Provider] ?? provider;
}

type CredentialField = {
  key: string;
  label: string;
  type?: "text" | "password" | "select" | "textarea";
  options?: { value: string; label: string }[];
  /** Valeur proposée à la création (listes déroulantes). */
  defaultValue?: string;
  optional?: boolean;
  hint?: string;
};

// Champs attendus par chaque adaptateur de packages/integrations (console et wa_link : aucun).
const CREDENTIAL_FIELDS: Partial<Record<Provider, CredentialField[]>> = {
  resend: [
    { key: "apiKey", label: t("settings.channelsPage.fields.resendApiKey"), type: "password" },
    { key: "fromEmail", label: t("settings.channelsPage.fields.resendFromEmail") },
    { key: "fromName", label: t("settings.channelsPage.fields.resendFromName") },
  ],
  smtp: [
    { key: "host", label: t("settings.channelsPage.fields.smtpHost") },
    { key: "port", label: t("settings.channelsPage.fields.smtpPort") },
    { key: "user", label: t("settings.channelsPage.fields.smtpUser") },
    { key: "password", label: t("settings.channelsPage.fields.smtpPassword"), type: "password" },
    { key: "fromEmail", label: t("settings.channelsPage.fields.smtpFromEmail") },
  ],
  twilio: [
    { key: "accountSid", label: t("settings.channelsPage.fields.twilioAccountSid") },
    {
      key: "authToken",
      label: t("settings.channelsPage.fields.twilioAuthToken"),
      type: "password",
    },
    { key: "fromNumber", label: t("settings.channelsPage.fields.twilioFromNumber") },
  ],
  orange_sms: [
    { key: "clientId", label: t("settings.channelsPage.fields.orangeClientId") },
    {
      key: "clientSecret",
      label: t("settings.channelsPage.fields.orangeClientSecret"),
      type: "password",
    },
    {
      key: "senderName",
      label: t("settings.channelsPage.fields.orangeSenderId"),
      optional: true,
      hint: t("settings.channelsPage.fields.orangeSenderIdHint"),
    },
  ],
  whatsapp_cloud: [
    {
      key: "accessToken",
      label: t("settings.channelsPage.fields.waAccessToken"),
      type: "password",
    },
    { key: "phoneNumberId", label: t("settings.channelsPage.fields.waPhoneNumberId") },
  ],
  smpp: [
    { key: "host", label: t("settings.channelsPage.fields.smppHost") },
    { key: "port", label: t("settings.channelsPage.fields.smppPort"), defaultValue: "2775" },
    {
      key: "tls",
      label: t("settings.channelsPage.fields.smppTls"),
      type: "select",
      defaultValue: "false",
      options: [
        { value: "false", label: t("settings.channelsPage.fields.smppTlsNo") },
        { value: "true", label: t("settings.channelsPage.fields.smppTlsYes") },
      ],
    },
    { key: "systemId", label: t("settings.channelsPage.fields.smppSystemId") },
    { key: "password", label: t("settings.channelsPage.fields.smppPassword"), type: "password" },
    {
      key: "systemType",
      label: t("settings.channelsPage.fields.smppSystemType"),
      optional: true,
    },
    {
      key: "sourceAddr",
      label: t("settings.channelsPage.fields.smppSourceAddr"),
      hint: t("settings.channelsPage.fields.smppSourceAddrHint"),
    },
    {
      key: "sourceAddrTon",
      label: t("settings.channelsPage.fields.smppSourceAddrTon"),
      optional: true,
      hint: t("settings.channelsPage.fields.smppTonNpiHint"),
    },
    {
      key: "sourceAddrNpi",
      label: t("settings.channelsPage.fields.smppSourceAddrNpi"),
      optional: true,
    },
    {
      key: "destAddrTon",
      label: t("settings.channelsPage.fields.smppDestAddrTon"),
      optional: true,
    },
    {
      key: "destAddrNpi",
      label: t("settings.channelsPage.fields.smppDestAddrNpi"),
      optional: true,
    },
    {
      key: "defaultAlphabet",
      label: t("settings.channelsPage.fields.smppAlphabet"),
      type: "select",
      defaultValue: "gsm7",
      options: [
        { value: "gsm7", label: t("settings.channelsPage.fields.smppAlphabetGsm") },
        { value: "latin1", label: t("settings.channelsPage.fields.smppAlphabetLatin1") },
      ],
      hint: t("settings.channelsPage.fields.smppAlphabetHint"),
    },
  ],
  http_sms: [
    { key: "url", label: t("settings.channelsPage.fields.httpUrl") },
    {
      key: "method",
      label: t("settings.channelsPage.fields.httpMethod"),
      type: "select",
      defaultValue: "POST",
      options: [
        { value: "POST", label: "POST" },
        { value: "GET", label: "GET" },
      ],
    },
    {
      key: "contentType",
      label: t("settings.channelsPage.fields.httpContentType"),
      type: "select",
      defaultValue: "application/json",
      options: [
        {
          value: "application/json",
          label: t("settings.channelsPage.fields.httpContentTypeJson"),
        },
        {
          value: "application/x-www-form-urlencoded",
          label: t("settings.channelsPage.fields.httpContentTypeForm"),
        },
      ],
    },
    {
      key: "bodyTemplate",
      label: t("settings.channelsPage.fields.httpBodyTemplate"),
      type: "textarea",
      hint: t("settings.channelsPage.fields.httpBodyTemplateHint"),
    },
    {
      key: "responseMessageIdPath",
      label: t("settings.channelsPage.fields.httpResponseIdPath"),
      optional: true,
    },
    {
      key: "webhookToken",
      label: t("settings.channelsPage.fields.httpWebhookToken"),
      type: "password",
      optional: true,
    },
  ],
};

type ConfigRow = {
  id: string;
  isActive: boolean;
  status: string | null;
};

function configStatus(config: ConfigRow): { tone: StatusTone; label: string } {
  if (!config.isActive) return { tone: "off", label: t("settings.channelsPage.status.inactive") };
  if (config.status === "ERROR")
    return { tone: "bad", label: t("settings.channelsPage.status.error") };
  if (config.status === "OK") return { tone: "ok", label: t("settings.channelsPage.status.ok") };
  return { tone: "warn", label: t("settings.channelsPage.status.unchecked") };
}

type Configuring = {
  channel: Channel;
  provider: Provider;
  existingId?: string;
  priority: number;
  hasCredentials: boolean;
};

const inputClass = "min-h-11 rounded-md border border-border bg-surface px-3 text-sm";

export default function ChannelsPage() {
  const utils = trpc.useUtils();
  const { data, isLoading, isError, refetch } = trpc.channel.list.useQuery();
  const me = trpc.me.get.useQuery(undefined, { staleTime: 60_000 });
  const timeZone = me.data?.activeOrganization?.timezone ?? DEFAULT_TIME_ZONE;
  const [draftProvider, setDraftProvider] = useState<Partial<Record<Channel, Provider>>>({});
  const [configuring, setConfiguring] = useState<Configuring | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  // Erreurs et résultats affichés sur la carte concernée (canal ou configuration).
  const [cardError, setCardError] = useState<Partial<Record<Channel, string>>>({});
  const [testResult, setTestResult] = useState<
    Record<string, { ok: boolean; detail?: string } | undefined>
  >({});

  const upsert = trpc.channel.upsert.useMutation({
    onSuccess: () => utils.channel.list.invalidate(),
  });
  const setActive = trpc.channel.setActive.useMutation({
    onSuccess: () => utils.channel.list.invalidate(),
  });
  const test = trpc.channel.test.useMutation({
    onSettled: () => utils.channel.list.invalidate(),
  });

  function closeModal() {
    setConfiguring(null);
    setCredentials({});
    upsert.reset();
  }

  // Échap ferme la modale (le composant Modal gère le clic hors cadre et le bouton Fermer).
  useEffect(() => {
    if (!configuring) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeModal();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [configuring]);

  function setError(channel: Channel, message: string | undefined) {
    setCardError((prev) => ({ ...prev, [channel]: message }));
  }

  function openConfigure(channel: Channel, provider: Provider) {
    const configs = data?.filter((c) => c.channel === channel) ?? [];
    const existing = configs.find((c) => c.provider === provider);
    const fields = CREDENTIAL_FIELDS[provider] ?? [];
    setError(channel, undefined);

    if (fields.length === 0) {
      // console et wa_link : pas d'identifiants, on enregistre directement (mise à jour si existe).
      upsert.mutate(
        {
          id: existing?.id,
          channel,
          provider,
          isActive: true,
          priority: existing?.priority ?? configs.length + 1,
          credentials: {},
        },
        {
          onError: (error) =>
            setError(channel, t("settings.channelsPage.actionError", { message: error.message })),
        },
      );
      return;
    }

    const hasCredentials = Boolean(existing?.hasCredentials);
    setConfiguring({
      channel,
      provider,
      existingId: existing?.id,
      priority: existing?.priority ?? configs.length + 1,
      hasCredentials,
    });
    // En modification, les listes partent de « conserver » (valeur vide) ; à la création,
    // de leur valeur par défaut.
    setCredentials(
      hasCredentials
        ? {}
        : Object.fromEntries(
            fields.filter((f) => f.defaultValue).map((f) => [f.key, f.defaultValue!]),
          ),
    );
    upsert.reset();
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">{t("settings.channelsPage.title")}</h1>
        <div className="grid gap-4 md:grid-cols-3" aria-busy="true">
          <span className="sr-only">{t("settings.channelsPage.loading")}</span>
          {CHANNELS.map((channel) => (
            <div
              key={channel}
              className="h-48 animate-pulse rounded-md border border-border bg-surface-2"
            />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">{t("settings.channelsPage.title")}</h1>
        <div className="flex flex-col items-start gap-2 rounded-lg border border-status-bad bg-status-bad-bg p-4">
          <p className="text-sm text-status-bad">{t("settings.channelsPage.loadError")}</p>
          <Button variant="secondary" onClick={() => refetch()}>
            {t("settings.channelsPage.retry")}
          </Button>
        </div>
      </div>
    );
  }

  const modalFields = configuring ? (CREDENTIAL_FIELDS[configuring.provider] ?? []) : [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("settings.channelsPage.title")}</h1>

      <div className="grid gap-4 md:grid-cols-3">
        {CHANNELS.map((channel) => {
          const configs = data?.filter((c) => c.channel === channel) ?? [];
          const provider =
            draftProvider[channel] ??
            (configs[0]?.provider as Provider | undefined) ??
            PROVIDERS_BY_CHANNEL[channel][0]!;
          const providerExists = configs.some((c) => c.provider === provider);
          const providerNeedsCredentials = (CREDENTIAL_FIELDS[provider] ?? []).length > 0;
          const selectId = `provider-${channel}`;
          return (
            <div
              key={channel}
              data-testid={`channel-${channel}`}
              className="flex flex-col gap-3 rounded-md border border-border p-4"
            >
              <h2 className="font-semibold">{CHANNEL_LABELS[channel]}</h2>

              {configs.length === 0 && (
                <p className="text-sm text-muted">{t("settings.channelsPage.noConfig")}</p>
              )}

              {configs.map((config) => {
                const status = configStatus(config);
                const result = testResult[config.id];
                const testing = test.isPending && test.variables?.id === config.id;
                const toggling = setActive.isPending && setActive.variables?.id === config.id;
                return (
                  <div
                    key={config.id}
                    className="flex flex-col gap-2 rounded-md bg-surface-2 p-3 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{providerLabel(config.provider)}</span>
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    </div>
                    {config.hasCredentials && (
                      <p className="text-xs text-muted">
                        {t("settings.channelsPage.credentialsStored")}
                      </p>
                    )}
                    {config.lastCheckedAt && (
                      <p className="text-xs text-muted">
                        {t("settings.channelsPage.lastChecked", {
                          date: formatDateTime(config.lastCheckedAt, timeZone),
                        })}
                      </p>
                    )}
                    {/* Après « Vérifier maintenant », le résultat ci-dessous redit la même erreur. */}
                    {config.lastError && !(result && !result.ok) && (
                      <p className="text-xs text-status-bad">{config.lastError}</p>
                    )}
                    {result && (
                      <p
                        role="status"
                        className={`text-xs ${result.ok ? "text-status-ok" : "text-status-bad"}`}
                      >
                        {result.ok
                          ? t("settings.channelsPage.verifyOk")
                          : t("settings.channelsPage.verifyFailed", {
                              detail: result.detail ?? "",
                            })}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        disabled={toggling}
                        onClick={() => {
                          setError(channel, undefined);
                          setActive.mutate(
                            { id: config.id, isActive: !config.isActive },
                            {
                              onError: (error) =>
                                setError(
                                  channel,
                                  t("settings.channelsPage.actionError", {
                                    message: error.message,
                                  }),
                                ),
                            },
                          );
                        }}
                      >
                        {config.isActive
                          ? t("settings.channelsPage.deactivate")
                          : t("settings.channelsPage.activate")}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={testing}
                        onClick={() => {
                          setError(channel, undefined);
                          setTestResult((prev) => ({ ...prev, [config.id]: undefined }));
                          test.mutate(
                            { id: config.id },
                            {
                              onSuccess: (health) =>
                                setTestResult((prev) => ({ ...prev, [config.id]: health })),
                              onError: (error) =>
                                setError(
                                  channel,
                                  t("settings.channelsPage.actionError", {
                                    message: error.message,
                                  }),
                                ),
                            },
                          );
                        }}
                      >
                        {testing
                          ? t("settings.channelsPage.verifying")
                          : t("settings.channelsPage.verify")}
                      </Button>
                    </div>
                  </div>
                );
              })}

              <div className="flex flex-col gap-2 border-t border-border pt-3">
                <label htmlFor={selectId} className="text-sm font-medium">
                  {t("settings.channelsPage.providerLabel")}
                </label>
                <select
                  id={selectId}
                  className="min-h-11 rounded-md border border-border bg-surface px-2 text-sm"
                  value={provider}
                  onChange={(e) =>
                    setDraftProvider((prev) => ({
                      ...prev,
                      [channel]: e.target.value as Provider,
                    }))
                  }
                >
                  {PROVIDERS_BY_CHANNEL[channel].map((p) => (
                    <option key={p} value={p}>
                      {PROVIDER_LABELS[p]}
                    </option>
                  ))}
                </select>
                <Button
                  disabled={upsert.isPending && !configuring}
                  onClick={() => openConfigure(channel, provider)}
                >
                  {providerExists && providerNeedsCredentials
                    ? t("settings.channelsPage.reconfigure")
                    : t("settings.channelsPage.configure")}
                </Button>
                {cardError[channel] && (
                  <p role="alert" className="text-sm text-status-bad">
                    {cardError[channel]}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        open={configuring !== null}
        title={
          configuring
            ? t("settings.channelsPage.modalTitle", {
                provider: PROVIDER_LABELS[configuring.provider],
              })
            : ""
        }
        onClose={closeModal}
      >
        {configuring && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              upsert.mutate(
                {
                  id: configuring.existingId,
                  channel: configuring.channel,
                  provider: configuring.provider,
                  isActive: true,
                  priority: configuring.priority,
                  credentials,
                },
                { onSuccess: closeModal },
              );
            }}
          >
            {configuring.hasCredentials && (
              <p className="text-sm text-muted">{t("settings.channelsPage.keepHint")}</p>
            )}
            {modalFields.map((field) => {
              const id = `cred-${field.key}`;
              const required = !configuring.hasCredentials && !field.optional;
              const value = credentials[field.key] ?? "";
              const onChange = (next: string) =>
                setCredentials((prev) => ({ ...prev, [field.key]: next }));
              return (
                <div key={field.key} className="flex flex-col gap-1">
                  <label htmlFor={id} className="text-sm font-medium">
                    {field.label}
                  </label>
                  {field.type === "select" ? (
                    <select
                      id={id}
                      className={inputClass}
                      value={value}
                      required={required}
                      onChange={(e) => onChange(e.target.value)}
                    >
                      {configuring.hasCredentials && (
                        <option value="">{t("settings.channelsPage.keepOption")}</option>
                      )}
                      {field.options?.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea
                      id={id}
                      className="min-h-24 rounded-md border border-border bg-surface p-3 font-mono text-sm"
                      value={value}
                      required={required}
                      aria-describedby={field.hint ? `${id}-hint` : undefined}
                      onChange={(e) => onChange(e.target.value)}
                    />
                  ) : (
                    <input
                      id={id}
                      type={field.type ?? "text"}
                      autoComplete="off"
                      className={inputClass}
                      value={value}
                      required={required}
                      aria-describedby={field.hint ? `${id}-hint` : undefined}
                      onChange={(e) => onChange(e.target.value)}
                    />
                  )}
                  {field.hint && (
                    <p id={`${id}-hint`} className="text-xs text-muted">
                      {field.hint}
                    </p>
                  )}
                </div>
              );
            })}
            {upsert.error && (
              <p role="alert" className="text-sm text-status-bad">
                {upsert.error.message}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={closeModal}>
                {t("settings.channelsPage.cancel")}
              </Button>
              <Button type="submit" disabled={upsert.isPending}>
                {upsert.isPending
                  ? t("settings.channelsPage.saving")
                  : t("settings.channelsPage.save")}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
