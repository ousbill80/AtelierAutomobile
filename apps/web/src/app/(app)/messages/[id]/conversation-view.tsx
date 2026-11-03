"use client";

// RG-M11 §7.1 : fil d'une conversation. On y voit aussi les envois automatiques (relances,
// reçus, documents) partis vers ce numéro ou cet email, pour que la réponse du client ait son
// contexte. Bulles datées, accusé de réception, zone de saisie en bas.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, Send } from "lucide-react";
import { Button } from "@atelieros/ui";
import { InboxSuggestions } from "@/components/ai/inbox-suggestions";
import { IntentBadge } from "@/components/ai/intent-badge";
import { DeliveryTicks } from "@/components/messaging/delivery-ticks";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/react";
import { CHANNEL_ICON } from "../conversation-list";
import { tm } from "../labels";
import { AssigneePicker } from "./assignee-picker";

type Channel = "WHATSAPP" | "SMS" | "EMAIL";

function dayLabel(d: Date, now: Date): string {
  const key = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (key(d) === key(now)) return tm("today");
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (key(d) === key(yesterday)) return tm("yesterday");
  const label = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function ConversationView({ conversationId }: { conversationId: string }) {
  const [body, setBody] = useState("");
  const [now] = useState(() => new Date());
  const endRef = useRef<HTMLDivElement>(null);

  const utils = trpc.useUtils();
  const { data, isLoading, isError, refetch } = trpc.messaging.conversations.get.useQuery({
    id: conversationId,
  });
  const { mutate: markRead } = trpc.messaging.conversations.markRead.useMutation({
    onSuccess: () => void utils.messaging.conversations.list.invalidate(),
  });
  const reply = trpc.messaging.conversations.reply.useMutation({
    onSuccess: () => {
      setBody("");
      void utils.messaging.conversations.get.invalidate({ id: conversationId });
      void utils.messaging.conversations.list.invalidate();
    },
  });

  useEffect(() => {
    markRead({ conversationId });
  }, [conversationId, markRead]);

  const count = data?.messages.length ?? 0;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [count]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3" aria-hidden>
        <div className="h-14 animate-pulse rounded-lg bg-surface-2" />
        <div className="h-64 animate-pulse rounded-lg bg-surface-2" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg border border-status-bad bg-status-bad-bg p-4">
        <p className="text-sm text-status-bad">{tm("conversation.notFound")}</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => refetch()}>
            {tm("retry")}
          </Button>
          <Link href="/messages" className="btn btn-ghost min-h-11">
            {tm("conversation.back")}
          </Link>
        </div>
      </div>
    );
  }

  const { conversation } = data;
  const channel = conversation.channel as Channel;
  const Icon = CHANNEL_ICON[channel];
  const windowOpen =
    data.windowExpiresAt != null && new Date(data.windowExpiresAt).getTime() > now.getTime();
  const name = conversation.customer?.displayName ?? conversation.externalAddress;

  // Séparateur de jour devant le premier message de chaque journée.
  const dayOf = data.messages.map((m) => dayLabel(new Date(m.sentAt ?? m.createdAt), now));

  return (
    <div className="flex w-full min-w-0 flex-col gap-3 pb-6">
      <header className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2">
        <Link
          href="/messages"
          aria-label={tm("conversation.back")}
          className="inline-flex size-11 items-center justify-center rounded-md hover:bg-surface-2"
        >
          <ArrowLeft size={18} aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">
            {conversation.customer ? (
              <Link href={`/clients/${conversation.customer.id}`} className="hover:underline">
                {name}
              </Link>
            ) : (
              name
            )}
          </h1>
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <Icon size={14} aria-hidden />
            {tm(`channels.${channel}`)} · {conversation.externalAddress}
          </p>
        </div>
        <IntentBadge intent={conversation.lastIntent} />
        {channel === "WHATSAPP" && (
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${windowOpen ? "bg-status-ok-bg text-status-ok" : "bg-surface-2 text-muted"}`}
          >
            {windowOpen ? tm("conversation.windowOpen") : tm("conversation.windowClosed")}
          </span>
        )}
        <div className="w-full border-t border-border pt-2">
          <AssigneePicker conversationId={conversationId} assignee={conversation.assignee} />
        </div>
      </header>

      <div className="flex min-h-64 flex-col gap-2 rounded-xl border border-border bg-surface-2/50 p-3 sm:p-4">
        {data.truncated && (
          <p className="text-center text-xs text-muted">{tm("conversation.truncated")}</p>
        )}
        {data.messages.length === 0 && (
          <p className="m-auto text-sm text-muted">{tm("conversation.empty")}</p>
        )}
        {data.messages.map((message, index) => {
          const at = new Date(message.sentAt ?? message.createdAt);
          const day = dayOf[index]!;
          const showDay = index === 0 || dayOf[index - 1] !== day;
          const outbound = message.direction === "OUTBOUND";
          const automatic = outbound && !message.sentById;
          return (
            <div key={message.id} className="flex flex-col gap-2">
              {showDay && (
                <span className="self-center rounded-full bg-surface px-3 py-0.5 text-xs text-muted shadow-sm">
                  {day}
                </span>
              )}
              <div
                className={`flex max-w-[85%] flex-col gap-1 rounded-2xl px-3 py-2 text-sm shadow-sm sm:max-w-[70%] ${
                  outbound
                    ? `self-end rounded-br-sm ${automatic ? "border border-border bg-surface" : "bg-accent/10"}`
                    : "self-start rounded-bl-sm bg-surface"
                }`}
              >
                {automatic && (
                  <span className="flex items-center gap-1 text-xs font-medium text-muted">
                    <Bot size={12} aria-hidden />
                    {message.reminderType
                      ? tm("conversation.autoReminder", {
                          type: t(`reminders.types.${message.reminderType}`),
                        })
                      : tm("conversation.auto")}
                  </span>
                )}
                {message.subject && <span className="font-semibold">{message.subject}</span>}
                <p className="break-words whitespace-pre-wrap">{message.body}</p>
                <span className="flex items-center justify-end gap-2 text-[11px] text-muted">
                  {at.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                  {outbound && <DeliveryTicks state={message.delivery} compact />}
                </span>
                {message.status === "FAILED" && (message.errorMessage || message.errorCode) && (
                  <span className="text-xs text-status-bad">
                    {message.errorMessage ?? message.errorCode}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {channel === "WHATSAPP" && !windowOpen && (
        <p className="rounded-md bg-status-warn-bg px-3 py-2 text-sm text-status-warn">
          {tm("conversation.windowClosedHint")}
        </p>
      )}

      {/* M17 §7 : suggestions sous le dernier message entrant (rien n'est envoyé sans clic). */}
      <InboxSuggestions conversationId={conversationId} />

      <form
        className="sticky bottom-[calc(var(--bottom-nav-offset,0px)+0.5rem)] flex items-end gap-2 rounded-xl border border-border bg-surface p-2 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) reply.mutate({ conversationId, body: body.trim() });
        }}
      >
        <textarea
          rows={1}
          className="max-h-40 min-h-11 flex-1 resize-y rounded-md border-0 bg-transparent px-2 py-2.5 text-sm focus:outline-none"
          placeholder={tm("conversation.placeholder")}
          aria-label={tm("conversation.placeholder")}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (body.trim()) reply.mutate({ conversationId, body: body.trim() });
            }
          }}
        />
        <Button
          type="submit"
          className="min-h-11"
          disabled={!body.trim() || reply.isPending}
          aria-label={tm("conversation.send")}
        >
          <Send size={16} aria-hidden />
          <span className="hidden sm:inline">{tm("conversation.send")}</span>
        </Button>
      </form>
      {reply.error && <p className="text-sm text-status-bad">{reply.error.message}</p>}
    </div>
  );
}
