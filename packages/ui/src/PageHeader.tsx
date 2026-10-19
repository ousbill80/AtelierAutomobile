import type { ReactNode } from "react";

export interface PageHeadProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHead({ title, description, actions }: PageHeadProps) {
  return (
    <div className="page-head">
      <div>
        <h2>{title}</h2>
        {description ? <div className="desc">{description}</div> : null}
      </div>
      {actions ? <div className="page-head-actions">{actions}</div> : null}
    </div>
  );
}

export interface BreadcrumbItem {
  label: string;
  onClick?: () => void;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <div className="breadcrumb">
      {items.map((item, i) => (
        <span key={`${item.label}-${i}`}>
          {i > 0 ? <span> / </span> : null}
          {item.onClick ? <a onClick={item.onClick}>{item.label}</a> : <span>{item.label}</span>}
        </span>
      ))}
    </div>
  );
}

export interface TabItem {
  key: string;
  label: string;
}

export function Tabs({
  items,
  activeKey,
  onChange,
}: {
  items: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="tabs-row">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={["tab-btn", item.key === activeKey ? "active" : ""].filter(Boolean).join(" ")}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
