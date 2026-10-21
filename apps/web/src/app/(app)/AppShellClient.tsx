"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { inferRouterOutputs } from "@trpc/server";
import {
  BarChart3,
  Boxes,
  Building2,
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
  FileCode,
  FileSignature,
  FileText,
  FolderCog,
  History,
  KeyRound,
  Layers,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  Radio,
  Receipt,
  Send,
  Shield,
  ShieldCheck,
  ShoppingCart,
  Sliders,
  Sparkles,
  Star,
  Tablet,
  UploadCloud,
  Users,
  Wallet,
  Webhook,
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
  SidebarSection,
  Topbar,
  TopbarActions,
} from "@atelieros/ui";
import { formatDate } from "@atelieros/core/calendar";
import type { AppRouter } from "@/server/routers/_app";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";
import { setStoredActiveOrgId } from "@/trpc/active-org";
import { GlobalSearch } from "@/components/global-search";
import { NavigationProgress } from "@/components/navigation-progress";

type Me = inferRouterOutputs<AppRouter>["me"]["get"];

interface MenuItemDef {
  href: string;
  label: string;
  icon: ReactNode;
  permission?: string | string[];
  hidden?: boolean;
  subItem?: boolean;
  badge?: ReactNode;
  badgeVariant?: "default" | "accent" | "ai" | "warn";
  exact?: boolean;
}

