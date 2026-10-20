// M10 RG-M10-02 et Annexe A — règles de relance et modèles de message livrés par défaut à une
// organisation. Source unique pour l'assistant d'onboarding (RG-M01-16, `onboarding.saveStep`)
// et le seed de démonstration (packages/db/prisma/seed.ts) : données pures, l'appelant ajoute
// `organizationId` et écrit via `createMany`.
//
// Les placeholders {{...}} sont résolus au rendu (M11, `core/reminders/context`). Une ligne par
// canal supporté par le modèle (ex. `rdv_hm2` n'a pas de variante Email). Les variantes `_pro`
// sont choisies pour un client COMPANY avant la clé simple (RG-M10-13).

export type DefaultTemplateChannel = "WHATSAPP" | "SMS" | "EMAIL";

export type DefaultReminderType =
  | "INSPECTION"
  | "SERVICE"
  | "RECEIVABLE"
  | "APPOINTMENT"
  | "QUOTE_FOLLOWUP"
  | "VEHICLE_READY"
  | "INSURANCE_EXPIRY"
  | "SATISFACTION";

export interface DefaultMessageTemplate {
  key: string;
  name: string;
  channel: DefaultTemplateChannel;
  subject?: string;
  body: string;
  type?: DefaultReminderType;
}

/** Palier d'une règle, au format validé par `reminderStepSchema` (RG-M10-03). */
export interface DefaultReminderStep {
  key: string;
  label: string;
  offsetDays: number;
  offsetHours?: number;
  anchor?: "default" | "sentAt" | "validUntil";
  templateKey: string;
  autoSend: boolean;
  channels: DefaultTemplateChannel[];
  internalOnly?: boolean;
  requiresPermission?: string;
  attachments?: string[];
  sendAt?: string;
}

export interface DefaultReminderRule {
  type: DefaultReminderType;
  name: string;
  isActive: boolean;
  steps: DefaultReminderStep[];
  sendWindow: { days: number[]; from: string; to: string; preferredTime: string };
  conditions: Record<string, unknown>;
  stopOn: string[];
}

function sendWindow(days: number[], from: string, to: string, preferredTime: string) {
  return { days, from, to, preferredTime };
}

