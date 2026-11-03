import type { ReactNode } from "react";

export interface MenuItemDef {
  href: string;
  label: string;
  icon: ReactNode;
  permission?: string | string[];
  hidden?: boolean;
  badge?: ReactNode;
  badgeVariant?: "default" | "accent" | "ai" | "warn";
  exact?: boolean;
}

/** Entrée du menu : lien direct, ou menu repliable avec ses sous-menus. */
export type MenuEntryDef =
  | { kind: "link"; item: MenuItemDef }
  | { kind: "group"; id: string; label: string; icon: ReactNode; items: MenuItemDef[] };
