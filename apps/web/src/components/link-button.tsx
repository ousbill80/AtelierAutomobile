import Link, { type LinkProps } from "next/link";
import type { ReactNode } from "react";
import type { ButtonVariant } from "@atelieros/ui";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active",
  secondary: "bg-surface-2 text-foreground hover:bg-border",
  danger: "bg-status-bad text-white hover:opacity-90",
  ghost: "bg-transparent text-foreground hover:bg-surface-2",
};

export interface LinkButtonProps extends LinkProps {
  children: ReactNode;
  variant?: ButtonVariant;
  className?: string;
}

/** Même rendu que `Button` (packages/ui) mais pour une navigation (`<a>`), jamais un `<button>`. */
export function LinkButton({
  variant = "primary",
  className = "",
  children,
  ...props
}: LinkButtonProps) {
  return (
    <Link
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    >
      {children}
    </Link>
  );
}
