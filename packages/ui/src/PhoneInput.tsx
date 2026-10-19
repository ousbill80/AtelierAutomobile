import { normalizePhoneCI, type NormalizedPhone } from "@atelieros/core/src/phone";
import { Input, type InputProps } from "./Field";

export interface PhoneInputProps extends Omit<InputProps, "type" | "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
}

function tryNormalize(value: string): NormalizedPhone | null {
  if (!value.trim()) return null;
  try {
    return normalizePhoneCI(value);
  } catch {
    return null;
  }
}

/** Champ téléphone CI : saisie libre, normalisation E.164 affichée en aperçu sous le champ. */
export function PhoneInput({ value, onChange, invalid, ...rest }: PhoneInputProps) {
  const normalized = tryNormalize(value);
  const showInvalid = invalid ?? (value.trim() !== "" && normalized?.e164 == null);

  return (
    <div>
      <Input
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={value}
        invalid={showInvalid}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
      {normalized?.e164 ? <span className="hint">{normalized.e164}</span> : null}
    </div>
  );
}
