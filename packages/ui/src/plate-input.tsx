import { Input, type InputProps } from "./input";

/** RG-M02-05 — saisie de plaque ; la normalisation réelle (majuscules, format) est faite
 * côté serveur/validateur, ce champ se contente d'une saisie confortable (majuscules visuelles). */
export function PlateInput(props: InputProps) {
  return (
    <Input
      placeholder="2547 GH 01"
      className="font-mono uppercase tracking-wide"
      autoCapitalize="characters"
      {...props}
    />
  );
}

export interface PlateBadgeProps {
  plate: string;
  plateType?: string;
}

export function PlateBadge({ plate, plateType }: PlateBadgeProps) {
  const isTemporary = plateType === "TEMPORARY";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-1 font-mono text-sm tracking-wide ${
        isTemporary
          ? "border-status-warn bg-status-warn-bg text-status-warn"
          : "border-border bg-surface-2 text-foreground"
      }`}
    >
      {plate}
    </span>
  );
}
