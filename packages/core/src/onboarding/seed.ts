// RG-M01-16 — Semences créées à la fin de l'étape 2 de l'assistant d'onboarding.
// Relances et modèles de message : jeu complet de M10 (RG-M10-02, Annexe A), partagé avec le
// seed de démonstration via `./reminder-defaults`. Inspections et main-d'œuvre : jeu de
// référence minimal, à enrichir avec M04/M05.

import {
  DEFAULT_MESSAGE_TEMPLATES,
  DEFAULT_REMINDER_RULES,
  type DefaultMessageTemplate,
  type DefaultReminderRule,
  type DefaultReminderStep,
} from "./reminder-defaults";

export type OnboardingBayType = "LIFT" | "DIAGNOSTIC";

export interface OnboardingBaySeed {
  name: string;
  type: OnboardingBayType;
}

/** Lun-ven 07:30–18:00, sam 08:00–14:00, dimanche fermé. */
export function defaultSiteOpeningHours(): Record<string, [string, string][]> {
  const weekday: [string, string][] = [["07:30", "18:00"]];
  return {
    mon: weekday,
    tue: weekday,
    wed: weekday,
    thu: weekday,
    fri: weekday,
    sat: [["08:00", "14:00"]],
    sun: [],
  };
}

export function defaultSiteBays(): OnboardingBaySeed[] {
  return [
    { name: "Pont 1", type: "LIFT" },
    { name: "Pont 2", type: "LIFT" },
    { name: "Diagnostic", type: "DIAGNOSTIC" },
  ];
}

export type OnboardingReminderStep = DefaultReminderStep;
export type OnboardingReminderRuleSeed = DefaultReminderRule;
export type OnboardingMessageTemplateSeed = DefaultMessageTemplate;

/**
 * RG-M01-16 / RG-M10-02 : les 9 règles par défaut de M10 (VT, révision, créances, échéance
 * proche entreprises, RDV, devis, véhicule prêt, assurance, satisfaction). Copie profonde : la
 * constante partagée n'est jamais modifiée par l'appelant.
 */
export function defaultReminderRules(): OnboardingReminderRuleSeed[] {
  return structuredClone(DEFAULT_REMINDER_RULES);
}

/** Annexe A de M10 : un modèle par (clé, canal), y compris les variantes `_pro`. */
export function defaultMessageTemplates(): OnboardingMessageTemplateSeed[] {
  return structuredClone(DEFAULT_MESSAGE_TEMPLATES);
}

export interface OnboardingInspectionItemSeed {
  category: string;
  label: string;
}

/** « Inspection 30 points » (RG-M01-16). */
export function defaultInspectionTemplate(): {
  name: string;
  items: OnboardingInspectionItemSeed[];
} {
  return {
    name: "Inspection 30 points",
    items: [
      { category: "Freinage", label: "Plaquettes avant" },
      { category: "Freinage", label: "Plaquettes arrière" },
      { category: "Freinage", label: "Disques avant" },
      { category: "Freinage", label: "Disques arrière" },
      { category: "Freinage", label: "Liquide de frein" },
      { category: "Freinage", label: "Frein à main" },
      { category: "Pneumatiques", label: "Pneu avant gauche (usure/pression)" },
      { category: "Pneumatiques", label: "Pneu avant droit (usure/pression)" },
      { category: "Pneumatiques", label: "Pneu arrière gauche (usure/pression)" },
      { category: "Pneumatiques", label: "Pneu arrière droit (usure/pression)" },
      { category: "Pneumatiques", label: "Roue de secours" },
      { category: "Éclairage", label: "Feux de croisement" },
      { category: "Éclairage", label: "Feux de route" },
      { category: "Éclairage", label: "Feux stop" },
      { category: "Éclairage", label: "Clignotants" },
      { category: "Éclairage", label: "Feux de recul" },
      { category: "Niveaux", label: "Huile moteur" },
      { category: "Niveaux", label: "Liquide de refroidissement" },
      { category: "Niveaux", label: "Liquide de direction assistée" },
      { category: "Niveaux", label: "Lave-glace" },
      { category: "Direction / Suspension", label: "Amortisseurs avant" },
      { category: "Direction / Suspension", label: "Amortisseurs arrière" },
      { category: "Direction / Suspension", label: "Rotules de direction" },
      { category: "Direction / Suspension", label: "Silent-blocs" },
      { category: "Moteur", label: "Courroie / chaîne de distribution" },
      { category: "Moteur", label: "Batterie" },
      { category: "Moteur", label: "Filtre à air" },
      { category: "Carrosserie", label: "Essuie-glaces" },
      { category: "Carrosserie", label: "Pare-brise (fissures/impacts)" },
      { category: "Divers", label: "Triangle et gilet de sécurité" },
    ],
  };
}

export interface OnboardingLaborOperationSeed {
  code: string;
  name: string;
  category: string;
  standardHours: number;
  rateType: "STANDARD" | "DIAGNOSTIC" | "BODYWORK" | "ELECTRICAL";
}

