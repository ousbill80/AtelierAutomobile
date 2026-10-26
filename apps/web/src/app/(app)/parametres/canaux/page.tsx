"use client";

// RG-M11 §7.4 : canaux WhatsApp/SMS/Email avec formulaire de configuration.
import { useState } from "react";
import { Button, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";

const CHANNELS = ["WHATSAPP", "SMS", "EMAIL"] as const;
const PROVIDERS_BY_CHANNEL: Record<string, string[]> = {
  WHATSAPP: ["console", "wa_link", "whatsapp_cloud"],
  SMS: ["console", "orange_sms", "twilio", "http_sms"],
  EMAIL: ["console", "resend", "smtp"],
};

// Champs requis par provider
const CREDENTIAL_FIELDS: Record<string, { key: string; label: string; type?: string }[]> = {
  resend: [
    { key: "apiKey", label: "Clé API Resend" },
    { key: "fromEmail", label: "Email d'envoi (ex: noreply@domaine.com)" },
    { key: "fromName", label: "Nom d'expéditeur (ex: GarageDemo)" },
  ],
  smtp: [
    { key: "host", label: "Serveur SMTP" },
    { key: "port", label: "Port" },
    { key: "user", label: "Utilisateur" },
    { key: "password", label: "Mot de passe", type: "password" },
    { key: "fromEmail", label: "Email d'envoi" },
  ],
  twilio: [
    { key: "accountSid", label: "Account SID" },
    { key: "authToken", label: "Auth Token", type: "password" },
    { key: "fromNumber", label: "Numéro d'envoi (ex: +225...)" },
  ],
  orange_sms: [
    { key: "clientId", label: "Client ID" },
    { key: "clientSecret", label: "Client Secret", type: "password" },
    { key: "senderId", label: "Sender ID" },
  ],
  whatsapp_cloud: [
    { key: "accessToken", label: "Access Token", type: "password" },
    { key: "phoneNumberId", label: "Phone Number ID" },
  ],
  // console et wa_link n'ont pas besoin de credentials
};

export default function ChannelsPage() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.channel.list.useQuery();
  const upsert = trpc.channel.upsert.useMutation({
    onSuccess: () => {
      utils.channel.list.invalidate();
      setConfiguring(null);
      setCredentials({});
    },
  });
  const test = trpc.channel.test.useMutation({ onSuccess: () => utils.channel.list.invalidate() });
  const [draftProvider, setDraftProvider] = useState<Record<string, string>>({});
  const [configuring, setConfiguring] = useState<{ channel: string; provider: string } | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Canaux</h1>
      {isLoading && <p className="text-sm text-muted">Chargement…</p>}

      <div className="grid gap-4 md:grid-cols-3">
        {CHANNELS.map((channel) => {
          const configs = data?.filter((c) => c.channel === channel) ?? [];
          const provider =
            draftProvider[channel] ?? configs[0]?.provider ?? PROVIDERS_BY_CHANNEL[channel]![0];
          return (
            <div
              key={channel}
              data-testid={`channel-${channel}`}
              className="flex flex-col gap-3 rounded-md border p-4"
            >
              <h2 className="font-semibold">{channel}</h2>

              {configs.map((config) => (
                <div
                  key={config.id}
                  className="flex flex-col gap-2 rounded-md bg-surface-2 p-3 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{config.provider}</span>
                    <StatusBadge
                      tone={config.status === "ERROR" ? "bad" : config.isActive ? "ok" : "off"}
                    >
                      {config.status === "ERROR"
                        ? "Erreur"
                        : config.isActive
                          ? "Connecté"
                          : "Non configuré"}
                    </StatusBadge>
                  </div>
                  {config.lastError && (
                    <p className="text-xs text-status-bad">{config.lastError}</p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() =>
                        upsert.mutate({
                          id: config.id,
                          channel,
                          provider: config.provider as never,
                          isActive: !config.isActive,
                          priority: config.priority,
                          credentials: {},
                        })
                      }
                    >
                      {config.isActive ? "Désactiver" : "Activer"}
                    </Button>
                    <Button variant="secondary" onClick={() => test.mutate({ id: config.id })}>
                      Vérifier maintenant
                    </Button>
                  </div>
                </div>
              ))}

              <div className="flex flex-col gap-2 border-t pt-3">
                <select
                  className="min-h-11 rounded-md border px-2 text-sm"
                  value={provider}
                  onChange={(e) =>
                    setDraftProvider((prev) => ({ ...prev, [channel]: e.target.value }))
                  }
                >
                  {PROVIDERS_BY_CHANNEL[channel]!.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <Button
                  onClick={() => {
                    const fields = CREDENTIAL_FIELDS[provider];
                    if (!fields || fields.length === 0) {
                      // Pas de credentials requis (console, wa_link)
                      upsert.mutate({
                        channel,
                        provider: provider as never,
                        isActive: true,
                        priority: configs.length + 1,
                        credentials: {},
                      });
                    } else {
                      // Ouvrir le formulaire de configuration
                      setConfiguring({ channel, provider });
                      setCredentials({});
                    }
                  }}
                >
                  Configurer
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modale de configuration */}
      {configuring && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-xl">
            <h2 className="mb-4 text-xl font-semibold">
              Configurer {configuring.provider}
            </h2>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                const configs = data?.filter((c) => c.channel === configuring.channel) ?? [];
                // Trouver une config existante pour ce provider
                const existing = configs.find((c) => c.provider === configuring.provider);
                upsert.mutate({
                  id: existing?.id, // Si existe, on met à jour
                  channel: configuring.channel as "WHATSAPP" | "SMS" | "EMAIL",
                  provider: configuring.provider as never,
                  isActive: true,
                  priority: existing?.priority ?? configs.length + 1,
                  credentials,
                });
              }}
            >
              {CREDENTIAL_FIELDS[configuring.provider]?.map((field) => (
                <label key={field.key} className="flex flex-col gap-1">
                  <span className="text-sm font-medium">{field.label}</span>
                  <input
                    type={field.type ?? "text"}
                    className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm"
                    value={credentials[field.key] ?? ""}
                    onChange={(e) =>
                      setCredentials((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    required
                  />
                </label>
              ))}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setConfiguring(null);
                    setCredentials({});
                  }}
                >
                  Annuler
                </Button>
                <Button type="submit" disabled={upsert.isPending}>
                  {upsert.isPending ? "Enregistrement..." : "Enregistrer"}
                </Button>
              </div>
              {upsert.error && (
                <p className="text-sm text-status-bad">{upsert.error.message}</p>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
