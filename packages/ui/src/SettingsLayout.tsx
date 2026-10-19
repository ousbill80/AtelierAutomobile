import type { ReactNode } from "react";

export interface SettingsNavItem {
  key: string;
  label: string;
}

export function SettingsLayout({
  items,
  activeKey,
  onChange,
  children,
}: {
  items: SettingsNavItem[];
  activeKey: string;
  onChange: (key: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="settings-grid">
      <nav className="settings-nav">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            className={item.key === activeKey ? "active" : ""}
            onClick={() => onChange(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="settings-content">{children}</div>
    </div>
  );
}
