"use client";

// M17 §7 — carte « Suggestion » sous le dernier message entrant : brouillon de réponse
// (Envoyer / Modifier / Ignorer), créneaux proposés (Réserver), désinscription et promesse
// détectées. Rien n'est envoyé ni créé sans clic (RG-M17-02).
import Link from "next/link";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button } from "@atelieros/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/react";

interface SuggestionRow {
  id: string;
  feature: string;
  isFallback: boolean;
  payload: unknown;
}

function Header({ fallback }: { fallback: boolean }) {
  return (
    <p className="flex items-center gap-1 text-xs font-medium text-muted">
      <Sparkles aria-hidden className="h-3.5 w-3.5" />
      {fallback ? t("aiInbox.fallback") : t("aiInbox.proposedBy")}
    </p>
  );
}

export function InboxSuggestions({ conversationId }: { conversationId: string }) {
  const utils = trpc.useUtils();
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const status = trpc.ai.status.useQuery(undefined, { staleTime: 60_000 });
  const suggestions = trpc.ai.suggestion.listFor.useQuery({
    targetEntity: "conversation",
    targetId: conversationId,
  });
  const refresh = () => {
    void utils.ai.suggestion.listFor.invalidate({
      targetEntity: "conversation",
      targetId: conversationId,
    });
    void utils.messaging.conversations.get.invalidate({ id: conversationId });
  };
  const generate = trpc.ai.suggestReply.useMutation({ onSuccess: refresh });
  const accept = trpc.ai.suggestion.accept.useMutation({ onSuccess: refresh });
  const dismiss = trpc.ai.suggestion.dismiss.useMutation({ onSuccess: refresh });

  const rows = (suggestions.data ?? []) as SuggestionRow[];
  const replyAvailability = status.data?.reply_draft;
  const unavailable = replyAvailability && !replyAvailability.available ? replyAvailability : null;
  const error = accept.error ?? dismiss.error ?? generate.error;

  if (suggestions.isLoading || generate.isPending) {
    return (
      <div className="flex flex-col gap-2 rounded-md border p-4" aria-busy>
        <p className="text-sm text-muted">{t("aiInbox.preparing")}</p>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }

  const reply = rows.find((r) => r.feature === "reply_draft");
  const slot = rows.find((r) => r.feature === "slot");
  const optout = rows.find((r) => r.feature === "optout");
  const promise = rows.find((r) => r.feature === "promise");

  return (
    <div className="flex flex-col gap-3" data-testid="inbox-suggestions">
      {notice && (
        <p role="status" className="text-sm text-status-ok">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-status-bad">
          {t("aiInbox.error", { message: error.message })}
        </p>
      )}

      {slot && (
        <div className="flex flex-col gap-2 rounded-md border p-4" data-testid="slot-suggestion">
          <Header fallback={false} />
          <p className="font-medium">{t("aiInbox.slotsTitle")}</p>
          <div className="flex flex-wrap gap-2">
            {(slot.payload as { slots: { label: string }[] }).slots.map((s, index) => (
              <Button
                key={s.label}
                variant={index === 0 ? "primary" : "secondary"}
                className="min-h-11"
                loading={accept.isPending}
                onClick={() =>
                  accept.mutate(
                    { suggestionId: slot.id, editedPayload: { index } },
                    { onSuccess: () => setNotice(t("aiInbox.booked", { label: s.label })) },
                  )
                }
              >
                {t("aiInbox.book", { label: s.label })}
              </Button>
            ))}
          </div>
        </div>
      )}

      {reply && (
        <div className="flex flex-col gap-2 rounded-md border p-4" data-testid="reply-suggestion">
          <Header fallback={reply.isFallback} />
          <p className="font-medium">{t("aiInbox.draftTitle")}</p>
          {editing === reply.id ? (
            <textarea
              className="min-h-24 rounded-md border p-3 text-sm"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={t("aiInbox.draftTitle")}
            />
          ) : (
            <p className="whitespace-pre-wrap rounded-md bg-surface-2 p-3 text-sm">
              {(reply.payload as { body: string }).body}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-11"
              loading={accept.isPending}
              onClick={() =>
                accept.mutate(
                  {
                    suggestionId: reply.id,
                    editedPayload: editing === reply.id ? { body: draft } : undefined,
                  },
                  {
                    onSuccess: () => {
                      setEditing(null);
                      setNotice(t("aiInbox.sent"));
                    },
                  },
                )
              }
            >
              {t("aiInbox.send")}
            </Button>
            {editing === reply.id ? (
              <Button variant="secondary" className="min-h-11" onClick={() => setEditing(null)}>
                {t("aiInbox.cancelEdit")}
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="min-h-11"
                onClick={() => {
                  setDraft((reply.payload as { body: string }).body);
                  setEditing(reply.id);
                }}
              >
                {t("aiInbox.edit")}
              </Button>
            )}
            <Button
              variant="ghost"
              className="min-h-11"
              onClick={() => dismiss.mutate({ suggestionId: reply.id })}
            >
              {t("aiInbox.ignore")}
            </Button>
          </div>
        </div>
      )}

      {optout && (
        <div className="flex flex-col gap-2 rounded-md border p-4">
          <Header fallback={optout.isFallback} />
          <p className="text-sm">{t("aiInbox.optoutTitle")}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              className="min-h-11"
              onClick={() =>
                accept.mutate(
                  { suggestionId: optout.id },
                  { onSuccess: () => setNotice(t("aiInbox.optoutDone")) },
                )
              }
            >
              {t("aiInbox.optoutAccept")}
            </Button>
            <Button
              variant="ghost"
              className="min-h-11"
              onClick={() => dismiss.mutate({ suggestionId: optout.id })}
            >
              {t("aiInbox.ignore")}
            </Button>
          </div>
        </div>
      )}

      {promise && (
        <div className="flex flex-col gap-2 rounded-md border p-4">
          <Header fallback={promise.isFallback} />
          <p className="font-medium">{t("aiInbox.promiseTitle")}</p>
          {(() => {
            const p = promise.payload as {
              customerId: string;
              amount: number | null;
              promisedDate: string | null;
            };
            return (
              <>
                <p className="text-sm text-muted">
                  {t("aiInbox.promiseDetail", {
                    amount: p.amount ? formatFCFA(p.amount) : t("aiInbox.promiseUnknown"),
                    date: p.promisedDate
                      ? p.promisedDate.split("-").reverse().join("/")
                      : t("aiInbox.promiseUnknown"),
                  })}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/clients/${p.customerId}`}
                    className="btn btn-secondary min-h-11"
                    onClick={() => dismiss.mutate({ suggestionId: promise.id })}
                  >
                    {t("aiInbox.promiseOpen")}
                  </Link>
                  <Button
                    variant="ghost"
                    className="min-h-11"
                    onClick={() => dismiss.mutate({ suggestionId: promise.id })}
                  >
                    {t("aiInbox.ignore")}
                  </Button>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {!reply && (
        <div>
          <Button
            variant="secondary"
            className="min-h-11"
            disabled={!!unavailable}
            title={
              unavailable ? t("aiInbox.unavailable", { reason: unavailable.reason }) : undefined
            }
            onClick={() => generate.mutate({ conversationId })}
          >
            <Sparkles aria-hidden className="mr-1 h-4 w-4" />
            {t("aiInbox.suggestReply")}
          </Button>
          {unavailable && (
            <p className="mt-1 text-xs text-muted">
              {t("aiInbox.unavailable", { reason: unavailable.reason })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
