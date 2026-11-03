import type { LucideIcon } from "lucide-react";
import { EduTip } from "@/components/edu-tip";

type Tone = "neutral" | "ok" | "warn" | "bad";

export function MiniStat({
  icon: Icon,
  label,
  value,
  tone = "neutral",
  pressed,
  onClick,
  help,
  example,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone?: Tone;
  pressed?: boolean;
  onClick: () => void;
  help?: string;
  example?: string;
}) {
  const toneClass = tone === "neutral" ? "" : tone;
  return (
    <div className="relative min-w-0">
      <button
        type="button"
        className={`mini-stat w-full${pressed ? " is-pressed" : ""}${help ? " pr-12" : ""}`}
        aria-pressed={pressed}
        onClick={onClick}
      >
        <span className={`mini-stat-icon ${tone}`}>
          <Icon aria-hidden />
        </span>
        <span>
          <span className={`mini-stat-value ${toneClass}`}>
            {new Intl.NumberFormat("fr-FR").format(value)}
          </span>
          <span className="mini-stat-label">{label}</span>
        </span>
      </button>
      {help ? (
        <span className="absolute right-0.5 top-0.5 z-10">
          <EduTip text={help} example={example} />
        </span>
      ) : null}
    </div>
  );
}

export function MiniStatSkeleton() {
  return (
    <div className="mini-stats" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="mini-stat-skeleton" />
      ))}
    </div>
  );
}
