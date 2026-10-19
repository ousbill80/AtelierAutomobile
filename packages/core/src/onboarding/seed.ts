// RG-M01-16 — Semences créées à la fin de l'étape 2 de l'assistant d'onboarding.
// Le contenu détaillé des relances/messages/inspections/main-d'œuvre est défini par
// M10/M11/M04/M05 ; ce qui suit est un jeu de référence minimal pour qu'un garage
// nouvellement créé soit immédiatement utilisable, à enrichir quand ces modules
// seront implémentés.

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

export interface OnboardingReminderStep {
  key: string;
  offsetDays: number;
  templateKey: string;
  autoSend: boolean;
  channels: Array<"WHATSAPP" | "SMS" | "EMAIL">;
}

export interface OnboardingReminderRuleSeed {
  type:
    "INSPECTION" | "SERVICE" | "RECEIVABLE" | "APPOINTMENT" | "QUOTE_FOLLOWUP" | "VEHICLE_READY";
  name: string;
  steps: OnboardingReminderStep[];
  sendWindow: { days: number[]; from: string; to: string };
  stopOn: string[];
}

const DEFAULT_SEND_WINDOW = { days: [1, 2, 3, 4, 5, 6], from: "08:00", to: "19:00" };

/** RG-M01-16 : VT J-30/J-7/J-0, révision J-15/J-0, créances J+3/J+15/J+30/J+45, RDV J-1, devis, véhicule prêt. */
export function defaultReminderRules(): OnboardingReminderRuleSeed[] {
  return [
    {
      type: "INSPECTION",
      name: "Visite technique",
      steps: [
        {
          key: "J-30",
          offsetDays: -30,
          templateKey: "vt_j30",
          autoSend: true,
          channels: ["WHATSAPP", "SMS"],
        },
        {
          key: "J-7",
          offsetDays: -7,
          templateKey: "vt_j7",
          autoSend: true,
          channels: ["WHATSAPP", "SMS"],
        },
        {
          key: "J-0",
          offsetDays: 0,
          templateKey: "vt_j0",
          autoSend: true,
          channels: ["WHATSAPP", "SMS"],
        },
      ],
      sendWindow: DEFAULT_SEND_WINDOW,
      stopOn: ["appointment.created"],
    },
    {
      type: "SERVICE",
      name: "Révision",
      steps: [
        {
          key: "J-15",
          offsetDays: -15,
          templateKey: "revision_j15",
          autoSend: true,
          channels: ["WHATSAPP"],
        },
        {
          key: "J-0",
          offsetDays: 0,
          templateKey: "revision_j0",
          autoSend: true,
          channels: ["WHATSAPP", "SMS"],
        },
      ],
      sendWindow: DEFAULT_SEND_WINDOW,
      stopOn: ["appointment.created"],
    },
    {
      type: "RECEIVABLE",
      name: "Créances",
      steps: [
        {
          key: "J+3",
          offsetDays: 3,
          templateKey: "receivable_j3",
          autoSend: true,
          channels: ["WHATSAPP"],
        },
        {
          key: "J+15",
          offsetDays: 15,
          templateKey: "receivable_j15",
          autoSend: true,
          channels: ["WHATSAPP", "SMS"],
        },
        {
          key: "J+30",
          offsetDays: 30,
          templateKey: "receivable_j30",
          autoSend: true,
          channels: ["WHATSAPP", "SMS"],
        },
        {
          key: "J+45",
          offsetDays: 45,
          templateKey: "receivable_j45",
          autoSend: false,
          channels: ["WHATSAPP"],
        },
      ],
      sendWindow: DEFAULT_SEND_WINDOW,
      stopOn: ["payment.received"],
    },
    {
      type: "APPOINTMENT",
      name: "Rappel de rendez-vous",
      steps: [
        {
          key: "J-1",
          offsetDays: -1,
          templateKey: "appointment_j1",
          autoSend: true,
          channels: ["WHATSAPP", "SMS"],
        },
      ],
      sendWindow: DEFAULT_SEND_WINDOW,
      stopOn: ["appointment.cancelled"],
    },
    {
      type: "QUOTE_FOLLOWUP",
      name: "Relance devis",
      steps: [
        {
          key: "J+2",
          offsetDays: 2,
          templateKey: "quote_followup",
          autoSend: true,
          channels: ["WHATSAPP"],
        },
      ],
      sendWindow: DEFAULT_SEND_WINDOW,
      stopOn: ["quote.accepted", "quote.declined"],
    },
    {
      type: "VEHICLE_READY",
      name: "Véhicule prêt",
      steps: [
        {
          key: "J-0",
          offsetDays: 0,
          templateKey: "vehicle_ready",
          autoSend: true,
          channels: ["WHATSAPP", "SMS"],
        },
      ],
      sendWindow: DEFAULT_SEND_WINDOW,
      stopOn: ["repair_order.delivered"],
    },
  ];
}

