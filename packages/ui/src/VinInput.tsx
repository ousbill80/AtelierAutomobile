"use client";

import { useId } from "react";
import { Field, type InputProps } from "./Field";

export interface VinInputProps extends Omit<InputProps, "type" | "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Nettoie et formate la saisie d'un numéro de châssis (VIN) selon la norme ISO 3779 :
 * - 17 caractères
 * - Majuscules
 * - Exclusion des lettres I, O, Q pour éviter les confusions avec 1 et 0
 */
function cleanVin(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-HJ-NPR-Z0-9]/g, "") // Exclut I, O, Q et caractères spéciaux
    .slice(0, 17);
}

/**
 * Champ numéro de série / châssis (VIN) intelligent :
 * - Masque ISO 3779 (17 caractères max, filtrage direct de I, O, Q)
 * - Compteur de caractères interactif avec indicateur vert à 17
 * - Typographie monospace majuscules
 */
export function VinInput({
  value,
  onChange,
  label,
  hint,
  required,
  optional,
  className,
  ...rest
}: VinInputProps) {
  const generatedId = useId();
  const inputId = rest.id ?? (label ? generatedId : undefined);

  const cleaned = cleanVin(value);
  const count = cleaned.length;
  const isComplete = count === 17;

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const nextVal = cleanVin(e.target.value);
    onChange(nextVal);
  }

  const inputElement = (
    <div className="vin-input-wrap relative flex w-full items-center">
      {/* Préfixe VIN discret */}
      <div
        className="pointer-events-none absolute left-0 top-0 bottom-0 flex items-center justify-center rounded-l-md border-r border-border bg-surface-2/60 px-2.5 text-[11px] font-bold tracking-wider text-muted select-none z-10"
        title="Vehicle Identification Number (ISO 3779)"
      >
        <span>VIN</span>
      </div>

      <input
        {...rest}
        id={inputId}
        type="text"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck="false"
        placeholder="VF1XXXXXXXXXXXXXX"
        maxLength={17}
        value={cleaned}
        required={required}
        onChange={handleChange}
        style={{ ...rest.style, paddingLeft: "54px", paddingRight: "64px" }}
        className={[
          "input font-mono text-sm tracking-widest font-semibold uppercase",
          isComplete ? "border-status-ok focus:border-status-ok" : "",
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
      />

      {/* Compteur interactif à droite */}
      <div className="absolute right-2.5 top-0 bottom-0 flex items-center gap-1.5 pointer-events-none z-10">
        <span
          className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold ${
            isComplete
              ? "bg-status-ok-bg text-status-ok border border-status-ok/30"
              : count > 0
                ? "bg-surface-2 text-muted border border-border"
                : "text-muted/60"
          }`}
        >
          {count}/17
        </span>
      </div>
    </div>
  );

  return (
    <Field
      label={label}
      hint={hint ?? (isComplete ? "Numéro de châssis conforme (17 caractères ISO 3779)" : "17 caractères (lettres I, O, Q exclues de la norme)")}
      required={required}
      optional={optional}
      htmlFor={inputId}
    >
      {inputElement}
    </Field>
  );
}
