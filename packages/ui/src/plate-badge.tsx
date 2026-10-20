export interface PlateBadgeProps {
  plate: string;
  plateType?: string;
  className?: string;
}

export function PlateBadge({ plate, plateType, className }: PlateBadgeProps) {
  const isTemporary = plateType === "TEMPORARY";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-1 font-mono text-sm tracking-wide ${
        isTemporary
          ? "border-status-warn bg-status-warn-bg text-status-warn"
          : "border-border bg-surface-2 text-foreground"
      } ${className ?? ""}`}
    >
      {plate}
    </span>
  );
}
