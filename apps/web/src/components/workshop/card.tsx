"use client";

// US-M06-01 — carte d'OR du kanban atelier : n°, plaque, véhicule, client, mécaniciens,
// avancement, date promise, badges (priorité, pièces manquantes, sous-traitance), retard.
import Link from "next/link";
import { AlertTriangle, Clock, Handshake, PackageX, Wrench } from "lucide-react";
import { PlateBadge, StatusBadge } from "@atelieros/ui";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { formatDuration, initials, tw } from "./i18n";
import type { WorkshopCard } from "./types";

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
      className={`flex min-w-0 flex-col gap-2 rounded-lg border bg-surface p-3 shadow-sm ${
        card.lateness.late ? "border-status-bad" : "border-border"
      }`}
    >
      {card.lateness.late ? (
        <div className="-mx-3 -mt-3 flex items-center gap-1 rounded-t-lg bg-status-bad px-3 py-1 text-xs font-semibold text-white">
          <Clock className="size-3.5" aria-hidden />
          {tw("board.late", { duration: formatDuration(card.lateness.lateMinutes) })}
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <Link href={`/ordres/${card.id}`} className="text-sm font-semibold hover:underline">
          {card.number}
        </Link>
        <PlateBadge plate={card.plate} />
      </div>
      <p className="truncate text-sm">{card.vehicle}</p>
      <p className="truncate text-xs text-muted">{card.customerName}</p>
      <div className="flex flex-wrap items-center gap-1" aria-label={tw("board.mechanicsLabel")}>
        {card.mechanics.length === 0 ? (
          <span className="text-xs text-muted">{tw("board.noMechanic")}</span>
        ) : (
          card.mechanics.map((m) => (
            <span
              key={m.id}
              title={m.name}
              className="inline-flex size-7 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold"
            >
              {initials(m.name)}
            </span>
          ))
        )}
        <span className="ml-auto text-xs font-medium">
          {tw("board.progress", { done: card.progress.done, total: card.progress.total })}
        </span>
      </div>
      <p className="text-xs text-muted">
        {card.promisedAt
          ? tw("board.promised", { date: formatDateTime(card.promisedAt, timeZone) })
          : tw("board.noPromise")}
      </p>
      <div className="flex flex-wrap gap-1">
        {card.priority === "HIGH" || card.priority === "URGENT" ? (
          <StatusBadge tone={card.priority === "URGENT" ? "bad" : "warn"}>
            <AlertTriangle className="size-3" aria-hidden />
            {tw(`priorityLabels.${card.priority}`)}
          </StatusBadge>
        ) : null}
        {card.lateness.atRisk ? (
          <StatusBadge tone="warn">
            <Clock className="size-3" aria-hidden />
            {tw("board.atRisk")}
          </StatusBadge>
        ) : null}
        {card.badges.missingParts ? (
          <StatusBadge tone="bad">
            <PackageX className="size-3" aria-hidden />
            {tw("board.missingParts")}
          </StatusBadge>
        ) : null}
        {card.badges.subcontract ? (
          <StatusBadge tone="off">
            <Handshake className="size-3" aria-hidden />
            {tw("board.subcontract")}
          </StatusBadge>
        ) : null}
        {card.activeMechanics.length > 0 ? (
          <StatusBadge tone="ok">
            <Wrench className="size-3" aria-hidden />
            {card.activeMechanics.map((m) => initials(m.name)).join(", ")}
          </StatusBadge>
        ) : null}
      </div>
      {footer}
    </article>
  );
}
