import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

export function Card({ title, actions, children, className, ...rest }: CardProps) {
  return (
    <div className={["card", className ?? ""].filter(Boolean).join(" ")} {...rest}>
      {title || actions ? (
        <div className="card-head">
          {title ? <div className="card-title">{title}</div> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </div>
  );
}
