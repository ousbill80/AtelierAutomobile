"use client";

// Messages › Envois : tout ce qui est parti vers les clients (relances automatiques, reçus,
// documents, messages écrits à la main), avec l'accusé de réception de chacun. Les compteurs
// filtrent la liste (« Échecs », « Sans accusé »…) ; pagination « Charger plus ».
import { useState } from "react";
import Link from "next/link";
import {
  CheckCheck,
  Clock,
  MessageSquareText,
  Search,
  ShieldQuestion,
  TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button, EmptyState } from "@atelieros/ui";
import { DeliveryTicks } from "@/components/messaging/delivery-ticks";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/react";
import { CHANNEL_ICON } from "./conversation-list";
import { shortWhen, tm } from "./labels";

type Channel = "WHATSAPP" | "SMS" | "EMAIL";
type State = "PENDING" | "FAILED" | "UNCONFIRMED" | "DELIVERED" | "READ";
type Kind = "REMINDER" | "TRANSACTIONAL" | "CONVERSATION";

const STATES: { value: State; icon: LucideIcon; className: string }[] = [
  { value: "FAILED", icon: TriangleAlert, className: "text-status-bad" },
  { value: "UNCONFIRMED", icon: ShieldQuestion, className: "text-status-warn" },
  { value: "PENDING", icon: Clock, className: "text-muted" },
  { value: "DELIVERED", icon: CheckCheck, className: "text-foreground" },
  { value: "READ", icon: CheckCheck, className: "text-sky-600 dark:text-sky-400" },
];

function kindLabel(kind: string, reminderType: string | null): string {
  if (reminderType) {
    return tm("log.reminderOf", { type: t(`reminders.types.${reminderType}`) });
  }
  if (kind === "REMINDER") return tm("log.kinds.REMINDER");
  if (kind === "TRANSACTIONAL") return tm("log.kinds.TRANSACTIONAL");
  if (kind === "CONVERSATION") return tm("log.kinds.CONVERSATION");
  return tm("log.kinds.SYSTEM");
}

export function SentLog() {
  const [state, setState] = useState<State | "">("");
  const [channel, setChannel] = useState<Channel | "">("");
  const [kind, setKind] = useState<Kind | "">("");
  const [search, setSearch] = useState("");
  const [now] = useState(() => new Date());
  const q = search.trim().length >= 2 ? search.trim() : undefined;
  const log = trpc.messaging.log.useInfiniteQuery(
    {
      state: state || undefined,
      channel: channel || undefined,
      kind: kind || undefined,
      q,
      limit: 50,
    },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  const items = log.data?.pages.flatMap((p) => p.items) ?? [];
  const summary = log.data?.pages[0]?.summary ?? null;
  const filtered = Boolean(state || channel || kind || q);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {STATES.map(({ value, icon: Icon, className }) => {
          const active = state === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => setState(active ? "" : value)}
              className={`flex min-h-16 items-center gap-3 rounded-xl border bg-surface px-3 py-2 text-left hover:bg-surface-2 ${
                active ? "border-accent ring-1 ring-accent" : "border-border"
              }`}
              title={tm(`log.stateHelp.${value}`)}
            >
              <Icon size={18} className={`shrink-0 ${className}`} aria-hidden />
              <span className="min-w-0">
                <span className="tabular block text-xl leading-tight font-semibold">
                  {summary ? summary[value] : "—"}
                </span>
                <span className="block truncate text-xs text-muted">
                  {tm(`log.states.${value}`)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-56">
          <span className="sr-only">{tm("log.search")}</span>
          <Search
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tm("log.search")}
            className="min-h-11 w-full rounded-md border border-border bg-surface pr-3 pl-9 text-sm"
          />
        </label>
        <select
          aria-label={tm("log.kindLabel")}
          className="min-h-11 rounded-md border border-border bg-surface px-2 text-sm"
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind | "")}
        >
          <option value="">{tm("log.allKinds")}</option>
          {(["REMINDER", "TRANSACTIONAL", "CONVERSATION"] as const).map((k) => (
            <option key={k} value={k}>
              {tm(`log.kinds.${k}`)}
            </option>
          ))}
        </select>
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
        {filtered && (
          <Button
            variant="ghost"
            className="min-h-11"
            onClick={() => {
              setState("");
              setChannel("");
              setKind("");
              setSearch("");
            }}
          >
            {tm("log.reset")}
          </Button>
        )}
      </div>

      {log.isLoading ? (
        <div className="flex flex-col gap-2" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      ) : log.isError ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-status-bad bg-status-bad-bg p-4">
          <p className="text-sm text-status-bad">{tm("loadError")}</p>
          <Button variant="secondary" onClick={() => log.refetch()}>
            {tm("retry")}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={filtered ? tm("log.emptyFiltered") : tm("log.empty")}
          description={tm("log.emptyDescription")}
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {items.map((m) => {
            const Icon = CHANNEL_ICON[m.channel as Channel] ?? MessageSquareText;
            const href = m.conversationId
              ? `/messages/${m.conversationId}`
              : m.customer
                ? `/clients/${m.customer.id}`
                : null;
            return (
              <li
                key={m.id}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-4 py-3 text-sm"
              >
                <span className="mt-0.5 inline-flex size-8 items-center justify-center rounded-full bg-surface-2">
                  <Icon size={15} aria-label={tm(`channels.${m.channel}`)} />
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    {href ? (
                      <Link href={href} className="truncate font-medium hover:underline">
                        {m.customer?.displayName ?? m.to}
                      </Link>
                    ) : (
                      <span className="truncate font-medium">
                        {m.customer?.displayName ?? m.to}
                      </span>
                    )}
                    <span className="text-xs text-muted">
                      {kindLabel(m.kind, m.reminderType)}
                      {m.sentByName
                        ? ` · ${tm("log.by", { name: m.sentByName })}`
                        : ` · ${tm("log.auto")}`}
                    </span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-muted">
                    {m.subject ? (
                      <strong className="font-medium text-foreground">{m.subject} — </strong>
                    ) : null}
                    {m.preview}
                  </span>
                  {m.status === "FAILED" && m.errorMessage && (
                    <span className="mt-1 block text-xs text-status-bad">{m.errorMessage}</span>
                  )}
                </span>
                <span className="flex flex-col items-end gap-1 text-right">
                  <span className="text-xs text-muted">
                    {shortWhen(m.sentAt ?? m.createdAt, now)}
                  </span>
                  <DeliveryTicks state={m.delivery} />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {items.length > 0 && log.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          onClick={() => log.fetchNextPage()}
          disabled={log.isFetchingNextPage}
        >
          {log.isFetchingNextPage ? tm("loading") : tm("loadMore")}
        </Button>
      )}
    </div>
  );
}