/** Annexe A de M10 (+ `cr_promesse_rompue`, M09). */
export const DEFAULT_MESSAGE_TEMPLATES: DefaultMessageTemplate[] = [
  // A.1 Visite technique
  {
    key: "vt_j30",
    name: "Visite technique — J-30",
    channel: "WHATSAPP",
    type: "INSPECTION",
    body: "Bonjour {{client.salutation}}, la visite technique de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) expire le {{vt.dateExpiration}}. {{garage.nom}} vous propose une pré-visite pour passer le contrôle sans surprise. Répondez à ce message ou appelez le {{garage.telephone}} pour réserver.",
  },
  {
    key: "vt_j30",
    name: "Visite technique — J-30",
    channel: "SMS",
    type: "INSPECTION",
    body: "{{garage.nom}}: {{client.salutation}}, la visite technique de votre {{vehicule.marque}} {{vehicule.plaque}} expire le {{vt.dateExpiration}}. Pre-visite: {{garage.telephone}}",
  },
  {
    key: "vt_j30",
    name: "Visite technique — J-30",
    channel: "EMAIL",
    type: "INSPECTION",
    subject:
      "Visite technique de votre {{vehicule.marque}} {{vehicule.modele}} : expiration le {{vt.dateExpiration}}",
    body: "Bonjour {{client.salutation}},\nLa visite technique de votre {{vehicule.marque}} {{vehicule.modele}} immatriculé {{vehicule.plaque}} expire le {{vt.dateExpiration}}.\nNous vous proposons une pré-visite : nous contrôlons les points vérifiés au centre (freins, éclairage, pneus, émissions) et corrigeons ce qui doit l'être, pour réussir la visite du premier coup.\nPrenez rendez-vous au {{garage.telephone}} ou en ligne : {{lien.rdv}}\n{{garage.nom}} — {{garage.adresse}} — {{garage.horaires}}",
  },
  {
    key: "vt_j7",
    name: "Visite technique — J-7",
    channel: "WHATSAPP",
    type: "INSPECTION",
    body: "Bonjour {{client.salutation}}, plus que {{vt.joursRestants}} jours : la visite technique de votre {{vehicule.marque}} ({{vehicule.plaque}}) expire le {{vt.dateExpiration}}. Nous pouvons vous recevoir cette semaine pour la pré-visite. Quel jour vous arrange ? {{garage.nom}} – {{garage.telephone}}",
  },
  {
    key: "vt_j7",
    name: "Visite technique — J-7",
    channel: "SMS",
    type: "INSPECTION",
    body: "{{garage.nom}}: {{client.salutation}}, la visite technique de votre {{vehicule.marque}} {{vehicule.plaque}} expire le {{vt.dateExpiration}}. RDV cette semaine: {{garage.telephone}}",
  },
  {
    key: "vt_j7",
    name: "Visite technique — J-7",
    channel: "EMAIL",
    type: "INSPECTION",
    subject: "Plus que {{vt.joursRestants}} jours avant l'expiration de votre visite technique",
    body: "Bonjour {{client.salutation}},\nLa visite technique de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) expire le {{vt.dateExpiration}}, dans {{vt.joursRestants}} jours.\nNous pouvons encore vous recevoir cette semaine pour une pré-visite. Réservez au {{garage.telephone}} ou ici : {{lien.rdv}}\n{{garage.nom}}",
  },
  {
    key: "vt_j0",
    name: "Visite technique — J0",
    channel: "WHATSAPP",
    type: "INSPECTION",
    body: "Bonjour {{client.salutation}}, la visite technique de votre {{vehicule.marque}} ({{vehicule.plaque}}) expire aujourd'hui, le {{vt.dateExpiration}}. Si ce n'est pas encore fait, passez nous voir : nous vous aidons à la faire rapidement. {{garage.nom}} – {{garage.telephone}}",
  },
  {
    key: "vt_j0",
    name: "Visite technique — J0",
    channel: "SMS",
    type: "INSPECTION",
    body: "{{garage.nom}}: {{client.salutation}}, la visite technique de votre {{vehicule.marque}} {{vehicule.plaque}} expire aujourd'hui. Passez nous voir. Tel {{garage.telephone}}",
  },
  {
    key: "vt_j0",
    name: "Visite technique — J0",
    channel: "EMAIL",
    type: "INSPECTION",
    subject: "Votre visite technique expire aujourd'hui",
    body: "Bonjour {{client.salutation}},\nLa visite technique de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) expire aujourd'hui. Si vous l'avez déjà faite, ignorez ce message ou indiquez-nous la nouvelle date pour mettre votre dossier à jour.\nSinon, contactez-nous au {{garage.telephone}} : nous préparons votre véhicule en priorité.\n{{garage.nom}}",
  },
  {
    key: "vt_jp7",
    name: "Visite technique — J+7",
    channel: "WHATSAPP",
    type: "INSPECTION",
    body: "Bonjour {{client.salutation}}, selon nos informations la visite technique de votre {{vehicule.marque}} ({{vehicule.plaque}}) a expiré le {{vt.dateExpiration}}. Si elle a été faite, envoyez-nous simplement la nouvelle date. Sinon, nous pouvons préparer votre véhicule rapidement : {{garage.telephone}}. {{garage.nom}}",
  },
  {
    key: "vt_jp7",
    name: "Visite technique — J+7",
    channel: "SMS",
    type: "INSPECTION",
    body: "{{garage.nom}}: {{client.salutation}}, la visite technique de votre {{vehicule.marque}} {{vehicule.plaque}} a expiré le {{vt.dateExpiration}}. On vous aide: {{garage.telephone}}",
  },
  {
    key: "vt_jp7",
    name: "Visite technique — J+7",
    channel: "EMAIL",
    type: "INSPECTION",
    subject: "Visite technique expirée : on vous aide à régulariser",
    body: "Bonjour {{client.salutation}},\nD'après notre suivi, la visite technique de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) a expiré le {{vt.dateExpiration}}.\nSi elle a déjà été faite, répondez à cet email avec la nouvelle date d'expiration : nous mettrons votre dossier à jour et vous ne recevrez plus ce rappel.\nSinon, nous pouvons préparer votre véhicule rapidement. Appelez le {{garage.telephone}}.\n{{garage.nom}}",
  },
  // vt_multi (RG-M10-05/13) : un seul message groupé quand ≥ 2 véhicules du même client
  // atteignent le même palier le même jour.
  {
    key: "vt_multi",
    name: "Visite technique — plusieurs véhicules",
    channel: "WHATSAPP",
    type: "INSPECTION",
    body: "Bonjour {{client.salutation}}, la visite technique de {{vehicules.nombre}} de vos véhicules arrive à échéance :\n{{vehicules.liste}}\n{{garage.nom}} peut organiser les pré-visites en une seule fois. Répondez à ce message ou appelez le {{garage.telephone}}.",
  },
  {
    key: "vt_multi",
    name: "Visite technique — plusieurs véhicules",
    channel: "SMS",
    type: "INSPECTION",
    body: "{{garage.nom}}: {{client.salutation}}, la visite technique de {{vehicules.nombre}} de vos vehicules arrive a echeance. Detail et RDV: {{garage.telephone}}",
  },
  {
    key: "vt_multi",
    name: "Visite technique — plusieurs véhicules",
    channel: "EMAIL",
    type: "INSPECTION",
    subject: "Visites techniques à prévoir : {{vehicules.nombre}} véhicules",
    body: "Bonjour {{client.salutation}},\nLes visites techniques suivantes arrivent à échéance :\n{{vehicules.liste}}\nNous pouvons regrouper les pré-visites sur une même journée pour limiter l'immobilisation de votre flotte. Contactez-nous au {{garage.telephone}}.\n{{garage.nom}}",
  },
  // Demande de date de VT (en validation, déclenchée depuis Échéances).
  {
    key: "vt_demande_date",
    name: "VT — Demande de date",
    channel: "WHATSAPP",
    type: "INSPECTION",
    body: "Bonjour {{client.salutation}}, pour vous rappeler à temps la visite technique de votre {{vehicule.marque}} ({{vehicule.plaque}}), pouvez-vous nous indiquer sa date d'expiration (ou envoyer une photo de la vignette) ? Merci. {{garage.nom}}",
  },
  {
    key: "vt_demande_date",
    name: "VT — Demande de date",
    channel: "SMS",
    type: "INSPECTION",
    body: "{{garage.nom}}: {{client.salutation}}, quelle est la date d'expiration de la visite technique de votre {{vehicule.plaque}}? Merci de nous appeler au {{garage.telephone}}",
  },
  // A.2 Révision
  {
    key: "rev_jm15",
    name: "Révision — J-15",
    channel: "WHATSAPP",
    type: "SERVICE",
    body: "Bonjour {{client.salutation}}, d'après notre suivi, la révision de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) est à prévoir vers le {{revision.dateEcheance}} ou à {{revision.kmEcheance}} km (estimation actuelle : {{vehicule.kmEstime}} km). Souhaitez-vous réserver un créneau ? {{garage.nom}} – {{garage.telephone}}",
  },
  {
    key: "rev_jm15",
    name: "Révision — J-15",
    channel: "SMS",
    type: "SERVICE",
    body: "{{garage.nom}}: {{client.salutation}}, la revision de votre {{vehicule.marque}} {{vehicule.plaque}} est a prevoir vers le {{revision.dateEcheance}}. RDV: {{garage.telephone}}",
  },
  {
    key: "rev_jm15",
    name: "Révision — J-15",
    channel: "EMAIL",
    type: "SERVICE",
    subject: "Votre {{vehicule.marque}} {{vehicule.modele}} approche de sa révision",
    body: "Bonjour {{client.salutation}},\nD'après notre suivi, votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) approche de sa révision : échéance vers le {{revision.dateEcheance}} ou à {{revision.kmEcheance}} km (nous estimons votre compteur à {{vehicule.kmEstime}} km).\nUne révision régulière (vidange, filtres, contrôle des freins et des niveaux) évite les pannes coûteuses et préserve la valeur de votre véhicule.\nPrenez rendez-vous au {{garage.telephone}} ou en ligne : {{lien.rdv}}\n{{garage.nom}}",
  },
  {
    key: "rev_j0",
    name: "Révision — J0",
    channel: "WHATSAPP",
    type: "SERVICE",
    body: "Bonjour {{client.salutation}}, votre {{vehicule.marque}} ({{vehicule.plaque}}) est arrivé à l'échéance de sa révision. Nous pouvons vous recevoir dès cette semaine, comptez environ une demi-journée. Quel jour vous convient ? {{garage.nom}} – {{garage.telephone}}",
  },
  {
    key: "rev_j0",
    name: "Révision — J0",
    channel: "SMS",
    type: "SERVICE",
    body: "{{garage.nom}}: {{client.salutation}}, votre {{vehicule.marque}} {{vehicule.plaque}} est due pour sa revision. Reservez au {{garage.telephone}}",
  },
  {
    key: "rev_j0",
    name: "Révision — J0",
    channel: "EMAIL",
    type: "SERVICE",
    subject: "C'est le moment de la révision de votre {{vehicule.marque}}",
    body: "Bonjour {{client.salutation}},\nVotre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) a atteint l'échéance de sa révision. Nous pouvons vous recevoir dès cette semaine.\nRéservez au {{garage.telephone}} ou ici : {{lien.rdv}}\n{{garage.nom}}",
  },
  {
    key: "rev_jp15",
    name: "Révision — J+15",
    channel: "WHATSAPP",
    type: "SERVICE",
    body: "Bonjour {{client.salutation}}, la révision de votre {{vehicule.marque}} ({{vehicule.plaque}}) était prévue le {{revision.dateEcheance}}. Rouler avec une huile usée use le moteur plus vite. Si elle a été faite ailleurs, dites-le-nous et nous mettrons votre suivi à jour. {{garage.nom}} – {{garage.telephone}}",
  },
  {
    key: "rev_jp15",
    name: "Révision — J+15",
    channel: "SMS",
    type: "SERVICE",
    body: "{{garage.nom}}: {{client.salutation}}, la revision de votre {{vehicule.marque}} {{vehicule.plaque}} etait prevue le {{revision.dateEcheance}}. RDV: {{garage.telephone}}",
  },
  {
    key: "rev_jp15",
    name: "Révision — J+15",
    channel: "EMAIL",
    type: "SERVICE",
    subject: "Révision en retard sur votre {{vehicule.marque}}",
    body: "Bonjour {{client.salutation}},\nLa révision de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) était prévue le {{revision.dateEcheance}}. Si elle a été faite, répondez-nous avec la date et le kilométrage pour que nous mettions votre suivi à jour.\nSinon, contactez-nous au {{garage.telephone}}.\n{{garage.nom}}",
  },
  {
    key: "rev_jp45",
    name: "Révision — J+45 (dernier rappel, validation)",
    channel: "WHATSAPP",
    type: "SERVICE",
    body: "Bonjour {{client.salutation}}, dernier petit rappel de {{garage.nom}} : la révision de votre {{vehicule.marque}} ({{vehicule.plaque}}) reste à faire. Nous restons à votre disposition au {{garage.telephone}}. Bonne route !",
  },
  {
    key: "rev_jp45",
    name: "Révision — J+45 (dernier rappel, validation)",
    channel: "SMS",
    type: "SERVICE",
    body: "{{garage.nom}}: {{client.salutation}}, dernier rappel pour la revision de votre {{vehicule.marque}} {{vehicule.plaque}}. RDV au {{garage.telephone}}",
  },
  {
    key: "rev_jp45",
    name: "Révision — J+45 (dernier rappel, validation)",
    channel: "EMAIL",
    type: "SERVICE",
    subject: "Dernier rappel : révision de votre {{vehicule.marque}}",
    body: "Bonjour {{client.salutation}},\nDernier rappel : la révision de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) reste à faire. Nous ne vous relancerons plus pour cette échéance.\n{{garage.nom}} — {{garage.telephone}}",
  },
  // rev_multi (RG-M10-05/13), même principe que vt_multi.
  {
    key: "rev_multi",
    name: "Révision — plusieurs véhicules",
    channel: "WHATSAPP",
    type: "SERVICE",
    body: "Bonjour {{client.salutation}}, {{vehicules.nombre}} de vos véhicules arrivent à l'échéance de leur révision :\n{{vehicules.liste}}\nNous pouvons les planifier sur une même journée. Répondez à ce message ou appelez le {{garage.telephone}}. {{garage.nom}}",
  },
  {
    key: "rev_multi",
    name: "Révision — plusieurs véhicules",
    channel: "SMS",
    type: "SERVICE",
    body: "{{garage.nom}}: {{client.salutation}}, {{vehicules.nombre}} de vos vehicules sont dus pour leur revision. Planning: {{garage.telephone}}",
  },
  {
    key: "rev_multi",
    name: "Révision — plusieurs véhicules",
    channel: "EMAIL",
    type: "SERVICE",
    subject: "Révisions à planifier : {{vehicules.nombre}} véhicules",
    body: "Bonjour {{client.salutation}},\nLes véhicules suivants arrivent à l'échéance de leur révision :\n{{vehicules.liste}}\nContactez-nous au {{garage.telephone}} pour les planifier ensemble.\n{{garage.nom}}",
  },
  // vt_rev_combo (RG-M10-13) : VT et révision dues en même temps sur le même véhicule.
  {
    key: "vt_rev_combo",
    name: "Visite technique + révision (même véhicule)",
    channel: "WHATSAPP",
    body: "Bonjour {{client.salutation}}, deux échéances pour votre {{vehicule.marque}} ({{vehicule.plaque}}) : la visite technique expire le {{vt.dateExpiration}} et la révision est due. Faites les deux en un seul passage chez {{garage.nom}}. Réservez au {{garage.telephone}}.",
  },
  {
    key: "vt_rev_combo",
    name: "Visite technique + révision (même véhicule)",
    channel: "SMS",
    body: "{{garage.nom}}: {{client.salutation}}, visite technique (exp. {{vt.dateExpiration}}) et revision a faire sur votre {{vehicule.plaque}}. RDV: {{garage.telephone}}",
  },
  {
    key: "vt_rev_combo",
    name: "Visite technique + révision (même véhicule)",
    channel: "EMAIL",
    subject: "Visite technique et révision : un seul passage",
    body: "Bonjour {{client.salutation}},\nLa visite technique de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) expire le {{vt.dateExpiration}} et sa révision est due. Nous pouvons faire la révision et la pré-visite en un seul passage.\nRéservez au {{garage.telephone}} ou ici : {{lien.rdv}}\n{{garage.nom}}",
  },
  // A.3 Créances
  {
    key: "cr_jp3",
    name: "Créances — J+3 (courtois)",
    channel: "WHATSAPP",
    type: "RECEIVABLE",
    body: "Bonjour {{client.salutation}}, sauf erreur de notre part, {{factures.resume}} reste à régler. Vous pouvez payer en un clic par Wave ou Orange Money : {{lien.paiement}}. Si le paiement est déjà fait, merci de nous le signaler et ignorez ce message. Bonne journée ! {{garage.nom}}",
  },
  {
    key: "cr_jp3",
    name: "Créances — J+3 (courtois)",
    channel: "SMS",
    type: "RECEIVABLE",
    body: "{{garage.nom}}: bonjour {{client.salutation}}, rappel de paiement pour {{factures.resume}}. Payer: {{lien.paiement}} Merci",
  },
  {
    key: "cr_jp3",
    name: "Créances — J+3 (courtois)",
    channel: "EMAIL",
    type: "RECEIVABLE",
    subject: "Rappel : {{factures.resume}}",
    body: "Bonjour {{client.salutation}},\nSauf erreur de notre part, le règlement suivant n'a pas encore été enregistré :\n{{factures.detail}}\nVous pouvez payer en ligne (Wave, Orange Money, MTN MoMo, carte) : {{lien.paiement}} — ou à notre caisse.\nSi vous avez déjà réglé, merci d'ignorer ce message.\n{{garage.nom}} — {{garage.telephone}}",
  },
  {
    key: "cr_jp15",
    name: "Créances — J+15 (rappel)",
    channel: "WHATSAPP",
    type: "RECEIVABLE",
    body: "Bonjour {{client.salutation}}, nous n'avons toujours pas reçu le règlement de {{factures.resume}}. Pouvez-vous nous indiquer quand vous pensez payer ? Lien de paiement : {{lien.paiement}}. Merci. {{garage.nom}} – {{garage.telephone}}",
  },
  {
    key: "cr_jp15",
    name: "Créances — J+15 (rappel)",
    channel: "SMS",
    type: "RECEIVABLE",
    body: "{{garage.nom}}: {{client.salutation}}, nous attendons toujours le reglement de {{factures.resume}}. Payer: {{lien.paiement}}",
  },
  {
    key: "cr_jp15",
    name: "Créances — J+15 (rappel)",
    channel: "EMAIL",
    type: "RECEIVABLE",
    subject: "Deuxième rappel : règlement en attente",
    body: "Bonjour {{client.salutation}},\nMalgré notre précédent rappel, le règlement suivant reste en attente :\n{{factures.detail}}\nPouvez-vous nous indiquer la date à laquelle vous prévoyez de régler ? Paiement en ligne : {{lien.paiement}}\n{{garage.nom}} — {{garage.telephone}}",
  },
  {
    key: "cr_jp30",
    name: "Créances — J+30 (ferme, validation)",
    channel: "WHATSAPP",
    type: "RECEIVABLE",
    body: "{{client.salutation}}, malgré nos rappels, {{factures.resume}} n'est toujours pas réglé ({{client.joursRetardMax}} jours de retard). Nous vous demandons de régulariser sous 7 jours ou de nous appeler au {{garage.telephone}} pour convenir d'un échéancier. Paiement : {{lien.paiement}}. {{garage.nom}}",
  },
  {
    key: "cr_jp30",
    name: "Créances — J+30 (ferme, validation)",
    channel: "SMS",
    type: "RECEIVABLE",
    body: "{{garage.nom}}: {{client.salutation}}, {{factures.resume}}: {{client.joursRetardMax}} j de retard. Merci de regulariser sous 7 jours: {{lien.paiement}}",
  },
  {
    key: "cr_jp30",
    name: "Créances — J+30 (ferme, validation)",
    channel: "EMAIL",
    type: "RECEIVABLE",
    subject: "Relance : régularisation demandée sous 7 jours",
    body: "{{client.salutation}},\nMalgré nos rappels, le règlement suivant n'a pas été effectué :\n{{factures.detail}}\nRetard : {{client.joursRetardMax}} jours. Nous vous demandons de régulariser cette situation sous 7 jours. Si vous rencontrez une difficulté, appelez-nous au {{garage.telephone}} : nous pouvons convenir d'un échéancier.\nPaiement en ligne : {{lien.paiement}}\n{{garage.nom}}",
  },
  // Variantes `_pro` (clients COMPANY, RG-M10-13).
  {
    key: "cr_jp3_pro",
    name: "Créance (entreprise) — Rappel courtois (J+3)",
    channel: "WHATSAPP",
    type: "RECEIVABLE",
    body: "Bonjour {{client.salutation}}, nous vous informons que {{factures.resume}} adressée à {{client.nomComplet}} est arrivée à échéance. Le relevé est disponible ici : {{lien.releve}}. Paiement par virement, Wave ou Orange Money : {{lien.paiement}}. Merci de transmettre au service comptable. {{garage.nom}}",
  },
  {
    key: "cr_jp3_pro",
    name: "Créance (entreprise) — Rappel courtois (J+3)",
    channel: "SMS",
    type: "RECEIVABLE",
    body: "{{garage.nom}}: {{factures.resume}} est arrivee a echeance. Releve et paiement: {{lien.paiement}} Contact: {{garage.telephone}}",
  },
  {
    key: "cr_jp3_pro",
    name: "Créance (entreprise) — Rappel courtois (J+3)",
    channel: "EMAIL",
    type: "RECEIVABLE",
    subject: "{{client.nomComplet}} — échéance dépassée : {{factures.resume}}",
    body: "Madame, Monsieur,\nSauf erreur de notre part, les factures suivantes sont arrivées à échéance et restent à régler :\n{{factures.detail}}\nSolde total : {{client.soldeEnRetard}}. Vous trouverez votre relevé de compte ici : {{lien.releve}}\nRèglement par virement bancaire (coordonnées sur facture), Wave, Orange Money ou MTN MoMo : {{lien.paiement}}\nMerci de bien vouloir procéder au règlement ou de nous indiquer la date prévue.\nService facturation — {{garage.nom}} — {{garage.telephone}}",
  },
  {
    key: "cr_jp15_pro",
    name: "Créance (entreprise) — Deuxième rappel (J+15)",
    channel: "WHATSAPP",
    type: "RECEIVABLE",
    body: "Bonjour {{client.salutation}}, deuxième rappel de {{garage.nom}} : {{factures.resume}} reste impayé à ce jour ({{client.joursRetardMax}} jours de retard). Merci de nous communiquer la date de mise en paiement. Relevé : {{lien.releve}}",
  },
  {
    key: "cr_jp15_pro",
    name: "Créance (entreprise) — Deuxième rappel (J+15)",
    channel: "SMS",
    type: "RECEIVABLE",
    body: "{{garage.nom}}: 2e rappel, {{factures.resume}}: {{client.joursRetardMax}} j de retard. Merci de nous donner une date. Tel {{garage.telephone}}",
  },
  {
    key: "cr_jp15_pro",
    name: "Créance (entreprise) — Deuxième rappel (J+15)",
    channel: "EMAIL",
    type: "RECEIVABLE",
    subject: "Deuxième rappel — {{client.nomComplet}} — solde {{client.soldeEnRetard}}",
    body: "Madame, Monsieur,\nNous revenons vers vous au sujet des factures suivantes, toujours impayées à ce jour :\n{{factures.detail}}\nRetard maximal : {{client.joursRetardMax}} jours. Merci de nous communiquer la date de mise en paiement ou, le cas échéant, le motif de blocage (bon de commande, réception, contestation) afin que nous puissions le lever.\nRelevé de compte : {{lien.releve}}\nService facturation — {{garage.nom}} — {{garage.telephone}}",
  },
  {
    key: "cr_jp30_pro",
    name: "Créance (entreprise) — Relance ferme (J+30)",
    channel: "WHATSAPP",
    type: "RECEIVABLE",
    body: "Madame, Monsieur, malgré nos relances, {{factures.resume}} demeure impayé ({{client.joursRetardMax}} jours de retard). Sans règlement ou proposition d'échéancier sous 7 jours, nous serons contraints de suspendre l'ouverture de nouveaux travaux à crédit. {{garage.nom}} – {{garage.telephone}}",
  },
  {
    key: "cr_jp30_pro",
    name: "Créance (entreprise) — Relance ferme (J+30)",
    channel: "SMS",
    type: "RECEIVABLE",
    body: "{{garage.nom}}: {{factures.resume}} impaye depuis {{client.joursRetardMax}} j. Sans reglement sous 7 j, credit suspendu. Tel {{garage.telephone}}",
  },
  {
    key: "cr_jp30_pro",
    name: "Créance (entreprise) — Relance ferme (J+30)",
    channel: "EMAIL",
    type: "RECEIVABLE",
    subject: "Relance ferme — {{client.nomComplet}} — {{client.soldeEnRetard}}",
    body: "Madame, Monsieur,\nMalgré nos relances, les factures suivantes demeurent impayées :\n{{factures.detail}}\nSans règlement ou proposition d'échéancier de votre part sous 7 jours, nous serons contraints de suspendre l'ouverture de nouveaux travaux à crédit pour votre compte.\nRelevé de compte : {{lien.releve}} — Paiement : {{lien.paiement}}\nDirection — {{garage.nom}} — {{garage.telephone}}",
  },
  {
    key: "cr_mise_en_demeure",
    name: "Créances — J+60 (mise en demeure, validation OWNER)",
    channel: "WHATSAPP",
    type: "RECEIVABLE",
    body: "{{client.salutation}}, vous trouverez ci-joint une mise en demeure de {{garage.nom}} concernant {{factures.resume}}. Pour régler ou en discuter, contactez-nous au {{garage.telephone}}.",
  },
  {
    key: "cr_mise_en_demeure",
    name: "Créances — J+60 (mise en demeure, validation OWNER)",
    channel: "SMS",
    type: "RECEIVABLE",
    body: "{{garage.nom}}: {{client.salutation}}, une mise en demeure concernant {{factures.resume}} vous a ete adressee. Contact: {{garage.telephone}}",
  },
  {
    key: "cr_mise_en_demeure",
    name: "Créances — J+60 (mise en demeure, validation OWNER)",
    channel: "EMAIL",
    type: "RECEIVABLE",
    subject: "Mise en demeure de payer — {{client.nomComplet}}",
    body: "{{client.salutation}},\nVeuillez trouver ci-joint une mise en demeure de payer la somme de {{client.soldeEnRetard}} au titre des factures listées dans le document.\nPour toute question ou pour convenir d'un règlement, contactez-nous au {{garage.telephone}}.\n{{garage.nom}}",
  },
  // cr_alerte_gerant (J+45, internalOnly ⇒ channels:[]) n'a pas de variante par canal : c'est
  // une notification interne / ligne du résumé quotidien (RG-M10-02), jamais un message client.
  // Pas de ligne MessageTemplate pour cette clé : le modèle n'a pas de champ Channel pertinent.

  // M09 RG-M09-06 : relance hors séquence le lendemain d'une promesse non tenue
  // (planifiée par collections.promises, stepKey PROMISE_BROKEN). Annexe A de M10.
  {
    key: "cr_promesse_rompue",
    name: "Créances — promesse non tenue",
    channel: "WHATSAPP",
    type: "RECEIVABLE",
    body: "Bonjour {{client.salutation}}, sauf erreur, le paiement de {{promesse.montant}} prévu le {{promesse.date}} ne nous est pas parvenu. Pouvez-vous régler aujourd'hui ou nous rappeler au {{garage.telephone}} ? Paiement : {{lien.paiement}}. {{garage.nom}}",
  },
  {
    key: "cr_promesse_rompue",
    name: "Créances — promesse non tenue",
    channel: "SMS",
    type: "RECEIVABLE",
    body: "{{garage.nom}}: {{client.salutation}}, paiement de {{promesse.montant}} prevu le {{promesse.date}} non recu. Payer: {{lien.paiement}}",
  },
  {
    key: "cr_promesse_rompue",
    name: "Créances — promesse non tenue",
    channel: "EMAIL",
    type: "RECEIVABLE",
    subject: "Paiement prévu le {{promesse.date}} non reçu",
    body: "Bonjour {{client.salutation}},\nVous nous aviez indiqué un paiement de {{promesse.montant}} pour le {{promesse.date}}. Sauf erreur, nous ne l'avons pas reçu.\nMerci de régler aujourd'hui ({{lien.paiement}}) ou de nous appeler au {{garage.telephone}} pour convenir d'une nouvelle date.\n{{garage.nom}}",
  },
  // Variante entreprises, step unique de la règle "Échéance proche (entreprises)" (inactive
  // par défaut). Annexe A donne aussi une variante SMS ; on la transcrit même si le palier
  // par défaut n'utilise que EMAIL + WHATSAPP (RG-M10-02), pour que le modèle soit disponible
  // si un MANAGER active le canal SMS sur cette règle.
  {
    key: "cr_avant_echeance_pro",
    name: "Créances — J-3 avant échéance (entreprises)",
    channel: "WHATSAPP",
    type: "RECEIVABLE",
    body: "Bonjour {{client.salutation}}, pour information, la facture {{facture.numero}} de {{facture.solde}} arrive à échéance le {{facture.echeance}}. Facture : {{lien.facture}} – Paiement : {{lien.paiement}}. {{garage.nom}}",
  },
  {
    key: "cr_avant_echeance_pro",
    name: "Créances — J-3 avant échéance (entreprises)",
    channel: "SMS",
    type: "RECEIVABLE",
    body: "{{garage.nom}}: facture {{facture.numero}} ({{facture.solde}}) a regler avant le {{facture.echeance}}. Paiement: {{lien.paiement}}",
  },
  {
    key: "cr_avant_echeance_pro",
    name: "Créances — J-3 avant échéance (entreprises)",
    channel: "EMAIL",
    type: "RECEIVABLE",
    subject: "Échéance le {{facture.echeance}} — facture {{facture.numero}}",
    body: "Madame, Monsieur,\nPour faciliter votre planification, la facture {{facture.numero}} d'un montant de {{facture.solde}} arrive à échéance le {{facture.echeance}}.\nFacture : {{lien.facture}} — Paiement : {{lien.paiement}}\nService facturation — {{garage.nom}}",
  },
  // A.4 Rendez-vous
  {
    key: "rdv_confirm",
    name: "Rendez-vous — confirmation",
    channel: "WHATSAPP",
    type: "APPOINTMENT",
    body: "Bonjour {{client.salutation}}, votre rendez-vous chez {{garage.nom}} est confirmé le {{rdv.date}} à {{rdv.heure}} pour votre {{vehicule.marque}} ({{vehicule.plaque}}). Adresse : {{garage.adresse}}. Un empêchement ? Répondez à ce message ou appelez le {{garage.telephone}}.",
  },
  {
    key: "rdv_confirm",
    name: "Rendez-vous — confirmation",
    channel: "SMS",
    type: "APPOINTMENT",
    body: "{{garage.nom}}: RDV confirme le {{rdv.date}} a {{rdv.heure}} pour votre {{vehicule.marque}} {{vehicule.plaque}}. Changement? Tel {{garage.telephone}}",
  },
  {
    key: "rdv_confirm",
    name: "Rendez-vous — confirmation",
    channel: "EMAIL",
    type: "APPOINTMENT",
    subject: "Rendez-vous confirmé le {{rdv.date}} à {{rdv.heure}}",
    body: "Bonjour {{client.salutation}},\nVotre rendez-vous est confirmé le {{rdv.date}} à {{rdv.heure}} pour votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}).\nAdresse : {{garage.adresse}}. Pensez à apporter la carte grise et, si possible, votre carnet d'entretien.\nPour déplacer le rendez-vous : {{garage.telephone}}. {{garage.nom}}",
  },
  {
    key: "rdv_jm1",
    name: "Rendez-vous — J-1 (veille, 17h)",
    channel: "WHATSAPP",
    type: "APPOINTMENT",
    body: "Bonjour {{client.salutation}}, petit rappel : nous vous attendons demain {{rdv.date}} à {{rdv.heure}} avec votre {{vehicule.marque}} ({{vehicule.plaque}}). Répondez OUI pour confirmer ou appelez le {{garage.telephone}} pour décaler. {{garage.nom}}",
  },
  {
    key: "rdv_jm1",
    name: "Rendez-vous — J-1 (veille, 17h)",
    channel: "SMS",
    type: "APPOINTMENT",
    body: "{{garage.nom}}: rappel, RDV demain {{rdv.date}} a {{rdv.heure}} pour votre {{vehicule.marque}} {{vehicule.plaque}}. Tel {{garage.telephone}}",
  },
  {
    key: "rdv_jm1",
    name: "Rendez-vous — J-1 (veille, 17h)",
    channel: "EMAIL",
    type: "APPOINTMENT",
    subject: "Rappel : rendez-vous demain à {{rdv.heure}}",
    body: "Bonjour {{client.salutation}},\nNous vous attendons demain {{rdv.date}} à {{rdv.heure}} avec votre {{vehicule.marque}} ({{vehicule.plaque}}). Pour décaler : {{garage.telephone}}.\n{{garage.nom}} — {{garage.adresse}}",
  },
  // rdv_hm2 : pas de variante Email d'après le PRD ("non utilisé, trop tardif").
  {
    key: "rdv_hm2",
    name: "Rendez-vous — H-2 (inactif par défaut)",
    channel: "WHATSAPP",
    type: "APPOINTMENT",
    body: "Bonjour {{client.salutation}}, nous vous attendons aujourd'hui à {{rdv.heure}} avec votre {{vehicule.marque}} ({{vehicule.plaque}}). À tout à l'heure ! {{garage.nom}}",
  },
  {
    key: "rdv_hm2",
    name: "Rendez-vous — H-2 (inactif par défaut)",
    channel: "SMS",
    type: "APPOINTMENT",
    body: "{{garage.nom}}: nous vous attendons aujourd'hui a {{rdv.heure}} avec votre {{vehicule.plaque}}. Tel {{garage.telephone}}",
  },
  // A.5 Suivi de devis
  {
    key: "devis_jp2",
    name: "Suivi de devis — J+2",
    channel: "WHATSAPP",
    type: "QUOTE_FOLLOWUP",
    body: "Bonjour {{client.salutation}}, avez-vous pu consulter le devis {{devis.numero}} ({{devis.montant}}) pour votre {{vehicule.marque}} ? Vous pouvez l'accepter en ligne, ligne par ligne : {{lien.devis}}. Une question ? Répondez ici. {{garage.nom}}",
  },
  {
    key: "devis_jp2",
    name: "Suivi de devis — J+2",
    channel: "SMS",
    type: "QUOTE_FOLLOWUP",
    body: "{{garage.nom}}: {{client.salutation}}, votre devis {{devis.numero}} ({{devis.montant}}) vous attend: {{lien.devis}} Tel {{garage.telephone}}",
  },
  {
    key: "devis_jp2",
    name: "Suivi de devis — J+2",
    channel: "EMAIL",
    type: "QUOTE_FOLLOWUP",
    subject: "Votre devis {{devis.numero}} vous attend",
    body: "Bonjour {{client.salutation}},\nVotre devis {{devis.numero}} d'un montant de {{devis.montant}} pour votre {{vehicule.marque}} {{vehicule.modele}} est disponible ici : {{lien.devis}}\nVous pouvez accepter tout ou partie des travaux en ligne. Pour toute question : {{garage.telephone}}.\n{{garage.nom}}",
  },
  {
    key: "devis_jp5",
    name: "Suivi de devis — J+5",
    channel: "WHATSAPP",
    type: "QUOTE_FOLLOWUP",
    body: "Bonjour {{client.salutation}}, souhaitez-vous que nous lancions les travaux du devis {{devis.numero}} ? Les points urgents concernent votre sécurité. Accepter en ligne : {{lien.devis}} ou appelez le {{garage.telephone}}. {{garage.nom}}",
  },
  {
    key: "devis_jp5",
    name: "Suivi de devis — J+5",
    channel: "SMS",
    type: "QUOTE_FOLLOWUP",
    body: "{{garage.nom}}: {{client.salutation}}, on lance les travaux du devis {{devis.numero}}? Accepter en ligne: {{lien.devis}}",
  },
  {
    key: "devis_jp5",
    name: "Suivi de devis — J+5",
    channel: "EMAIL",
    type: "QUOTE_FOLLOWUP",
    subject: "Devis {{devis.numero}} : souhaitez-vous lancer les travaux ?",
    body: "Bonjour {{client.salutation}},\nNous restons dans l'attente de votre décision sur le devis {{devis.numero}} ({{devis.montant}}). Les points marqués « urgent » concernent votre sécurité.\nDécider en ligne : {{lien.devis}} — ou appelez-nous au {{garage.telephone}}.\n{{garage.nom}}",
  },
  {
    key: "devis_expire",
    name: "Suivi de devis — expiration (validation)",
    channel: "WHATSAPP",
    type: "QUOTE_FOLLOWUP",
    body: "Bonjour {{client.salutation}}, le devis {{devis.numero}} est valable jusqu'au {{devis.validite}}. Après cette date, les prix des pièces pourront changer. Pour le valider : {{lien.devis}}. {{garage.nom}}",
  },
  {
    key: "devis_expire",
    name: "Suivi de devis — expiration (validation)",
    channel: "SMS",
    type: "QUOTE_FOLLOWUP",
    body: "{{garage.nom}}: le devis {{devis.numero}} est valable jusqu'au {{devis.validite}}. Pour le valider: {{lien.devis}}",
  },
  {
    key: "devis_expire",
    name: "Suivi de devis — expiration (validation)",
    channel: "EMAIL",
    type: "QUOTE_FOLLOWUP",
    subject: "Votre devis {{devis.numero}} expire le {{devis.validite}}",
    body: "Bonjour {{client.salutation}},\nLe devis {{devis.numero}} est valable jusqu'au {{devis.validite}}. Au-delà, nous devrons actualiser les prix des pièces.\nValider en ligne : {{lien.devis}}\n{{garage.nom}}",
  },
  // A.6 Véhicule prêt
  {
    key: "pret_j0",
    name: "Véhicule prêt — J0",
    channel: "WHATSAPP",
    type: "VEHICLE_READY",
    body: "Bonjour {{client.salutation}}, bonne nouvelle : votre {{vehicule.marque}} ({{vehicule.plaque}}) est prêt ! Montant à régler : {{facture.solde}}. Payez avant de venir pour gagner du temps : {{lien.paiement}}. Nous sommes ouverts {{garage.horaires}}. {{garage.nom}}",
  },
  {
    key: "pret_j0",
    name: "Véhicule prêt — J0",
    channel: "SMS",
    type: "VEHICLE_READY",
    body: "{{garage.nom}}: {{client.salutation}}, votre {{vehicule.marque}} {{vehicule.plaque}} est disponible. A regler: {{facture.solde}}. Payer: {{lien.paiement}}",
  },
  {
    key: "pret_j0",
    name: "Véhicule prêt — J0",
    channel: "EMAIL",
    type: "VEHICLE_READY",
    subject: "Votre {{vehicule.marque}} est prêt",
    body: "Bonjour {{client.salutation}},\nLes travaux sur votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) sont terminés. Montant à régler : {{facture.solde}}.\nFacture : {{lien.facture}} — Paiement en ligne : {{lien.paiement}}\nNous vous attendons {{garage.horaires}}. {{garage.nom}} — {{garage.adresse}}",
  },
  {
    key: "pret_jp2",
    name: "Véhicule prêt — J+2",
    channel: "WHATSAPP",
    type: "VEHICLE_READY",
    body: "Bonjour {{client.salutation}}, votre {{vehicule.marque}} ({{vehicule.plaque}}) vous attend chez {{garage.nom}} depuis 2 jours. Quand pensez-vous passer le récupérer ? {{garage.telephone}}",
  },
  {
    key: "pret_jp2",
    name: "Véhicule prêt — J+2",
    channel: "SMS",
    type: "VEHICLE_READY",
    body: "{{garage.nom}}: {{client.salutation}}, votre {{vehicule.marque}} {{vehicule.plaque}} vous attend depuis 2 jours. Tel {{garage.telephone}}",
  },
  {
    key: "pret_jp2",
    name: "Véhicule prêt — J+2",
    channel: "EMAIL",
    type: "VEHICLE_READY",
    subject: "Votre véhicule vous attend",
    body: "Bonjour {{client.salutation}},\nVotre {{vehicule.marque}} ({{vehicule.plaque}}) est prêt depuis 2 jours. Quand pensez-vous passer ? {{garage.telephone}}\n{{garage.nom}}",
  },
  {
    key: "pret_jp5",
    name: "Véhicule prêt — J+5 (validation)",
    channel: "WHATSAPP",
    type: "VEHICLE_READY",
    body: "Bonjour {{client.salutation}}, votre {{vehicule.marque}} ({{vehicule.plaque}}) est prêt depuis 5 jours. Merci de passer le récupérer rapidement : au-delà de 7 jours, des frais de gardiennage peuvent s'appliquer selon nos conditions. {{garage.nom}} – {{garage.telephone}}",
  },
  {
    key: "pret_jp5",
    name: "Véhicule prêt — J+5 (validation)",
    channel: "SMS",
    type: "VEHICLE_READY",
    body: "{{garage.nom}}: votre {{vehicule.plaque}} est disponible depuis 5 jours. Frais de gardiennage possibles apres 7 jours. Tel {{garage.telephone}}",
  },
  {
    key: "pret_jp5",
    name: "Véhicule prêt — J+5 (validation)",
    channel: "EMAIL",
    type: "VEHICLE_READY",
    subject: "Votre véhicule est prêt depuis 5 jours",
    body: "Bonjour {{client.salutation}},\nVotre {{vehicule.marque}} ({{vehicule.plaque}}) est prêt depuis 5 jours. Merci de passer le récupérer rapidement ; au-delà de 7 jours, des frais de gardiennage peuvent s'appliquer conformément à nos conditions générales.\n{{garage.nom}} — {{garage.telephone}}",
  },
  // A.7 Assurance
  {
    key: "assur_jm15",
    name: "Assurance — J-15 (inactif par défaut)",
    channel: "WHATSAPP",
    type: "INSURANCE_EXPIRY",
    body: "Bonjour {{client.salutation}}, l'assurance de votre {{vehicule.marque}} ({{vehicule.plaque}}) arrive à échéance le {{assurance.dateExpiration}}. Pensez à la renouveler pour rouler l'esprit tranquille. {{garage.nom}}",
  },
  {
    key: "assur_jm15",
    name: "Assurance — J-15 (inactif par défaut)",
    channel: "SMS",
    type: "INSURANCE_EXPIRY",
    body: "{{garage.nom}}: {{client.salutation}}, l'assurance de votre {{vehicule.marque}} {{vehicule.plaque}} expire le {{assurance.dateExpiration}}. Pensez a la renouveler.",
  },
  {
    key: "assur_jm15",
    name: "Assurance — J-15 (inactif par défaut)",
    channel: "EMAIL",
    type: "INSURANCE_EXPIRY",
    subject: "Votre assurance auto expire le {{assurance.dateExpiration}}",
    body: "Bonjour {{client.salutation}},\nD'après nos informations, l'assurance de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) arrive à échéance le {{assurance.dateExpiration}}. Pensez à la renouveler auprès de votre assureur.\n{{garage.nom}}",
  },
  {
    key: "assur_jm3",
    name: "Assurance — J-3 (inactif par défaut)",
    channel: "WHATSAPP",
    type: "INSURANCE_EXPIRY",
    body: "Bonjour {{client.salutation}}, rappel : l'assurance de votre {{vehicule.marque}} ({{vehicule.plaque}}) expire le {{assurance.dateExpiration}}. Si c'est déjà renouvelé, envoyez-nous la nouvelle date et nous mettrons votre dossier à jour. {{garage.nom}}",
  },
  {
    key: "assur_jm3",
    name: "Assurance — J-3 (inactif par défaut)",
    channel: "SMS",
    type: "INSURANCE_EXPIRY",
    body: "{{garage.nom}}: rappel, l'assurance de votre {{vehicule.plaque}} expire le {{assurance.dateExpiration}}. Pensez a la renouveler avant de rouler.",
  },
  {
    key: "assur_jm3",
    name: "Assurance — J-3 (inactif par défaut)",
    channel: "EMAIL",
    type: "INSURANCE_EXPIRY",
    subject: "Rappel : assurance à renouveler avant le {{assurance.dateExpiration}}",
    body: "Bonjour {{client.salutation}},\nL'assurance de votre {{vehicule.marque}} ({{vehicule.plaque}}) expire le {{assurance.dateExpiration}}. Si elle est déjà renouvelée, répondez-nous avec la nouvelle date d'échéance.\n{{garage.nom}}",
  },
  // A.8 Satisfaction
  {
    key: "satis_jp2",
    name: "Satisfaction — J+2",
    channel: "WHATSAPP",
    type: "SATISFACTION",
    body: "Bonjour {{client.salutation}}, merci d'avoir confié votre {{vehicule.marque}} à {{garage.nom}}. Comment s'est passée votre visite ? Notez-nous de 1 à 5 en répondant à ce message, ou donnez votre avis ici : {{lien.avis}}. Votre retour nous aide à progresser.",
  },
  {
    key: "satis_jp2",
    name: "Satisfaction — J+2",
    channel: "SMS",
    type: "SATISFACTION",
    body: "{{garage.nom}}: merci pour votre visite! Donnez votre avis en 1 clic: {{lien.avis}}",
  },
  {
    key: "satis_jp2",
    name: "Satisfaction — J+2",
    channel: "EMAIL",
    type: "SATISFACTION",
    subject: "Comment s'est passée votre visite chez {{garage.nom}} ?",
    body: "Bonjour {{client.salutation}},\nMerci d'avoir confié votre {{vehicule.marque}} {{vehicule.modele}} à notre atelier. Votre avis compte : il ne prend que 30 secondes.\n{{lien.avis}}\n{{garage.nom}}",
  },
];

