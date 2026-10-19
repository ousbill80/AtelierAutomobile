import { type InputHTMLAttributes, forwardRef } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, className = "", ...props },
  ref,
) {
  // Le <label> englobe le <input> (association accessible native) plutôt que htmlFor/id,
  // pour fonctionner même sans id/name explicite (ex. getByLabel en test).
  const field = (
    <input
      ref={ref}
      className={`min-h-11 rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent ${className}`}
      {...props}
    />
  );

  return (
    <div className="flex flex-col gap-1">
      {label ? (
        <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
          {label}
          {field}
        </label>
      ) : (
        field
      )}
      {error && <p className="text-xs text-status-bad">{error}</p>}
    </div>
  );
});
