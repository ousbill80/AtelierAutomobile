"use client";

// Cloche de la barre du haut : pastille du nombre de notifications non lues, panneau des
// dernières notifications. Rafraîchie chaque minute, au retour sur l'onglet et dès qu'une
// notification push arrive (message du service worker).
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { unreadBadge } from "@atelieros/core/notifications";
import { trpc } from "@/trpc/client";
import { t } from "@/i18n/t";
import { NotificationItem, type NotificationRow } from "./notification-item";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const wrapRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();
  const unread = trpc.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const list = trpc.notifications.list.useQuery({ limit: 8 }, { enabled: open });
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      void utils.notifications.unreadCount.invalidate();
      void utils.notifications.list.invalidate();
    },
  });
  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      void utils.notifications.unreadCount.invalidate();
      void utils.notifications.list.invalidate();
    },
  });

  // Une notification push reçue pendant que l'application est ouverte : on rafraîchit.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === "notification:received") {
        void utils.notifications.unreadCount.invalidate();
        void utils.notifications.list.invalidate();
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [utils]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = unread.data?.count ?? 0;
  const badge = unreadBadge(count);

  function openNotification(notification: NotificationRow) {
    if (notification.readAt == null) markRead.mutate({ ids: [notification.id] });
    setOpen(false);
  }

  return (
    <div className="dropdown-wrap" ref={wrapRef}>
      <button
        type="button"
        className="icon-btn"
        aria-label={count > 0 ? t("notifications.bellUnread", { count }) : t("notifications.bell")}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setNow(Date.now());
          setOpen((v) => !v);
        }}
      >
        <Bell size={20} aria-hidden />
        {badge ? (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-surface bg-status-bad px-1 text-[10px] font-bold text-white"
          >
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={t("notifications.title")}
          className="fixed inset-x-2 top-[calc(var(--topbar-h)+4px)] z-50 flex max-h-[75vh] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-96"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
            <h2 className="text-sm font-semibold">{t("notifications.title")}</h2>
            {count > 0 ? (
              <button
                type="button"
                className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-accent"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
              >
                <CheckCheck size={14} aria-hidden />
                {t("notifications.markAllRead")}
              </button>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {list.isLoading ? (
              <div className="flex flex-col gap-2 p-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-md bg-surface-2" />
                ))}
              </div>
            ) : list.isError ? (
              <div className="flex flex-col items-start gap-2 p-4">
                <p className="text-sm text-status-bad">{t("notifications.loadError")}</p>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm min-h-11"
                  onClick={() => list.refetch()}
                >
                  {t("notifications.retry")}
                </button>
              </div>
            ) : list.data && list.data.items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <Bell size={28} className="text-muted" aria-hidden />
                <p className="text-sm font-medium">{t("notifications.emptyTitle")}</p>
                <p className="text-xs text-muted">{t("notifications.emptyHint")}</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {list.data?.items.map((notification) => (
                  <li key={notification.id}>
                    <NotificationItem
                      notification={notification}
                      now={now}
                      onOpen={openNotification}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center justify-center border-t border-border text-sm font-medium text-accent hover:bg-surface-2"
          >
            {t("notifications.seeAll")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
