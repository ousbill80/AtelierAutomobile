"use client";

// RG-M11 §7.4 : canaux WhatsApp/SMS/Email (version minimale — pas d'assistant d'identifiants).
import { useState } from "react";
import { Button, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";

const CHANNELS = ["WHATSAPP", "SMS", "EMAIL"] as const;
const PROVIDERS_BY_CHANNEL: Record<string, string[]> = {
  WHATSAPP: ["console", "wa_link", "whatsapp_cloud"],
  SMS: ["console", "orange_sms", "twilio", "http_sms"],
  EMAIL: ["console", "resend", "smtp"],
};

export default function ChannelsPage() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.channel.list.useQuery();
  const upsert = trpc.channel.upsert.useMutation({
    onSuccess: () => utils.channel.list.invalidate(),
  });
  const test = trpc.channel.test.useMutation({ onSuccess: () => utils.channel.list.invalidate() });
  const [draftProvider, setDraftProvider] = useState<Record<string, string>>({});

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
                  onClick={() =>
                    upsert.mutate({
                      channel,
                      provider: provider as never,
                      isActive: true,
                      priority: configs.length + 1,
                      credentials: {},
                    })
                  }
                >
                  Configurer
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
