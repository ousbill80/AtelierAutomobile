"use client";

import { useState } from "react";
import { formatFCFA, parseFCFA } from "@atelieros/core/src/money";
import { Input, type InputProps } from "./Field";

export interface MoneyInputProps extends Omit<InputProps, "type" | "onChange" | "value"> {
  value: number | null;
  onChange: (value: number | null) => void;
}

/** Champ montant FCFA : saisie libre, reformatée ("185 000 FCFA") à la perte de focus. */
export function MoneyInput({ value, onChange, ...rest }: MoneyInputProps) {
  const [text, setText] = useState(value != null ? formatFCFA(value) : "");
  const [focused, setFocused] = useState(false);

  return (
    <Input
      type="text"
      inputMode="numeric"
      className="num"
      value={focused ? text : value != null ? formatFCFA(value) : text}
      onFocus={(e) => {
        setFocused(true);
        setText(value != null ? String(value) : "");
        e.target.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocused(false);
        if (!text.trim()) {
          onChange(null);
          return;
        }
        try {
          onChange(parseFCFA(text));
        } catch {
          onChange(value);
        }
      }}
      {...rest}
    />
  );
}
