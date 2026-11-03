"use client";

export interface FuelGaugeProps {
  /** 0 à 8 (huitièmes). */
  value: number | null;
  onChange?: (value: number) => void;
  /** Libellé accessible de chaque cran, ex. (3) => "3/8". */
  levelLabel: (level: number) => string;
  label: string;
  /** Légendes sous certains crans, ex. { 0: "Vide", 8: "Plein" }. */
  captions?: Partial<Record<number, string>>;
}

/** M04 — jauge carburant tactile à 8 crans (0 = réserve vide, 8 = plein). */
export function FuelGauge({ value, onChange, levelLabel, label, captions }: FuelGaugeProps) {
  return (
    <div className="flex flex-col gap-1">
      <div role="radiogroup" aria-label={label} className="flex items-end gap-1">
        {Array.from({ length: 9 }, (_, level) => {
          const active = value !== null && level <= value;
          const selected = value === level;
          return (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={
                captions?.[level] ? `${captions[level]} (${levelLabel(level)})` : levelLabel(level)
              }
              disabled={!onChange}
              onClick={() => onChange?.(level)}
              className={`flex min-h-11 min-w-8 flex-1 items-end justify-center rounded-md border text-xs font-semibold ${
                active
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border bg-surface text-foreground"
              } ${selected ? "ring-2 ring-accent ring-offset-1" : ""}`}
              style={{ height: 44 + level * 4 }}
            >
              {level}
            </button>
          );
        })}
      </div>
      {captions && (
        <div className="flex gap-1" aria-hidden>
          {Array.from({ length: 9 }, (_, level) => (
            <span
              key={level}
              className={`min-w-8 flex-1 text-center text-[11px] leading-tight ${
                value === level ? "font-semibold text-foreground" : "text-muted"
              }`}
            >
              {captions[level] ?? ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
