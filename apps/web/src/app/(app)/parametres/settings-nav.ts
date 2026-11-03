// Pages de paramètres (menu de gauche de /parametres) : libellé, lien, permission requise.
// Partagé par le layout, la page d'entrée /parametres et la barre latérale.
export const SETTINGS_NAV = [
  // M15 RG-M15-01/02/03 — identité légale, TVA, mentions.
  {
    key: "garage",
    group: "garage",
    href: "/parametres/garage",
    label: "nav.settingsGarage",
    permission: "settings:read",
  },
  {
    key: "equipe",
    group: "team",
    href: "/parametres/equipe",
    label: "nav.settingsTeam",
    permission: "member:read",
  },
  {
    key: "roles",
    group: "team",
    href: "/parametres/roles",
    label: "nav.settingsRoles",
    permission: "role:manage",
  },
  {
    key: "sites",
    group: "garage",
    href: "/parametres/sites",
    label: "nav.settingsSites",
    permission: "site:manage",
  },
  // M15 RG-M15-08 — jours fériés et fermetures exceptionnelles.
  {
    key: "jours-feries",
    group: "garage",
    href: "/parametres/jours-feries",
    label: "nav.settingsHolidays",
    permission: "site:manage",
  },
  // M15 RG-M15-12 — numérotation des documents.
  {
    key: "documents",
    group: "billing",
    href: "/parametres/documents",
    label: "nav.settingsDocuments",
    permission: "settings:read",
  },
  // M11/M10 — canaux, modèles de messages et règles de relance (écrans existants).
  {
    key: "canaux",
    group: "messaging",
    href: "/parametres/canaux",
    label: "nav.settingsChannels",
    permission: "settings:channels",
  },
  {
    key: "modeles",
    group: "messaging",
    href: "/parametres/modeles",
    label: "nav.settingsTemplates",
    permission: "message:read",
  },
  {
    key: "relances",
    group: "messaging",
    href: "/parametres/relances",
    label: "nav.settingsReminderRules",
    permission: "reminder:read",
  },
  {
    key: "planning",
    group: "garage",
    href: "/parametres/planning",
    label: "nav.settingsPlanning",
    permission: "appointment:read",
  },
  {
    key: "journal",
    group: "team",
    href: "/parametres/journal",
    label: "nav.settingsJournal",
    permission: "audit:read",
  },
  // M04 — ordres de réparation et modèles d'inspection.
  {
    key: "ordres",
    group: "workshop",
    href: "/parametres/ordres",
    label: "nav.settingsRepairOrders",
    permission: "settings:update",
  },
  {
    key: "inspection",
    group: "workshop",
    href: "/parametres/inspection",
    label: "nav.settingsInspection",
    permission: "inspection:template_manage",
  },
  // M05 — devis et catalogue de main-d'œuvre.
  {
    key: "devis",
    group: "workshop",
    href: "/parametres/devis",
    label: "nav.settingsQuotes",
    permission: "settings:update",
  },
  {
    key: "catalogue-mo",
    group: "workshop",
    href: "/parametres/catalogue-mo",
    label: "nav.settingsLaborCatalog",
    permission: "labor_catalog:manage",
  },
  // M08 / M15 RG-M15-18 — facture normalisée électronique.
  {
    key: "fne",
    group: "billing",
    href: "/parametres/fne",
    label: "nav.settingsFne",
    permission: "settings:fne",
  },
  // M15 RG-M15-17 — fournisseurs de liens de paiement et numéros marchands.
  {
    key: "paiements",
    group: "billing",
    href: "/parametres/paiements",
    label: "nav.settingsPayments",
    permission: "settings:payments",
  },
  // M17 RG-M17-10 — fonctions IA, consommation et journal.
  {
    key: "ia",
    group: "advanced",
    href: "/parametres/ia",
    label: "nav.settingsAi",
    permission: "ai:configure",
  },
  // M17 RG-M17-23 — automatisations « si… alors… » (ai:configure + reminder:rules_manage).
  {
    key: "automatisations",
    group: "advanced",
    href: "/parametres/automatisations",
    label: "automations.nav",
    permission: "ai:configure",
  },
  // M13 §7 — clés de l'API publique et webhooks sortants (étape 6.4).
  {
    key: "api",
    group: "advanced",
    href: "/parametres/api",
    label: "nav.settingsApi",
    permission: "integration:manage",
  },
  // M15 RG-M15-19..22 — abonnement, export complet, suppression du compte.
  {
    key: "abonnement",
    group: "account",
    href: "/parametres/abonnement",
    label: "nav.settingsSubscription",
    permission: "settings:billing",
  },
  {
    key: "donnees",
    group: "account",
    href: "/parametres/donnees",
    label: "nav.settingsData",
    permission: "settings:billing",
  },
] as const;

/** Groupes du menu, dans l'ordre d'affichage. */
export const SETTINGS_GROUPS = [
  "garage",
  "team",
  "workshop",
  "billing",
  "messaging",
  "advanced",
  "account",
] as const;

export const SETTINGS_PERMISSIONS = [...new Set(SETTINGS_NAV.map((item) => item.permission))];

/** Première page de paramètres accessible avec ces permissions. */
export function firstSettingsHref(permissions: ReadonlySet<string>): string | null {
  for (const group of SETTINGS_GROUPS) {
    const item = SETTINGS_NAV.find((i) => i.group === group && permissions.has(i.permission));
    if (item) return item.href;
  }
  return null;
}
