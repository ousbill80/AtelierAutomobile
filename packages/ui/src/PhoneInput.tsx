"use client";

import { useId } from "react";
import { normalizePhoneCI, type NormalizedPhone } from "@atelieros/core/src/phone";
import { Field, type InputProps } from "./Field";

export interface PhoneInputProps extends Omit<InputProps, "type" | "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
  showOperatorBadge?: boolean;
}

function tryNormalize(value: string): NormalizedPhone | null {
  if (!value.trim()) return null;
  try {
    return normalizePhoneCI(value);
  } catch {
    return null;
  }
}

/** Détecte l'opérateur en fonction des deux premiers chiffres ivoiriens */
function getOperatorInfo(digits: string): { name: "Orange" | "MTN" | "Moov"; color: string } | null {
  if (digits.length < 2) return null;
  const prefix = digits.slice(0, 2);
  if (prefix === "07" || prefix === "27") {
    return { name: "Orange", color: "bg-orange-500/10 text-orange-600 border-orange-500/30" };
  }
  if (prefix === "05" || prefix === "25") {
    return { name: "MTN", color: "bg-amber-400/15 text-amber-700 border-amber-400/40" };
  }
  if (prefix === "01" || prefix === "21") {
    return { name: "Moov", color: "bg-blue-500/10 text-blue-600 border-blue-500/30" };
  }
  return null;
}

/** Formate une suite de chiffres en groupes de 2 : 07 12 34 56 78 */
function formatCiPhone(raw: string): string {
  // Supprime tout sauf les chiffres
  let digits = raw.replace(/\D/g, "");

  // Si commence par l'indicatif international 225
  if (digits.startsWith("225") && digits.length > 10) {
    digits = digits.slice(3);
  } else if (digits.startsWith("00225")) {
    digits = digits.slice(5);
  }

  // Limite à 10 chiffres (standard ivoirien)
  digits = digits.slice(0, 10);

  // Découpe en paires de 2
  const parts: string[] = [];
  for (let i = 0; i < digits.length; i += 2) {
    parts.push(digits.slice(i, i + 2));
  }
  return parts.join(" ");
}

/**
 * Champ téléphone intelligent pour la Côte d'Ivoire :
 * - Masque de saisie 10 chiffres espacés 2 par 2 (ex: 07 12 34 56 78)
 * - Préfixe drapeau CI 🇨🇮 +225
 * - Détection automatique de l'opérateur (Orange, MTN, Moov)
 * - Indicateur de validité en temps réel
 */
export function PhoneInput({
  value,
  onChange,
  invalid,
  label,
  hint,
  required,
  optional,
  showOperatorBadge = true,
  className,
  ...rest
}: PhoneInputProps) {
  const generatedId = useId();
  const inputId = rest.id ?? (label ? generatedId : undefined);

  const formattedDisplay = formatCiPhone(value);
  const rawDigits = value.replace(/\D/g, "");
  const cleanDigits = rawDigits.startsWith("225") && rawDigits.length > 10 ? rawDigits.slice(3) : rawDigits;
  const operator = getOperatorInfo(cleanDigits);
  const normalized = tryNormalize(value);
  const isComplete = cleanDigits.length === 10;
  const showInvalid = invalid ?? (value.trim() !== "" && cleanDigits.length > 0 && !isComplete && cleanDigits.length >= 10);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const nextFormatted = formatCiPhone(e.target.value);
    onChange(nextFormatted);
  }

  const inputElement = (
    <div className="phone-input-wrap relative flex w-full items-center">
      {/* Préfixe pays stylisé */}
      <div
        className="pointer-events-none absolute left-0 top-0 bottom-0 flex items-center gap-1.5 rounded-l-md border-r border-border bg-surface-2/60 px-3 text-xs font-semibold text-muted select-none z-10"
        title="Côte d'Ivoire (+225)"
      >
        <span className="text-sm leading-none" role="img" aria-label="Drapeau Côte d'Ivoire">
          🇨🇮
        </span>
        <span className="text-foreground/80">+225</span>
      </div>

      <input
        {...rest}
        id={inputId}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="07 00 00 00 00"
        value={formattedDisplay}
        required={required}
        onChange={handleChange}
        style={{ ...rest.style, paddingLeft: "88px", paddingRight: "54px" }}
        className={[
          "input font-mono text-sm tracking-wide",
          showInvalid ? "invalid" : "",
          isComplete ? "border-status-ok focus:border-status-ok" : "",
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
      />

      {/* Badge opérateur ou validation à droite */}
      <div className="absolute right-2.5 top-0 bottom-0 flex items-center gap-1 z-10 pointer-events-none">
        {showOperatorBadge && operator ? (
          <span
            className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase transition-all ${operator.color}`}
          >
            {operator.name}
          </span>
        ) : null}

        {isComplete ? (
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full bg-status-ok-bg text-status-ok"
            title="Numéro complet (10 chiffres)"
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
      hint={
        hint ??
        (normalized?.e164
          ? `Normalisé : ${normalized.e164}`
          : "Format ivoirien à 10 chiffres (ex: 07 12 34 56 78)")
      }
      required={required}
      optional={optional}
      htmlFor={inputId}
      error={showInvalid ? "Numéro incomplet (10 chiffres attendus)" : null}
    >
      {inputElement}
    </Field>
  );
}
