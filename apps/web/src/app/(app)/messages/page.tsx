"use client";

// RG-M11 §7.1 : boîte de réception unifiée (version minimale — liste des conversations).
import Link from "next/link";
import { useState } from "react";
import { Button, EmptyState, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";

const CHANNEL_LABEL: Record<string, string> = { WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "Email" };

export default function MessagesPage() {
  const [filter, setFilter] = useState<"ALL" | "UNREAD" | "ASSIGNED_TO_ME" | "UNASSIGNED">("ALL");
  const { data, isLoading, isError } = trpc.messaging.conversations.list.useQuery({
    filter,
    limit: 50,
  });

  const [composeOpen, setComposeOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [channel, setChannel] = useState<"WHATSAPP" | "SMS" | "EMAIL">("WHATSAPP");
  const [composeBody, setComposeBody] = useState("");
  const [templateKey, setTemplateKey] = useState(""); // "" = texte libre
  const { data: templates } = trpc.template.list.useQuery({ channel }, { enabled: composeOpen });
  const send = trpc.messaging.send.useMutation({
    onSuccess: () => {
      setComposeOpen(false);
      setCustomerId("");
      setComposeBody("");
      setTemplateKey("");
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Messages</h1>
        <div className="flex items-center gap-3">
          {data && <span className="text-sm text-muted">{data.unreadTotal} non lu(s)</span>}
          <Button variant="secondary" onClick={() => setComposeOpen((v) => !v)}>
            Nouveau message
          </Button>
        </div>
      </div>

      {composeOpen && (
        <div className="flex flex-col gap-2 rounded-md border p-4">
          <label className="text-sm">
            ID client
            <input
              className="mt-1 min-h-11 w-full rounded-md border px-3 text-sm"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              placeholder="cuid du client"
            />
          </label>
          <select
            className="min-h-11 rounded-md border px-2 text-sm"
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value as "WHATSAPP" | "SMS" | "EMAIL");
              setTemplateKey("");
            }}
          >
            <option value="WHATSAPP">WhatsApp</option>
            <option value="SMS">SMS</option>
            <option value="EMAIL">Email</option>
          </select>

          {/* RG-M11-10 : hors fenêtre 24 h, WhatsApp n'accepte qu'un modèle approuvé. */}
          <select
            className="min-h-11 rounded-md border px-2 text-sm"
            value={templateKey}
            onChange={(e) => setTemplateKey(e.target.value)}
          >
            <option value="">
              Texte libre{channel === "WHATSAPP" ? " (1er contact WhatsApp impossible)" : ""}
            </option>
            {templates
              ?.filter((t) => channel !== "WHATSAPP" || t.whatsappStatus === "APPROVED")
              .map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
          </select>

          {!templateKey && (
            <textarea
              className="min-h-24 rounded-md border p-3 text-sm"
              placeholder="Message…"
              value={composeBody}
              onChange={(e) => setComposeBody(e.target.value)}
            />
          )}
          <Button
            onClick={() =>
              customerId.trim() &&
              (templateKey || composeBody.trim()) &&
              send.mutate({
                customerId: customerId.trim(),
                channel,
                ...(templateKey ? { templateKey } : { body: composeBody.trim() }),
              })
            }
            disabled={send.isPending}
          >
            Envoyer
          </Button>
          {send.error && <p className="text-sm text-status-bad">{send.error.message}</p>}
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        {(["ALL", "UNREAD", "ASSIGNED_TO_ME", "UNASSIGNED"] as const).map((value) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`min-h-11 rounded-md px-3 ${filter === value ? "bg-accent text-accent-foreground" : "bg-surface-2"}`}
          >
            {value === "ALL" && "Toutes"}
            {value === "UNREAD" && "Non lues"}
            {value === "ASSIGNED_TO_ME" && "Assignées à moi"}
            {value === "UNASSIGNED" && "Non assignées"}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-muted">Chargement…</p>}
      {isError && <p className="text-sm text-status-bad">Impossible de charger les messages.</p>}

      {data && data.items.length === 0 && (
        <EmptyState
          title="Aucun message."
          description="Les réponses de vos clients arriveront ici."
        />
      )}

      <div className="flex flex-col gap-2">
        {data?.items.map((conversation) => (
          <Link
            key={conversation.id}
            href={`/messages/${conversation.id}`}
            className="flex items-center justify-between gap-3 rounded-md border p-4 hover:bg-surface-2"
          >
            <div>
              <p className="font-medium">
                {conversation.customer?.displayName ?? conversation.externalAddress}
              </p>
              <p className="text-sm text-muted">{conversation.externalAddress}</p>
            </div>
            <div className="flex items-center gap-2">
              {conversation.unreadCount > 0 && (
                <StatusBadge tone="bad">{conversation.unreadCount} non lu(s)</StatusBadge>
              )}
              <StatusBadge tone={conversation.status === "OPEN" ? "warn" : "off"}>
                {CHANNEL_LABEL[conversation.channel] ?? conversation.channel}
              </StatusBadge>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
