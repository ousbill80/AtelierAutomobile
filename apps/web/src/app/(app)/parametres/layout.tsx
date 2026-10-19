"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SettingsLayout } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

const NAV = [
  {
    key: "equipe",
    href: "/parametres/equipe",
    label: "nav.settingsTeam",
    permission: "member:read",
  },
  {
    key: "roles",
    href: "/parametres/roles",
    label: "nav.settingsRoles",
    permission: "role:manage",
  },
  {
    key: "sites",
    href: "/parametres/sites",
    label: "nav.settingsSites",
    permission: "site:manage",
  },
  {
    key: "journal",
    href: "/parametres/journal",
    label: "nav.settingsJournal",
    permission: "audit:read",
  },
] as const;

export default function ParametresLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const me = trpc.me.get.useQuery();

  const permissions = new Set<string>(me.data?.permissions ?? []);
  const items = NAV.filter((item) => permissions.has(item.permission)).map((item) => ({
    key: item.key,
    label: t(item.label),
  }));
  const activeKey = NAV.find((item) => pathname.startsWith(item.href))?.key ?? items[0]?.key ?? "";

  return (
    <SettingsLayout
      items={items}
      activeKey={activeKey}
      onChange={(key) => {
        const target = NAV.find((item) => item.key === key);
        if (target) router.push(target.href);
      }}
    >
      {children}
    </SettingsLayout>
  );
}
