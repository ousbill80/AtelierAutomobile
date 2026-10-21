import {
  useState,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ElementType,
  type ReactNode,
} from "react";
import { ChevronDown, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";

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
  logoIcon?: ReactNode;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  collapseLabel?: string;
  expandLabel?: string;
  footer?: ReactNode;
  children: ReactNode;
}

export function Sidebar({
  garageName,
  garageSub,
  logoLabel,
  logoIcon,
  collapsed = false,
  onToggleCollapse,
  collapseLabel,
  expandLabel,
  footer,
  children,
}: SidebarProps) {
  const toggleLabel = collapsed ? expandLabel : collapseLabel;
  return (
    <aside className={["sidebar", collapsed ? "collapsed" : ""].filter(Boolean).join(" ")}>
      <div className="sidebar-head">
        <div className="sidebar-logo" title={logoLabel}>
          {logoIcon ?? logoLabel.slice(0, 2).toUpperCase()}
        </div>
        <div className="sidebar-garage">
          <div className="name" title={garageName}>
            {garageName}
          </div>
          {garageSub ? (
            <div className="sub" title={garageSub}>
              {garageSub}
            </div>
          ) : null}
        </div>
        {onToggleCollapse && toggleLabel ? (
          <button
            type="button"
            className="sidebar-toggle"
            onClick={onToggleCollapse}
            title={toggleLabel}
            aria-label={toggleLabel}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        ) : null}
      </div>
      <nav className="sidebar-nav">{children}</nav>
      {footer ? <div className="sidebar-foot">{footer}</div> : null}
    </aside>
  );
}

export interface SidebarSectionProps {
  label: string;
  collapsible?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onToggle?: () => void;
  badge?: ReactNode;
  children: ReactNode;
}

export function SidebarSection({
  label,
  collapsible = false,
  open: controlledOpen,
  defaultOpen = true,
  onToggle,
  badge,
  children,
}: SidebarSectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;

  function handleToggle() {
    if (onToggle) onToggle();
    else setInternalOpen((prev) => !prev);
  }

  return (
    <div className={["sidebar-section", isOpen ? "open" : "closed"].join(" ")}>
      {collapsible ? (
        <button
          type="button"
          className="sidebar-section-header collapsible"
          onClick={handleToggle}
          aria-expanded={isOpen}
        >
          <span className="sidebar-section-title">{label}</span>
          {badge ? <span className="sidebar-section-badge">{badge}</span> : null}
          <span className="sidebar-section-icon" aria-hidden="true">
            <ChevronDown size={14} />
          </span>
        </button>
      ) : (
        <div className="sidebar-section-header">
          <span className="sidebar-section-title">{label}</span>
          {badge ? <span className="sidebar-section-badge">{badge}</span> : null}
        </div>
      )}
      {collapsible ? (
        <div className="sidebar-section-collapse" inert={!isOpen}>
          <div className="sidebar-section-content">{children}</div>
        </div>
      ) : (
        <div className="sidebar-section-content">{children}</div>
      )}
    </div>
  );
}

export function SidebarSectionLabel({ children }: { children: ReactNode }) {
  return <div className="sidebar-section-label">{children}</div>;
}

export interface SidebarSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  clearLabel?: string;
}

export function SidebarSearch({ value, onChange, placeholder, clearLabel }: SidebarSearchProps) {
  return (
    <div className="sidebar-search-box">
      <Search size={14} className="sidebar-search-icon" aria-hidden="true" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="sidebar-search-input"
        aria-label={placeholder}
      />
      {value && clearLabel ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="sidebar-search-clear"
          aria-label={clearLabel}
        >
          <X size={12} />
        </button>
      ) : null}
    </div>
  );
}

export interface NavItemProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  as?: ElementType;
  active?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  badge?: ReactNode;
  badgeVariant?: "default" | "accent" | "ai" | "warn";
  subItem?: boolean;
}

export function NavItem({
  as: Component = "a",
  active,
  icon,
  label,
  badge,
  badgeVariant = "default",
  subItem = false,
  className,
  title,
  ...rest
}: NavItemProps) {
  const displayTitle = title ?? (typeof label === "string" ? label : undefined);
  return (
    <Component
      className={["nav-item", active ? "active" : "", subItem ? "sub-item" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      title={displayTitle}
      {...rest}
    >
      {icon ? <span className="ic">{icon}</span> : null}
      <span className="label">{label}</span>
      {badge != null ? (
        <span className={["badge", `badge-${badgeVariant}`].join(" ")}>{badge}</span>
      ) : null}
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
