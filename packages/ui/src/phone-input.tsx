import { useMemo } from "react";
import { Input, type InputProps } from "./input";

export interface PhoneInputProps extends Omit<InputProps, "type"> {
  /** Résultat de `normalizePhoneCI` côté appelant (affiché en aide, jamais recalculé ici). */
  hint?: string | null;
}

/** RG-M02-03 — saisie téléphone avec clavier numérique et aide de normalisation en direct. */
export function PhoneInput({ hint, ...props }: PhoneInputProps) {
  const helpId = useMemo(() => `${props.id ?? props.name ?? "phone"}-hint`, [props.id, props.name]);
  return (
    <div className="flex flex-col gap-1">
      <Input
        type="tel"
        inputMode="tel"
        placeholder="07 47 21 88 90"
        aria-describedby={hint ? helpId : undefined}
        {...props}
      />
      {hint && (
        <p id={helpId} className="text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
