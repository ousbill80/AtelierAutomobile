"use client";

// RG-M11 §7.1 : fil de discussion (version minimale) — bulles, statuts, zone de saisie.
import { useEffect, useState } from "react";
import { Button, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";

const STATUS_LABEL: Record<string, string> = {
  QUEUED: "En attente",
  SENDING: "Envoi…",
  SENT: "Envoyé",
  DELIVERED: "Délivré",
  READ: "Lu",
  FAILED: "Échec",
  RECEIVED: "Reçu",
};

export function ConversationView({ conversationId }: { conversationId: string }) {
  const [body, setBody] = useState("");
  const [now] = useState(() => Date.now());

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.messaging.conversations.get.useQuery({ id: conversationId });
  const { mutate: markRead } = trpc.messaging.conversations.markRead.useMutation();
  const reply = trpc.messaging.conversations.reply.useMutation({
    onSuccess: () => {
      setBody("");
      void utils.messaging.conversations.get.invalidate({ id: conversationId });
    },
  });

  useEffect(() => {
    markRead({ conversationId });
  }, [conversationId, markRead]);

  if (isLoading) return <p className="text-sm text-muted">Chargement…</p>;
  if (!data) return <p className="text-sm text-status-bad">Conversation introuvable.</p>;

  const windowOpen = data.windowExpiresAt != null && new Date(data.windowExpiresAt).getTime() > now;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">
          {data.conversation.customer?.displayName ?? data.conversation.externalAddress}
        </h1>
        <p className="text-sm text-muted">{data.conversation.externalAddress}</p>
        {data.conversation.channel === "WHATSAPP" && (
          <p className="text-sm text-muted">
            {windowOpen ? "Fenêtre WhatsApp ouverte" : "Fenêtre fermée : modèle approuvé requis"}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-md border p-4">
        {data.messages.length === 0 && <p className="text-sm text-muted">Aucun message.</p>}
        {data.messages.map((message) => (
          <div
            key={message.id}
            className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
              message.direction === "OUTBOUND"
                ? "self-end bg-accent text-accent-foreground"
                : "self-start bg-surface-2"
            }`}
          >
            <p>{message.body}</p>
            {message.direction === "OUTBOUND" && (
              <p className="mt-1 text-xs opacity-80">
                {STATUS_LABEL[message.status] ?? message.status}
                {message.errorCode ? ` · ${message.errorCode}` : ""}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          className="min-h-11 flex-1 rounded-md border px-3 text-sm"
          placeholder="Écrire un message…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <Button
          onClick={() => body.trim() && reply.mutate({ conversationId, body: body.trim() })}
          disabled={reply.isPending}
        >
          Envoyer
        </Button>
      </div>

      {data.conversation.lastIntent && (
        <StatusBadge tone="warn">Intention : {data.conversation.lastIntent}</StatusBadge>
      )}
    </div>
  );
}
