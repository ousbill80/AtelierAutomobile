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

/**
 * Reconstruit la forme attendue par `reminderRules.upsert`/`simulate` à partir d'une règle
 * déjà enregistrée (ses champs `steps`/`sendWindow`/`conditions` sont stockés en `Json`).
 */
export function toRuleInput(rule: StoredRule): ReminderRuleUpsertInput {
  return reminderRuleUpsertInputSchema.parse({
    id: rule.id,
    type: rule.type,
    name: rule.name,
    isActive: rule.isActive,
    steps: rule.steps,
    sendWindow: rule.sendWindow,
    conditions: rule.conditions,
    stopOn: rule.stopOn,
  });
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
