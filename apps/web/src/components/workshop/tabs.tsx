"use client";

// M06 §7 — navigation entre les écrans de l'atelier, filtrée par permission (le serveur
// revérifie chaque procédure) avec indicateurs en direct.
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

  // Indicateurs temps réel (staleTime pour ne pas surcharger)
  const board = trpc.workshop.board.useQuery(
    {},
    { enabled: permissions.has("workshop:view"), staleTime: 30_000, refetchInterval: 30_000 },
  );
  const bays = trpc.workshop.bays.useQuery(
    {},
    { enabled: permissions.has("workshop:view"), staleTime: 30_000 },
  );
  const mechanics = trpc.workshop.mechanics.useQuery(
    {},
    { enabled: permissions.has("workshop:view"), staleTime: 30_000 },
  );
  const qc = trpc.workshop.qcQueue.useQuery(
    {},
    { enabled: permissions.has("repair_order:qc"), staleTime: 30_000 },
  );
  const parts = trpc.partRequest.list.useQuery(
    {},
    { enabled: permissions.has("stock:issue"), staleTime: 30_000 },
  );

  const tabs = TABS.filter((tab) => permissions.has(tab.permission));

  const getBadge = (key: (typeof TABS)[number]["key"]) => {
    switch (key) {
      case "board": {
        const total = board.data?.columns.reduce((s, c) => s + c.cards.length, 0) ?? 0;
        const late = board.data?.lateCount ?? 0;
        if (total === 0) return null;
        return (
          <span className="flex items-center gap-1">
            <span className="rounded-full bg-surface-3 px-1.5 py-0.2 text-[11px] font-semibold">
              {total}
            </span>
            {late > 0 ? (
              <span
                className="size-2 rounded-full bg-status-bad"
                title={`${late} OR en retard`}
                aria-label={`${late} OR en retard`}
              />
            ) : null}
          </span>
        );
      }
      case "bays": {
        const allBays = bays.data?.bays ?? [];
        if (allBays.length === 0) return null;
        const occupied = allBays.filter((b) => b.repairOrder !== null).length;
        return (
          <span className="rounded-full bg-surface-3 px-1.5 py-0.2 text-[11px] font-semibold">
            {occupied}/{allBays.length}
          </span>
        );
      }
      case "mechanics": {
        const mecs = mechanics.data?.mechanics ?? [];
        if (mecs.length === 0) return null;
        const present = mecs.filter((m) => m.present).length;
        return (
          <span className="rounded-full bg-surface-3 px-1.5 py-0.2 text-[11px] font-semibold">
            {present}/{mecs.length}
          </span>
        );
      }
      case "qc": {
        const count = qc.data?.length ?? 0;
        if (count === 0) return null;
        return (
          <span className="rounded-full bg-status-warn/20 text-status-warn px-1.5 py-0.2 text-[11px] font-bold">
            {count}
          </span>
        );
      }
      case "parts": {
        const pending =
          parts.data?.filter((p) => p.status === "REQUESTED" || p.status === "PREPARING").length ??
          0;
        if (pending === 0) return null;
        return (
          <span className="rounded-full bg-accent/20 text-accent px-1.5 py-0.2 text-[11px] font-bold">
            {pending}
          </span>
        );
      }
      default:
        return null;
    }
  };

  return (
    <nav aria-label={tw("title")} className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 px-1">
        {tabs.map((tab) => {
          const active =
            tab.href === "/atelier" ? pathname === tab.href : pathname.startsWith(tab.href);
          const badge = getBadge(tab.key);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition ${
                  active
                    ? "bg-foreground text-background font-semibold shadow-sm"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                <span>{tw(`tabs.${tab.key}`)}</span>
                {badge}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
