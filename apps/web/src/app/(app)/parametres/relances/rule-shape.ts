import { reminderRuleUpsertInputSchema, type ReminderRuleUpsertInput } from "@atelieros/validators";

type StoredRule = {
  id: string;
  type: string;
  name: string;
  isActive: boolean;
  steps: unknown;
  sendWindow: unknown;
  conditions: unknown;
  stopOn: string[];
};

export type RuleInputResult =
  { ok: true; input: ReminderRuleUpsertInput } | { ok: false; message: string };

/**
 * Reconstruit la forme attendue par `reminderRules.upsert`/`simulate` à partir d'une règle
 * déjà enregistrée (ses champs `steps`/`sendWindow`/`conditions` sont stockés en `Json`).
 * `safeParse` : une règle ancienne ou corrompue donne un état d'erreur, jamais un plantage.
 */
export function toRuleInput(rule: StoredRule): RuleInputResult {
  const parsed = reminderRuleUpsertInputSchema.safeParse({
    id: rule.id,
    type: rule.type,
    name: rule.name,
    isActive: rule.isActive,
    steps: rule.steps,
    sendWindow: rule.sendWindow,
    conditions: rule.conditions,
    stopOn: rule.stopOn,
  });
  if (parsed.success) return { ok: true, input: parsed.data };
  const issue = parsed.error.issues[0];
  const path = issue?.path.join(".");
  return { ok: false, message: [path, issue?.message].filter(Boolean).join(" : ") };
}

/** Clé de palier dérivée du décalage : « J-30 », « J0 », « J+15 ». */
export function stepKeyFromOffset(offsetDays: number): string {
  if (offsetDays === 0) return "J0";
  return offsetDays > 0 ? `J+${offsetDays}` : `J${offsetDays}`;
}

export function stepCount(rule: { steps: unknown }): number {
  return Array.isArray(rule.steps) ? rule.steps.length : 0;
}

export const EMPTY_RULE_INPUT: ReminderRuleUpsertInput = {
  type: "INSPECTION",
  name: "",
  isActive: true,
  steps: [
    {
      key: "J0",
      label: "Rappel",
      offsetDays: 0,
      anchor: "default",
      templateKey: "",
      autoSend: false,
      channels: [],
      internalOnly: false,
      attachments: [],
    },
  ],
  sendWindow: { days: [1, 2, 3, 4, 5, 6], from: "08:00", to: "19:00", preferredTime: "09:00" },
  conditions: {},
  stopOn: [],
};
