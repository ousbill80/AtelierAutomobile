"use client";

import Link from "next/link";
import { AlertTriangle, Bell, CircleAlert, Info } from "lucide-react";
import { t } from "@/i18n/t";
import { relativeTime } from "./format";

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  severity: string | null;
  readAt: Date | string | null;
  createdAt: Date | string;
}

function SeverityIcon({ severity }: { severity: string | null }) {
  if (severity === "critical")
    return <CircleAlert size={18} className="text-status-bad" aria-hidden />;
  if (severity === "warning")
    return <AlertTriangle size={18} className="text-status-warn" aria-hidden />;
  if (severity === "info") return <Info size={18} className="text-accent" aria-hidden />;
  return <Bell size={18} className="text-muted" aria-hidden />;
}

export function NotificationItem({
  notification,
  now,
  onOpen,
}: {
  notification: NotificationRow;
  now: number;
  onOpen: (notification: NotificationRow) => void;
}) {
  const unread = notification.readAt == null;
  const content = (
    <>
      <span className="mt-0.5 shrink-0">
        <SeverityIcon severity={notification.severity} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`text-sm ${unread ? "font-semibold" : "font-medium text-muted"}`}>
          {notification.title}
        </span>
        {notification.body ? (
          <span className="line-clamp-2 text-xs text-muted">{notification.body}</span>
        ) : null}
        <span className="text-[11px] text-muted">{relativeTime(notification.createdAt, now)}</span>
      </span>
      {unread ? (
        <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-accent">
          <span className="sr-only">{t("notifications.unread")}</span>
        </span>
      ) : null}
    </>
  );
  const className = `flex min-h-14 w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-2 ${
    unread ? "bg-accent/5" : ""
  }`;
  return notification.link ? (
    <Link href={notification.link} className={className} onClick={() => onOpen(notification)}>
      {content}
    </Link>
  ) : (
    <button type="button" className={className} onClick={() => onOpen(notification)}>
      {content}
    </button>
  );
}
