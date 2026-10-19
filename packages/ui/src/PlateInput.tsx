import { normalizePlate } from "@atelieros/core/src/plate";
import { Input, type InputProps } from "./Field";

export interface PlateInputProps extends Omit<InputProps, "type" | "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
}

/** Champ plaque : saisie telle quelle, aperçu de la forme normalisée sous le champ. */
export function PlateInput({ value, onChange, ...rest }: PlateInputProps) {
  const normalized = value.trim() ? normalizePlate(value) : null;

  return (
    <div>
      <Input
        type="text"
        className="veh-plate"
        autoCapitalize="characters"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
      {normalized && normalized.plate !== value ? (
        <span className="hint">{normalized.plate}</span>
      ) : null}
    </div>
  );
}
