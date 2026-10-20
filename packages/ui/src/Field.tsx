"use client";

import {
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
  label?: ReactNode;
  hint?: string;
  error?: string | null;
  success?: string | null;
  required?: boolean;
  optional?: boolean;
  icon?: ReactNode;
  tooltip?: string;
  badge?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

export function Field({
  label,
  hint,
  error,
  success,
  required,
  optional,
  icon,
  tooltip,
  badge,
  htmlFor,
  className,
  children,
}: FieldProps) {
  const generatedId = useId();
  const fieldId = htmlFor ?? generatedId;
  const content =
    label && isValidElement(children)
      ? cloneElement(children as ReactElement<{ id?: string }>, {
          id: (children.props as { id?: string }).id ?? fieldId,
        })
      : children;

  return (
    <div className={["field", error ? "has-error" : "", className ?? ""].filter(Boolean).join(" ")}>
      {label ? (
        <label htmlFor={fieldId} title={tooltip} className="field-label-row">
          <span className="field-label-text">
            {icon ? <span className="field-icon">{icon}</span> : null}
            <span>{label}</span>
            {required ? (
              <span className="field-required ml-1 text-red-500 font-bold" aria-hidden="true" title="Champ obligatoire">
                *
              </span>
            ) : null}
            {optional ? (
              <span className="field-optional ml-1.5 text-xs text-muted font-normal">
                (facultatif)
              </span>
            ) : null}
          </span>
          {badge ? <span className="field-badge">{badge}</span> : null}
        </label>
      ) : null}
      {content}
      {error ? (
        <span className="error">
          <svg
            className="error-icon"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{error}</span>
        </span>
      ) : success ? (
        <span className="success">
          <svg
            className="success-icon"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span>{success}</span>
        </span>
      ) : hint ? (
        <span className="hint">{hint}</span>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** Raccourci : enveloppe le champ dans un `Field` avec ce libellé (et `hint`). */
  label?: ReactNode;
  hint?: string;
  required?: boolean;
  optional?: boolean;
  leftIcon?: ReactNode;
  rightAction?: ReactNode;
}

export function Input({
  invalid,
  className,
  label,
  hint,
  required,
  optional,
  leftIcon,
  rightAction,
  ...rest
}: InputProps) {
  const generatedId = useId();
  const inputId = rest.id ?? (label ? generatedId : undefined);

  const input = (
    <input
      id={inputId}
      required={required}
      className={["input", invalid ? "invalid" : "", className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    />
  );

  const element =
    leftIcon || rightAction ? (
      <div
        className={[
          "input-wrap",
          leftIcon ? "has-left-icon" : "",
          rightAction ? "has-right-icon" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {leftIcon ? <span className="input-icon-left">{leftIcon}</span> : null}
        {input}
        {rightAction ? <span className="input-icon-right">{rightAction}</span> : null}
      </div>
    ) : (
      input
    );

  return label || hint ? (
    <Field label={label} hint={hint} required={required} optional={optional} htmlFor={inputId}>
      {element}
    </Field>
  ) : (
    element
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  label?: ReactNode;
  hint?: string;
  required?: boolean;
  optional?: boolean;
}

export function Select({ invalid, className, label, hint, required, optional, ...rest }: SelectProps) {
  const generatedId = useId();
  const selectId = rest.id ?? (label ? generatedId : undefined);

  const select = (
    <select
      id={selectId}
      required={required}
      className={["select", invalid ? "invalid" : "", className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    />
  );

  return label || hint ? (
    <Field label={label} hint={hint} required={required} optional={optional} htmlFor={selectId}>
      {select}
    </Field>
  ) : (
    select
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  label?: ReactNode;
  hint?: string;
  required?: boolean;
  optional?: boolean;
}

export function Textarea({ invalid, className, label, hint, required, optional, ...rest }: TextareaProps) {
  const generatedId = useId();
  const textareaId = rest.id ?? (label ? generatedId : undefined);

  const textarea = (
    <textarea
      id={textareaId}
      required={required}
      className={["textarea", invalid ? "invalid" : "", className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    />
  );

  return label || hint ? (
    <Field label={label} hint={hint} required={required} optional={optional} htmlFor={textareaId}>
      {textarea}
    </Field>
  ) : (
    textarea
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
