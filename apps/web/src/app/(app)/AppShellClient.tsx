"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { inferRouterOutputs } from "@trpc/server";
import {
  AppMain,
  AppShell,
  Avatar,
  Content,
  DropdownItem,
  DropdownMenu,
  IconButton,
  NavItem,
  SearchBox,
  Sidebar,
  SidebarSectionLabel,
  Topbar,
  TopbarActions,
} from "@atelieros/ui";
import type { AppRouter } from "@/server/routers/_app";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";
import { setStoredActiveOrgId } from "@/trpc/active-org";

type Me = inferRouterOutputs<AppRouter>["me"]["get"];

export function AppShellClient({ me, children }: { me: Me; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [profileOpen, setProfileOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);

  const permissions = new Set<string>(me.permissions);
  const has = (permission: string) => permissions.has(permission);

  const signOut = trpc.auth.signOut.useMutation({
    onSuccess() {
      router.push("/connexion");
      router.refresh();
    },
  });

  const setActiveSite = trpc.session.setActiveSite.useMutation({
    onSuccess() {
      setSiteOpen(false);
      router.refresh();
      utils.me.get.invalidate();
    },
  });

  const setActiveOrganization = trpc.session.setActiveOrganization.useMutation({
    onSuccess(_, variables) {
      setStoredActiveOrgId(variables.organizationId);
      router.push("/");
      router.refresh();
    },
  });

  const activeSite = me.allowedSites.find((site) => site.id === me.activeSiteId);
  const garageSub =
    me.allowedSites.length > 1 ? (activeSite?.name ?? t("common.allSites")) : activeSite?.name;

  const mainItems = [
    { href: "/tableau-de-bord", label: t("nav.ownerDashboard"), permission: "dashboard:owner" },
    { href: "/clients", label: t("nav.customers"), permission: "customer:read" },
    { href: "/vehicules", label: t("nav.vehicles"), permission: "vehicle:read" },
    { href: "/clients/doublons", label: t("nav.duplicates"), permission: "customer:merge" },
    { href: "/messages", label: t("nav.messages"), permission: "message:read" },
    { href: "/relances", label: t("nav.reminders"), permission: "reminder:read" },
    { href: "/relances/echeances", label: t("nav.dueDates"), permission: "reminder:read" },
    {
      href: "/relances/resultats",
      label: t("nav.reminderResults"),
      permission: "reminder:read",
    },
    { href: "/creances", label: t("nav.receivables"), permission: "receivable:read" },
    { href: "/import", label: t("nav.import"), permission: "import:run" },
  ].filter((item) => has(item.permission));

  const settingsItems = [
    { href: "/parametres/equipe", label: t("nav.settingsTeam"), permission: "member:read" },
    { href: "/parametres/roles", label: t("nav.settingsRoles"), permission: "role:manage" },
    { href: "/parametres/sites", label: t("nav.settingsSites"), permission: "site:manage" },
    { href: "/parametres/journal", label: t("nav.settingsJournal"), permission: "audit:read" },
    {
      href: "/parametres/canaux",
      label: t("nav.settingsChannels"),
      permission: "settings:channels",
    },
    {
      href: "/parametres/modeles",
      label: t("nav.settingsTemplates"),
      permission: "template:manage",
    },
    {
      href: "/parametres/relances",
      label: t("nav.settingsReminderRules"),
      permission: "reminder:rules_manage",
    },
  ].filter((item) => has(item.permission));

  return (
    <AppShell>
      <Sidebar
        garageName={me.activeOrganization?.name ?? t("common.appName")}
        garageSub={garageSub}
        logoLabel={t("common.appName")}
      >
        <NavItem as={Link} href="/" label={t("nav.dashboard")} active={pathname === "/"} />
        {mainItems.map((item) => (
          <NavItem
            key={item.href}
            as={Link}
            href={item.href}
            label={item.label}
            active={pathname === item.href}
          />
        ))}
        {settingsItems.length > 0 ? (
          <>
            <SidebarSectionLabel>{t("nav.settings")}</SidebarSectionLabel>
            {settingsItems.map((item) => (
              <NavItem
                key={item.href}
                as={Link}
                href={item.href}
                label={item.label}
                active={pathname.startsWith(item.href)}
              />
            ))}
          </>
        ) : null}
      </Sidebar>
      <AppMain>
        <Topbar>
          {me.allowedSites.length > 1 ? (
            <div className="dropdown-wrap">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setSiteOpen((v) => !v)}
              >
                {garageSub}
              </button>
              <DropdownMenu open={siteOpen} onClose={() => setSiteOpen(false)}>
                <DropdownItem onClick={() => setActiveSite.mutate({ siteId: null })}>
                  {t("common.allSites")}
                </DropdownItem>
                {me.allowedSites.map((site) => (
                  <DropdownItem
                    key={site.id}
                    onClick={() => setActiveSite.mutate({ siteId: site.id })}
                  >
                    {site.name}
                  </DropdownItem>
                ))}
              </DropdownMenu>
            </div>
          ) : null}
          <SearchBox placeholder={t("common.search")} />
          <TopbarActions>
            <IconButton aria-label="Notifications" />
            <div className="dropdown-wrap">
              <Avatar label={me.user?.name ?? "?"} onClick={() => setProfileOpen((v) => !v)} />
              <DropdownMenu open={profileOpen} onClose={() => setProfileOpen(false)}>
                {me.organizations.length > 1 ? (
                  <>
                    {me.organizations.map((org) => (
                      <DropdownItem
                        key={org.id}
                        onClick={() => setActiveOrganization.mutate({ organizationId: org.id })}
                      >
                        {org.name}
                      </DropdownItem>
                    ))}
                    <hr className="sep" />
                  </>
                ) : null}
                <DropdownItem onClick={() => router.push("/profil")}>
                  {t("nav.profile")}
                </DropdownItem>
                <DropdownItem onClick={() => router.push("/profil/securite")}>
                  {t("nav.profileSecurity")}
                </DropdownItem>
                <DropdownItem danger onClick={() => signOut.mutate()}>
                  {t("nav.logout")}
                </DropdownItem>
              </DropdownMenu>
            </div>
          </TopbarActions>
        </Topbar>
        <Content>{children}</Content>
      </AppMain>
    </AppShell>
  );
}
