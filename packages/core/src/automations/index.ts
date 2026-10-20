// M17 RG-M17-23/24/25 — automatisations « si… alors… » sans IA : catalogue des déclencheurs,
// évaluation des conditions sur le payload enrichi, garde anti-boucle, délai d'exécution et
// modèles fournis. Fonctions pures ; l'orchestration (file `automations`) est dans apps/worker.

export const AUTOMATION_TRIGGERS = [
  "repair_order.status_changed",
  "repair_order.ready",
  "quote.viewed",
  "invoice.issued",
  "payment.received",
  "appointment.no_show",
  "customer.created",
  "portal.feedback_received",
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

/**
 * Déclencheurs dont l'événement de domaine n'est encore émis par aucun module : la règle peut
 * être enregistrée mais pas activée (`portal.feedback_received` arrive avec M14 complet, 6.3).
 */
export const UNAVAILABLE_TRIGGERS: ReadonlySet<AutomationTrigger> = new Set([
  "portal.feedback_received",
]);

export const CONDITION_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains"] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export interface AutomationCondition {
  field: string;
  op: ConditionOp;
  value: unknown;
}

/** Champs proposés par l'éditeur (le moteur accepte tout chemin `a.b.c`). */
export const CONDITION_FIELDS = [
  "repairOrder.status",
  "repairOrder.totalEstimate",
  "customer.type",
  "customer.tags",
  "invoice.balance",
  "invoice.total",
  "quote.status",
  "payment.amount",
  "payment.method",
  "site.code",
  "event.to",
] as const;

export const AUTOMATION_ACTION_TYPES = [
  "send_template",
  "create_payment_link",
  "notify_members",
  "assign_conversation",
  "add_customer_tag",
  "create_task",
  "schedule_reminder",
  "call_webhook",
] as const;
export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number];

/** Actions dont l'exécution n'est pas livrée en v1 : le run les marque « non disponible ». */
export const UNAVAILABLE_ACTIONS: ReadonlySet<AutomationActionType> = new Set([
  "create_payment_link",
  "schedule_reminder",
  "call_webhook",
]);

export type AutomationChannel = "WHATSAPP" | "SMS" | "EMAIL";
export type AutomationRole =
  "OWNER" | "MANAGER" | "ADVISOR" | "MECHANIC" | "STOREKEEPER" | "CASHIER" | "ACCOUNTANT";

export type AutomationAction =
  | {
      type: "send_template";
      templateKey: string;
      channel: AutomationChannel;
      withPaymentLink?: boolean;
    }
  | { type: "create_payment_link" }
  | {
      type: "notify_members";
      roles?: AutomationRole[];
      membershipIds?: string[];
      title: string;
      body?: string;
    }
  | { type: "assign_conversation"; membershipId: string }
  | { type: "add_customer_tag"; tag: string }
  | { type: "create_task"; roles?: AutomationRole[]; title: string; body?: string }
  | { type: "schedule_reminder"; days: number; templateKey: string }
  | { type: "call_webhook"; endpointId: string };

export type AutomationMode = "AUTO" | "PROPOSE";

// ── Conditions ──

/** Valeur d'un chemin pointé (`repairOrder.status`) dans un objet ; `undefined` si absent. */
export function getPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as object)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}

function asComparable(value: unknown): number | string | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.getTime();
  return null;
}

function looselyEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const ca = asComparable(a);
  const cb = asComparable(b);
  if (ca === null || cb === null) return false;
  if (typeof ca === "string" && typeof cb === "string") {
    return ca.toLowerCase() === cb.toLowerCase();
  }
  return ca === cb;
}

export function evaluateCondition(condition: AutomationCondition, payload: unknown): boolean {
  const actual = getPath(payload, condition.field);
  const expected = condition.value;
  switch (condition.op) {
    case "eq":
      return looselyEqual(actual, expected);
    case "neq":
      return !looselyEqual(actual, expected);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = asComparable(actual);
      const b = asComparable(expected);
      if (typeof a !== "number" || typeof b !== "number") return false;
      if (condition.op === "gt") return a > b;
      if (condition.op === "gte") return a >= b;
      if (condition.op === "lt") return a < b;
      return a <= b;
    }
    case "in": {
      const list = Array.isArray(expected)
        ? expected
        : typeof expected === "string"
          ? expected.split(",").map((s) => s.trim())
          : [];
      return list.some((v) => looselyEqual(actual, v));
    }
    case "contains": {
      if (Array.isArray(actual)) return actual.some((v) => looselyEqual(v, expected));
      if (typeof actual === "string" && typeof expected === "string") {
        return actual.toLowerCase().includes(expected.toLowerCase());
      }
      return false;
    }
  }
}

