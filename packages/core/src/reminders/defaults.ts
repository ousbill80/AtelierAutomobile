/**
 * M10 §4.1 (RG-M10-02) et Annexe A — règles et modèles de message livrés par défaut à la création
 * d'une organisation. Données pures (aucun accès DB ici) : l'appelant (seed, `onboarding.saveStep`)
 * leur ajoute `organizationId` et les écrit via `tenantDb.reminderRule.createMany` /
 * `tenantDb.messageTemplate.createMany`.
 *
 * Écarts documentés par rapport au PRD (RG-M10-22 ne définit pas certains événements cités en
 * RG-M10-02, ou un palier est annoncé « inactif par défaut » sans mécanisme de désactivation par
 * palier dans le schéma RG-M10-03) :
 * - Règle « Rendez-vous » : le palier `H-2` (« inactif par défaut ») est omis du tableau par défaut
 *   plutôt que désactivé individuellement (le modèle n'a pas de drapeau actif par palier) ; le
 *   gérant peut l'ajouter via « + Ajouter un palier ».
 * - Règle « Véhicule prêt » : `stopOn` ne référence pas `repair_order.status_changed → DELIVERED`
 *   (absent de la liste blanche `REMINDER_STOP_EVENTS`, RG-M10-22 ne le modélise pas encore) ;
 *   laissé vide en attendant cet événement.
 * - Règle « Assurance » : `stopOn` ne référence pas `vehicle.insurance_updated` (même raison, cet
 *   événement n'apparaît pas dans le tableau RG-M10-22) ; laissé vide.
 * - Règle « Échéance proche (entreprises) » et la règle « Créances » partagent `type: "RECEIVABLE"`
 *   (le modèle n'a qu'une valeur d'enum par type) ; la première reste inactive par défaut.
 */

import type { ReminderChannel, ReminderRuleDefinition } from "./types";

export interface DefaultMessageTemplate {
  key: string;
  name: string;
  channel: ReminderChannel;
  subject?: string;
  body: string;
}

export interface DefaultReminderRule extends ReminderRuleDefinition {
  name: string;
  isActive: boolean;
  conditions?: Record<string, unknown>;
}

/**
 * RG-M10-13 — candidats de `MessageTemplate.key` pour un palier, dans l'ordre de recherche :
 * `{templateKey}_pro` si le client est une entreprise, puis `{templateKey}`.
 */
export function resolveTemplateCandidates(
  baseKey: string,
  customerType: "INDIVIDUAL" | "COMPANY",
): string[] {
  return customerType === "COMPANY" ? [`${baseKey}_pro`, baseKey] : [baseKey];
}

const WEEKDAYS_MON_SAT = [1, 2, 3, 4, 5, 6] as const;
const WEEKDAYS_MON_FRI = [1, 2, 3, 4, 5] as const;

