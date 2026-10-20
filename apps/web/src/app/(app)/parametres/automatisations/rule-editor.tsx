"use client";

// M17 §7 — éditeur « Quand… / Si… / Alors… » en 3 blocs avec listes déroulantes (RG-M17-23).
import { useState } from "react";
import {
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_TRIGGERS,
  CONDITION_FIELDS,
  CONDITION_OPS,
  UNAVAILABLE_ACTIONS,
  type AutomationAction,
  type AutomationActionType,
  type AutomationCondition,
  type AutomationRole,
  type AutomationTrigger,
  type ConditionOp,
} from "@atelieros/core/automations";
import { Button, CheckboxRow, Field, Input, Select, Textarea } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/react";

const ROLES: AutomationRole[] = [
  "OWNER",
  "MANAGER",
  "ADVISOR",
  "MECHANIC",
  "STOREKEEPER",
  "CASHIER",
  "ACCOUNTANT",
];
const CHANNELS = ["WHATSAPP", "SMS", "EMAIL"] as const;

export interface RuleDraft {
  id?: string;
  name: string;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  mode: "AUTO" | "PROPOSE";
  delayMinutes: number;
}

export const EMPTY_RULE: RuleDraft = {
  name: "",
  trigger: "repair_order.status_changed",
  conditions: [],
  actions: [{ type: "send_template", templateKey: "", channel: "WHATSAPP" }],
  mode: "PROPOSE",
  delayMinutes: 0,
};

function defaultAction(type: AutomationActionType): AutomationAction {
  switch (type) {
    case "send_template":
      return { type, templateKey: "", channel: "WHATSAPP" };
    case "notify_members":
    case "create_task":
      return { type, roles: ["MANAGER"], title: "" };
    case "add_customer_tag":
      return { type, tag: "" };
    case "assign_conversation":
      return { type, membershipId: "" };
    case "schedule_reminder":
      return { type, days: 1, templateKey: "" };
    case "call_webhook":
      return { type, endpointId: "" };
    default:
      return { type: "create_payment_link" };
  }
}

/** Valeur saisie → valeur de condition (liste pour `in`, nombre si numérique). */
function parseValue(op: ConditionOp, raw: string): AutomationCondition["value"] {
  if (op === "in")
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return raw.trim() !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
}

function displayValue(value: unknown): string {
  return Array.isArray(value) ? value.join(", ") : value === undefined ? "" : String(value);
}

