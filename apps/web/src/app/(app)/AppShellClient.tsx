"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { inferRouterOutputs } from "@trpc/server";
import {
  BarChart3,
  Boxes,
  Calendar,
  CalendarCheck,
  CalendarClock,
  CalendarRange,
  Car,
  CheckCheck,
  CircleDollarSign,
  ClipboardList,
  Copy,
  CreditCard,
  FileText,
  HandCoins,
  History,
  Landmark,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  Receipt,
  Send,
  ShieldCheck,
  ShoppingCart,
  Sliders,
  Sparkles,
  Star,
  Tablet,
  UploadCloud,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
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
  SidebarSearch,
  NavGroup,
  Topbar,
  TopbarActions,
} from "@atelieros/ui";
import { formatDate } from "@atelieros/core/calendar";
import type { AppRouter } from "@/server/routers/_app";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";
import { setStoredActiveOrgId } from "@/trpc/active-org";
import { GlobalSearch } from "@/components/global-search";
import { SETTINGS_PERMISSIONS } from "./parametres/settings-nav";

type Me = inferRouterOutputs<AppRouter>["me"]["get"];

interface MenuItemDef {
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
type MenuEntryDef =
  | { kind: "link"; item: MenuItemDef }
  | { kind: "group"; id: string; label: string; icon: ReactNode; items: MenuItemDef[] };

export function AppShellClient({ me, children }: { me: Me; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [profileOpen, setProfileOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [menuFilter, setMenuFilter] = useState("");

  const permissions = new Set<string>(me.permissions);
  const has = (permission?: string | string[]) => {
    if (!permission) return true;
    return Array.isArray(permission)
      ? permission.some((p) => permissions.has(p))
      : permissions.has(permission);
  };

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

  const isRemindersOnly = me.activeOrganization?.operatingMode === "REMINDERS_ONLY";
  const isMechanic = me.membership?.role === "MECHANIC";

  const menuEntries: MenuEntryDef[] = useMemo(() => {
    const link = (item: MenuItemDef): MenuEntryDef => ({ kind: "link", item });
    const group = (
      id: string,
      label: string,
      icon: ReactNode,
      items: MenuItemDef[],
    ): MenuEntryDef => ({ kind: "group", id, label, icon, items });
    return [
      link({
        href: "/tableau-de-bord",
        label: t("nav.dashboard"),
        icon: <LayoutDashboard size={17} strokeWidth={2} />,
        permission: [
          "dashboard:owner",
          "repair_order:read",
          "reminder:read",
          "report:financial",
          "cash:operate",
        ],
        hidden: isMechanic,
      }),
      link({
        href: "/rapports",
        label: t("nav.reports"),
        icon: <BarChart3 size={17} strokeWidth={2} />,
        permission: ["report:read", "report:financial"],
      }),
      group("appointments", t("nav.appointments"), <Calendar size={17} strokeWidth={2} />, [
        {
          href: "/rendez-vous",
          label: t("nav.planning"),
          icon: <CalendarRange size={16} strokeWidth={2} />,
          permission: "appointment:read",
          exact: true,
        },
        {
          href: "/rendez-vous/aujourdhui",
          label: t("nav.appointmentsToday"),
          icon: <CalendarCheck size={16} strokeWidth={2} />,
          permission: "appointment:read",
        },
      ]),
      group("workshop", t("nav.groupWorkshop"), <Wrench size={17} strokeWidth={2} />, [
        {
          href: "/ordres",
          label: t("nav.repairOrders"),
          icon: <ClipboardList size={16} strokeWidth={2} />,
          permission: "repair_order:read",
          hidden: isRemindersOnly,
        },
        {
          href: "/atelier",
          label: t("nav.workshopBoard"),
          icon: <Wrench size={16} strokeWidth={2} />,
          permission: "workshop:view",
          hidden: isRemindersOnly,
        },
        {
          href: "/tablette",
          label: t("nav.tablet"),
          icon: <Tablet size={16} strokeWidth={2} />,
          permission: "time:clock",
          hidden: isRemindersOnly,
        },
      ]),
      group("billing", t("nav.sectionBilling"), <Receipt size={17} strokeWidth={2} />, [
        {
          href: "/devis",
          label: t("nav.quotes"),
          icon: <FileText size={16} strokeWidth={2} />,
          permission: "quote:read",
          hidden: isRemindersOnly,
        },
        {
          href: "/factures",
          label: t("nav.invoices"),
          icon: <Receipt size={16} strokeWidth={2} />,
          permission: "invoice:read",
        },
        {
          href: "/assurances",
          label: t("nav.insurance"),
          icon: <ShieldCheck size={16} strokeWidth={2} />,
          permission: "insurance:read",
          hidden: isRemindersOnly,
        },
        {
          href: "/creances",
          label: t("nav.receivables"),
          icon: <CircleDollarSign size={16} strokeWidth={2} />,
          permission: "receivable:read",
        },
      ]),
      group("treasury", t("nav.sectionTreasury"), <Landmark size={17} strokeWidth={2} />, [
        {
          href: "/tresorerie",
          label: t("nav.treasuryOverview"),
          icon: <Landmark size={16} strokeWidth={2} />,
          permission: "treasury:read",
          hidden: isRemindersOnly,
          exact: true,
        },
        {
          href: "/caisse",
          label: t("nav.cashToday"),
          icon: <Wallet size={16} strokeWidth={2} />,
          permission: "payment:read",
          hidden: isRemindersOnly,
          exact: true,
        },
        {
          href: "/caisse/depenses",
          label: t("nav.cashExpenses"),
          icon: <HandCoins size={16} strokeWidth={2} />,
          permission: "payment:read",
          hidden: isRemindersOnly,
        },
        {
          href: "/caisse/paiements",
          label: t("nav.payments"),
          icon: <CreditCard size={16} strokeWidth={2} />,
          permission: "payment:read",
          hidden: isRemindersOnly,
        },
        {
          href: "/caisse/sessions",
          label: t("nav.cashSessions"),
          icon: <History size={16} strokeWidth={2} />,
          permission: "payment:read",
          hidden: isRemindersOnly,
        },
        {
          href: "/tresorerie/journal",
          label: t("nav.treasuryJournal"),
          icon: <ListChecks size={16} strokeWidth={2} />,
          permission: "treasury:read",
          hidden: isRemindersOnly,
        },
        {
          href: "/tresorerie/rapports",
          label: t("nav.treasuryReports"),
          icon: <BarChart3 size={16} strokeWidth={2} />,
          permission: "treasury:read",
          hidden: isRemindersOnly,
        },
      ]),
      group("reminders", t("nav.reminders"), <Send size={17} strokeWidth={2} />, [
        {
          href: "/relances",
          label: t("nav.remindersQueue"),
          icon: <Send size={16} strokeWidth={2} />,
          permission: "reminder:read",
          exact: true,
        },
        {
          href: "/relances/echeances",
          label: t("nav.dueDates"),
          icon: <CalendarClock size={16} strokeWidth={2} />,
          permission: "reminder:read",
        },
        {
          href: "/relances/resultats",
          label: t("nav.reminderResults"),
          icon: <CheckCheck size={16} strokeWidth={2} />,
          permission: "reminder:read",
        },
        {
          href: "/messages",
          label: t("nav.messages"),
          icon: <MessageSquare size={16} strokeWidth={2} />,
          permission: "message:read",
        },
      ]),
      link({
        href: "/assistant",
        label: t("nav.assistant"),
        icon: <Sparkles size={17} strokeWidth={2} />,
        permission: "ai:use",
        badge: t("nav.aiBadge"),
        badgeVariant: "ai",
      }),
      group("customers", t("nav.sectionFleet"), <Users size={17} strokeWidth={2} />, [
        {
          href: "/clients",
          label: t("nav.customers"),
          icon: <Users size={16} strokeWidth={2} />,
          permission: "customer:read",
          exact: true,
        },
        {
          href: "/vehicules",
          label: t("nav.vehicles"),
          icon: <Car size={16} strokeWidth={2} />,
          permission: "vehicle:read",
        },
        {
          href: "/clients/doublons",
          label: t("nav.duplicates"),
          icon: <Copy size={16} strokeWidth={2} />,
          permission: "customer:merge",
        },
        {
          href: "/clients/avis",
          label: t("nav.reviews"),
          icon: <Star size={16} strokeWidth={2} />,
          permission: "customer:read",
        },
      ]),
      group("inventory", t("nav.sectionInventory"), <Boxes size={17} strokeWidth={2} />, [
        {
          href: "/stock",
          label: t("nav.stock"),
          icon: <Boxes size={16} strokeWidth={2} />,
          permission: "stock:read",
        },
        {
          href: "/achats",
          label: t("nav.purchases"),
          icon: <ShoppingCart size={16} strokeWidth={2} />,
          permission: "purchase:read",
        },
        {
          href: "/import",
          label: t("nav.import"),
          icon: <UploadCloud size={16} strokeWidth={2} />,
          permission: "import:run",
        },
      ]),
      // Les pages de paramètres ont leur propre menu à gauche : lien simple ici.
      link({
        href: "/parametres",
        label: t("nav.settings"),
        icon: <Sliders size={17} strokeWidth={2} />,
        permission: SETTINGS_PERMISSIONS,
      }),
    ];
  }, [isMechanic, isRemindersOnly]);

  const filteredEntries = useMemo(() => {
    const query = menuFilter.trim().toLowerCase();
    const visible = (item: MenuItemDef) => has(item.permission) && !item.hidden;
    const matches = (label: string, href?: string) =>
      !query || label.toLowerCase().includes(query) || (href ?? "").toLowerCase().includes(query);
    return menuEntries.flatMap((entry): MenuEntryDef[] => {
      if (entry.kind === "link") {
        return visible(entry.item) && matches(entry.item.label, entry.item.href) ? [entry] : [];
      }
      const items = entry.items.filter(
        (item) => visible(item) && (matches(entry.label) || matches(item.label, item.href)),
      );
      return items.length > 0 ? [{ ...entry, items }] : [];
    });
  }, [menuEntries, menuFilter, permissions]);

  // Menus ouverts : ceux choisis par l'utilisateur, plus celui de la page courante.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  function isItemActive(item: MenuItemDef) {
    if (item.exact) return pathname === item.href;
    if (item.href === "/" || item.href === "/tableau-de-bord") {
      return pathname === "/" || pathname === "/tableau-de-bord";
    }
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  return (
    <AppShell>
      <Sidebar
        garageName={me.activeOrganization?.name ?? t("common.appName")}
        garageSub={garageSub}
        logoLabel={t("common.appName")}
        logoIcon={<Wrench size={19} strokeWidth={2.4} />}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        collapseLabel={t("nav.collapseSidebar")}
        expandLabel={t("nav.expandSidebar")}
        footer={!collapsed ? <span>{t("nav.sidebarFooter")}</span> : null}
      >
        {!collapsed ? (
          <SidebarSearch
            value={menuFilter}
            onChange={setMenuFilter}
            placeholder={t("nav.filterPlaceholder")}
            clearLabel={t("nav.clearMenuFilter")}
          />
        ) : null}

        {filteredEntries.map((entry) => {
          if (entry.kind === "link") {
            const item = entry.item;
            return (
              <NavItem
                key={item.href}
                as={Link}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isItemActive(item)}
                badge={item.badge}
                badgeVariant={item.badgeVariant}
              />
            );
          }
          const active = entry.items.some(isItemActive);
          const open = menuFilter.trim() !== "" || (openGroups[entry.id] ?? active);
          return (
            <NavGroup
              key={entry.id}
              label={entry.label}
              icon={entry.icon}
              count={entry.items.length}
              open={open}
              active={active}
              onToggle={() => setOpenGroups((g) => ({ ...g, [entry.id]: !open }))}
            >
              {entry.items.map((item) => (
                <NavItem
                  key={item.href}
                  as={Link}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={isItemActive(item)}
                  badge={item.badge}
                  badgeVariant={item.badgeVariant}
                />
              ))}
            </NavGroup>
          );
        })}

        {filteredEntries.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-white/70">{t("nav.noMenuFound")}</div>
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

          {has("customer:read") ? <GlobalSearch /> : <SearchBox placeholder={t("common.search")} />}

          <TopbarActions>
            <IconButton aria-label={t("nav.notifications")} />
            <div className="dropdown-wrap">
              <Avatar label={me.user?.name ?? "?"} onClick={() => setProfileOpen((v) => !v)} />
              <DropdownMenu open={profileOpen} onClose={() => setProfileOpen(false)}>
                {me.organizations.length > 1 ? (
                  <>
                    <div className="item text-[11px] font-bold uppercase opacity-60">
                      {t("nav.myGarages")}
                    </div>
                    {me.organizations.map((org) => (
                      <DropdownItem
                        key={org.id}
                        onClick={() => {
                          setActiveOrganization.mutate({ organizationId: org.id });
                          setProfileOpen(false);
                        }}
                      >
                        {org.name}
                        {org.id === me.activeOrganization?.id ? " ✓" : ""}
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
        {me.activeOrganization &&
        (me.activeOrganization.lifecycleStatus === "DELETION_SCHEDULED" ||
          me.activeOrganization.lifecycleStatus === "SUSPENDED") ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 border-b border-status-bad bg-surface-2 px-4 py-3 text-sm"
          >
            <span aria-hidden="true">⚠</span>
            <span className="flex-1">
              {t(`lifecycleBanner.${me.activeOrganization.lifecycleStatus}`, {
                date: me.activeOrganization.deletionScheduledFor
                  ? formatDate(
                      new Date(me.activeOrganization.deletionScheduledFor),
                      me.activeOrganization.timezone,
                    )
                  : "",
              })}
            </span>
            {has("settings:billing") ? (
              <Link className="btn btn-secondary btn-sm min-h-11" href="/parametres/donnees">
                {t("lifecycleBanner.manage")}
              </Link>
            ) : null}
          </div>
        ) : null}
        <Content>{children}</Content>
      </AppMain>
    </AppShell>
  );
}
