"use client";

// Paramètres : menu groupé par thème (garage, équipe, atelier, facturation, messages, avancé,
// compte). Sur ordinateur, menu latéral fixe ; sur mobile, une liste déroulante.
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";
import { SETTINGS_GROUPS, SETTINGS_NAV } from "./settings-nav";

export default function ParametresLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const me = trpc.me.get.useQuery();

  const permissions = new Set<string>(me.data?.permissions ?? []);
  const visible = SETTINGS_NAV.filter((item) => permissions.has(item.permission));
  const groups = SETTINGS_GROUPS.map((group) => ({
    group,
    items: visible.filter((item) => item.group === group),
  })).filter((g) => g.items.length > 0);
  const active = SETTINGS_NAV.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );

  return (
    <div className="settings-grid">
      <nav className="settings-nav settings-nav-grouped" aria-label={t("nav.settings")}>
        {me.isLoading ? (
          <div className="flex flex-col gap-2" aria-hidden>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-8 animate-pulse rounded-md bg-surface-2" />
            ))}
          </div>
        ) : (
          groups.map(({ group, items }) => (
            <div key={group} className="settings-nav-group">
              <p className="settings-nav-title">{t(`settingsNav.groups.${group}`)}</p>
              {items.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className={item.key === active?.key ? "active" : ""}
                  aria-current={item.key === active?.key ? "page" : undefined}
                >
                  {t(item.label)}
                </Link>
              ))}
            </div>
          ))
        )}
      </nav>
      <label className="settings-nav-mobile">
        <span className="sr-only">{t("nav.settings")}</span>
        <select
          className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm font-medium"
          value={active?.href ?? ""}
          onChange={(e) => router.push(e.target.value)}
        >
          {!active && <option value="">{t("nav.settings")}</option>}
          {groups.map(({ group, items }) => (
            <optgroup key={group} label={t(`settingsNav.groups.${group}`)}>
              {items.map((item) => (
                <option key={item.key} value={item.href}>
                  {t(item.label)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="settings-content">{children}</div>
    </div>
  );
}