interface MenuSectionDef {
  id: string;
  label: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  items: MenuItemDef[];
}

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

  const menuSections: MenuSectionDef[] = useMemo(() => {
    return [
      {
        id: "overview",
        label: t("nav.sectionOverview"),
        items: [
          {
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
          },
          {
            href: "/rapports",
            label: t("nav.reports"),
            icon: <BarChart3 size={17} strokeWidth={2} />,
            permission: ["report:read", "report:financial"],
          },
        ],
      },
      {
        id: "workshop",
        label: t("nav.sectionWorkshop"),
        items: [
          {
            href: "/rendez-vous",
            label: t("nav.appointments"),
            icon: <Calendar size={17} strokeWidth={2} />,
            permission: "appointment:read",
            exact: true,
          },
          {
            href: "/rendez-vous/aujourdhui",
            label: t("nav.appointmentsToday"),
            icon: <CalendarCheck size={16} strokeWidth={2} />,
            permission: "appointment:read",
            subItem: true,
          },
          {
            href: "/ordres",
            label: t("nav.repairOrders"),
            icon: <ClipboardList size={17} strokeWidth={2} />,
            permission: "repair_order:read",
            hidden: isRemindersOnly,
          },
          {
            href: "/atelier",
            label: t("nav.workshop"),
            icon: <Wrench size={17} strokeWidth={2} />,
            permission: "workshop:view",
            hidden: isRemindersOnly,
          },
          {
            href: "/tablette",
            label: t("nav.tablet"),
            icon: <Tablet size={17} strokeWidth={2} />,
            permission: "time:clock",
            hidden: isRemindersOnly,
          },
        ],
      },
      {
        id: "billing",
        label: t("nav.sectionBilling"),
        items: [
          {
            href: "/devis",
            label: t("nav.quotes"),
            icon: <FileText size={17} strokeWidth={2} />,
            permission: "quote:read",
            hidden: isRemindersOnly,
          },
          {
            href: "/factures",
            label: t("nav.invoices"),
            icon: <Receipt size={17} strokeWidth={2} />,
            permission: "invoice:read",
          },
          {
            href: "/caisse",
            label: t("nav.cash"),
            icon: <Wallet size={17} strokeWidth={2} />,
            permission: "payment:read",
            hidden: isRemindersOnly,
          },
          {
            href: "/assurances",
            label: t("nav.insurance"),
            icon: <ShieldCheck size={17} strokeWidth={2} />,
            permission: "insurance:read",
            hidden: isRemindersOnly,
          },
          {
            href: "/creances",
            label: t("nav.receivables"),
            icon: <CircleDollarSign size={17} strokeWidth={2} />,
            permission: "receivable:read",
          },
        ],
      },
      {
        id: "crm",
        label: t("nav.sectionCrm"),
        items: [
          {
            href: "/assistant",
            label: t("nav.assistant"),
            icon: <Sparkles size={17} strokeWidth={2} />,
            permission: "ai:use",
            badge: t("nav.aiBadge"),
            badgeVariant: "ai",
          },
          {
            href: "/relances",
            label: t("nav.reminders"),
            icon: <Send size={17} strokeWidth={2} />,
            permission: "reminder:read",
            exact: true,
          },
          {
            href: "/relances/echeances",
            label: t("nav.dueDates"),
            icon: <CalendarClock size={16} strokeWidth={2} />,
            permission: "reminder:read",
            subItem: true,
          },
          {
            href: "/relances/resultats",
            label: t("nav.reminderResults"),
            icon: <CheckCheck size={16} strokeWidth={2} />,
            permission: "reminder:read",
            subItem: true,
          },
          {
            href: "/messages",
            label: t("nav.messages"),
            icon: <MessageSquare size={17} strokeWidth={2} />,
            permission: "message:read",
          },
        ],
      },
      {
        id: "fleet",
        label: t("nav.sectionFleet"),
        items: [
          {
            href: "/clients",
            label: t("nav.customers"),
            icon: <Users size={17} strokeWidth={2} />,
            permission: "customer:read",
            exact: true,
          },
          {
            href: "/clients/doublons",
            label: t("nav.duplicates"),
            icon: <Copy size={16} strokeWidth={2} />,
            permission: "customer:merge",
            subItem: true,
          },
          {
            href: "/clients/avis",
            label: t("nav.reviews"),
            icon: <Star size={16} strokeWidth={2} />,
            permission: "customer:read",
            subItem: true,
          },
          {
            href: "/vehicules",
            label: t("nav.vehicles"),
            icon: <Car size={17} strokeWidth={2} />,
            permission: "vehicle:read",
          },
        ],
      },
      {
        id: "inventory",
        label: t("nav.sectionInventory"),
        items: [
          {
            href: "/stock",
            label: t("nav.stock"),
            icon: <Boxes size={17} strokeWidth={2} />,
            permission: "stock:read",
          },
          {
            href: "/achats",
            label: t("nav.purchases"),
            icon: <ShoppingCart size={17} strokeWidth={2} />,
            permission: "purchase:read",
          },
          {
            href: "/import",
            label: t("nav.import"),
            icon: <UploadCloud size={17} strokeWidth={2} />,
            permission: "import:run",
          },
        ],
      },
      {
        id: "settings",
        label: t("nav.settings"),
        collapsible: true,
        defaultOpen: pathname.startsWith("/parametres"),
        items: [
          {
            href: "/parametres/garage",
            label: t("nav.settingsGarage"),
            icon: <Building2 size={16} strokeWidth={2} />,
            permission: "settings:update",
          },
          {
            href: "/parametres/equipe",
            label: t("nav.settingsTeam"),
            icon: <Users size={16} strokeWidth={2} />,
            permission: "member:read",
          },
          {
            href: "/parametres/roles",
            label: t("nav.settingsRoles"),
            icon: <Shield size={16} strokeWidth={2} />,
            permission: "role:manage",
          },
          {
            href: "/parametres/sites",
            label: t("nav.settingsSites"),
            icon: <Building2 size={16} strokeWidth={2} />,
            permission: "site:manage",
          },
          {
            href: "/parametres/jours-feries",
            label: t("nav.settingsHolidays"),
            icon: <CalendarRange size={16} strokeWidth={2} />,
            permission: "site:manage",
          },
          {
            href: "/parametres/journal",
            label: t("nav.settingsJournal"),
            icon: <History size={16} strokeWidth={2} />,
            permission: "audit:read",
          },
          {
            href: "/parametres/canaux",
            label: t("nav.settingsChannels"),
            icon: <Radio size={16} strokeWidth={2} />,
            permission: "settings:channels",
          },
          {
            href: "/parametres/modeles",
            label: t("nav.settingsTemplates"),
            icon: <FileCode size={16} strokeWidth={2} />,
            permission: "template:manage",
          },
          {
            href: "/parametres/relances",
            label: t("nav.settingsReminderRules"),
            icon: <Sliders size={16} strokeWidth={2} />,
            permission: "reminder:rules_manage",
          },
          {
            href: "/parametres/automatisations",
            label: t("nav.settingsAutomations"),
            icon: <Sparkles size={16} strokeWidth={2} />,
            permission: ["ai:configure", "reminder:rules_manage"],
          },
          {
            href: "/parametres/planning",
            label: t("nav.settingsPlanning"),
            icon: <CalendarRange size={16} strokeWidth={2} />,
            permission: "planning:manage",
          },
          {
            href: "/parametres/ordres",
            label: t("nav.settingsRepairOrders"),
            icon: <FolderCog size={16} strokeWidth={2} />,
            permission: "settings:update",
          },
          {
            href: "/parametres/inspection",
            label: t("nav.settingsInspection"),
            icon: <ListChecks size={16} strokeWidth={2} />,
            permission: "inspection:template_manage",
          },
          {
            href: "/parametres/devis",
            label: t("nav.settingsQuotes"),
            icon: <FileSignature size={16} strokeWidth={2} />,
            permission: "settings:update",
          },
          {
            href: "/parametres/catalogue-mo",
            label: t("nav.settingsLaborCatalog"),
            icon: <Layers size={16} strokeWidth={2} />,
            permission: "labor_catalog:manage",
          },
          {
            href: "/parametres/documents",
            label: t("nav.settingsDocuments"),
            icon: <FileText size={16} strokeWidth={2} />,
            permission: "settings:read",
          },
          {
            href: "/parametres/fne",
            label: t("nav.settingsFne"),
            icon: <Receipt size={16} strokeWidth={2} />,
            permission: "settings:fne",
          },
          {
            href: "/parametres/paiements",
            label: t("nav.settingsPayments"),
            icon: <CreditCard size={16} strokeWidth={2} />,
            permission: "settings:payments",
          },
          {
            href: "/parametres/ia",
            label: t("nav.settingsAi"),
            icon: <Sparkles size={16} strokeWidth={2} />,
            permission: "ai:configure",
          },
          {
            href: "/parametres/abonnement",
            label: t("nav.settingsSubscription"),
            icon: <KeyRound size={16} strokeWidth={2} />,
            permission: "settings:billing",
          },
          {
            href: "/parametres/donnees",
            label: t("nav.settingsData"),
            icon: <Shield size={16} strokeWidth={2} />,
            permission: "settings:billing",
          },
          {
            href: "/parametres/api",
            label: t("nav.settingsApi"),
            icon: <Webhook size={16} strokeWidth={2} />,
            permission: "settings:update",
          },
        ],
      },
    ];
  }, [isMechanic, isRemindersOnly, pathname]);

  const filteredSections = useMemo(() => {
    const query = menuFilter.trim().toLowerCase();
    return menuSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          if (!has(item.permission) || item.hidden) return false;
          if (!query) return true;
          return (
            item.label.toLowerCase().includes(query) || item.href.toLowerCase().includes(query)
          );
        }),
      }))
      .filter((section) => section.items.length > 0);
  }, [menuSections, menuFilter, permissions]);

  function isItemActive(item: MenuItemDef) {
    if (item.exact) return pathname === item.href;
    if (item.href === "/" || item.href === "/tableau-de-bord") {
      return pathname === "/" || pathname === "/tableau-de-bord";
    }
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  return (
    <AppShell>
      <NavigationProgress />
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

        {filteredSections.map((section) => (
          <SidebarSection
            key={section.id}
            label={section.label}
            collapsible={section.collapsible}
            defaultOpen={section.defaultOpen ?? true}
          >
            {section.items.map((item) => (
              <NavItem
                key={item.href}
                as={Link}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isItemActive(item)}
                subItem={item.subItem}
                badge={item.badge}
                badgeVariant={item.badgeVariant}
              />
            ))}
          </SidebarSection>
        ))}

        {filteredSections.length === 0 ? (
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
