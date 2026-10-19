"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

export interface FieldProps {
  label?: string;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, htmlFor, children }: FieldProps) {
  const generatedId = useId();
  const fieldId = htmlFor ?? generatedId;
  const child = Children.only(children);
  const content =
    label && isValidElement(child)
      ? cloneElement(child as ReactElement<{ id?: string }>, {
          id: (child.props as { id?: string }).id ?? fieldId,
        })
      : children;

  return (
    <div className="field">
      {label ? <label htmlFor={fieldId}>{label}</label> : null}
      {content}
      {error ? (
        <span className="error">{error}</span>
      ) : hint ? (
        <span className="hint">{hint}</span>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** Raccourci : enveloppe le champ dans un `Field` avec ce libellé (et `hint`). */
  label?: string;
  hint?: string;
}

export function Input({ invalid, className, label, hint, ...rest }: InputProps) {
  const input = (
    <input
      className={["input", invalid ? "invalid" : "", className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    />
  );
  return label || hint ? (
    <Field label={label} hint={hint}>
      {input}
    </Field>
  ) : (
    input
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export function Select({ invalid, className, ...rest }: SelectProps) {
  return (
    <select
      className={["select", invalid ? "invalid" : "", className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function Textarea({ invalid, className, ...rest }: TextareaProps) {
  return (
    <textarea
      className={["textarea", invalid ? "invalid" : "", className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}

export function CheckboxRow({
  label,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="checkbox-row">
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}

export function Switch({
  label,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }) {
  return (
    <label className="switch">
      <input type="checkbox" {...rest} />
      <span className="track" />
      {label ? <span className="visually-hidden">{label}</span> : null}
    </label>
  );
}
