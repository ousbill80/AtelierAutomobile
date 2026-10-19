"use client";

import { useRef } from "react";

export interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Place le focus sur la première case au montage. */
  autoFocus?: boolean;
}

/** Saisie OTP en cases séparées, avec collage du code complet supporté. */
export function OtpInput({ length = 6, value, onChange, disabled, autoFocus }: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");

  function setDigit(index: number, digit: string) {
    const next = digits.slice();
    next[index] = digit;
    onChange(next.join("").slice(0, length));
  }

  return (
    <div className="otp-row">
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="otp-digit"
          inputMode="numeric"
          autoFocus={autoFocus && i === 0}
          aria-label={`Chiffre ${i + 1} sur ${length}`}
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          disabled={disabled}
          value={digit}
          onChange={(e) => {
            const raw = e.target.value.replace(/\D/g, "");
            if (raw.length > 1) {
              onChange(raw.slice(0, length));
              refs.current[Math.min(raw.length, length - 1)]?.focus();
              return;
            }
            setDigit(i, raw);
            if (raw && i < length - 1) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digit && i > 0) refs.current[i - 1]?.focus();
          }}
        />
      ))}
    </div>
  );
}
