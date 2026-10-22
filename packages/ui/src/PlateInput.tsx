"use client";

import { useId } from "react";
import { normalizePlate, type NormalizedPlate } from "@atelieros/core/src/plate";
import { Field, type InputProps } from "./Field";

export interface PlateInputProps extends Omit<InputProps, "type" | "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Formate intelligemment la frappe d'une plaque d'immatriculation ivoirienne :
 * Ex: "1234ab01" -> "1234 AB 01"
 * Ex: "ww123401" -> "WW 1234 01"
 */
function formatCiPlate(raw: string): string {
  const upper = raw.toUpperCase().trim();
  if (!upper || upper === "SANS PLAQUE") return upper;

  const clean = upper.replace(/[^A-Z0-9]/g, "");

  // Format temporaire WW / W
  if (clean.startsWith("WW") || (clean.startsWith("W") && !clean.startsWith("WA"))) {
    const prefix = clean.startsWith("WW") ? "WW" : "W";
    const rest = clean.slice(prefix.length);
    if (!rest) return prefix;
    if (rest.length <= 4) return `${prefix} ${rest}`;
    return `${prefix} ${rest.slice(0, rest.length - 2)} ${rest.slice(-2)}`;
  }

  // Format diplomatique CD / CMD
  if (clean.startsWith("CMD") || clean.startsWith("CD")) {
    const prefix = clean.startsWith("CMD") ? "CMD" : "CD";
    const rest = clean.slice(prefix.length);
    if (!rest) return prefix;
    if (rest.length <= 3) return `${prefix} ${rest}`;
    return `${prefix} ${rest.slice(0, rest.length - 2)} ${rest.slice(-2)}`;
  }

  // Format standard civil : [1 à 4 chiffres] [1 à 2 lettres] [2 chiffres]
  const match = clean.match(/^(\d{1,4})([A-Z]{0,2})(\d{0,2})$/);
  if (match) {
    const digits = match[1] ?? "";
    const letters = match[2] ?? "";
    const dept = match[3] ?? "";
    let res = digits;
    if (letters) res += ` ${letters}`;
    if (dept) res += ` ${dept}`;
    return res;
  }

  // Repli : si l'utilisateur saisit avec des espaces personnalisés
  return upper;
}

/**
 * Champ plaque d'immatriculation intelligent :
 * - Masque de saisie automatique adapté aux plaques ivoiriennes (1234 AB 01)
 * - Badge minéralogique "CI" façon plaque d'immatriculation
 * - Typographie plaque monospace majuscules
 * - Validation en direct
 */
export function PlateInput({
  value,
  onChange,
  label,
  hint,
  required,
  optional,
  className,
  ...rest
}: PlateInputProps) {
  const generatedId = useId();
  const inputId = rest.id ?? (label ? generatedId : undefined);

  const formattedDisplay = formatCiPlate(value);
  const normalized: NormalizedPlate = value.trim()
    ? normalizePlate(value)
    : { raw: "", plateCompact: "", plate: "", plateType: "NONE" };

  const isStandard = normalized.plateType === "STANDARD";

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const formatted = formatCiPlate(e.target.value);
    onChange(formatted);
  }

  const inputElement = (
    <div className="plate-input-wrap relative flex w-full items-center">
      {/* Badge bleu façon plaque officielle Côte d'Ivoire */}
      <div
        className="pointer-events-none absolute left-0 top-0 bottom-0 flex items-center justify-center rounded-l-md border-r border-blue-600 bg-blue-600 px-2.5 text-xs font-black tracking-widest text-white select-none z-10 shadow-xs"
        title="Immatriculation République de Côte d'Ivoire"
      >
        <span>CI</span>
      </div>

      <input
        {...rest}
        id={inputId}
        type="text"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck="false"
        placeholder="1234 AB 01"
        value={formattedDisplay}
        required={required}
        onChange={handleChange}
        style={{ ...rest.style, paddingLeft: "52px", paddingRight: "44px" }}
        className={[
          "input font-mono text-sm font-bold tracking-wider uppercase",
          isStandard ? "border-status-ok focus:border-status-ok" : "",
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
      />

      {/* Indicateur de conformité à droite */}
      <div className="absolute right-2.5 top-0 bottom-0 flex items-center pointer-events-none z-10">
        {isStandard ? (
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full bg-status-ok-bg text-status-ok"
            title="Format de plaque standard CI valide"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
        ) : null}
      </div>
    </div>
  );

  return (
    <Field
      label={label}
      hint={hint ?? (isStandard ? "Format civil standard CI (4 chiffres + 2 lettres + 2 chiffres)" : "Ex: 1234 AB 01 ou WW 1234 01")}
      required={required}
      optional={optional}
      htmlFor={inputId}
    >
      {inputElement}
    </Field>
  );
}
