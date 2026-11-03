"use client";

// US-M06-01 — carte d'OR du kanban atelier : n°, plaque, véhicule, client, mécaniciens,
// avancement, date promise, badges (priorité, pièces manquantes, sous-traitance), retard.
import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, Clock, Handshake, PackageX, Wrench, type LucideIcon } from "lucide-react";
import { PlateBadge } from "@atelieros/ui";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { formatDuration, initials, tw } from "./i18n";
import type { WorkshopCard } from "./types";

function CardFlag({
  tone,
  icon: Icon,
  children,
}: {
  tone: "bad" | "warn" | "off" | "ok";
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  const toneClass = {
    bad: "bg-status-bad-bg text-status-bad",
    warn: "bg-status-warn-bg text-status-warn",
    off: "bg-status-off-bg text-status-off",
    ok: "bg-status-ok-bg text-status-ok",
  }[tone];
  return (
    <p
      className={`flex w-full min-w-0 items-start gap-1 rounded-md px-1.5 py-1 text-xs font-medium leading-snug ${toneClass}`}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export function OrderCard({
  card,
  timeZone,
  footer,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  card: WorkshopCard;
  timeZone: string;
  footer?: React.ReactNode;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const [nowMs] = useState(() => Date.now());
  return (
    <article
      data-testid={`ro-card-${card.number}`}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", card.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.();
      }}
      onDragEnd={onDragEnd}
      className={`flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-lg border bg-surface p-2 shadow-sm ${
        card.lateness.late ? "border-status-bad" : "border-border"
      }`}
    >
      {card.lateness.late ? (
        <div className="-mx-2 -mt-2 flex min-w-0 items-start gap-1 rounded-t-lg bg-status-bad px-2 py-1 text-xs font-semibold leading-snug text-white">
          <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0">
            {tw("board.late", { duration: formatDuration(card.lateness.lateMinutes) })}
          </span>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col items-start gap-1">
        <PlateBadge plate={card.plate} />
        <Link
          href={`/ordres/${card.id}`}
          className="max-w-full font-mono text-[10px] font-semibold leading-tight break-all hover:underline"
        >
          {card.number}
        </Link>
      </div>
      <div>
        <p className="truncate text-sm font-medium">{card.vehicle}</p>
        <p className="truncate text-xs text-muted">{card.customerName}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-1" aria-label={tw("board.mechanicsLabel")}>
        {card.mechanics.length === 0 ? (
          <span className="text-xs text-muted">{tw("board.noMechanic")}</span>
        ) : (
          <div className="flex items-center gap-1">
            {card.mechanics.map((m) => (
              <span
                key={m.id}
                title={m.name}
                className="inline-flex size-7 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold"
              >
                {initials(m.name)}
              </span>
            ))}
          </div>
        )}
        {card.progress.total > 0 ? (
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[11px] font-medium tabular-nums">
              {tw("board.progress", { done: card.progress.done, total: card.progress.total })}
            </span>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div
                className={`h-full ${card.progress.done === card.progress.total ? "bg-status-ok" : "bg-accent"}`}
                style={{
                  width: `${Math.round((card.progress.done / card.progress.total) * 100)}%`,
                }}
              />
            </div>
          </div>
        ) : null}
      </div>
      <p
        className={`break-words text-xs ${
          card.lateness.late
            ? "font-medium text-status-bad"
            : card.promisedAt && new Date(card.promisedAt).getTime() < nowMs
              ? "font-medium text-status-warn"
              : "text-muted"
        }`}
      >
        {card.promisedAt
          ? tw("board.promised", { date: formatDateTime(card.promisedAt, timeZone) })
          : tw("board.noPromise")}
      </p>
      <div className="flex w-full min-w-0 flex-col gap-1">
        {card.priority === "HIGH" || card.priority === "URGENT" ? (
          <CardFlag tone={card.priority === "URGENT" ? "bad" : "warn"} icon={AlertTriangle}>
            {tw(`priorityLabels.${card.priority}`)}
          </CardFlag>
        ) : null}
        {card.lateness.atRisk ? (
          <CardFlag tone="warn" icon={Clock}>
            {tw("board.atRisk")}
          </CardFlag>
        ) : null}
        {card.badges.missingParts ? (
          <CardFlag tone="bad" icon={PackageX}>
            {tw("board.missingParts")}
          </CardFlag>
        ) : null}
        {card.badges.subcontract ? (
          <CardFlag tone="off" icon={Handshake}>
            {tw("board.subcontract")}
          </CardFlag>
        ) : null}
        {card.activeMechanics.length > 0 ? (
          <CardFlag tone="ok" icon={Wrench}>
            {card.activeMechanics.map((m) => initials(m.name)).join(", ")}
          </CardFlag>
        ) : null}
      </div>
      {footer}
    </article>
  );
}