export const DEFAULT_REMINDER_RULES: DefaultReminderRule[] = [
  {
    type: "INSPECTION",
    name: "Visite technique",
    isActive: true,
    sendWindow: { days: [...WEEKDAYS_MON_SAT], from: "08:00", to: "19:00", preferredTime: "09:00" },
    stopOn: ["appointment.created", "vehicle.inspection_updated", "repair_order.created"],
    steps: [
      {
        key: "J-30",
        label: "1er rappel (J-30)",
        offsetDays: -30,
        templateKey: "vt_j30",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
      {
        key: "J-7",
        label: "Rappel (J-7)",
        offsetDays: -7,
        templateKey: "vt_j7",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
      {
        key: "J0",
        label: "Expire aujourd'hui",
        offsetDays: 0,
        templateKey: "vt_j0",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
      {
        key: "J+7",
        label: "Expirée depuis 7 j",
        offsetDays: 7,
        templateKey: "vt_jp7",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
    ],
  },
  {
    type: "SERVICE",
    name: "Révision",
    isActive: true,
    sendWindow: { days: [...WEEKDAYS_MON_SAT], from: "08:00", to: "19:00", preferredTime: "09:30" },
    stopOn: ["appointment.created", "repair_order.created", "vehicle.service_recorded"],
    steps: [
      {
        key: "J-15",
        label: "Rappel (J-15)",
        offsetDays: -15,
        templateKey: "rev_jm15",
        autoSend: true,
        channels: ["WHATSAPP", "SMS", "EMAIL"],
      },
      {
        key: "J0",
        label: "Échéance",
        offsetDays: 0,
        templateKey: "rev_j0",
        autoSend: true,
        channels: ["WHATSAPP", "SMS", "EMAIL"],
      },
      {
        key: "J+15",
        label: "Rappel (J+15)",
        offsetDays: 15,
        templateKey: "rev_jp15",
        autoSend: true,
        channels: ["WHATSAPP", "SMS", "EMAIL"],
      },
      {
        key: "J+45",
        label: "Dernier rappel (J+45)",
        offsetDays: 45,
        templateKey: "rev_jp45",
        autoSend: false,
        channels: ["WHATSAPP", "SMS", "EMAIL"],
      },
    ],
  },
  {
    type: "RECEIVABLE",
    name: "Créances",
    isActive: true,
    sendWindow: { days: [...WEEKDAYS_MON_FRI], from: "08:30", to: "18:00", preferredTime: "10:00" },
    stopOn: ["payment.received", "collection.promised", "collection.disputed", "collection.paused"],
    steps: [
      {
        key: "J+3",
        label: "Rappel courtois",
        offsetDays: 3,
        templateKey: "cr_jp3",
        autoSend: true,
        channels: ["WHATSAPP", "SMS", "EMAIL"],
      },
      {
        key: "J+15",
        label: "Deuxième rappel",
        offsetDays: 15,
        templateKey: "cr_jp15",
        autoSend: true,
        channels: ["WHATSAPP", "SMS", "EMAIL"],
      },
      {
        key: "J+30",
        label: "Relance ferme",
        offsetDays: 30,
        templateKey: "cr_jp30",
        autoSend: false,
        channels: ["WHATSAPP", "SMS", "EMAIL"],
      },
      {
        key: "J+45",
        label: "Alerte gérant",
        offsetDays: 45,
        templateKey: "cr_alerte_gerant",
        autoSend: true,
        channels: [],
        internalOnly: true,
      },
      {
        key: "J+60",
        label: "Mise en demeure",
        offsetDays: 60,
        templateKey: "cr_mise_en_demeure",
        autoSend: false,
        channels: ["WHATSAPP", "SMS", "EMAIL"],
        requiresPermission: "receivable:formal_notice",
        attachments: ["formal_notice"],
      },
    ],
  },
  {
    type: "RECEIVABLE",
    name: "Échéance proche (entreprises)",
    isActive: false,
    conditions: { customerTypes: ["COMPANY"] },
    sendWindow: { days: [...WEEKDAYS_MON_FRI], from: "08:00", to: "18:00", preferredTime: "10:00" },
    stopOn: ["payment.received"],
    steps: [
      {
        key: "J-3",
        label: "Échéance proche",
        offsetDays: -3,
        templateKey: "cr_avant_echeance_pro",
        autoSend: true,
        channels: ["EMAIL", "WHATSAPP"],
      },
    ],
  },
  {
    type: "APPOINTMENT",
    name: "Rendez-vous",
    isActive: true,
    sendWindow: { days: [...WEEKDAYS_MON_SAT], from: "07:00", to: "20:00", preferredTime: "08:00" },
    stopOn: ["appointment.cancelled", "appointment.no_show"],
    steps: [
      {
        // RG-M10-?? / §9 : planifiée immédiatement par `appointment.created` (scheduledFor = now),
        // avant le palier J-1 dans l'ordre d'affichage malgré son décalage nominal (RG-M10-03 exige
        // des décalages strictement croissants dans un même groupe d'ancre).
        key: "J-1",
        label: "Rappel la veille",
        offsetDays: -1,
        templateKey: "rdv_jm1",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
        sendAt: "17:00",
      },
      {
        key: "CONFIRM",
        label: "Confirmation",
        offsetDays: 0,
        templateKey: "rdv_confirm",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
    ],
  },
  {
    type: "QUOTE_FOLLOWUP",
    name: "Suivi de devis",
    isActive: true,
    sendWindow: { days: [...WEEKDAYS_MON_SAT], from: "08:00", to: "19:00", preferredTime: "09:00" },
    stopOn: ["quote.accepted", "quote.declined", "quote.expired"],
    steps: [
      {
        key: "J+2",
        label: "Relance (J+2)",
        offsetDays: 2,
        anchor: "sentAt",
        templateKey: "devis_jp2",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
      {
        key: "J+5",
        label: "Relance (J+5)",
        offsetDays: 5,
        anchor: "sentAt",
        templateKey: "devis_jp5",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
      {
        key: "EXPIRE",
        label: "Expire bientôt",
        offsetDays: -1,
        anchor: "validUntil",
        templateKey: "devis_expire",
        autoSend: false,
        channels: ["WHATSAPP", "SMS"],
      },
    ],
  },
  {
    type: "VEHICLE_READY",
    name: "Véhicule prêt",
    isActive: true,
    sendWindow: { days: [...WEEKDAYS_MON_SAT], from: "07:30", to: "19:30", preferredTime: "08:00" },
    stopOn: [],
    steps: [
      {
        key: "J0",
        label: "Immédiat",
        offsetDays: 0,
        templateKey: "pret_j0",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
      {
        key: "J+2",
        label: "Rappel (J+2)",
        offsetDays: 2,
        templateKey: "pret_jp2",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
      {
        key: "J+5",
        label: "Rappel (J+5)",
        offsetDays: 5,
        templateKey: "pret_jp5",
        autoSend: false,
        channels: ["WHATSAPP", "SMS"],
      },
    ],
  },
  {
    type: "INSURANCE_EXPIRY",
    name: "Assurance",
    isActive: false,
    sendWindow: { days: [...WEEKDAYS_MON_SAT], from: "08:00", to: "19:00", preferredTime: "09:00" },
    stopOn: [],
    steps: [
      {
        key: "J-15",
        label: "Rappel (J-15)",
        offsetDays: -15,
        templateKey: "assur_jm15",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
      {
        key: "J-3",
        label: "Rappel (J-3)",
        offsetDays: -3,
        templateKey: "assur_jm3",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
    ],
  },
  {
    type: "SATISFACTION",
    name: "Satisfaction",
    isActive: true,
    sendWindow: { days: [...WEEKDAYS_MON_SAT], from: "10:00", to: "18:00", preferredTime: "10:00" },
    stopOn: [],
    steps: [
      {
        key: "J+2",
        label: "Avis client",
        offsetDays: 2,
        templateKey: "satis_jp2",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
    ],
  },
];

export const DEFAULT_MESSAGE_TEMPLATES: DefaultMessageTemplate[] = [
  // --- A.1 Visite technique ---
  {
    key: "vt_j30",
    name: "VT — 1er rappel (J-30)",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, la visite technique de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) expire le {{vt.dateExpiration}}. {{garage.nom}} vous propose une pré-visite pour passer le contrôle sans surprise. Répondez à ce message ou appelez le {{garage.telephone}} pour réserver.",
  },
  {
    key: "vt_j30",
    name: "VT — 1er rappel (J-30)",
    channel: "SMS",
    body: "{{garage.nom}}: {{client.salutation}}, la visite technique de votre {{vehicule.marque}} {{vehicule.plaque}} expire le {{vt.dateExpiration}}. Pre-visite: {{garage.telephone}}",
  },
  {
    key: "vt_j30",
    name: "VT — 1er rappel (J-30)",
    channel: "EMAIL",
    subject:
      "Visite technique de votre {{vehicule.marque}} {{vehicule.modele}} : expiration le {{vt.dateExpiration}}",
    body: "Bonjour {{client.salutation}},\nLa visite technique de votre {{vehicule.marque}} {{vehicule.modele}} immatriculé {{vehicule.plaque}} expire le {{vt.dateExpiration}}.\nNous vous proposons une pré-visite : nous contrôlons les points vérifiés au centre (freins, éclairage, pneus, émissions) et corrigeons ce qui doit l'être, pour réussir la visite du premier coup.\nPrenez rendez-vous au {{garage.telephone}} ou en ligne : {{lien.rdv}}\n{{garage.nom}} — {{garage.adresse}} — {{garage.horaires}}",
  },
  {
    key: "vt_j7",
    name: "VT — Rappel (J-7)",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, plus que {{vt.joursRestants}} jours : la visite technique de votre {{vehicule.marque}} ({{vehicule.plaque}}) expire le {{vt.dateExpiration}}. Nous pouvons vous recevoir cette semaine pour la pré-visite. Quel jour vous arrange ? {{garage.nom}} – {{garage.telephone}}",
  },
  {
    key: "vt_j7",
    name: "VT — Rappel (J-7)",
    channel: "SMS",
    body: "{{garage.nom}}: {{client.salutation}}, la visite technique de votre {{vehicule.marque}} {{vehicule.plaque}} expire le {{vt.dateExpiration}}. RDV cette semaine: {{garage.telephone}}",
  },
  {
    key: "vt_j7",
    name: "VT — Rappel (J-7)",
    channel: "EMAIL",
    subject: "Plus que {{vt.joursRestants}} jours avant l'expiration de votre visite technique",
    body: "Bonjour {{client.salutation}},\nLa visite technique de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) expire le {{vt.dateExpiration}}, dans {{vt.joursRestants}} jours.\nNous pouvons encore vous recevoir cette semaine pour une pré-visite. Réservez au {{garage.telephone}} ou ici : {{lien.rdv}}\n{{garage.nom}}",
  },
  {
    key: "vt_j0",
    name: "VT — Expire aujourd'hui",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, la visite technique de votre {{vehicule.marque}} ({{vehicule.plaque}}) expire aujourd'hui, le {{vt.dateExpiration}}. Si ce n'est pas encore fait, passez nous voir : nous vous aidons à la faire rapidement. {{garage.nom}} – {{garage.telephone}}",
  },
  {
    key: "vt_j0",
    name: "VT — Expire aujourd'hui",
    channel: "SMS",
    body: "{{garage.nom}}: {{client.salutation}}, la visite technique de votre {{vehicule.marque}} {{vehicule.plaque}} expire aujourd'hui. Passez nous voir. Tel {{garage.telephone}}",
  },
  {
    key: "vt_j0",
    name: "VT — Expire aujourd'hui",
    channel: "EMAIL",
    subject: "Votre visite technique expire aujourd'hui",
    body: "Bonjour {{client.salutation}},\nLa visite technique de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) expire aujourd'hui. Si vous l'avez déjà faite, ignorez ce message ou indiquez-nous la nouvelle date pour mettre votre dossier à jour.\nSinon, contactez-nous au {{garage.telephone}} : nous préparons votre véhicule en priorité.\n{{garage.nom}}",
  },
  {
    key: "vt_jp7",
    name: "VT — Expirée (J+7)",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, selon nos informations la visite technique de votre {{vehicule.marque}} ({{vehicule.plaque}}) a expiré le {{vt.dateExpiration}}. Si elle a été faite, envoyez-nous simplement la nouvelle date. Sinon, nous pouvons préparer votre véhicule rapidement : {{garage.telephone}}. {{garage.nom}}",
  },
  {
    key: "vt_jp7",
    name: "VT — Expirée (J+7)",
    channel: "SMS",
    body: "{{garage.nom}}: {{client.salutation}}, la visite technique de votre {{vehicule.marque}} {{vehicule.plaque}} a expiré le {{vt.dateExpiration}}. On vous aide: {{garage.telephone}}",
  },
  {
    key: "vt_jp7",
    name: "VT — Expirée (J+7)",
    channel: "EMAIL",
    subject: "Visite technique expirée : on vous aide à régulariser",
    body: "Bonjour {{client.salutation}},\nD'après notre suivi, la visite technique de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) a expiré le {{vt.dateExpiration}}.\nSi elle a déjà été faite, répondez à cet email avec la nouvelle date d'expiration : nous mettrons votre dossier à jour et vous ne recevrez plus ce rappel.\nSinon, nous pouvons préparer votre véhicule rapidement. Appelez le {{garage.telephone}}.\n{{garage.nom}}",
  },
  {
    key: "vt_multi",
    name: "VT — Plusieurs véhicules",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, la visite technique de {{vehicules.nombre}} de vos véhicules arrive à échéance :\n{{vehicules.liste}}\n{{garage.nom}} peut organiser les pré-visites en une seule fois. Répondez à ce message ou appelez le {{garage.telephone}}.",
  },
  {
    key: "vt_multi",
    name: "VT — Plusieurs véhicules",
    channel: "SMS",
    body: "{{garage.nom}}: {{client.salutation}}, la visite technique de {{vehicules.nombre}} de vos vehicules arrive a echeance. Detail et RDV: {{garage.telephone}}",
  },
  {
    key: "vt_multi",
    name: "VT — Plusieurs véhicules",
    channel: "EMAIL",
    subject: "Visites techniques à prévoir : {{vehicules.nombre}} véhicules",
    body: "Bonjour {{client.salutation}},\nLes visites techniques suivantes arrivent à échéance :\n{{vehicules.liste}}\nNous pouvons regrouper les pré-visites sur une même journée pour limiter l'immobilisation de votre flotte. Contactez-nous au {{garage.telephone}}.\n{{garage.nom}}",
  },
  {
    key: "vt_demande_date",
    name: "VT — Demande de date",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, pour vous rappeler à temps la visite technique de votre {{vehicule.marque}} ({{vehicule.plaque}}), pouvez-vous nous indiquer sa date d'expiration (ou envoyer une photo de la vignette) ? Merci. {{garage.nom}}",
  },
  {
    key: "vt_demande_date",
    name: "VT — Demande de date",
    channel: "SMS",
    body: "{{garage.nom}}: {{client.salutation}}, quelle est la date d'expiration de la visite technique de votre {{vehicule.plaque}}? Merci de nous appeler au {{garage.telephone}}",
  },
  // --- A.2 Révision ---
  {
    key: "rev_jm15",
    name: "Révision — Rappel (J-15)",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, d'après notre suivi, la révision de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) est à prévoir vers le {{revision.dateEcheance}} ou à {{revision.kmEcheance}} km (estimation actuelle : {{vehicule.kmEstime}} km). Souhaitez-vous réserver un créneau ? {{garage.nom}} – {{garage.telephone}}",
  },
  {
    key: "rev_jm15",
    name: "Révision — Rappel (J-15)",
    channel: "SMS",
    body: "{{garage.nom}}: {{client.salutation}}, la revision de votre {{vehicule.marque}} {{vehicule.plaque}} est a prevoir vers le {{revision.dateEcheance}}. RDV: {{garage.telephone}}",
  },
  {
    key: "rev_jm15",
    name: "Révision — Rappel (J-15)",
    channel: "EMAIL",
    subject: "Votre {{vehicule.marque}} {{vehicule.modele}} approche de sa révision",
    body: "Bonjour {{client.salutation}},\nD'après notre suivi, votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) approche de sa révision : échéance vers le {{revision.dateEcheance}} ou à {{revision.kmEcheance}} km (nous estimons votre compteur à {{vehicule.kmEstime}} km).\nUne révision régulière (vidange, filtres, contrôle des freins et des niveaux) évite les pannes coûteuses et préserve la valeur de votre véhicule.\nPrenez rendez-vous au {{garage.telephone}} ou en ligne : {{lien.rdv}}\n{{garage.nom}}",
  },
  {
    key: "rev_j0",
    name: "Révision — Échéance",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, votre {{vehicule.marque}} ({{vehicule.plaque}}) est arrivé à l'échéance de sa révision. Nous pouvons vous recevoir dès cette semaine, comptez environ une demi-journée. Quel jour vous convient ? {{garage.nom}} – {{garage.telephone}}",
  },
  {
    key: "rev_j0",
    name: "Révision — Échéance",
    channel: "SMS",
    body: "{{garage.nom}}: {{client.salutation}}, votre {{vehicule.marque}} {{vehicule.plaque}} est due pour sa revision. Reservez au {{garage.telephone}}",
  },
  {
    key: "rev_j0",
    name: "Révision — Échéance",
    channel: "EMAIL",
    subject: "C'est le moment de la révision de votre {{vehicule.marque}}",
    body: "Bonjour {{client.salutation}},\nVotre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) a atteint l'échéance de sa révision. Nous pouvons vous recevoir dès cette semaine.\nRéservez au {{garage.telephone}} ou ici : {{lien.rdv}}\n{{garage.nom}}",
  },
  {
    key: "rev_jp15",
    name: "Révision — Rappel (J+15)",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, la révision de votre {{vehicule.marque}} ({{vehicule.plaque}}) était prévue le {{revision.dateEcheance}}. Rouler avec une huile usée use le moteur plus vite. Si elle a été faite ailleurs, dites-le-nous et nous mettrons votre suivi à jour. {{garage.nom}} – {{garage.telephone}}",
  },
  {
    key: "rev_jp15",
    name: "Révision — Rappel (J+15)",
    channel: "SMS",
    body: "{{garage.nom}}: {{client.salutation}}, la revision de votre {{vehicule.marque}} {{vehicule.plaque}} etait prevue le {{revision.dateEcheance}}. RDV: {{garage.telephone}}",
  },
  {
    key: "rev_jp15",
    name: "Révision — Rappel (J+15)",
    channel: "EMAIL",
    subject: "Révision en retard sur votre {{vehicule.marque}}",
    body: "Bonjour {{client.salutation}},\nLa révision de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) était prévue le {{revision.dateEcheance}}. Si elle a été faite, répondez-nous avec la date et le kilométrage pour que nous mettions votre suivi à jour.\nSinon, contactez-nous au {{garage.telephone}}.\n{{garage.nom}}",
  },
  {
    key: "rev_jp45",
    name: "Révision — Dernier rappel (J+45)",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, dernier petit rappel de {{garage.nom}} : la révision de votre {{vehicule.marque}} ({{vehicule.plaque}}) reste à faire. Nous restons à votre disposition au {{garage.telephone}}. Bonne route !",
  },
  {
    key: "rev_jp45",
    name: "Révision — Dernier rappel (J+45)",
    channel: "SMS",
    body: "{{garage.nom}}: {{client.salutation}}, dernier rappel pour la revision de votre {{vehicule.marque}} {{vehicule.plaque}}. RDV au {{garage.telephone}}",
  },
  {
    key: "rev_jp45",
    name: "Révision — Dernier rappel (J+45)",
    channel: "EMAIL",
    subject: "Dernier rappel : révision de votre {{vehicule.marque}}",
    body: "Bonjour {{client.salutation}},\nDernier rappel : la révision de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) reste à faire. Nous ne vous relancerons plus pour cette échéance.\n{{garage.nom}} — {{garage.telephone}}",
  },
  {
    key: "rev_multi",
    name: "Révision — Plusieurs véhicules",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, {{vehicules.nombre}} de vos véhicules arrivent à l'échéance de leur révision :\n{{vehicules.liste}}\nNous pouvons les planifier sur une même journée. Répondez à ce message ou appelez le {{garage.telephone}}. {{garage.nom}}",
  },
  {
    key: "rev_multi",
    name: "Révision — Plusieurs véhicules",
    channel: "SMS",
    body: "{{garage.nom}}: {{client.salutation}}, {{vehicules.nombre}} de vos vehicules sont dus pour leur revision. Planning: {{garage.telephone}}",
  },
  {
    key: "rev_multi",
    name: "Révision — Plusieurs véhicules",
    channel: "EMAIL",
    subject: "Révisions à planifier : {{vehicules.nombre}} véhicules",
    body: "Bonjour {{client.salutation}},\nLes véhicules suivants arrivent à l'échéance de leur révision :\n{{vehicules.liste}}\nContactez-nous au {{garage.telephone}} pour les planifier ensemble.\n{{garage.nom}}",
  },
  {
    key: "vt_rev_combo",
    name: "VT + révision combinées",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, deux échéances pour votre {{vehicule.marque}} ({{vehicule.plaque}}) : la visite technique expire le {{vt.dateExpiration}} et la révision est due. Faites les deux en un seul passage chez {{garage.nom}}. Réservez au {{garage.telephone}}.",
  },
  {
    key: "vt_rev_combo",
    name: "VT + révision combinées",
    channel: "SMS",
    body: "{{garage.nom}}: {{client.salutation}}, visite technique (exp. {{vt.dateExpiration}}) et revision a faire sur votre {{vehicule.plaque}}. RDV: {{garage.telephone}}",
  },
  {
    key: "vt_rev_combo",
    name: "VT + révision combinées",
    channel: "EMAIL",
    subject: "Visite technique et révision : un seul passage",
    body: "Bonjour {{client.salutation}},\nLa visite technique de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) expire le {{vt.dateExpiration}} et sa révision est due. Nous pouvons faire la révision et la pré-visite en un seul passage.\nRéservez au {{garage.telephone}} ou ici : {{lien.rdv}}\n{{garage.nom}}",
  },
  // --- A.3 Créances ---
  {
    key: "cr_jp3",
    name: "Créance — Rappel courtois (J+3)",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, sauf erreur de notre part, {{factures.resume}} reste à régler. Vous pouvez payer en un clic par Wave ou Orange Money : {{lien.paiement}}. Si le paiement est déjà fait, merci de nous le signaler et ignorez ce message. Bonne journée ! {{garage.nom}}",
  },
  {
    key: "cr_jp3",
    name: "Créance — Rappel courtois (J+3)",
    channel: "SMS",
    body: "{{garage.nom}}: bonjour {{client.salutation}}, rappel de paiement pour {{factures.resume}}. Payer: {{lien.paiement}} Merci",
  },
  {
    key: "cr_jp3",
    name: "Créance — Rappel courtois (J+3)",
    channel: "EMAIL",
    subject: "Rappel : {{factures.resume}}",
    body: "Bonjour {{client.salutation}},\nSauf erreur de notre part, le règlement suivant n'a pas encore été enregistré :\n{{factures.detail}}\nVous pouvez payer en ligne (Wave, Orange Money, MTN MoMo, carte) : {{lien.paiement}} — ou à notre caisse.\nSi vous avez déjà réglé, merci d'ignorer ce message.\n{{garage.nom}} — {{garage.telephone}}",
  },
  {
    key: "cr_jp3_pro",
    name: "Créance (entreprise) — Rappel courtois (J+3)",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, nous vous informons que {{factures.resume}} adressée à {{client.nomComplet}} est arrivée à échéance. Le relevé est disponible ici : {{lien.releve}}. Paiement par virement, Wave ou Orange Money : {{lien.paiement}}. Merci de transmettre au service comptable. {{garage.nom}}",
  },
  {
    key: "cr_jp3_pro",
    name: "Créance (entreprise) — Rappel courtois (J+3)",
    channel: "SMS",
    body: "{{garage.nom}}: {{factures.resume}} est arrivee a echeance. Releve et paiement: {{lien.paiement}} Contact: {{garage.telephone}}",
  },
  {
    key: "cr_jp3_pro",
    name: "Créance (entreprise) — Rappel courtois (J+3)",
    channel: "EMAIL",
    subject: "{{client.nomComplet}} — échéance dépassée : {{factures.resume}}",
    body: "Madame, Monsieur,\nSauf erreur de notre part, les factures suivantes sont arrivées à échéance et restent à régler :\n{{factures.detail}}\nSolde total : {{client.soldeEnRetard}}. Vous trouverez votre relevé de compte ici : {{lien.releve}}\nRèglement par virement bancaire (coordonnées sur facture), Wave, Orange Money ou MTN MoMo : {{lien.paiement}}\nMerci de bien vouloir procéder au règlement ou de nous indiquer la date prévue.\nService facturation — {{garage.nom}} — {{garage.telephone}}",
  },
  {
    key: "cr_jp15",
    name: "Créance — Deuxième rappel (J+15)",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, nous n'avons toujours pas reçu le règlement de {{factures.resume}}. Pouvez-vous nous indiquer quand vous pensez payer ? Lien de paiement : {{lien.paiement}}. Merci. {{garage.nom}} – {{garage.telephone}}",
  },
  {
    key: "cr_jp15",
    name: "Créance — Deuxième rappel (J+15)",
    channel: "SMS",
    body: "{{garage.nom}}: {{client.salutation}}, nous attendons toujours le reglement de {{factures.resume}}. Payer: {{lien.paiement}}",
  },
  {
    key: "cr_jp15",
    name: "Créance — Deuxième rappel (J+15)",
    channel: "EMAIL",
    subject: "Deuxième rappel : règlement en attente",
    body: "Bonjour {{client.salutation}},\nMalgré notre précédent rappel, le règlement suivant reste en attente :\n{{factures.detail}}\nPouvez-vous nous indiquer la date à laquelle vous prévoyez de régler ? Paiement en ligne : {{lien.paiement}}\n{{garage.nom}} — {{garage.telephone}}",
  },
  {
    key: "cr_jp15_pro",
    name: "Créance (entreprise) — Deuxième rappel (J+15)",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, deuxième rappel de {{garage.nom}} : {{factures.resume}} reste impayé à ce jour ({{client.joursRetardMax}} jours de retard). Merci de nous communiquer la date de mise en paiement. Relevé : {{lien.releve}}",
  },
  {
    key: "cr_jp15_pro",
    name: "Créance (entreprise) — Deuxième rappel (J+15)",
    channel: "SMS",
    body: "{{garage.nom}}: 2e rappel, {{factures.resume}}: {{client.joursRetardMax}} j de retard. Merci de nous donner une date. Tel {{garage.telephone}}",
  },
  {
    key: "cr_jp15_pro",
    name: "Créance (entreprise) — Deuxième rappel (J+15)",
    channel: "EMAIL",
    subject: "Deuxième rappel — {{client.nomComplet}} — solde {{client.soldeEnRetard}}",
    body: "Madame, Monsieur,\nNous revenons vers vous au sujet des factures suivantes, toujours impayées à ce jour :\n{{factures.detail}}\nRetard maximal : {{client.joursRetardMax}} jours. Merci de nous communiquer la date de mise en paiement ou, le cas échéant, le motif de blocage (bon de commande, réception, contestation) afin que nous puissions le lever.\nRelevé de compte : {{lien.releve}}\nService facturation — {{garage.nom}} — {{garage.telephone}}",
  },
  {
    key: "cr_jp30",
    name: "Créance — Relance ferme (J+30)",
    channel: "WHATSAPP",
    body: "{{client.salutation}}, malgré nos rappels, {{factures.resume}} n'est toujours pas réglé ({{client.joursRetardMax}} jours de retard). Nous vous demandons de régulariser sous 7 jours ou de nous appeler au {{garage.telephone}} pour convenir d'un échéancier. Paiement : {{lien.paiement}}. {{garage.nom}}",
  },
  {
    key: "cr_jp30",
    name: "Créance — Relance ferme (J+30)",
    channel: "SMS",
    body: "{{garage.nom}}: {{client.salutation}}, {{factures.resume}}: {{client.joursRetardMax}} j de retard. Merci de regulariser sous 7 jours: {{lien.paiement}}",
  },
  {
    key: "cr_jp30",
    name: "Créance — Relance ferme (J+30)",
    channel: "EMAIL",
    subject: "Relance : régularisation demandée sous 7 jours",
    body: "{{client.salutation}},\nMalgré nos rappels, le règlement suivant n'a pas été effectué :\n{{factures.detail}}\nRetard : {{client.joursRetardMax}} jours. Nous vous demandons de régulariser cette situation sous 7 jours. Si vous rencontrez une difficulté, appelez-nous au {{garage.telephone}} : nous pouvons convenir d'un échéancier.\nPaiement en ligne : {{lien.paiement}}\n{{garage.nom}}",
  },
  {
    key: "cr_jp30_pro",
    name: "Créance (entreprise) — Relance ferme (J+30)",
    channel: "WHATSAPP",
    body: "Madame, Monsieur, malgré nos relances, {{factures.resume}} demeure impayé ({{client.joursRetardMax}} jours de retard). Sans règlement ou proposition d'échéancier sous 7 jours, nous serons contraints de suspendre l'ouverture de nouveaux travaux à crédit. {{garage.nom}} – {{garage.telephone}}",
  },
  {
    key: "cr_jp30_pro",
    name: "Créance (entreprise) — Relance ferme (J+30)",
    channel: "SMS",
    body: "{{garage.nom}}: {{factures.resume}} impaye depuis {{client.joursRetardMax}} j. Sans reglement sous 7 j, credit suspendu. Tel {{garage.telephone}}",
  },
  {
    key: "cr_jp30_pro",
    name: "Créance (entreprise) — Relance ferme (J+30)",
    channel: "EMAIL",
    subject: "Relance ferme — {{client.nomComplet}} — {{client.soldeEnRetard}}",
    body: "Madame, Monsieur,\nMalgré nos relances, les factures suivantes demeurent impayées :\n{{factures.detail}}\nSans règlement ou proposition d'échéancier de votre part sous 7 jours, nous serons contraints de suspendre l'ouverture de nouveaux travaux à crédit pour votre compte.\nRelevé de compte : {{lien.releve}} — Paiement : {{lien.paiement}}\nDirection — {{garage.nom}} — {{garage.telephone}}",
  },
  {
    key: "cr_mise_en_demeure",
    name: "Créance — Mise en demeure (J+60)",
    channel: "WHATSAPP",
    body: "{{client.salutation}}, vous trouverez ci-joint une mise en demeure de {{garage.nom}} concernant {{factures.resume}}. Pour régler ou en discuter, contactez-nous au {{garage.telephone}}.",
  },
  {
    key: "cr_mise_en_demeure",
    name: "Créance — Mise en demeure (J+60)",
    channel: "SMS",
    body: "{{garage.nom}}: {{client.salutation}}, une mise en demeure concernant {{factures.resume}} vous a ete adressee. Contact: {{garage.telephone}}",
  },
  {
    key: "cr_mise_en_demeure",
    name: "Créance — Mise en demeure (J+60)",
    channel: "EMAIL",
    subject: "Mise en demeure de payer — {{client.nomComplet}}",
    body: "{{client.salutation}},\nVeuillez trouver ci-joint une mise en demeure de payer la somme de {{client.soldeEnRetard}} au titre des factures listées dans le document.\nPour toute question ou pour convenir d'un règlement, contactez-nous au {{garage.telephone}}.\n{{garage.nom}}",
  },
  {
    key: "cr_avant_echeance_pro",
    name: "Créance (entreprise) — Échéance proche (J-3)",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, pour information, la facture {{facture.numero}} de {{facture.solde}} arrive à échéance le {{facture.echeance}}. Facture : {{lien.facture}} – Paiement : {{lien.paiement}}. {{garage.nom}}",
  },
  {
    key: "cr_avant_echeance_pro",
    name: "Créance (entreprise) — Échéance proche (J-3)",
    channel: "SMS",
    body: "{{garage.nom}}: facture {{facture.numero}} ({{facture.solde}}) a regler avant le {{facture.echeance}}. Paiement: {{lien.paiement}}",
  },
  {
    key: "cr_avant_echeance_pro",
    name: "Créance (entreprise) — Échéance proche (J-3)",
    channel: "EMAIL",
    subject: "Échéance le {{facture.echeance}} — facture {{facture.numero}}",
    body: "Madame, Monsieur,\nPour faciliter votre planification, la facture {{facture.numero}} d'un montant de {{facture.solde}} arrive à échéance le {{facture.echeance}}.\nFacture : {{lien.facture}} — Paiement : {{lien.paiement}}\nService facturation — {{garage.nom}}",
  },
  // --- A.4 Rendez-vous ---
  {
    key: "rdv_confirm",
    name: "RDV — Confirmation",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, votre rendez-vous chez {{garage.nom}} est confirmé le {{rdv.date}} à {{rdv.heure}} pour votre {{vehicule.marque}} ({{vehicule.plaque}}). Adresse : {{garage.adresse}}. Un empêchement ? Répondez à ce message ou appelez le {{garage.telephone}}.",
  },
  {
    key: "rdv_confirm",
    name: "RDV — Confirmation",
    channel: "SMS",
    body: "{{garage.nom}}: RDV confirme le {{rdv.date}} a {{rdv.heure}} pour votre {{vehicule.marque}} {{vehicule.plaque}}. Changement? Tel {{garage.telephone}}",
  },
  {
    key: "rdv_confirm",
    name: "RDV — Confirmation",
    channel: "EMAIL",
    subject: "Rendez-vous confirmé le {{rdv.date}} à {{rdv.heure}}",
    body: "Bonjour {{client.salutation}},\nVotre rendez-vous est confirmé le {{rdv.date}} à {{rdv.heure}} pour votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}).\nAdresse : {{garage.adresse}}. Pensez à apporter la carte grise et, si possible, votre carnet d'entretien.\nPour déplacer le rendez-vous : {{garage.telephone}}. {{garage.nom}}",
  },
  {
    key: "rdv_jm1",
    name: "RDV — Rappel la veille (J-1)",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, petit rappel : nous vous attendons demain {{rdv.date}} à {{rdv.heure}} avec votre {{vehicule.marque}} ({{vehicule.plaque}}). Répondez OUI pour confirmer ou appelez le {{garage.telephone}} pour décaler. {{garage.nom}}",
  },
  {
    key: "rdv_jm1",
    name: "RDV — Rappel la veille (J-1)",
    channel: "SMS",
    body: "{{garage.nom}}: rappel, RDV demain {{rdv.date}} a {{rdv.heure}} pour votre {{vehicule.marque}} {{vehicule.plaque}}. Tel {{garage.telephone}}",
  },
  {
    key: "rdv_jm1",
    name: "RDV — Rappel la veille (J-1)",
    channel: "EMAIL",
    subject: "Rappel : rendez-vous demain à {{rdv.heure}}",
    body: "Bonjour {{client.salutation}},\nNous vous attendons demain {{rdv.date}} à {{rdv.heure}} avec votre {{vehicule.marque}} ({{vehicule.plaque}}). Pour décaler : {{garage.telephone}}.\n{{garage.nom}} — {{garage.adresse}}",
  },
  {
    key: "rdv_hm2",
    name: "RDV — Rappel (H-2)",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, nous vous attendons aujourd'hui à {{rdv.heure}} avec votre {{vehicule.marque}} ({{vehicule.plaque}}). À tout à l'heure ! {{garage.nom}}",
  },
  {
    key: "rdv_hm2",
    name: "RDV — Rappel (H-2)",
    channel: "SMS",
    body: "{{garage.nom}}: nous vous attendons aujourd'hui a {{rdv.heure}} avec votre {{vehicule.plaque}}. Tel {{garage.telephone}}",
  },
  // --- A.5 Suivi de devis ---
  {
    key: "devis_jp2",
    name: "Devis — Suivi (J+2)",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, avez-vous pu consulter le devis {{devis.numero}} ({{devis.montant}}) pour votre {{vehicule.marque}} ? Vous pouvez l'accepter en ligne, ligne par ligne : {{lien.devis}}. Une question ? Répondez ici. {{garage.nom}}",
  },
  {
    key: "devis_jp2",
    name: "Devis — Suivi (J+2)",
    channel: "SMS",
    body: "{{garage.nom}}: {{client.salutation}}, votre devis {{devis.numero}} ({{devis.montant}}) vous attend: {{lien.devis}} Tel {{garage.telephone}}",
  },
  {
    key: "devis_jp2",
    name: "Devis — Suivi (J+2)",
    channel: "EMAIL",
    subject: "Votre devis {{devis.numero}} vous attend",
    body: "Bonjour {{client.salutation}},\nVotre devis {{devis.numero}} d'un montant de {{devis.montant}} pour votre {{vehicule.marque}} {{vehicule.modele}} est disponible ici : {{lien.devis}}\nVous pouvez accepter tout ou partie des travaux en ligne. Pour toute question : {{garage.telephone}}.\n{{garage.nom}}",
  },
  {
    key: "devis_jp5",
    name: "Devis — Suivi (J+5)",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, souhaitez-vous que nous lancions les travaux du devis {{devis.numero}} ? Les points urgents concernent votre sécurité. Accepter en ligne : {{lien.devis}} ou appelez le {{garage.telephone}}. {{garage.nom}}",
  },
  {
    key: "devis_jp5",
    name: "Devis — Suivi (J+5)",
    channel: "SMS",
    body: "{{garage.nom}}: {{client.salutation}}, on lance les travaux du devis {{devis.numero}}? Accepter en ligne: {{lien.devis}}",
  },
  {
    key: "devis_jp5",
    name: "Devis — Suivi (J+5)",
    channel: "EMAIL",
    subject: "Devis {{devis.numero}} : souhaitez-vous lancer les travaux ?",
    body: "Bonjour {{client.salutation}},\nNous restons dans l'attente de votre décision sur le devis {{devis.numero}} ({{devis.montant}}). Les points marqués « urgent » concernent votre sécurité.\nDécider en ligne : {{lien.devis}} — ou appelez-nous au {{garage.telephone}}.\n{{garage.nom}}",
  },
  {
    key: "devis_expire",
    name: "Devis — Expire bientôt",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, le devis {{devis.numero}} est valable jusqu'au {{devis.validite}}. Après cette date, les prix des pièces pourront changer. Pour le valider : {{lien.devis}}. {{garage.nom}}",
  },
  {
    key: "devis_expire",
    name: "Devis — Expire bientôt",
    channel: "SMS",
    body: "{{garage.nom}}: le devis {{devis.numero}} est valable jusqu'au {{devis.validite}}. Pour le valider: {{lien.devis}}",
  },
  {
    key: "devis_expire",
    name: "Devis — Expire bientôt",
    channel: "EMAIL",
    subject: "Votre devis {{devis.numero}} expire le {{devis.validite}}",
    body: "Bonjour {{client.salutation}},\nLe devis {{devis.numero}} est valable jusqu'au {{devis.validite}}. Au-delà, nous devrons actualiser les prix des pièces.\nValider en ligne : {{lien.devis}}\n{{garage.nom}}",
  },
  // --- A.6 Véhicule prêt ---
  {
    key: "pret_j0",
    name: "Véhicule prêt — Immédiat",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, bonne nouvelle : votre {{vehicule.marque}} ({{vehicule.plaque}}) est prêt ! Montant à régler : {{facture.solde}}. Payez avant de venir pour gagner du temps : {{lien.paiement}}. Nous sommes ouverts {{garage.horaires}}. {{garage.nom}}",
  },
  {
    key: "pret_j0",
    name: "Véhicule prêt — Immédiat",
    channel: "SMS",
    body: "{{garage.nom}}: {{client.salutation}}, votre {{vehicule.marque}} {{vehicule.plaque}} est disponible. A regler: {{facture.solde}}. Payer: {{lien.paiement}}",
  },
  {
    key: "pret_j0",
    name: "Véhicule prêt — Immédiat",
    channel: "EMAIL",
    subject: "Votre {{vehicule.marque}} est prêt",
    body: "Bonjour {{client.salutation}},\nLes travaux sur votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) sont terminés. Montant à régler : {{facture.solde}}.\nFacture : {{lien.facture}} — Paiement en ligne : {{lien.paiement}}\nNous vous attendons {{garage.horaires}}. {{garage.nom}} — {{garage.adresse}}",
  },
  {
    key: "pret_jp2",
    name: "Véhicule prêt — Rappel (J+2)",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, votre {{vehicule.marque}} ({{vehicule.plaque}}) vous attend chez {{garage.nom}} depuis 2 jours. Quand pensez-vous passer le récupérer ? {{garage.telephone}}",
  },
  {
    key: "pret_jp2",
    name: "Véhicule prêt — Rappel (J+2)",
    channel: "SMS",
    body: "{{garage.nom}}: {{client.salutation}}, votre {{vehicule.marque}} {{vehicule.plaque}} vous attend depuis 2 jours. Tel {{garage.telephone}}",
  },
  {
    key: "pret_jp2",
    name: "Véhicule prêt — Rappel (J+2)",
    channel: "EMAIL",
    subject: "Votre véhicule vous attend",
    body: "Bonjour {{client.salutation}},\nVotre {{vehicule.marque}} ({{vehicule.plaque}}) est prêt depuis 2 jours. Quand pensez-vous passer ? {{garage.telephone}}\n{{garage.nom}}",
  },
  {
    key: "pret_jp5",
    name: "Véhicule prêt — Rappel (J+5)",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, votre {{vehicule.marque}} ({{vehicule.plaque}}) est prêt depuis 5 jours. Merci de passer le récupérer rapidement : au-delà de 7 jours, des frais de gardiennage peuvent s'appliquer selon nos conditions. {{garage.nom}} – {{garage.telephone}}",
  },
  {
    key: "pret_jp5",
    name: "Véhicule prêt — Rappel (J+5)",
    channel: "SMS",
    body: "{{garage.nom}}: votre {{vehicule.plaque}} est disponible depuis 5 jours. Frais de gardiennage possibles apres 7 jours. Tel {{garage.telephone}}",
  },
  {
    key: "pret_jp5",
    name: "Véhicule prêt — Rappel (J+5)",
    channel: "EMAIL",
    subject: "Votre véhicule est prêt depuis 5 jours",
    body: "Bonjour {{client.salutation}},\nVotre {{vehicule.marque}} ({{vehicule.plaque}}) est prêt depuis 5 jours. Merci de passer le récupérer rapidement ; au-delà de 7 jours, des frais de gardiennage peuvent s'appliquer conformément à nos conditions générales.\n{{garage.nom}} — {{garage.telephone}}",
  },
  // --- A.7 Assurance ---
  {
    key: "assur_jm15",
    name: "Assurance — Rappel (J-15)",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, l'assurance de votre {{vehicule.marque}} ({{vehicule.plaque}}) arrive à échéance le {{assurance.dateExpiration}}. Pensez à la renouveler pour rouler l'esprit tranquille. {{garage.nom}}",
  },
  {
    key: "assur_jm15",
    name: "Assurance — Rappel (J-15)",
    channel: "SMS",
    body: "{{garage.nom}}: {{client.salutation}}, l'assurance de votre {{vehicule.marque}} {{vehicule.plaque}} expire le {{assurance.dateExpiration}}. Pensez a la renouveler.",
  },
  {
    key: "assur_jm15",
    name: "Assurance — Rappel (J-15)",
    channel: "EMAIL",
    subject: "Votre assurance auto expire le {{assurance.dateExpiration}}",
    body: "Bonjour {{client.salutation}},\nD'après nos informations, l'assurance de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) arrive à échéance le {{assurance.dateExpiration}}. Pensez à la renouveler auprès de votre assureur.\n{{garage.nom}}",
  },
  {
    key: "assur_jm3",
    name: "Assurance — Rappel (J-3)",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, rappel : l'assurance de votre {{vehicule.marque}} ({{vehicule.plaque}}) expire le {{assurance.dateExpiration}}. Si c'est déjà renouvelé, envoyez-nous la nouvelle date et nous mettrons votre dossier à jour. {{garage.nom}}",
  },
  {
    key: "assur_jm3",
    name: "Assurance — Rappel (J-3)",
    channel: "SMS",
    body: "{{garage.nom}}: rappel, l'assurance de votre {{vehicule.plaque}} expire le {{assurance.dateExpiration}}. Pensez a la renouveler avant de rouler.",
  },
  {
    key: "assur_jm3",
    name: "Assurance — Rappel (J-3)",
    channel: "EMAIL",
    subject: "Rappel : assurance à renouveler avant le {{assurance.dateExpiration}}",
    body: "Bonjour {{client.salutation}},\nL'assurance de votre {{vehicule.marque}} ({{vehicule.plaque}}) expire le {{assurance.dateExpiration}}. Si elle est déjà renouvelée, répondez-nous avec la nouvelle date d'échéance.\n{{garage.nom}}",
  },
  // --- A.8 Satisfaction ---
  {
    key: "satis_jp2",
    name: "Satisfaction — Avis client (J+2)",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, merci d'avoir confié votre {{vehicule.marque}} à {{garage.nom}}. Comment s'est passée votre visite ? Notez-nous de 1 à 5 en répondant à ce message, ou donnez votre avis ici : {{lien.avis}}. Votre retour nous aide à progresser.",
  },
  {
    key: "satis_jp2",
    name: "Satisfaction — Avis client (J+2)",
    channel: "SMS",
    body: "{{garage.nom}}: merci pour votre visite! Donnez votre avis en 1 clic: {{lien.avis}}",
  },
  {
    key: "satis_jp2",
    name: "Satisfaction — Avis client (J+2)",
    channel: "EMAIL",
    subject: "Comment s'est passée votre visite chez {{garage.nom}} ?",
    body: "Bonjour {{client.salutation}},\nMerci d'avoir confié votre {{vehicule.marque}} {{vehicule.modele}} à notre atelier. Votre avis compte : il ne prend que 30 secondes.\n{{lien.avis}}\n{{garage.nom}}",
  },
];
