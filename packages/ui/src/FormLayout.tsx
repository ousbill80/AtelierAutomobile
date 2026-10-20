"use client";

import { useState, type ReactNode } from "react";
import { Button } from "./Button";

export interface FormCardProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  backHref?: string;
  onBack?: () => void;
  backLabel?: string;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "full";
  className?: string;
  children: ReactNode;
}

const MAX_WIDTH_CLASSES: Record<NonNullable<FormCardProps["maxWidth"]>, string> = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-2xl",
  xl: "max-w-3xl",
  "2xl": "max-w-4xl",
  full: "max-w-full",
};

/**
 * Conteneur de formulaire moderne et professionnel avec en-tête soigné :
 * - Lien ou bouton retour stylé
 * - Icône contextuelle dans un conteneur arrondi
 * - Titre et sous-titre explicatif
 * - Badge de statut (ex: Création, Modification, Brouillon)
 */
export function FormCard({
  title,
  description,
  icon,
  badge,
  backHref,
  onBack,
  backLabel = "Retour",
  maxWidth = "lg",
  className,
  children,
}: FormCardProps) {
  return (
    <div className={`mx-auto flex w-full flex-col gap-6 ${MAX_WIDTH_CLASSES[maxWidth]} ${className ?? ""}`}>
      {/* Bouton retour optionnel */}
      {(backHref || onBack) && (
        <div className="flex items-center">
          {backHref ? (
            <a
              href={backHref}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted transition-colors hover:text-foreground"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
              <span>{backLabel}</span>
            </a>
          ) : (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted transition-colors hover:text-foreground"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
              <span>{backLabel}</span>
            </button>
          )}
        </div>
      )}

      {/* Carte principale */}
      <div className="form-card rounded-2xl border border-border/70 bg-surface p-6 shadow-xs sm:p-8">
        {/* En-tête du formulaire */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-5">
          <div className="flex items-center gap-3">
            {icon ? (
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent shadow-xs">
                {icon}
              </div>
            ) : null}
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{title}</h1>
                {badge}
              </div>
              {description ? <p className="mt-0.5 text-xs text-muted sm:text-sm">{description}</p> : null}
            </div>
          </div>
        </div>

        {/* Corps du formulaire */}
        {children}
      </div>
    </div>
  );
}

export interface FormSectionProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Section structurante à l'intérieur d'un formulaire :
 * - Regroupement par domaine (Identité, Coordonnées, Véhicule...)
 * - Titre avec icône
 * - Support pliable optionnel
 */
export function FormSection({
  title,
  description,
  icon,
  badge,
  collapsible = false,
  defaultOpen = true,
  className,
  children,
}: FormSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`form-section rounded-xl border border-border/60 bg-surface-2/20 p-4 sm:p-5 transition-all ${className ?? ""}`}>
      <div
        className={`flex items-center justify-between gap-2 ${collapsible ? "cursor-pointer select-none" : ""} ${description ? "mb-1" : "mb-3"}`}
        onClick={collapsible ? () => setOpen(!open) : undefined}
      >
        <div className="flex items-center gap-2">
          {icon ? <span className="text-accent">{icon}</span> : null}
          <h2 className="text-sm font-bold text-foreground">{title}</h2>
          {badge}
        </div>
        {collapsible ? (
          <button type="button" className="text-muted hover:text-foreground">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        ) : null}
      </div>

      {description ? <p className="mb-4 text-xs text-muted">{description}</p> : null}

      {open ? <div className="mt-3 flex flex-col gap-4">{children}</div> : null}
    </div>
  );
}

export interface FormGridProps {
  cols?: 1 | 2 | 3 | 4;
  columns?: 1 | 2 | 3 | 4;
  className?: string;
  children: ReactNode;
}

const COLS_CLASSES: Record<NonNullable<FormGridProps["cols"]>, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};

/** Grille responsive pour organiser plusieurs champs côte à côte */
export function FormGrid({ cols, columns = 2, className, children }: FormGridProps) {
  const effectiveCols = cols ?? columns;
  return <div className={`grid gap-4 ${COLS_CLASSES[effectiveCols]} ${className ?? ""}`}>{children}</div>;
}

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  label?: ReactNode;
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Sélecteur d'options visuel ultra-classe (Segmented control) :
 * Idéal pour basculer entre "Particulier / Entreprise", types de documents, etc.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  size = "md",
  className,
}: SegmentedControlProps<T>) {
  const sizeClasses = {
    sm: "h-8 text-xs px-2.5",
    md: "h-10 text-xs sm:text-sm px-3 sm:px-4",
    lg: "h-12 text-sm sm:text-base px-4 sm:px-5",
  };

  const control = (
    <div
      role="radiogroup"
      className={`inline-flex w-full items-center rounded-xl border border-border/70 bg-surface-2/60 p-1 shadow-xs ${className ?? ""}`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg font-semibold transition-all ${
              sizeClasses[size]
            } ${
              active
                ? "bg-surface text-accent shadow-sm border border-border/50 font-bold"
                : "text-muted hover:text-foreground"
            }`}
          >
            {option.icon ? <span className="shrink-0">{option.icon}</span> : null}
            <span>{option.label}</span>
            {option.badge ? <span className="ml-1">{option.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );

  if (label) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>
        {control}
      </div>
    );
  }

  return control;
}

export interface FormActionsProps {
  submitLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  onCancel?: () => void;
  cancelHref?: string;
  cancelLabel?: string;
  extraActions?: ReactNode;
  className?: string;
}

/** Barre d'actions modernes en pied de formulaire */
export function FormActions({
  submitLabel = "Enregistrer",
  loading = false,
  disabled = false,
  onCancel,
  cancelHref,
  cancelLabel = "Annuler",
  extraActions,
  className,
}: FormActionsProps) {
  return (
    <div className={`mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-5 ${className ?? ""}`}>
      <div>{extraActions}</div>
      <div className="flex items-center gap-2.5">
        {cancelHref ? (
          <a
            href={cancelHref}
            className="inline-flex h-10 items-center rounded-lg border border-border bg-surface px-4 text-xs font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            {cancelLabel}
          </a>
        ) : onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          loading={loading}
          disabled={disabled || loading}
          className="shadow-sm"
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