export interface ConditionsResult {
  matched: boolean;
  /** Conditions non remplies (motif d'un run SKIPPED). */
  failed: AutomationCondition[];
}

/** Conditions combinées en ET ; liste vide = toujours vrai. */
export function evaluateConditions(
  conditions: readonly AutomationCondition[],
  payload: unknown,
): ConditionsResult {
  const failed = conditions.filter((c) => !evaluateCondition(c, payload));
  return { matched: failed.length === 0, failed };
}

// ── Anti-boucle et délai (RG-M17-24) ──

export const AUTOMATION_MAX_DEPTH = 3;
export const AUTOMATION_MAX_ATTEMPTS = 3;

/** Marque portée par les événements produits par une automatisation. */
export interface AutomationEventMark {
  ruleId: string;
  depth: number;
}

export function automationMarkOf(payload: unknown): AutomationEventMark | null {
  const mark = getPath(payload, "automation");
  if (mark && typeof mark === "object" && "ruleId" in mark) {
    const m = mark as { ruleId: unknown; depth?: unknown };
    return {
      ruleId: String(m.ruleId),
      depth: typeof m.depth === "number" ? m.depth : 1,
    };
  }
  return null;
}

export type TriggerGuard =
  { allowed: true; depth: number } | { allowed: false; reason: "SELF_TRIGGERED" | "MAX_DEPTH" };

/**
 * Une règle ne se déclenche jamais sur un événement qu'elle a produit, et la chaîne
 * d'automatisations s'arrête à la profondeur 3.
 */
export function guardTrigger(ruleId: string, eventPayload: unknown): TriggerGuard {
  const mark = automationMarkOf(eventPayload);
  if (!mark) return { allowed: true, depth: 0 };
  if (mark.ruleId === ruleId) return { allowed: false, reason: "SELF_TRIGGERED" };
  if (mark.depth >= AUTOMATION_MAX_DEPTH) return { allowed: false, reason: "MAX_DEPTH" };
  return { allowed: true, depth: mark.depth };
}

/** Date d'exécution d'un run : événement + délai, jamais dans le passé. */
export function runScheduledFor(eventOccurredAt: Date, delayMinutes: number, now: Date): Date {
  const due = eventOccurredAt.getTime() + Math.max(0, delayMinutes) * 60_000;
  return new Date(Math.max(due, now.getTime()));
}

/** Prochaine tentative d'un run en échec (5 min, 10 min) ; `null` après 3 essais. */
export function nextRetryAt(attempts: number, now: Date): Date | null {
  if (attempts >= AUTOMATION_MAX_ATTEMPTS) return null;
  return new Date(now.getTime() + attempts * 5 * 60_000);
}

/** Clé d'idempotence d'un envoi : M11 dédoublonne par (client, modèle, événement) (§11). */
export function automationMessageKey(
  customerId: string,
  templateKey: string,
  eventId: string,
): string {
  return `auto:${customerId}:${templateKey}:${eventId}`;
}

export interface RuleLike {
  id: string;
  trigger: string;
  isActive: boolean;
  actions: readonly { type: string }[];
}

/**
 * §11 — règles actives qui envoient déjà un message sur le même déclencheur (avertissement à
 * la création de la seconde règle).
 */
export function conflictingSendRules<R extends RuleLike>(
  rules: readonly R[],
  candidate: { id?: string; trigger: string; actions: readonly { type: string }[] },
): R[] {
  if (!candidate.actions.some((a) => a.type === "send_template")) return [];
  return rules.filter(
    (r) =>
      r.id !== candidate.id &&
      r.isActive &&
      r.trigger === candidate.trigger &&
      r.actions.some((a) => a.type === "send_template"),
  );
}

// ── Modèles fournis (RG-M17-25), désactivés par défaut ──

export interface AutomationTemplate {
  key: string;
  name: string;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  mode: AutomationMode;
  delayMinutes: number;
  /** Modèles de messages M11 à créer s'ils n'existent pas encore dans l'organisation. */
  messageTemplates?: { key: string; name: string; channel: AutomationChannel; body: string }[];
}

