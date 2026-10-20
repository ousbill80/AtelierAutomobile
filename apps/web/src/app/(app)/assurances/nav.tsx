"use client";

// M16 §7 — sous-navigation du module assurances (tableau de bord, sinistres, compagnies, relances).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/components/claims/i18n";

const ITEMS = [
  { href: "/assurances", key: "title" },
  { href: "/assurances/sinistres", key: "claimsTitle" },
  { href: "/assurances/compagnies", key: "insurersTitle" },
  { href: "/assurances/relances", key: "followUpsTitle" },
] as const;

export function ClaimsNav() {
  const path = usePathname();
  return (
    <nav aria-label={t("title")} className="flex max-w-full gap-2 overflow-x-auto">
      {ITEMS.map((item) => {
        const active =
          item.href === "/assurances" ? path === item.href : path.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`btn min-h-11 whitespace-nowrap ${active ? "btn-primary" : "btn-secondary"}`}
          >
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