export interface OnboardingMessageTemplateSeed {
  key: string;
  name: string;
  channel: "WHATSAPP" | "SMS" | "EMAIL";
  body: string;
}

/** Un modèle WhatsApp par templateKey référencé dans defaultReminderRules(). */
export function defaultMessageTemplates(): OnboardingMessageTemplateSeed[] {
  return [
    {
      key: "vt_j30",
      name: "VT à 30 jours",
      channel: "WHATSAPP",
      body: "Bonjour {{client.prenom}}, la visite technique de votre véhicule {{vehicule.plaque}} arrive à échéance le {{vt.date}}. Prenez rendez-vous avec {{garage.nom}}.",
    },
    {
      key: "vt_j7",
      name: "VT à 7 jours",
      channel: "WHATSAPP",
      body: "Rappel : la visite technique de {{vehicule.plaque}} expire dans 7 jours ({{vt.date}}). Contactez {{garage.nom}} pour planifier.",
    },
    {
      key: "vt_j0",
      name: "VT échue",
      channel: "WHATSAPP",
      body: "La visite technique de {{vehicule.plaque}} est arrivée à échéance. Merci de régulariser rapidement.",
    },
    {
      key: "revision_j15",
      name: "Révision à 15 jours",
      channel: "WHATSAPP",
      body: "Bonjour {{client.prenom}}, la révision de {{vehicule.plaque}} est recommandée dans 15 jours. {{garage.nom}} reste à votre disposition.",
    },
    {
      key: "revision_j0",
      name: "Révision due",
      channel: "WHATSAPP",
      body: "Votre véhicule {{vehicule.plaque}} est dû pour une révision. Prenez rendez-vous avec {{garage.nom}}.",
    },
    {
      key: "receivable_j3",
      name: "Créance à 3 jours",
      channel: "WHATSAPP",
      body: "Bonjour {{client.prenom}}, la facture {{facture.numero}} de {{facture.montant}} reste à régler. Merci de votre retour.",
    },
    {
      key: "receivable_j15",
      name: "Créance à 15 jours",
      channel: "WHATSAPP",
      body: "Rappel : la facture {{facture.numero}} de {{facture.montant}} est toujours impayée. Contactez {{garage.nom}} pour régulariser.",
    },
    {
      key: "receivable_j30",
      name: "Créance à 30 jours",
      channel: "WHATSAPP",
      body: "La facture {{facture.numero}} de {{facture.montant}} est en retard de paiement depuis 30 jours. Merci de régulariser rapidement.",
    },
    {
      key: "receivable_j45",
      name: "Créance à 45 jours",
      channel: "WHATSAPP",
      body: "Dernier rappel : la facture {{facture.numero}} de {{facture.montant}} reste impayée depuis 45 jours.",
    },
    {
      key: "appointment_j1",
      name: "Rappel RDV",
      channel: "WHATSAPP",
      body: "Bonjour {{client.prenom}}, rappel de votre rendez-vous demain à {{rdv.heure}} chez {{garage.nom}}.",
    },
    {
      key: "quote_followup",
      name: "Relance devis",
      channel: "WHATSAPP",
      body: "Bonjour {{client.prenom}}, votre devis {{devis.numero}} de {{devis.montant}} est toujours disponible. Souhaitez-vous le valider ?",
    },
    {
      key: "vehicle_ready",
      name: "Véhicule prêt",
      channel: "WHATSAPP",
      body: "Bonjour {{client.prenom}}, votre véhicule {{vehicule.plaque}} est prêt. Vous pouvez venir le récupérer chez {{garage.nom}}.",
    },
  ];
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