/** ~25 opérations de main-d'œuvre courantes (RG-M01-16). */
export function defaultLaborOperations(): OnboardingLaborOperationSeed[] {
  return [
    {
      code: "VID001",
      name: "Vidange moteur + filtre à huile",
      category: "Entretien",
      standardHours: 0.5,
      rateType: "STANDARD",
    },
    {
      code: "FRE001",
      name: "Remplacement plaquettes avant",
      category: "Freinage",
      standardHours: 1,
      rateType: "STANDARD",
    },
    {
      code: "FRE002",
      name: "Remplacement plaquettes arrière",
      category: "Freinage",
      standardHours: 1,
      rateType: "STANDARD",
    },
    {
      code: "FRE003",
      name: "Remplacement disques avant",
      category: "Freinage",
      standardHours: 1.5,
      rateType: "STANDARD",
    },
    {
      code: "FRE004",
      name: "Remplacement disques arrière",
      category: "Freinage",
      standardHours: 1.5,
      rateType: "STANDARD",
    },
    {
      code: "FRE005",
      name: "Purge du circuit de freinage",
      category: "Freinage",
      standardHours: 0.75,
      rateType: "STANDARD",
    },
    {
      code: "PNE001",
      name: "Montage + équilibrage pneu",
      category: "Pneumatiques",
      standardHours: 0.5,
      rateType: "STANDARD",
    },
    {
      code: "PNE002",
      name: "Permutation des 4 pneus",
      category: "Pneumatiques",
      standardHours: 0.5,
      rateType: "STANDARD",
    },
    {
      code: "SUS001",
      name: "Remplacement amortisseur avant",
      category: "Suspension",
      standardHours: 1.5,
      rateType: "STANDARD",
    },
    {
      code: "SUS002",
      name: "Remplacement amortisseur arrière",
      category: "Suspension",
      standardHours: 1.5,
      rateType: "STANDARD",
    },
    {
      code: "SUS003",
      name: "Remplacement rotule de direction",
      category: "Suspension",
      standardHours: 1,
      rateType: "STANDARD",
    },
    {
      code: "MOT001",
      name: "Remplacement courroie de distribution",
      category: "Moteur",
      standardHours: 3,
      rateType: "STANDARD",
    },
    {
      code: "MOT002",
      name: "Remplacement batterie",
      category: "Moteur",
      standardHours: 0.25,
      rateType: "ELECTRICAL",
    },
    {
      code: "MOT003",
      name: "Remplacement filtre à air",
      category: "Moteur",
      standardHours: 0.25,
      rateType: "STANDARD",
    },
    {
      code: "MOT004",
      name: "Remplacement bougies d'allumage",
      category: "Moteur",
      standardHours: 0.75,
      rateType: "STANDARD",
    },
    {
      code: "MOT005",
      name: "Remplacement courroie d'accessoires",
      category: "Moteur",
      standardHours: 1,
      rateType: "STANDARD",
    },
    {
      code: "CLI001",
      name: "Recharge climatisation",
      category: "Climatisation",
      standardHours: 1,
      rateType: "STANDARD",
    },
    {
      code: "ELE001",
      name: "Remplacement alternateur",
      category: "Électricité",
      standardHours: 2,
      rateType: "ELECTRICAL",
    },
    {
      code: "ELE002",
      name: "Remplacement démarreur",
      category: "Électricité",
      standardHours: 2,
      rateType: "ELECTRICAL",
    },
    {
      code: "ELE003",
      name: "Diagnostic électronique (voyant moteur)",
      category: "Électricité",
      standardHours: 1,
      rateType: "DIAGNOSTIC",
    },
    {
      code: "ECH001",
      name: "Remplacement échappement",
      category: "Échappement",
      standardHours: 1.5,
      rateType: "STANDARD",
    },
    {
      code: "TRA001",
      name: "Vidange boîte de vitesses",
      category: "Transmission",
      standardHours: 1,
      rateType: "STANDARD",
    },
    {
      code: "TRA002",
      name: "Remplacement embrayage",
      category: "Transmission",
      standardHours: 4,
      rateType: "STANDARD",
    },
    {
      code: "CAR001",
      name: "Remplacement pare-brise",
      category: "Carrosserie",
      standardHours: 1.5,
      rateType: "BODYWORK",
    },
    {
      code: "CAR002",
      name: "Remplacement essuie-glaces",
      category: "Carrosserie",
      standardHours: 0.25,
      rateType: "STANDARD",
    },
    {
      code: "DIA001",
      name: "Diagnostic général avant achat",
      category: "Diagnostic",
      standardHours: 1,
      rateType: "DIAGNOSTIC",
    },
  ];
}

export interface OnboardingChannelConfigSeed {
  channel: "WHATSAPP" | "SMS" | "EMAIL";
  provider: string;
  isActive: boolean;
  credentials: string;
}

/** WhatsApp en mode wa_link actif (sans compte Meta) ; EMAIL console désactivé (RG-M01-16). */
export function defaultChannelConfigs(): OnboardingChannelConfigSeed[] {
  return [
    { channel: "WHATSAPP", provider: "wa_link", isActive: true, credentials: "{}" },
    { channel: "EMAIL", provider: "console", isActive: false, credentials: "{}" },
  ];
}
