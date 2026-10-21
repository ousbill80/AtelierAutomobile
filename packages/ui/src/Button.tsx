import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  iconOnly?: boolean;
  loading?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  iconOnly = false,
  loading = false,
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    "btn",
    `btn-${variant}`,
    size === "sm" ? "btn-sm" : "",
    block ? "btn-block" : "",
    iconOnly ? "btn-icon-only" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={classes} disabled={disabled ?? loading} aria-busy={loading} {...rest}>
      {loading ? <span className="btn-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function LinkButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, ...rest } = props;
  return <button className={["link-btn", className ?? ""].join(" ")} {...rest} />;
}
