"use client";

// Navigation mobile façon application (≤ 760 px) : barre d'onglets en bas (4 raccourcis
// selon le rôle + « Menu ») et menu plein écran avec tous les modules, la recherche, les
// notifications, l'installation de l'appli et le compte. Remplace la barre latérale.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Bell,
  ChevronRight,
  LayoutGrid,
  LogOut,
  Search,
  Sliders,
  Smartphone,
  UserRound,
  X,
} from "lucide-react";
import { t } from "@/i18n/t";
import { InstallCard, useInstallState } from "@/components/pwa/install-card";
import type { MenuEntryDef, MenuItemDef } from "./menu-types";

/** Ordre de préférence des onglets du bas ; les 4 premiers accessibles sont retenus. */
const TAB_PRIORITY = [
  "/tableau-de-bord",
  "/ordres",
  "/relances",
  "/creances",
  "/rendez-vous/aujourdhui",
  "/clients",
  "/factures",
  "/tablette",
  "/caisse",
];

const SHORT_LABELS: Record<string, string> = {
  "/tableau-de-bord": "nav.mobile.home",
  "/ordres": "nav.mobile.orders",
  "/rendez-vous/aujourdhui": "nav.mobile.appointments",
  "/relances": "nav.mobile.reminders",
  "/creances": "nav.mobile.receivables",
  "/clients": "nav.mobile.customers",
  "/factures": "nav.mobile.invoices",
  "/tablette": "nav.mobile.tablet",
  "/caisse": "nav.mobile.cash",
};

function flatten(entries: MenuEntryDef[]): MenuItemDef[] {
  return entries.flatMap((entry) => (entry.kind === "link" ? [entry.item] : entry.items));
}

export function pickTabs(entries: MenuEntryDef[]): MenuItemDef[] {
  const items = flatten(entries);
  const byHref = new Map(items.map((item) => [item.href, item]));
  return TAB_PRIORITY.flatMap((href) => (byHref.has(href) ? [byHref.get(href)!] : [])).slice(0, 4);
}

