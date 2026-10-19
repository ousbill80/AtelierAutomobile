"use client";

export interface FuelGaugeProps {
  /** 0 à 8 (huitièmes). */
  value: number | null;
  onChange?: (value: number) => void;
  /** Libellé accessible de chaque cran, ex. (3) => "3/8". */
  levelLabel: (level: number) => string;
  label: string;
}

/** M04 — jauge carburant tactile à 8 crans (0 = réserve vide, 8 = plein). */
export function FuelGauge({ value, onChange, levelLabel, label }: FuelGaugeProps) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-end gap-1">
      {Array.from({ length: 9 }, (_, level) => {
        const active = value !== null && level <= value;
        return (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={value === level}
            aria-label={levelLabel(level)}
            disabled={!onChange}
            onClick={() => onChange?.(level)}
            className={`flex min-h-11 min-w-8 flex-1 items-end justify-center rounded-md border text-xs font-semibold ${
              active
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border bg-surface-2"
            }`}
            style={{ height: 44 + level * 4 }}
          >
            {level}
          </button>
        );
      })}
    </div>
  );
}
