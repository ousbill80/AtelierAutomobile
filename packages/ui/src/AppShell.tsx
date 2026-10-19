import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ElementType, ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return <div className="app-shell">{children}</div>;
}

export function AppMain({ children }: { children: ReactNode }) {
  return <div className="app-main">{children}</div>;
}

export function Content({ children }: { children: ReactNode }) {
  return <div className="content">{children}</div>;
}

export interface SidebarProps {
  garageName: string;
  garageSub?: string;
  logoLabel: string;
  children: ReactNode;
}

export function Sidebar({ garageName, garageSub, logoLabel, children }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="sidebar-logo">{logoLabel}</div>
        <div className="sidebar-garage">
          <div className="name">{garageName}</div>
          {garageSub ? <div className="sub">{garageSub}</div> : null}
        </div>
      </div>
      <nav className="sidebar-nav">{children}</nav>
    </aside>
  );
}

export function SidebarSectionLabel({ children }: { children: ReactNode }) {
  return <div className="sidebar-section-label">{children}</div>;
}

export interface NavItemProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  as?: ElementType;
  active?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  badge?: ReactNode;
}

export function NavItem({
  as: Component = "a",
  active,
  icon,
  label,
  badge,
  className,
  ...rest
}: NavItemProps) {
  return (
    <Component
      className={["nav-item", active ? "active" : "", className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    >
      {icon ? <span className="ic">{icon}</span> : null}
      <span className="label">{label}</span>
      {badge != null ? <span className="badge">{badge}</span> : null}
    </Component>
  );
}

export interface TopbarProps {
  garageName?: string;
  children: ReactNode;
}

export function Topbar({ garageName, children }: TopbarProps) {
  return (
    <header className="topbar">
      {garageName ? <div className="topbar-garage">{garageName}</div> : null}
      {children}
    </header>
  );
}

export function SearchBox({ placeholder }: { placeholder: string }) {
  return (
    <div className="search-box">
      <input placeholder={placeholder} aria-label={placeholder} disabled />
    </div>
  );
}

export function TopbarActions({ children }: { children: ReactNode }) {
  return <div className="topbar-actions">{children}</div>;
}

export function IconButton(props: ButtonHTMLAttributes<HTMLButtonElement> & { hasDot?: boolean }) {
  const { hasDot, className, children, ...rest } = props;
  return (
    <button
      type="button"
      className={["icon-btn", className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
      {hasDot ? <span className="dot" /> : null}
    </button>
  );
}

export function Avatar({ label, onClick }: { label: string; onClick?: () => void }) {
  const initials = label
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <button type="button" className="avatar" onClick={onClick} aria-label={label}>
      {initials}
    </button>
  );
}

export interface DropdownMenuProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function DropdownMenu({ open, onClose, children }: DropdownMenuProps) {
  if (!open) return null;
  return (
    <div className="dropdown-wrap">
      <div className="dropdown-menu" role="menu" onMouseLeave={onClose}>
        {children}
      </div>
    </div>
  );
}

export function DropdownItem({
  danger,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={["item", danger ? "danger" : "", className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}
