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
    return <span className="text-xs text-muted">↗ {L.variation.new}</span>;
  }
  const { pct } = variation;
  if (pct === 0) return <span className="text-xs text-muted">→ {L.variation.flat}</span>;
  const up = pct > 0;
  return (
    <span className={`text-xs ${up ? "text-status-ok" : "text-status-bad"}`}>
      {up ? "▲" : "▼"} {fmt(up ? L.variation.up : L.variation.down, { pct: Math.abs(pct) })}
    </span>
  );
}

/** Info-bulle « Comment est-ce calculé ? » : survol (title) et texte lu par les lecteurs d'écran. */
export function HelpTip({ text }: { text: string }) {
  return (
    <span title={text} className="cursor-help">
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
}: {
  label: string;
  value: string;
  sub?: string;
  variation?: Variation;
  help?: string;
  href?: string;
  badge?: string;
}) {
  const content = (
    <>
      <span className="flex items-start justify-between gap-1 text-xs font-medium text-muted">
        {label}
        {help && <HelpTip text={help} />}
      </span>
      <KpiValue value={value} />
      {sub && <span className="text-xs text-muted">{sub}</span>}
      {variation && <VariationText variation={variation} />}
      {badge && (
        <span className="w-fit">
          <StatusBadge tone="warn">{badge}</StatusBadge>
        </span>
      )}
    </>
  );
  const className =
    "flex min-h-28 min-w-0 flex-col gap-1.5 break-words rounded-xl border border-border bg-surface p-4 shadow-sm";
  return href ? (
    <Link
      href={href}
      className={`${className} transition-colors hover:border-accent/40 hover:bg-surface-2`}
      data-testid="kpi-card"
    >
      {content}
    </Link>
  ) : (
    <div className={className} data-testid="kpi-card">
      {content}
    </div>
  );
}

/** Valeur d'une carte : chiffre en grand, unité « FCFA » plus petite (le texte reste « 185 000 FCFA »). */
function KpiValue({ value }: { value: string }) {
  const unit = value.endsWith(" FCFA") ? "FCFA" : null;
  const figure = unit ? value.slice(0, -" FCFA".length) : value;
  return (
    <span className="text-2xl font-bold leading-tight tracking-tight sm:text-[28px]">
      {figure}
      {unit && (
        <>
          {" "}
          <span className="text-xs font-semibold text-muted">{unit}</span>
        </>
      )}
    </span>
  );
}

export function Stat({ label, value, tone }: { label: string; value: number; tone?: StatusTone }) {
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-xl font-bold">
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
    <section className="min-w-0 rounded-xl border border-border bg-surface p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1 text-base font-semibold">
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
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.key} className="flex flex-col gap-1 text-sm">
          <span className="flex justify-between gap-2">
            <span className="min-w-0 truncate">{item.label}</span>
            <span className="shrink-0 font-medium">{format(item.value)}</span>
          </span>
          <span className="h-1.5 rounded-full bg-surface-2" aria-hidden="true">
            <span
              className="block h-full rounded-full bg-accent"
              style={{ width: `${(Math.abs(item.value) / max) * 100}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Ligne de liste cliquable (≥ 44 px) : titre, sous-titre, élément à droite. */
export function ListRow({
  href,
  title,
  sub,
  right,
}: {
  href?: string;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
}) {
  const content = (
    <>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-medium">{title}</span>
        {sub && <span className="truncate text-xs text-muted">{sub}</span>}
      </span>
      {right && <span className="shrink-0 text-right">{right}</span>}
    </>
  );
  const className = "flex min-h-12 items-center justify-between gap-3 py-2 text-sm";
  return (
    <li>
      {href ? (
        <Link
          href={href}
          className={`${className} -mx-2 rounded-md px-2 transition-colors hover:bg-surface-2`}
        >
          {content}
        </Link>
      ) : (
        <div className={className}>{content}</div>
      )}
    </li>
  );
}

/** Texte d'état vide d'un bloc. */
export function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg bg-surface-2 px-3 py-4 text-center text-sm text-muted">{children}</p>
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
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-surface-2" />
        ))}
      </div>
      <div className="h-56 animate-pulse rounded-xl bg-surface-2" />
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