export function RuleEditor({
  initial,
  onDone,
}: {
  initial: RuleDraft;
  onDone: (warnings: string[]) => void;
}) {
  const [rule, setRule] = useState<RuleDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const templates = trpc.automations.messageTemplates.useQuery();
  const create = trpc.automations.create.useMutation();
  const update = trpc.automations.update.useMutation();
  const saving = create.isPending || update.isPending;

  const set = (patch: Partial<RuleDraft>) => setRule((r) => ({ ...r, ...patch }));
  const setCondition = (i: number, patch: Partial<AutomationCondition>) =>
    set({ conditions: rule.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const setAction = (i: number, next: AutomationAction) =>
    set({ actions: rule.actions.map((a, j) => (j === i ? next : a)) });

  async function save() {
    setError(null);
    // Valeurs de condition saisies (chaîne/nombre/liste) : validées côté serveur (Zod).
    const payload = {
      name: rule.name,
      trigger: rule.trigger,
      conditions: rule.conditions,
      actions: rule.actions,
      mode: rule.mode,
      delayMinutes: rule.delayMinutes,
      siteIds: [],
    } as Parameters<typeof create.mutateAsync>[0];
    try {
      const result = rule.id
        ? await update.mutateAsync({ id: rule.id, ...payload })
        : await create.mutateAsync(payload);
      onDone(result.warnings);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("automations.editor.saveError"));
    }
  }

  const templateOptions = (templates.data ?? []).filter(
    (tpl, i, all) => all.findIndex((o) => o.key === tpl.key) === i,
  );

  return (
    <section
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
      data-testid="automation-editor"
    >
      <h3 className="text-lg font-semibold">
        {rule.id ? t("automations.editor.titleEdit") : t("automations.editor.titleNew")}
      </h3>
      <Input
        label={t("automations.editor.name")}
        value={rule.name}
        onChange={(e) => set({ name: e.target.value })}
        maxLength={120}
      />

      <fieldset className="flex flex-col gap-2 rounded-md bg-surface-2 p-3">
        <legend className="font-semibold">{t("automations.editor.when")}</legend>
        <Select
          aria-label={t("automations.editor.when")}
          value={rule.trigger}
          onChange={(e) => set({ trigger: e.target.value as AutomationTrigger })}
        >
          {AUTOMATION_TRIGGERS.map((trigger) => (
            <option key={trigger} value={trigger}>
              {t(`automations.triggers.${trigger}`)}
            </option>
          ))}
        </Select>
      </fieldset>

      <fieldset className="flex flex-col gap-2 rounded-md bg-surface-2 p-3">
        <legend className="font-semibold">{t("automations.editor.if")}</legend>
        {rule.conditions.length === 0 && (
          <p className="text-sm text-muted">{t("automations.editor.noCondition")}</p>
        )}
        {rule.conditions.map((condition, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <Select
              aria-label={t("automations.editor.field")}
              value={condition.field}
              onChange={(e) => setCondition(i, { field: e.target.value })}
            >
              {CONDITION_FIELDS.map((field) => (
                <option key={field} value={field}>
                  {t(`automations.fields.${field}`)}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t("automations.editor.op")}
              value={condition.op}
              onChange={(e) => {
                const op = e.target.value as ConditionOp;
                setCondition(i, { op, value: parseValue(op, displayValue(condition.value)) });
              }}
            >
              {CONDITION_OPS.map((op) => (
                <option key={op} value={op}>
                  {t(`automations.ops.${op}`)}
                </option>
              ))}
            </Select>
            <Input
              aria-label={t("automations.editor.value")}
              value={displayValue(condition.value)}
              onChange={(e) => setCondition(i, { value: parseValue(condition.op, e.target.value) })}
            />
            <Button
              variant="ghost"
              onClick={() => set({ conditions: rule.conditions.filter((_, j) => j !== i) })}
            >
              {t("automations.editor.remove")}
            </Button>
          </div>
        ))}
        <div>
          <Button
            variant="secondary"
            onClick={() =>
              set({
                conditions: [
                  ...rule.conditions,
                  { field: CONDITION_FIELDS[0], op: "eq", value: "" },
                ],
              })
            }
          >
            {t("automations.editor.addCondition")}
          </Button>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-md bg-surface-2 p-3">
        <legend className="font-semibold">{t("automations.editor.then")}</legend>
        {rule.actions.map((action, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <Field label={t("automations.editor.actionType")}>
                  <Select
                    value={action.type}
                    onChange={(e) =>
                      setAction(i, defaultAction(e.target.value as AutomationActionType))
                    }
                  >
                    {AUTOMATION_ACTION_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`automations.actions.${type}`)}
                        {UNAVAILABLE_ACTIONS.has(type)
                          ? ` ${t("automations.actions.unavailable")}`
                          : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {rule.actions.length > 1 && (
                <Button
                  variant="ghost"
                  onClick={() => set({ actions: rule.actions.filter((_, j) => j !== i) })}
                >
                  {t("automations.editor.remove")}
                </Button>
              )}
            </div>
            <ActionFields
              action={action}
              templates={templateOptions}
              onChange={(next) => setAction(i, next)}
            />
          </div>
        ))}
        <div>
          <Button
            variant="secondary"
            onClick={() => set({ actions: [...rule.actions, defaultAction("notify_members")] })}
            disabled={rule.actions.length >= 5}
          >
            {t("automations.editor.addAction")}
          </Button>
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("automations.editor.mode")}>
          <Select
            value={rule.mode}
            onChange={(e) => set({ mode: e.target.value as RuleDraft["mode"] })}
          >
            <option value="PROPOSE">{t("automations.mode.PROPOSE")}</option>
            <option value="AUTO">{t("automations.mode.AUTO")}</option>
          </Select>
        </Field>
        <Input
          label={t("automations.editor.delay")}
          type="number"
          min={0}
          max={10080}
          value={rule.delayMinutes}
          onChange={(e) => set({ delayMinutes: Math.max(0, Number(e.target.value) || 0) })}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-status-bad">
          ⚠ {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={save} loading={saving}>
          {t("automations.editor.save")}
        </Button>
        <Button variant="secondary" onClick={() => onDone([])}>
          {t("automations.editor.cancel")}
        </Button>
      </div>
    </section>
  );
}

function ActionFields({
  action,
  templates,
  onChange,
}: {
  action: AutomationAction;
  templates: { key: string; name: string }[];
  onChange: (next: AutomationAction) => void;
}) {
  switch (action.type) {
    case "send_template":
      return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label={t("automations.editor.templateKey")}>
            <Select
              value={action.templateKey}
              onChange={(e) => onChange({ ...action, templateKey: e.target.value })}
            >
              <option value="">{t("automations.editor.selectTemplate")}</option>
              {templates.map((tpl) => (
                <option key={tpl.key} value={tpl.key}>
                  {tpl.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("automations.editor.channel")}>
            <Select
              value={action.channel}
              onChange={(e) =>
                onChange({ ...action, channel: e.target.value as (typeof CHANNELS)[number] })
              }
            >
              {CHANNELS.map((channel) => (
                <option key={channel} value={channel}>
                  {t(`automations.channels.${channel}`)}
                </option>
              ))}
            </Select>
          </Field>
          <CheckboxRow
            label={t("automations.editor.withPaymentLink")}
            checked={!!action.withPaymentLink}
            onChange={(e) => onChange({ ...action, withPaymentLink: e.target.checked })}
          />
        </div>
      );
    case "notify_members":
    case "create_task":
      return (
        <div className="flex flex-col gap-2">
          <Input
            label={t("automations.editor.title")}
            value={action.title}
            maxLength={200}
            onChange={(e) => onChange({ ...action, title: e.target.value })}
          />
          <Field label={t("automations.editor.body")}>
            <Textarea
              value={action.body ?? ""}
              maxLength={1000}
              onChange={(e) => onChange({ ...action, body: e.target.value })}
            />
          </Field>
          <div>
            <p className="text-sm font-medium">{t("automations.editor.rolesLabel")}</p>
            <div className="flex flex-wrap gap-x-4">
              {ROLES.map((role) => (
                <CheckboxRow
                  key={role}
                  label={t(`automations.roles.${role}`)}
                  checked={action.roles?.includes(role) ?? false}
                  onChange={(e) =>
                    onChange({
                      ...action,
                      roles: e.target.checked
                        ? [...(action.roles ?? []), role]
                        : (action.roles ?? []).filter((r) => r !== role),
                    })
                  }
                />
              ))}
            </div>
          </div>
        </div>
      );
    case "add_customer_tag":
      return (
        <Input
          label={t("automations.editor.tag")}
          value={action.tag}
          maxLength={50}
          onChange={(e) => onChange({ ...action, tag: e.target.value })}
        />
      );
    case "assign_conversation":
      return (
        <Input
          label={t("automations.editor.membershipId")}
          value={action.membershipId}
          onChange={(e) => onChange({ ...action, membershipId: e.target.value })}
        />
      );
    default:
      return <p className="text-sm text-muted">{t("automations.actions.unavailable")}</p>;
  }
}