export function MobileTabBar({
  entries,
  isActive,
  badges,
  renderMenu,
}: {
  entries: MenuEntryDef[];
  isActive: (item: MenuItemDef) => boolean;
  badges?: Record<string, number>;
  renderMenu: (onClose: () => void) => ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const tabs = pickTabs(entries);
  const tabActive = tabs.some(isActive);

  return (
    <>
      <nav className="bottom-tabs" aria-label={t("nav.mobile.tabsLabel")}>
        {tabs.map((item) => {
          const active = isActive(item);
          const badge = badges?.[item.href] ?? 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`bottom-tab ${active ? "active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <span aria-hidden className="[&_svg]:size-[22px]">
                {item.icon}
              </span>
              <span className="max-w-full truncate px-1">
                {SHORT_LABELS[item.href] ? t(SHORT_LABELS[item.href]!) : item.label}
              </span>
              {badge > 0 ? (
                <span className="badge" aria-label={t("nav.mobile.badge", { count: badge })}>
                  {badge > 99 ? "99+" : badge}
                </span>
              ) : null}
            </Link>
          );
        })}
        <button
          type="button"
          className={`bottom-tab ${menuOpen || !tabActive ? "active" : ""}`}
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          onClick={() => setMenuOpen(true)}
        >
          <LayoutGrid size={22} aria-hidden />
          <span>{t("nav.mobile.menu")}</span>
        </button>
      </nav>
      {menuOpen ? renderMenu(closeMenu) : null}
    </>
  );
}

export function MobileMenuSheet({
  onClose,
  entries,
  isActive,
  garageName,
  userName,
  userMeta,
  showSettings,
  onSignOut,
  unreadCount,
}: {
  onClose: () => void;
  entries: MenuEntryDef[];
  isActive: (item: MenuItemDef) => boolean;
  garageName: string;
  userName: string;
  userMeta: string;
  showSettings: boolean;
  onSignOut: () => void;
  unreadCount: number;
}) {
  const [query, setQuery] = useState("");
  const { standalone } = useInstallState();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const match = (item: MenuItemDef, groupLabel?: string) =>
    !q || item.label.toLowerCase().includes(q) || (groupLabel ?? "").toLowerCase().includes(q);
  const sections = entries
    .map((entry) =>
      entry.kind === "link"
        ? {
            id: entry.item.href,
            label: null as string | null,
            items: match(entry.item) ? [entry.item] : [],
          }
        : {
            id: entry.id,
            label: entry.label,
            items: entry.items.filter((item) => match(item, entry.label)),
          },
    )
    .filter((section) => section.items.length > 0);
  const singles = sections.filter((s) => s.label === null).flatMap((s) => s.items);
  const groups = sections.filter((s) => s.label !== null);

  const row = (item: MenuItemDef) => {
    const active = isActive(item);
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          onClick={onClose}
          aria-current={active ? "page" : undefined}
          className={`flex min-h-12 items-center gap-3 rounded-md px-3 text-[15px] ${
            active ? "bg-accent/10 font-semibold text-accent" : "hover:bg-surface-2"
          }`}
        >
          <span aria-hidden className="text-muted [&_svg]:size-5">
            {item.icon}
          </span>
          <span className="flex-1">{item.label}</span>
          {item.badge ? <span className="text-xs text-muted">{item.badge}</span> : null}
          <ChevronRight size={16} className="text-muted" aria-hidden />
        </Link>
      </li>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("nav.mobile.menuTitle")}
      className="fixed inset-0 z-[70] flex flex-col bg-bg"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{garageName}</p>
          <p className="truncate text-xs text-muted">{t("nav.mobile.menuTitle")}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="icon-btn"
          aria-label={t("nav.mobile.close")}
        >
          <X size={22} aria-hidden />
        </button>
      </div>

      <div className="border-b border-border bg-surface px-4 py-2">
        <label className="search-box w-full max-w-none">
          <Search size={16} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("nav.filterPlaceholder")}
            aria-label={t("nav.filterPlaceholder")}
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!q ? (
          <ul className="mb-3 grid grid-cols-2 gap-2">
            <li>
              <Link
                href="/notifications"
                onClick={onClose}
                className="flex min-h-14 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium"
              >
                <Bell size={18} aria-hidden />
                <span className="flex-1">{t("notifications.title")}</span>
                {unreadCount > 0 ? (
                  <span className="rounded-full bg-status-bad px-1.5 text-xs font-bold text-white">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                ) : null}
              </Link>
            </li>
            <li>
              <Link
                href="/profil"
                onClick={onClose}
                className="flex min-h-14 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium"
              >
                <UserRound size={18} aria-hidden />
                <span className="flex-1">{t("nav.profile")}</span>
              </Link>
            </li>
          </ul>
        ) : null}

        {singles.length > 0 ? (
          <ul className="mb-2 flex flex-col gap-0.5">{singles.map(row)}</ul>
        ) : null}
        {groups.map((group) => (
          <section key={group.id} className="mb-2">
            <h2 className="px-3 pt-3 pb-1 text-[11px] font-bold tracking-wide text-muted uppercase">
              {group.label}
            </h2>
            <ul className="flex flex-col gap-0.5">{group.items.map(row)}</ul>
          </section>
        ))}
        {showSettings && (!q || t("nav.settings").toLowerCase().includes(q)) ? (
          <ul className="mt-2 border-t border-border pt-2">
            {row({ href: "/parametres", label: t("nav.settings"), icon: <Sliders size={18} /> })}
          </ul>
        ) : null}
        {sections.length === 0 && q ? (
          <p className="px-3 py-6 text-center text-sm text-muted">{t("nav.noMenuFound")}</p>
        ) : null}

        {!q && !standalone ? (
          <section className="mt-4 flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Smartphone size={16} aria-hidden /> {t("pwa.install.title")}
            </h2>
            <InstallCard />
          </section>
        ) : null}
      </div>

      <div className="flex items-center gap-3 border-t border-border bg-surface px-4 py-3">
        <span className="avatar" aria-hidden>
          {userName
            .split(" ")
            .map((p) => p[0])
            .filter(Boolean)
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{userName}</p>
          <p className="truncate text-xs text-muted">{userMeta}</p>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-status-bad hover:bg-surface-2"
        >
          <LogOut size={16} aria-hidden />
          {t("nav.logout")}
        </button>
      </div>
    </div>
  );
}
