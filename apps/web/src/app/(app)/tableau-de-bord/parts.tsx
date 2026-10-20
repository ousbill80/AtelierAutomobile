"use client";

// Briques d'affichage du tableau de bord (M12 §7) : cartes KPI (valeur, variation avec flèche
// et texte, info-bulle « Comment est-ce calculé ? »), sections, graphiques accessibles (texte
// et valeurs toujours affichés, jamais la couleur seule), états chargement / erreur.
import type { ReactNode } from "react";
import Link from "next/link";
import { Button, EmptyState, StatusBadge, type StatusTone } from "@atelieros/ui";
import { fmt, formatAmount, formatDay, L } from "./labels";

export type Variation = { kind: "pct"; pct: number } | { kind: "new" } | { kind: "none" };

/** Taux (0..1) → « 45,7 % » ; null → « — » (RG-M12-04). */
export function formatPct(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return L.dash;
  return `${(rate * 100).toFixed(1).replace(".", ",")} %`;
}

export function VariationText({ variation }: { variation: Variation }) {
  if (variation.kind === "none") return null;
  if (variation.kind === "new") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
        ↗ {L.variation.new}
      </span>
    );
  }
  const { pct } = variation;
  if (pct === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
        → {L.variation.flat}
      </span>
    );
  }
  const up = pct > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        up ? "bg-status-ok-bg text-status-ok" : "bg-status-bad-bg text-status-bad"
      }`}
    >
      {up ? "▲" : "▼"} {fmt(up ? L.variation.up : L.variation.down, { pct: Math.abs(pct) })}
    </span>
  );
}

/** Info-bulle « Comment est-ce calculé ? » : survol (title) et texte lu par les lecteurs d'écran. */
export function HelpTip({ text }: { text: string }) {
  return (
    <span title={text} className="cursor-help text-muted hover:text-foreground">
      <span aria-hidden="true">ⓘ</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  variation,
  help,
  href,
  badge,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  variation?: Variation;
  help?: string;
  href?: string;
  badge?: string;
  icon?: ReactNode;
}) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1 text-xs font-medium text-muted">
          {label}
          {help && <HelpTip text={help} />}
        </span>
        {icon && (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
            {icon}
          </span>
        )}
      </div>
      <div className="my-1 flex items-baseline gap-2">
        <span className="text-xl font-bold tracking-tight sm:text-2xl">{value}</span>
      </div>
      {(sub || variation || badge) && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {variation && <VariationText variation={variation} />}
          {badge && (
            <span className="w-fit">
              <StatusBadge tone="warn">{badge}</StatusBadge>
            </span>
          )}
          {sub && <span className="text-xs text-muted">{sub}</span>}
        </div>
      )}
    </>
  );
  const className =
    "flex min-h-24 min-w-0 flex-col justify-between gap-1 break-words rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm transition-all hover:border-accent/40 hover:shadow-md";
  return href ? (
    <Link href={href} className={`${className} hover:bg-surface-2/60`} data-testid="kpi-card">
      {content}
    </Link>
  ) : (
    <div className={className} data-testid="kpi-card">
      {content}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: number; tone?: StatusTone }) {
  return (
    <div className="rounded-md bg-surface-2 p-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-lg font-semibold">
        {tone ? <StatusBadge tone={tone}>{value}</StatusBadge> : value}
      </dd>
    </div>
  );
}

export function Section({
  title,
  help,
  action,
  children,
}: {
  title: string;
  help?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1 font-semibold">
          {title}
          {help && (
            <span className="text-xs text-muted">
              <HelpTip text={help} />
            </span>
          )}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Barres horizontales : libellé et valeur toujours écrits, la barre n'est qu'un appui visuel. */
export function BarList({
  items,
  format = formatAmount,
}: {
  items: { key: string; label: string; value: number }[];
  format?: (value: number) => string;
}) {
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.key} className="grid grid-cols-[7rem_1fr] items-center gap-2 text-xs">
          <span className="truncate text-muted">{item.label}</span>
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="h-3 shrink-0 rounded bg-accent"
              style={{ width: `${(Math.abs(item.value) / max) * 55}%` }}
              aria-hidden="true"
            />
            <span className="font-medium">{format(item.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * CA HT par jour (barres) vs période précédente (trait) — M12 §7. Sur mobile, 7 points au
 * plus (derniers jours). Accessible : chaque jour est décrit dans la liste lue par les
 * lecteurs d'écran, la légende distingue les séries par la forme (barre / trait).
 */
export function DailyChart({
  points,
}: {
  points: { day: string; ht: number; previousHt: number | null }[];
}) {
  const render = (data: typeof points, className: string) => {
    const max = Math.max(...data.flatMap((p) => [p.ht, p.previousHt ?? 0]), 1);
    return (
      <div className={className}>
        <div className="flex h-32 items-end gap-1" aria-hidden="true">
          {data.map((p) => (
            <div key={p.day} className="relative flex h-full min-w-0 flex-1 items-end">
              <div
                className="w-full rounded-t bg-accent"
                style={{ height: `${(Math.max(0, p.ht) / max) * 100}%` }}
              />
              {p.previousHt !== null && (
                <div
                  className="absolute inset-x-0 border-t-2 border-dashed border-foreground"
                  style={{ bottom: `${(Math.max(0, p.previousHt) / max) * 100}%` }}
                />
              )}
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted" aria-hidden="true">
          <span>{formatDay(data[0]?.day ?? "")}</span>
          <span>{formatDay(data[data.length - 1]?.day ?? "")}</span>
        </div>
      </div>
    );
  };
  return (
    <figure className="min-w-0">
      {render(points.slice(-7), "sm:hidden")}
      {render(points, "hidden sm:block")}
      <figcaption className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm bg-accent" aria-hidden="true" />
          {L.summary.dailyCurrent}
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block w-4 border-t-2 border-dashed border-foreground"
            aria-hidden="true"
          />
          {L.summary.dailyPrevious}
        </span>
      </figcaption>
      <ul className="sr-only">
        {points.map((p) => (
          <li key={p.day}>
            {fmt(L.summary.dailyAria, {
              day: formatDay(p.day),
              current: formatAmount(p.ht),
              previous: p.previousHt === null ? L.dash : formatAmount(p.previousHt),
            })}
          </li>
        ))}
      </ul>
    </figure>
  );
}

export function CardsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-lg bg-surface-2" />
      ))}
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      title={L.states.error}
      action={
        <Button variant="secondary" onClick={onRetry}>
          {L.states.retry}
        </Button>
      }
    />
  );
}

/** Instant → `dd/MM/yyyy HH:mm` dans le fuseau de l'organisation. */
export function formatDateTime(value: Date | string | null | undefined, timeZone: string): string {
  if (!value) return L.dash;
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

/** Instant → `HH:mm` dans le fuseau de l'organisation. */
export function formatTime(value: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone, hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
}