export const AUTOMATION_TEMPLATES: readonly AutomationTemplate[] = [
  {
    key: "ro_ready_message",
    name: "OR prêt → message + lien de paiement",
    trigger: "repair_order.status_changed",
    conditions: [{ field: "repairOrder.status", op: "eq", value: "READY" }],
    actions: [
      { type: "send_template", templateKey: "pret_j0", channel: "WHATSAPP", withPaymentLink: true },
    ],
    mode: "AUTO",
    delayMinutes: 0,
    messageTemplates: [
      {
        key: "pret_j0",
        name: "Véhicule prêt — J0",
        channel: "WHATSAPP",
        body: "Bonjour {{client.salutation}}, bonne nouvelle : votre {{vehicule.marque}} ({{vehicule.plaque}}) est prêt ! Montant à régler : {{facture.solde}}. Payez avant de venir pour gagner du temps : {{lien.paiement}}. {{garage.nom}}",
      },
    ],
  },
  {
    key: "quote_viewed_no_reply",
    name: "Devis consulté sans réponse depuis 24 h → notifier le conseiller",
    trigger: "quote.viewed",
    conditions: [{ field: "quote.status", op: "in", value: ["SENT", "VIEWED"] }],
    actions: [
      {
        type: "notify_members",
        roles: ["ADVISOR", "MANAGER"],
        title: "Devis consulté sans réponse depuis 24 h",
        body: "Le client a consulté le devis {{devis.numero}} sans répondre : relancez-le.",
      },
    ],
    mode: "AUTO",
    delayMinutes: 24 * 60,
  },
  {
    key: "payment_receipt",
    name: "Paiement reçu → reçu par WhatsApp",
    trigger: "payment.received",
    conditions: [],
    actions: [{ type: "send_template", templateKey: "auto_recu_paiement", channel: "WHATSAPP" }],
    mode: "AUTO",
    delayMinutes: 0,
    messageTemplates: [
      {
        key: "auto_recu_paiement",
        name: "Reçu de paiement",
        channel: "WHATSAPP",
        body: "Bonjour {{client.salutation}}, nous avons bien reçu votre paiement de {{paiement.montant}}. Merci de votre confiance. {{garage.nom}}",
      },
    ],
  },
  {
    key: "no_show_reschedule",
    name: "RDV non honoré → message de reprogrammation",
    trigger: "appointment.no_show",
    conditions: [],
    actions: [{ type: "send_template", templateKey: "auto_rdv_reprogrammer", channel: "WHATSAPP" }],
    mode: "PROPOSE",
    delayMinutes: 60,
    messageTemplates: [
      {
        key: "auto_rdv_reprogrammer",
        name: "RDV manqué — reprogrammation",
        channel: "WHATSAPP",
        body: "Bonjour {{client.salutation}}, nous ne vous avons pas vu à votre rendez-vous. Souhaitez-vous en fixer un nouveau ? Répondez à ce message ou appelez le {{garage.telephone}}. {{garage.nom}}",
      },
    ],
  },
  {
    key: "low_review_task",
    name: "Avis ≤ 3 → tâche gérant",
    trigger: "portal.feedback_received",
    conditions: [{ field: "event.rating", op: "lte", value: 3 }],
    actions: [
      {
        type: "create_task",
        roles: ["OWNER", "MANAGER"],
        title: "Avis client négatif à traiter",
        body: "Un client a laissé une note de {{evenement.note}}/5.",
      },
    ],
    mode: "AUTO",
    delayMinutes: 0,
  },
  {
    key: "company_fleet_tag",
    name: "Nouveau client entreprise → tag flotte + notifier le comptable",
    trigger: "customer.created",
    conditions: [{ field: "customer.type", op: "eq", value: "COMPANY" }],
    actions: [
      { type: "add_customer_tag", tag: "flotte" },
      {
        type: "notify_members",
        roles: ["ACCOUNTANT"],
        title: "Nouveau client entreprise",
        body: "{{client.nomComplet}} a été créé : vérifiez ses conditions de paiement.",
      },
    ],
    mode: "AUTO",
    delayMinutes: 0,
  },
];

export function automationTemplateByKey(key: string): AutomationTemplate | undefined {
  return AUTOMATION_TEMPLATES.find((t) => t.key === key);
}

/** Remplace `{{a.b}}` dans un texte de notification (valeur absente → vide). */
export function interpolateAutomationText(text: string, context: unknown): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = getPath(context, path);
    return value === undefined || value === null ? "" : String(value);
  });
}
