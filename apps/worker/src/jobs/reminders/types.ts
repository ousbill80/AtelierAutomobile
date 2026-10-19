import type {
  AntiSpamSentEntry,
  ReminderChannel,
  ReminderPriority,
  ReminderSettings,
  ReminderStep,
  ReminderType,
  RevalidateTypeInput,
  SendWindow,
  TemplateVariables,
} from "@atelieros/core";

/** Contexte minimal d'une organisation nécessaire aux jobs `reminders.plan`/`reminders.dispatch`. */
export interface OrganizationContext {
  id: string;
  timezone: string;
  operatingMode: "FULL" | "REMINDERS_ONLY";
  settings: ReminderSettings;
}

/** Ligne `ReminderRule` désérialisée (JSON `steps`/`sendWindow`/`conditions` typés). */
export interface RuleContext {
  id: string;
  type: ReminderType;
  steps: ReminderStep[];
  sendWindow: SendWindow;
  conditions: {
    customerTypes?: Array<"INDIVIDUAL" | "COMPANY">;
    minAmount?: number;
    tags?: string[];
    excludeTags?: string[];
    siteIds?: string[];
    vehicleMinYear?: number;
  };
  minGapDays?: number;
  catchUpDays?: number;
}

/** Point commun client/véhicule/dossier nécessaire à l'éligibilité et au rendu. */
export interface CustomerContext {
  id: string;
  type: "INDIVIDUAL" | "COMPANY";
  deletedAt: Date | null;
  doNotRemind: boolean;
  remindersConsent: boolean;
  tags: string[];
  displayName: string;
  phone: string | null;
  phone2: string | null;
  whatsappPhone: string | null;
  hasWhatsapp: boolean | null;
  email: string | null;
  preferredChannel: ReminderChannel | null;
  optedOutChannels: ReminderChannel[];
  phoneInvalidAt: Date | null;
}

/** Un candidat de relance (véhicule pour INSPECTION/SERVICE, dossier pour RECEIVABLE). */
export interface ReminderCandidate {
  entityId: string;
  customerId: string;
  vehicleId?: string | null;
  invoiceId?: string | null;
  siteId?: string | null;
  vehicleYear?: number | null;
  /** Montant pertinent pour RECEIVABLE. */
  amount?: number | null;
  /** Date d'ancre de la séquence (expiration VT, échéance révision, échéance la plus ancienne). */
  anchor: Date;
  plateOccurrences?: number;
  isInspectionDateSuspect?: boolean;
}

export interface StepHistoryRow {
  stepKey: string;
  status:
    | "PLANNED"
    | "NEEDS_APPROVAL"
    | "QUEUED"
    | "SENT"
    | "FAILED"
    | "SKIPPED"
    | "SNOOZED"
    | "CANCELLED";
  sentAt: Date | null;
}

export interface NewReminderInput {
  organizationId: string;
  ruleId: string;
  type: ReminderType;
  stepKey: string;
  customerId: string;
  vehicleId: string | null;
  invoiceId: string | null;
  dueDate: Date;
  scheduledFor: Date;
  status: "PLANNED" | "NEEDS_APPROVAL";
  channel: ReminderChannel | null;
  dedupeKey: string;
  sequenceKey: string;
  priority: number;
  isCatchUp: boolean;
  approvalExpiresAt: Date | null;
}

/** Gabarit (`MessageTemplate`) résolu pour un canal donné, prêt pour `renderTemplate`. */
export interface ResolvedTemplate {
  body: string;
  subject?: string | null;
}

/**
 * Relance `PLANNED` due, enrichie par le dépôt avec toutes les données fraîches nécessaires à la
 * revérification (RG-M10-24) et au rendu (RG-M10-25) — `dispatch.ts` n'orchestre que des appels
 * aux fonctions pures de `@atelieros/core`, jamais de logique métier.
 */
export interface DueReminder {
  id: string;
  type: ReminderType;
  stepKey: string;
  templateKey: string;
  customerId: string;
  vehicleId: string | null;
  invoiceId: string | null;
  sequenceKey: string;
  deferCount: number;
  priority: ReminderPriority;
  /** Canaux autorisés par le palier (`ReminderStep.channels`). */
  stepChannels: ReminderChannel[];
  customer: CustomerContext;
  /** Entrée (2) + (3-7) de `revalidateBeforeSend`, déjà construite avec des données fraîches. */
  typeCheck: RevalidateTypeInput;
  /** `true` si un humain a modifié le texte (`Reminder.editedBody`) ; alors `renderedBody` prime. */
  isEdited: boolean;
  renderedBody: string | null;
  /** Variables au moment de l'édition humaine (RG-M10-25 : détection de changement matériel). */
  editedContextVariables: TemplateVariables | null;
  /** Variables recalculées à l'instant du dispatch (RG-M10-25 : toujours re-rendu). */
  freshVariables: TemplateVariables;
  /** Gabarit actif par canal (`MessageTemplate`), `undefined` si aucun gabarit actif pour ce canal. */
  templates: Partial<Record<ReminderChannel, ResolvedTemplate>>;
}

export interface MarkSentInput {
  id: string;
  channel: ReminderChannel;
  to: string;
  renderedBody: string;
  renderedSubject?: string | null;
  provider: string;
  providerMessageId: string;
  cost?: number;
}

/** Dépendances d'accès aux données du job `reminders.dispatch`. */
export interface RemindersDispatchRepository {
  /** RG-M10-26 — relances `QUEUED` depuis plus de 30 min sans `Message` : remises `PLANNED`. */
  recoverStuckQueued(organizationId: string, now: Date): Promise<number>;
  listDueReminders(organizationId: string, now: Date): Promise<DueReminder[]>;
  antiSpamHistory(
    organizationId: string,
    recipientKey: string,
    now: Date,
  ): Promise<AntiSpamSentEntry[]>;
  isSuppressed(
    organizationId: string,
    target: {
      sequenceKey: string;
      customerId: string;
      vehicleId?: string | null;
      type: ReminderType;
    },
    now: Date,
  ): Promise<boolean>;
  cancelReminder(id: string, reason: string): Promise<void>;
  rescheduleReminder(id: string, retryAt: Date, reason: string): Promise<void>;
  deferReminder(
    id: string,
    decision: { action: "SNOOZED" | "SKIPPED"; reason: string; snoozeCount: number },
  ): Promise<void>;
  /** RG-M10-31 — aucun canal utilisable : `NEEDS_APPROVAL`, `channel = null` (onglet « À appeler »). */
  moveToCallList(id: string): Promise<void>;
  /** RG-M10-25 — donnée matérielle modifiée depuis l'édition humaine : retour en validation. */
  backToApproval(id: string, reason: string): Promise<void>;
  markSent(input: MarkSentInput): Promise<void>;
  markFailed(id: string, errorMessage: string): Promise<void>;
}

export interface DispatchResult {
  sent: number;
  failed: number;
  cancelled: number;
  rescheduled: number;
  deferred: number;
  movedToCallList: number;
  blockedByEdit: number;
  recoveredStuck: number;
}
