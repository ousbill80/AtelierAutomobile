"use client";

// Centre de notifications : toutes les alertes du membre (relances, créances, atelier,
// devis…), filtre « non lues », réglage des notifications push et installation de l'appli.
import { useState } from "react";
import { Bell, CheckCheck, Smartphone } from "lucide-react";
import { Button, EmptyState } from "@atelieros/ui";
import { trpc } from "@/trpc/client";
import { t } from "@/i18n/t";
import {
  NotificationItem,
  type NotificationRow,
} from "@/components/notifications/notification-item";
import { PushCard } from "@/components/pwa/push-card";
import { InstallCard } from "@/components/pwa/install-card";

type Filter = "all" | "unread";

export default function NotificationsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [now] = useState(() => Date.now());
  const utils = trpc.useUtils();
  const unread = trpc.notifications.unreadCount.useQuery();
  const list = trpc.notifications.list.useInfiniteQuery(
    { limit: 20, unreadOnly: filter === "unread" },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  const invalidate = () => {
    void utils.notifications.unreadCount.invalidate();
    void utils.notifications.list.invalidate();
  };
  const markRead = trpc.notifications.markRead.useMutation({ onSuccess: invalidate });
  const markAllRead = trpc.notifications.markAllRead.useMutation({ onSuccess: invalidate });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const count = unread.data?.count ?? 0;

  function open(notification: NotificationRow) {
    if (notification.readAt == null) markRead.mutate({ ids: [notification.id] });
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("notifications.title")}</h1>
          <p className="text-sm text-muted">
            {count > 0
              ? t(count > 1 ? "notifications.unreadMany" : "notifications.unreadOne", { count })
              : t("notifications.allRead")}
          </p>
        </div>
        {count > 0 ? (
          <Button
            variant="secondary"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
          >
            <CheckCheck size={16} aria-hidden />
            {t("notifications.markAllRead")}
          </Button>
        ) : null}
      </header>

      <div role="group" aria-label={t("notifications.filterLabel")} className="flex gap-2 text-sm">
        {(["all", "unread"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={`min-h-11 rounded-md px-4 ${filter === value ? "bg-accent text-accent-foreground" : "bg-surface-2"}`}
          >
            {t(`notifications.filters.${value}`)}
          </button>
        ))}
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        {list.isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-md bg-surface-2" />
            ))}
          </div>
        ) : list.isError ? (
          <div className="flex flex-col items-start gap-2 p-4">
            <p className="text-sm text-status-bad">{t("notifications.loadError")}</p>
            <Button variant="secondary" onClick={() => list.refetch()}>
              {t("notifications.retry")}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Bell size={28} aria-hidden />}
            title={
              filter === "unread" ? t("notifications.emptyUnread") : t("notifications.emptyTitle")
            }
            description={t("notifications.emptyHint")}
          />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((notification) => (
              <li key={notification.id}>
                <NotificationItem notification={notification} now={now} onOpen={open} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {list.hasNextPage ? (
        <Button
          variant="secondary"
          onClick={() => list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
        >
          {t("notifications.loadMore")}
        </Button>
      ) : null}

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <Bell size={18} aria-hidden /> {t("pwa.push.title")}
        </h2>
        <p className="text-sm text-muted">{t("pwa.push.description")}</p>
        <PushCard />
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <Smartphone size={18} aria-hidden /> {t("pwa.install.title")}
        </h2>
        <InstallCard />
      </section>
    </div>
  );
}
