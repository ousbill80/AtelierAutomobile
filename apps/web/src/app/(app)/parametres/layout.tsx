"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SettingsLayout } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

const NAV = [
  // M15 RG-M15-01/02/03 — identité légale, TVA, mentions.
  {
    key: "garage",
    href: "/parametres/garage",
    label: "nav.settingsGarage",
    permission: "settings:read",
  },
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
  // M15 RG-M15-08 — jours fériés et fermetures exceptionnelles.
  {
    key: "jours-feries",
    href: "/parametres/jours-feries",
    label: "nav.settingsHolidays",
    permission: "site:manage",
  },
  // M15 RG-M15-12 — numérotation des documents.
  {
    key: "documents",
    href: "/parametres/documents",
    label: "nav.settingsDocuments",
    permission: "settings:read",
  },
  // M11/M10 — canaux, modèles de messages et règles de relance (écrans existants).
  {
    key: "canaux",
    href: "/parametres/canaux",
    label: "nav.settingsChannels",
    permission: "settings:channels",
  },
  {
    key: "modeles",
    href: "/parametres/modeles",
    label: "nav.settingsTemplates",
    permission: "message:read",
  },
  {
    key: "relances",
    href: "/parametres/relances",
    label: "nav.settingsReminderRules",
    permission: "reminder:read",
  },
  {
    key: "planning",
    href: "/parametres/planning",
    label: "nav.settingsPlanning",
    permission: "appointment:read",
  },
  {
    key: "journal",
    href: "/parametres/journal",
    label: "nav.settingsJournal",
    permission: "audit:read",
  },
  // M04 — ordres de réparation et modèles d'inspection.
  {
    key: "ordres",
    href: "/parametres/ordres",
    label: "nav.settingsRepairOrders",
    permission: "settings:update",
  },
  {
    key: "inspection",
    href: "/parametres/inspection",
    label: "nav.settingsInspection",
    permission: "inspection:template_manage",
  },
  // M05 — devis et catalogue de main-d'œuvre.
  {
    key: "devis",
    href: "/parametres/devis",
    label: "nav.settingsQuotes",
    permission: "settings:update",
  },
  {
    key: "catalogue-mo",
    href: "/parametres/catalogue-mo",
    label: "nav.settingsLaborCatalog",
    permission: "labor_catalog:manage",
  },
  // M08 / M15 RG-M15-18 — facture normalisée électronique.
  {
    key: "fne",
    href: "/parametres/fne",
    label: "nav.settingsFne",
    permission: "settings:fne",
  },
  // M15 RG-M15-17 — fournisseurs de liens de paiement et numéros marchands.
  {
    key: "paiements",
    href: "/parametres/paiements",
    label: "nav.settingsPayments",
    permission: "settings:payments",
  },
  // M17 RG-M17-10 — fonctions IA, consommation et journal.
  {
    key: "ia",
    href: "/parametres/ia",
    label: "nav.settingsAi",
    permission: "ai:configure",
  },
  // M17 RG-M17-23 — automatisations « si… alors… » (ai:configure + reminder:rules_manage).
  {
    key: "automatisations",
    href: "/parametres/automatisations",
    label: "automations.nav",
    permission: "ai:configure",
  },
  // M15 RG-M15-19..22 — abonnement, export complet, suppression du compte.
  {
    key: "abonnement",
    href: "/parametres/abonnement",
    label: "nav.settingsSubscription",
    permission: "settings:billing",
  },
  {
    key: "donnees",
    href: "/parametres/donnees",
    label: "nav.settingsData",
    permission: "settings:billing",
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
