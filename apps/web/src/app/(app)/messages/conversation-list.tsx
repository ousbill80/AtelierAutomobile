"use client";

// Conversations avec les clients : dernier message, heure, non lus, canal ; recherche et
// filtres ; pagination « Charger plus ».
import { useState } from "react";
import Link from "next/link";
import { Mail, MessageCircle, MessageSquareText, Search, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button, EmptyState } from "@atelieros/ui";
import { DeliveryTicks } from "@/components/messaging/delivery-ticks";
import { IntentBadge } from "@/components/ai/intent-badge";
import { trpc } from "@/trpc/react";
import { shortWhen, tm } from "./labels";

type Filter = "ALL" | "UNREAD" | "ASSIGNED_TO_ME" | "UNASSIGNED";
type Channel = "WHATSAPP" | "SMS" | "EMAIL";

const FILTERS: [Filter, string][] = [
  ["ALL", "all"],
  ["UNREAD", "unread"],
  ["ASSIGNED_TO_ME", "assigned"],
  ["UNASSIGNED", "unassigned"],
];
export const CHANNEL_ICON: Record<Channel, LucideIcon> = {
  WHATSAPP: MessageCircle,
  SMS: MessageSquareText,
  EMAIL: Mail,
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function ConversationList() {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [channel, setChannel] = useState<Channel | "">("");
  const [search, setSearch] = useState("");
  const [now] = useState(() => new Date());
  const term = search.trim().length >= 2 ? search.trim() : undefined;
  const list = trpc.messaging.conversations.list.useInfiniteQuery(
    { filter, channel: channel || undefined, search: term, limit: 30 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const counts = list.data?.pages[0]?.counts ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={tm("filterLabel")}>
          {FILTERS.map(([value, key]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              title={
                value === "ASSIGNED_TO_ME" || value === "UNASSIGNED"
                  ? tm(`filterHelp.${value}`)
                  : undefined
              }
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm ${
                filter === value
                  ? "bg-accent text-accent-foreground"
                  : "bg-surface-2 text-foreground"
              }`}
            >
              {tm(key)}
              {counts && <span className="tabular text-xs opacity-80">{counts[value]}</span>}
            </button>
          ))}
        </div>
        <label className="relative min-w-0 flex-1 basis-56">
          <span className="sr-only">{tm("searchConversations")}</span>
          <Search
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tm("searchConversations")}
            className="min-h-11 w-full rounded-md border border-border bg-surface pr-3 pl-9 text-sm"
          />
        </label>
        <select
          aria-label={tm("channel")}
          className="min-h-11 rounded-md border border-border bg-surface px-2 text-sm"
          value={channel}
          onChange={(e) => setChannel(e.target.value as Channel | "")}
        >
          <option value="">{tm("allChannels")}</option>
          {(["WHATSAPP", "SMS", "EMAIL"] as const).map((c) => (
            <option key={c} value={c}>
              {tm(`channels.${c}`)}
            </option>
          ))}
        </select>
      </div>

      {list.isLoading ? (
        <div className="flex flex-col gap-2" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      ) : list.isError ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-status-bad bg-status-bad-bg p-4">
          <p className="text-sm text-status-bad">{tm("loadError")}</p>
          <Button variant="secondary" onClick={() => list.refetch()}>
            {tm("retry")}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={term || filter !== "ALL" || channel ? tm("emptyFiltered") : tm("emptyTitle")}
          description={tm("emptyDescription")}
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {items.map((conversation) => {
            const name = conversation.customer?.displayName ?? conversation.externalAddress;
            const Icon = CHANNEL_ICON[conversation.channel as Channel] ?? MessageSquareText;
            const unread = conversation.unreadCount > 0;
            const last = conversation.lastMessage;
            return (
              <li key={conversation.id}>
                <Link
                  href={`/messages/${conversation.id}`}
                  className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface-2"
                >
                  <span className="relative inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold">
                    {initials(name)}
                    <span className="absolute -right-1 -bottom-1 inline-flex size-5 items-center justify-center rounded-full border border-border bg-surface">
                      <Icon size={11} aria-label={tm(`channels.${conversation.channel}`)} />
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={`truncate ${unread ? "font-semibold" : "font-medium"}`}>
                        {name}
                      </span>
                      {last && (
                        <span
                          className={`shrink-0 text-xs ${unread ? "font-semibold text-accent" : "text-muted"}`}
                        >
                          {shortWhen(last.at, now)}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        className={`min-w-0 flex-1 truncate text-sm ${unread ? "text-foreground" : "text-muted"}`}
                      >
                        {last ? (
                          <>
                            {last.direction === "OUTBOUND" && (
                              <span className="mr-1 inline-flex align-middle">
                                <DeliveryTicks state={last.delivery} compact />
                              </span>
                            )}
                            {last.direction === "OUTBOUND" ? `${tm("you")} ` : ""}
                            {last.preview}
                          </>
                        ) : (
                          conversation.externalAddress
                        )}
                      </span>
                      <IntentBadge intent={conversation.lastIntent} />
                      {conversation.assignee && (
                        <span
                          className={`inline-flex max-w-28 shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                            conversation.assignee.isMe
                              ? "bg-accent/10 text-accent"
                              : "bg-surface-2 text-muted"
                          }`}
                          title={`${tm("assignee.label")} ${conversation.assignee.name}`}
                        >
                          <UserRound size={11} aria-hidden />
                          <span className="truncate">
                            {conversation.assignee.isMe
                              ? tm("assignee.byYou")
                              : conversation.assignee.name}
                          </span>
                        </span>
                      )}
                      {unread && (
                        <span
                          className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-foreground"
                          aria-label={tm(
                            conversation.unreadCount > 1 ? "unreadMany" : "unreadOne",
                            { count: conversation.unreadCount },
                          )}
                        >
                          {conversation.unreadCount}
                        </span>
                      )}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {list.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          onClick={() => list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
        >
          {list.isFetchingNextPage ? tm("loading") : tm("loadMore")}
        </Button>
      )}
    </div>
  );
}
