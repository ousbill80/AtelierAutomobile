import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "border-transparent bg-accent text-accent-foreground",
        secondary: "border-transparent bg-surface-2 text-foreground",
        outline: "border-border text-foreground",
        ok: "border-transparent bg-status-ok-bg text-status-ok",
        warn: "border-transparent bg-status-warn-bg text-status-warn",
        bad: "border-transparent bg-status-bad-bg text-status-bad",
        off: "border-transparent bg-status-off-bg text-status-off",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}

export { Badge, badgeVariants };
