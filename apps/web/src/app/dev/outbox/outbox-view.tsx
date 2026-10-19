"use client";

// RG-M11-26, US-M11-07 : boîte d'envoi console (dev/tests). Simulateurs : livré, lu, échec
// (dont « non WhatsApp » pour tester le repli RG-M11-05), réponse entrante, STOP.
//
// Deux sources : `defaultOutbox` (en mémoire, propre au processus web — OTP, invitations,
// envois qui ne passent jamais par le worker) et les `Message` réels en base (M11, traités de
// façon asynchrone par apps/worker, un processus séparé qui ne partage aucune mémoire avec le
// serveur web — seule la base Postgres est commune).
import { useCallback, useEffect, useState } from "react";
import { Button } from "@atelieros/ui";
import { trpc } from "@/trpc/client";

interface OutboxEntry {
  id: string;
  channel: string;
  to: string;
  body: string;
  sentAt: string;
}

interface MessageEntry extends OutboxEntry {
  status: string;
  errorCode: string | null;
}

export function DevOutboxView() {
  const [systemEntries, setSystemEntries] = useState<OutboxEntry[]>([]);
  const [messageEntries, setMessageEntries] = useState<MessageEntry[]>([]);
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});

  const refreshMessages = useCallback(async () => {
    const res = await fetch("/dev/outbox/messages", { cache: "no-store" });
    const data = (await res.json()) as MessageEntry[];
    setMessageEntries(data);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/dev/outbox/entries", { cache: "no-store" })
      .then((res) => res.json() as Promise<OutboxEntry[]>)
      .then((data) => {
        if (active) setSystemEntries([...data].reverse());
      });
    fetch("/dev/outbox/messages", { cache: "no-store" })
      .then((res) => res.json() as Promise<MessageEntry[]>)
      .then((data) => {
        if (active) setMessageEntries(data);
      });
    // apps/worker traite les envois de façon asynchrone (file BullMQ) : un message créé par un
    // simulateur (ex. le repli RG-M11-05) n'a pas encore de providerMessageId au moment où la
    // mutation répond. Sondage court pour que la liste se mette à jour une fois l'envoi terminé.
    const interval = setInterval(() => {
      fetch("/dev/outbox/messages", { cache: "no-store" })
        .then((res) => res.json() as Promise<MessageEntry[]>)
        .then((data) => {
          if (active) setMessageEntries(data);
        });
    }, 2000);
    return () => {
      clearInterval(interval);
      active = false;
    };
  }, []);

  const simulate = trpc.devOutbox.simulate.useMutation({ onSuccess: refreshMessages });
  const simulateReply = trpc.devOutbox.simulateReply.useMutation({ onSuccess: refreshMessages });

  return (
    <main className="flex flex-1 flex-col gap-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Boîte d&apos;envoi (dev)</h1>
        <p className="text-muted">
          Messages « envoyés » par le fournisseur console — aucun opérateur WhatsApp/SMS/email réel
          n&apos;est contacté en local.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Messages (M11)</h2>
        {messageEntries.length === 0 ? (
          <p className="text-muted">Aucun message envoyé pour l&apos;instant.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {messageEntries.map((entry) => (
              <div
                key={entry.id}
                data-testid={`outbox-entry-${entry.channel}-${entry.to}`}
                className="rounded-md border p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-muted">
                  <span>{new Date(entry.sentAt).toLocaleString("fr-FR")}</span>
                  <span className="font-medium">
                    {entry.channel} · {entry.to} · {entry.status}
                    {entry.errorCode ? ` (${entry.errorCode})` : ""}
                  </span>
                </div>
                <p className="mt-2 text-sm">{entry.body}</p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      simulate.mutate({ providerMessageId: entry.id, outcome: "DELIVERED" })
                    }
                  >
                    Simuler livré
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      simulate.mutate({ providerMessageId: entry.id, outcome: "READ" })
                    }
                  >
                    Simuler lu
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() =>
                      simulate.mutate({
                        providerMessageId: entry.id,
                        outcome: "FAILED_NOT_ON_WHATSAPP",
                      })
                    }
                  >
                    Échec : numéro non WhatsApp
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() =>
                      simulate.mutate({ providerMessageId: entry.id, outcome: "FAILED_GENERIC" })
                    }
                  >
                    Échec générique
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      simulateReply.mutate({ providerMessageId: entry.id, body: "STOP" })
                    }
                  >
                    Simuler STOP
                  </Button>
                </div>

                <div className="mt-3 flex gap-2">
                  <input
                    className="min-h-11 flex-1 rounded-md border px-3 text-sm"
                    placeholder="Réponse entrante du client…"
                    value={replyDraft[entry.id] ?? ""}
                    onChange={(e) =>
                      setReplyDraft((prev) => ({ ...prev, [entry.id]: e.target.value }))
                    }
                  />
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const body = replyDraft[entry.id]?.trim();
                      if (!body) return;
                      simulateReply.mutate({ providerMessageId: entry.id, body });
                      setReplyDraft((prev) => ({ ...prev, [entry.id]: "" }));
                    }}
                  >
                    Simuler réponse
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Messages système (OTP, invitations…)</h2>
        {systemEntries.length === 0 ? (
          <p className="text-muted">Aucun message système pour l&apos;instant.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {systemEntries.map((entry) => (
              <div key={entry.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-muted">
                  <span>{new Date(entry.sentAt).toLocaleString("fr-FR")}</span>
                  <span className="font-medium">
                    {entry.channel} · {entry.to}
                  </span>
                </div>
                <p className="mt-1">{entry.body}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