/**
 * Les 9 règles livrées par défaut (RG-M10-02), conformes au schéma Zod de
 * packages/validators/src/reminders.ts (RG-M10-03) : offsets strictement croissants dans l'ordre
 * du tableau `steps`, `internalOnly ⇒ channels: []`.
 */
export const DEFAULT_REMINDER_RULES: DefaultReminderRule[] = [
  {
    type: "INSPECTION",
    name: "Visite technique",
    isActive: true,
    steps: [
      {
        key: "J-30",
        label: "1er rappel",
        offsetDays: -30,
        templateKey: "vt_j30",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
      {
        key: "J-7",
        label: "Rappel urgent",
        offsetDays: -7,
        templateKey: "vt_j7",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
      {
        key: "J0",
        label: "Jour J",
        offsetDays: 0,
        templateKey: "vt_j0",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
      {
        key: "J+7",
        label: "Relance retard",
        offsetDays: 7,
        templateKey: "vt_jp7",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
    ],
    sendWindow: sendWindow([1, 2, 3, 4, 5, 6], "08:00", "19:00", "09:00"),
    conditions: {},
    stopOn: ["appointment.created", "vehicle.inspection_updated", "repair_order.created"],
  },
  {
    type: "SERVICE",
    name: "Révision",
    isActive: true,
    steps: [
      {
        key: "J-15",
        label: "1er rappel",
        offsetDays: -15,
        templateKey: "rev_jm15",
        autoSend: true,
        channels: ["WHATSAPP", "SMS", "EMAIL"],
      },
      {
        key: "J0",
        label: "Échéance atteinte",
        offsetDays: 0,
        templateKey: "rev_j0",
        autoSend: true,
        channels: ["WHATSAPP", "SMS", "EMAIL"],
      },
      {
        key: "J+15",
        label: "Rappel retard",
        offsetDays: 15,
        templateKey: "rev_jp15",
        autoSend: true,
        channels: ["WHATSAPP", "SMS", "EMAIL"],
      },
      {
        key: "J+45",
        label: "Dernier rappel (validation)",
        offsetDays: 45,
        templateKey: "rev_jp45",
        autoSend: false,
        channels: ["WHATSAPP", "SMS", "EMAIL"],
      },
    ],
    sendWindow: sendWindow([1, 2, 3, 4, 5, 6], "08:00", "19:00", "09:30"),
    conditions: {},
    stopOn: ["appointment.created", "repair_order.created", "vehicle.service_recorded"],
  },
  {
    type: "RECEIVABLE",
    name: "Créances",
    isActive: true,
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
        label: "Rappel",
        offsetDays: 15,
        templateKey: "cr_jp15",
        autoSend: true,
        channels: ["WHATSAPP", "SMS", "EMAIL"],
      },
      {
        key: "J+30",
        label: "Relance ferme (validation)",
        offsetDays: 30,
        templateKey: "cr_jp30",
        autoSend: false,
        channels: ["WHATSAPP", "SMS", "EMAIL"],
      },
      {
        // RG-M10-03 : internalOnly ⇒ channels obligatoirement vide (pas de message client,
        // juste une alerte interne / ligne du résumé quotidien, RG-M10-02).
        key: "J+45",
        label: "Alerte gérant (interne)",
        offsetDays: 45,
        templateKey: "cr_alerte_gerant",
        autoSend: true,
        channels: [],
        internalOnly: true,
      },
      {
        key: "J+60",
        label: "Mise en demeure (validation OWNER)",
        offsetDays: 60,
        templateKey: "cr_mise_en_demeure",
        autoSend: false,
        channels: ["WHATSAPP", "SMS", "EMAIL"],
        requiresPermission: "receivable:formal_notice",
        attachments: ["formal_notice"],
      },
    ],
    sendWindow: sendWindow([1, 2, 3, 4, 5], "08:30", "18:00", "10:00"),
    conditions: {},
    stopOn: ["payment.received", "collection.promised", "collection.disputed", "collection.paused"],
  },
  {
    type: "RECEIVABLE",
    name: "Échéance proche (entreprises)",
    isActive: false, // RG-M10-02 : inactive par défaut
    steps: [
      {
        key: "J-3",
        label: "Rappel avant échéance",
        offsetDays: -3,
        templateKey: "cr_avant_echeance_pro",
        autoSend: true,
        channels: ["EMAIL", "WHATSAPP"],
      },
    ],
    // Fenêtre lun-ven, préférée 10:00 (RG-M10-02) ; from/to non précisés par le PRD pour
    // cette règle : on reprend ceux de la règle "Créances" (même plage ouvrière), choix
    // raisonnable documenté ici.
    sendWindow: sendWindow([1, 2, 3, 4, 5], "08:30", "18:00", "10:00"),
    conditions: { customerTypes: ["COMPANY"] },
    stopOn: ["payment.received"],
  },
  {
    type: "APPOINTMENT",
    name: "Rendez-vous",
    isActive: true,
    steps: [
      {
        // RG-M10-02 : "CONFIRM (à la création)" est déclenché immédiatement à la création du
        // RDV, pas par le décalage générique du planificateur. offsetDays:-2 n'est qu'un
        // repère pour respecter la contrainte Zod des offsets strictement croissants
        // (RG-M10-03) avant J-1 (-1) et H-2 (0) : la vraie règle de déclenchement de CONFIRM
        // est gérée par le worker (événement appointment.created), pas par cet offset.
        key: "CONFIRM",
        label: "Confirmation",
        offsetDays: -2,
        templateKey: "rdv_confirm",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
      {
        key: "J-1",
        label: "Rappel veille (17h)",
        offsetDays: -1,
        sendAt: "17:00",
        templateKey: "rdv_jm1",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
      {
        // RG-M10-02 : le palier H-2 est "inactif par défaut" dans le tableau du PRD, mais
        // c'est une note par palier, pas par règle, et ReminderStep (RG-M10-03) n'a pas de
        // champ isActive par palier. On garde donc le palier dans la frise (pour qu'un
        // MANAGER puisse l'activer plus tard) mais avec autoSend:false, qui force la
        // validation et approxime l'intention "inactif par défaut" sans bloc technique.
        key: "H-2",
        label: "Rappel 2h avant (inactif par défaut)",
        offsetDays: 0,
        offsetHours: -2,
        templateKey: "rdv_hm2",
        autoSend: false,
        channels: ["WHATSAPP", "SMS"],
      },
    ],
    // preferredTime non précisé par le PRD pour cette règle (fenêtre lun-sam 07:00-20:00) :
    // 08:00 est un choix raisonnable, documenté ici.
    sendWindow: sendWindow([1, 2, 3, 4, 5, 6], "07:00", "20:00", "08:00"),
    conditions: {},
    stopOn: ["appointment.cancelled", "appointment.updated"],
  },
  {
    type: "QUOTE_FOLLOWUP",
    name: "Suivi de devis",
    isActive: true,
    // RG-M10-03 : les offsetDays doivent être strictement croissants dans l'ordre du
    // tableau, quelle que soit l'ancre. EXPIRE (ancre validUntil, offsetDays:-1) doit donc
    // apparaître avant J+2/J+5 (ancre sentAt, offsetDays 2 et 5) même si, dans le tableau
    // RG-M10-02, il est listé en dernier : les deux ancres suivent des horloges
    // indépendantes (date d'envoi du devis vs. date de validité), l'ordre du tableau Prisma
    // ne reflète donc pas l'ordre chronologique réel pour un devis donné.
    steps: [
      {
        key: "EXPIRE",
        label: "Expiration (validation)",
        offsetDays: -1,
        anchor: "validUntil",
        templateKey: "devis_expire",
        autoSend: false,
        channels: ["WHATSAPP", "SMS"],
      },
      {
        key: "J+2",
        label: "Relance 1",
        offsetDays: 2,
        anchor: "sentAt",
        templateKey: "devis_jp2",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
      {
        key: "J+5",
        label: "Relance 2",
        offsetDays: 5,
        anchor: "sentAt",
        templateKey: "devis_jp5",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
    ],
    sendWindow: sendWindow([1, 2, 3, 4, 5, 6], "08:00", "19:00", "09:00"),
    conditions: {},
    stopOn: ["quote.accepted", "quote.declined", "quote.expired"],
  },
  {
    type: "VEHICLE_READY",
    name: "Véhicule prêt",
    isActive: true,
    steps: [
      {
        key: "J0",
        label: "Véhicule prêt",
        offsetDays: 0,
        templateKey: "pret_j0",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
      {
        key: "J+2",
        label: "Rappel 2 jours",
        offsetDays: 2,
        templateKey: "pret_jp2",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
      {
        key: "J+5",
        label: "Rappel 5 jours (validation)",
        offsetDays: 5,
        templateKey: "pret_jp5",
        autoSend: false,
        channels: ["WHATSAPP", "SMS"],
      },
    ],
    // preferredTime non précisé par le PRD pour cette règle (fenêtre lun-sam 07:30-19:30) :
    // 08:00 est un choix raisonnable, documenté ici.
    sendWindow: sendWindow([1, 2, 3, 4, 5, 6], "07:30", "19:30", "08:00"),
    conditions: {},
    stopOn: ["repair_order.status_changed"],
  },
  {
    type: "INSURANCE_EXPIRY",
    name: "Assurance",
    isActive: false, // RG-M10-02 : inactive par défaut
    steps: [
      {
        key: "J-15",
        label: "1er rappel",
        offsetDays: -15,
        templateKey: "assur_jm15",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
      {
        key: "J-3",
        label: "Rappel final",
        offsetDays: -3,
        templateKey: "assur_jm3",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
    ],
    // from/to non précisés par le PRD pour cette règle (lun-sam, préférée 09:00) : on
    // reprend la plage 08:00-19:00 de la règle "Visite technique", choix raisonnable.
    sendWindow: sendWindow([1, 2, 3, 4, 5, 6], "08:00", "19:00", "09:00"),
    conditions: {},
    stopOn: ["vehicle.insurance_updated"],
  },
  {
    type: "SATISFACTION",
    name: "Satisfaction",
    isActive: true,
    steps: [
      {
        // RG-M10-01 : l'ancre PRD est `deliveredAt` (RepairOrder), mais l'enum Zod `anchor`
        // (RG-M10-03) n'a que "default"/"sentAt"/"validUntil" — pas de valeur "deliveredAt".
        // On utilise donc "default" ; la résolution de l'ancre réelle (deliveredAt) se fait
        // côté worker pour le type SATISFACTION, pas dans ce champ de la règle.
        key: "J+2",
        label: "Enquête de satisfaction",
        offsetDays: 2,
        anchor: "default",
        templateKey: "satis_jp2",
        autoSend: true,
        channels: ["WHATSAPP", "SMS"],
      },
    ],
    sendWindow: sendWindow([1, 2, 3, 4, 5, 6], "10:00", "18:00", "10:00"),
    conditions: {},
    stopOn: [], // RG-M10-02 : "—" (aucun événement d'arrêt listé)
  },
];
