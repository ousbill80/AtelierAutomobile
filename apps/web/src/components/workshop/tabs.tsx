"use client";

// M06 §7 — navigation entre les écrans de l'atelier, filtrée par permission (le serveur
// revérifie chaque procédure).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { trpc } from "@/trpc/react";
import { tw } from "./i18n";

const TABS = [
  { href: "/atelier", key: "board", permission: "workshop:view" },
  { href: "/atelier/ponts", key: "bays", permission: "workshop:view" },
  { href: "/atelier/mecaniciens", key: "mechanics", permission: "workshop:view" },
  { href: "/atelier/pointages", key: "timeEntries", permission: "time:edit" },
  { href: "/atelier/controle-qualite", key: "qc", permission: "repair_order:qc" },
  { href: "/atelier/sous-traitance", key: "subcontract", permission: "workshop:subcontract" },
  { href: "/atelier/productivite", key: "productivity", permission: "workshop:productivity" },
  { href: "/atelier/pieces", key: "parts", permission: "stock:issue" },
] as const;

export function WorkshopTabs() {
  const pathname = usePathname();
  const me = trpc.me.get.useQuery(undefined, { staleTime: 60_000 });
  const permissions = new Set<string>(me.data?.permissions ?? []);
  const tabs = TABS.filter((tab) => permissions.has(tab.permission));
  return (
    <nav aria-label={tw("title")} className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 px-1">
        {tabs.map((tab) => {
          const active =
            tab.href === "/atelier" ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium ${
                  active ? "bg-accent text-accent-foreground" : "text-muted hover:bg-surface-2"
                }`}
              >
                {tw(`tabs.${tab.key}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
