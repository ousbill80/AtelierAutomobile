"use client";

// Éditeur de règle de relance (création/modification), partagé par /parametres/relances/nouveau
// et /parametres/relances/[id]. Simplification documentée (PRD §7.3) : liste de paliers avec
// formulaire inline plutôt que la frise chronologique glisser-déposer, et conditions limitées à
// `customerTypes`/`minAmount` (tags/excludeTags/siteIds/vehicleMinYear/digest non exposés ici).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Button, Input } from "@atelieros/ui";
import {
  reminderStopEventSchema,
  type ReminderRuleUpsertInput,
  type ReminderStepInput,
} from "@atelieros/validators";
import { trpc } from "@/trpc/react";
import {
  REMINDER_CHANNEL_LABELS,
  REMINDER_STOP_EVENT_LABELS,
  REMINDER_TYPE_LABELS,
} from "../../relances/reminder-labels";
import { EMPTY_RULE_INPUT, stepKeyFromOffset } from "./rule-shape";
import { t } from "@/i18n/t";

type StopEvent = z.infer<typeof reminderStopEventSchema>;
type CustomerType = "INDIVIDUAL" | "COMPANY";
type ChannelInput = "WHATSAPP" | "SMS" | "EMAIL";

const DAY_LABELS = [0, 1, 2, 3, 4, 5, 6].map((day) => t(`reminders.ruleForm.days.${day}`));
const ANCHOR_LABELS: Record<ReminderStepInput["anchor"], string> = {
  default: t("reminders.ruleForm.anchors.default"),
  sentAt: t("reminders.ruleForm.anchors.sentAt"),
  validUntil: t("reminders.ruleForm.anchors.validUntil"),
};
const STOP_EVENTS = reminderStopEventSchema.options;
const CHANNELS: ChannelInput[] = ["WHATSAPP", "SMS", "EMAIL"];
// Permissions utiles pour soumettre un palier à une validation renforcée (US-M10 :
// mise en demeure). Simple liste de choix plutôt qu'une saisie libre.
const STEP_PERMISSIONS = ["reminder:approve", "receivable:formal_notice"] as const;

function newStep(previous?: ReminderStepInput): ReminderStepInput {
  // Les décalages doivent être strictement croissants : on propose « précédent + 7 jours ».
  const offsetDays = previous ? Math.min(previous.offsetDays + 7, 365) : 0;
  return {
    key: stepKeyFromOffset(offsetDays),
    label: t("reminders.ruleForm.defaultStepLabel"),
    offsetDays,
    anchor: "default",
    templateKey: "",
    autoSend: false,
    channels: [],
    internalOnly: false,
    attachments: [],
  };
}

export function RuleForm({ initial }: { initial?: ReminderRuleUpsertInput }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const me = trpc.me.get.useQuery(undefined, { staleTime: 60_000 });
  const canManage = (me.data?.permissions ?? []).includes("reminder:rules_manage");
  const templates = trpc.template.list.useQuery({}, { staleTime: 60_000 });
  const [rule, setRule] = useState<ReminderRuleUpsertInput>(initial ?? EMPTY_RULE_INPUT);
  const isEditing = Boolean(initial?.id);

  const upsert = trpc.reminderRules.upsert.useMutation({
    onSuccess: () => {
      utils.reminderRules.list.invalidate();
      if (rule.id) utils.reminderRules.get.invalidate({ id: rule.id });
      router.push("/parametres/relances");
    },
  });

  function updateStep(index: number, patch: Partial<ReminderStepInput>) {
    setRule((r) => ({
      ...r,
      steps: r.steps.map((s, i) => {
        if (i !== index) return s;
        const next = { ...s, ...patch };
        return next.internalOnly ? { ...next, channels: [] } : next;
      }),
    }));
  }

  function removeStep(index: number) {
    setRule((r) => ({ ...r, steps: r.steps.filter((_, i) => i !== index) }));
  }

  function addStep() {
    setRule((r) => ({ ...r, steps: [...r.steps, newStep(r.steps[r.steps.length - 1])] }));
  }

  /** La clé suit le décalage tant qu'elle n'a pas été personnalisée. */
  function updateOffset(index: number, offsetDays: number) {
    const step = rule.steps[index];
    if (!step) return;
    const autoKey = !step.key || step.key === stepKeyFromOffset(step.offsetDays);
    updateStep(index, {
      offsetDays,
      ...(autoKey && Number.isFinite(offsetDays) ? { key: stepKeyFromOffset(offsetDays) } : {}),
    });
  }

  /** Modèles proposés pour un palier : ceux de ses canaux (tous si aucun canal), clé unique. */
  function templateOptions(step: ReminderStepInput): { key: string; name: string }[] {
    const byKey = new Map<string, string>();
    for (const tpl of templates.data ?? []) {
      if (step.channels.length > 0 && !step.channels.includes(tpl.channel as ChannelInput)) {
        continue;
      }
      if (!byKey.has(tpl.key)) byKey.set(tpl.key, tpl.name);
    }
    return [...byKey.entries()]
      .map(([key, name]) => ({ key, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }

  function toggleDay(day: number) {
    setRule((r) => ({
      ...r,
      sendWindow: {
        ...r.sendWindow,
        days: r.sendWindow.days.includes(day)
          ? r.sendWindow.days.filter((d) => d !== day)
          : [...r.sendWindow.days, day].sort((a, b) => a - b),
      },
    }));
  }

  function toggleCustomerType(type: CustomerType) {
    setRule((r) => {
      const current = r.conditions.customerTypes ?? [];
      const next = current.includes(type) ? current.filter((t) => t !== type) : [...current, type];
      return {
        ...r,
        conditions: { ...r.conditions, customerTypes: next.length ? next : undefined },
      };
    });
  }

  function toggleStopEvent(event: StopEvent) {
    setRule((r) => ({
      ...r,
      stopOn: r.stopOn.includes(event) ? r.stopOn.filter((e) => e !== event) : [...r.stopOn, event],
    }));
  }

  function toggleStepChannel(index: number, channel: ChannelInput) {
    const step = rule.steps[index];
    if (!step) return;
    const next = step.channels.includes(channel)
      ? step.channels.filter((c) => c !== channel)
      : [...step.channels, channel];
    updateStep(index, { channels: next });
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        upsert.mutate(rule);
      }}
    >
      {me.data && !canManage && (
        <p className="rounded-md bg-surface-2 p-3 text-sm text-muted">
          {t("reminders.rules.readOnly")}
        </p>
      )}
      {upsert.error && (
        <p role="alert" className="rounded-md bg-status-bad-bg p-3 text-sm text-status-bad">
          {upsert.error.message}
        </p>
      )}

      <fieldset disabled={!canManage} className="flex flex-col gap-6">
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold">{t("reminders.ruleForm.general")}</h2>
          <Input
            label={t("reminders.ruleForm.name")}
            value={rule.name}
            onChange={(e) => setRule((r) => ({ ...r, name: e.target.value }))}
            required
          />
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t("reminders.ruleForm.type")}
            <select
              className="min-h-11 rounded-md border border-border bg-surface px-2 text-sm disabled:opacity-60"
              value={rule.type}
              disabled={isEditing}
              onChange={(e) =>
                setRule((r) => ({ ...r, type: e.target.value as ReminderRuleUpsertInput["type"] }))
              }
            >
              {Object.entries(REMINDER_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {isEditing && (
              <span className="text-xs text-muted">{t("reminders.ruleForm.typeLocked")}</span>
            )}
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={rule.isActive}
              onChange={(e) => setRule((r) => ({ ...r, isActive: e.target.checked }))}
            />
            {t("reminders.ruleForm.active")}
          </label>
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold">{t("reminders.ruleForm.sendWindow")}</h2>
          <div className="flex flex-wrap gap-3">
            {DAY_LABELS.map((label, day) => (
              <label key={day} className="flex min-h-11 items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={rule.sendWindow.days.includes(day)}
                  onChange={() => toggleDay(day)}
                />
                {label}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {t("reminders.ruleForm.from")}
              <input
                type="time"
                required
                className="min-h-11 w-32 rounded-md border border-border bg-surface px-3 text-sm"
                value={rule.sendWindow.from}
                onChange={(e) =>
                  setRule((r) => ({ ...r, sendWindow: { ...r.sendWindow, from: e.target.value } }))
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t("reminders.ruleForm.to")}
              <input
                type="time"
                required
                className="min-h-11 w-32 rounded-md border border-border bg-surface px-3 text-sm"
                value={rule.sendWindow.to}
                onChange={(e) =>
                  setRule((r) => ({ ...r, sendWindow: { ...r.sendWindow, to: e.target.value } }))
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t("reminders.ruleForm.preferredTime")}
              <input
                type="time"
                required
                className="min-h-11 w-32 rounded-md border border-border bg-surface px-3 text-sm"
                value={rule.sendWindow.preferredTime}
                onChange={(e) =>
                  setRule((r) => ({
                    ...r,
                    sendWindow: { ...r.sendWindow, preferredTime: e.target.value },
                  }))
                }
              />
            </label>
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold">{t("reminders.ruleForm.conditions")}</h2>
          <div className="flex flex-wrap gap-3">
            {(["INDIVIDUAL", "COMPANY"] as const).map((type) => (
              <label key={type} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={rule.conditions.customerTypes?.includes(type) ?? false}
                  onChange={() => toggleCustomerType(type)}
                />
                {type === "INDIVIDUAL"
                  ? t("reminders.ruleForm.individuals")
                  : t("reminders.ruleForm.companies")}
              </label>
            ))}
          </div>
          <label className="flex max-w-xs flex-col gap-1 text-sm font-medium">
            {t("reminders.ruleForm.minAmount")}
            <input
              type="number"
              min={0}
              className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm"
              value={rule.conditions.minAmount ?? ""}
              onChange={(e) =>
                setRule((r) => ({
                  ...r,
                  conditions: {
                    ...r.conditions,
                    minAmount: e.target.value ? Number(e.target.value) : undefined,
                  },
                }))
              }
            />
          </label>
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold">{t("reminders.ruleForm.stopTitle")}</h2>
          <p className="text-sm text-muted">{t("reminders.ruleForm.stopHint")}</p>
          <div className="flex flex-wrap gap-3">
            {STOP_EVENTS.map((event) => (
              <label key={event} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={rule.stopOn.includes(event)}
                  onChange={() => toggleStopEvent(event)}
                />
                {REMINDER_STOP_EVENT_LABELS[event] ?? event}
              </label>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{t("reminders.ruleForm.steps")}</h2>
            <Button
              type="button"
              variant="secondary"
              onClick={addStep}
              disabled={rule.steps.length >= 8}
            >
              {t("reminders.ruleForm.addStep")}
            </Button>
          </div>
          <p className="text-sm text-muted">{t("reminders.ruleForm.stepsHint")}</p>
          <div className="flex flex-col gap-4">
            {rule.steps.map((step, index) => (
              <div key={index} className="flex flex-col gap-3 rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    {t("reminders.ruleForm.stepN", { n: index + 1 })}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => removeStep(index)}
                    disabled={rule.steps.length <= 1}
                  >
                    {t("reminders.ruleForm.remove")}
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Input
                    label={t("reminders.ruleForm.key")}
                    value={step.key}
                    onChange={(e) => updateStep(index, { key: e.target.value.toUpperCase() })}
                  />
                  <Input
                    label={t("reminders.ruleForm.label")}
                    value={step.label}
                    onChange={(e) => updateStep(index, { label: e.target.value })}
                  />
                  <Input
                    label={t("reminders.ruleForm.offsetDays")}
                    type="number"
                    value={step.offsetDays}
                    onChange={(e) => updateOffset(index, Number(e.target.value))}
                  />
                  <Input
                    label={t("reminders.ruleForm.offsetHours")}
                    type="number"
                    value={step.offsetHours ?? ""}
                    onChange={(e) =>
                      updateStep(index, {
                        offsetHours: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                  />
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    {t("reminders.ruleForm.anchor")}
                    <select
                      className="min-h-11 rounded-md border border-border bg-surface px-2 text-sm"
                      value={step.anchor}
                      onChange={(e) =>
                        updateStep(index, { anchor: e.target.value as ReminderStepInput["anchor"] })
                      }
                    >
                      {Object.entries(ANCHOR_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    {t("reminders.ruleForm.templateKey")}
                    <select
                      className="min-h-11 rounded-md border border-border bg-surface px-2 text-sm"
                      value={step.templateKey}
                      required
                      onChange={(e) => updateStep(index, { templateKey: e.target.value })}
                    >
                      <option value="">
                        {templates.isLoading
                          ? t("reminders.ruleForm.templatesLoading")
                          : t("reminders.ruleForm.templatePlaceholder")}
                      </option>
                      {step.templateKey &&
                        !templateOptions(step).some((o) => o.key === step.templateKey) && (
                          <option value={step.templateKey}>
                            {t("reminders.ruleForm.templateMissing", { key: step.templateKey })}
                          </option>
                        )}
                      {templateOptions(step).map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    {t("reminders.ruleForm.permission")}
                    <select
                      className="min-h-11 rounded-md border border-border bg-surface px-2 text-sm"
                      value={step.requiresPermission ?? ""}
                      onChange={(e) =>
                        updateStep(index, { requiresPermission: e.target.value || undefined })
                      }
                    >
                      <option value="">{t("reminders.ruleForm.permissionNone")}</option>
                      {step.requiresPermission &&
                        !(STEP_PERMISSIONS as readonly string[]).includes(
                          step.requiresPermission,
                        ) && (
                          <option value={step.requiresPermission}>{step.requiresPermission}</option>
                        )}
                      {STEP_PERMISSIONS.map((permission) => (
                        <option key={permission} value={permission}>
                          {t(`permissions.${permission}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Input
                    label={t("reminders.ruleForm.catchUp")}
                    type="number"
                    value={step.catchUpDays ?? ""}
                    onChange={(e) =>
                      updateStep(index, {
                        catchUpDays: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                  />
                  <Input
                    label={t("reminders.ruleForm.sendAt")}
                    type="time"
                    value={step.sendAt ?? ""}
                    onChange={(e) => updateStep(index, { sendAt: e.target.value || undefined })}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={step.autoSend}
                      onChange={(e) => updateStep(index, { autoSend: e.target.checked })}
                    />
                    {t("reminders.ruleForm.autoSend")}
                  </label>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={step.internalOnly}
                      onChange={(e) => updateStep(index, { internalOnly: e.target.checked })}
                    />
                    {t("reminders.ruleForm.internalOnly")}
                  </label>
                </div>
                <div className="flex flex-wrap gap-4">
                  {CHANNELS.map((channel) => (
                    <label
                      key={channel}
                      className={`flex min-h-11 items-center gap-2 text-sm ${step.internalOnly ? "opacity-50" : ""}`}
                    >
                      <input
                        type="checkbox"
                        className="h-5 w-5"
                        checked={step.channels.includes(channel)}
                        disabled={step.internalOnly}
                        onChange={() => toggleStepChannel(index, channel)}
                      />
                      {REMINDER_CHANNEL_LABELS[channel]}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </fieldset>

      {canManage && (
        <div className="flex gap-3">
          <Button type="submit" disabled={upsert.isPending}>
            {t("reminders.ruleForm.save")}
          </Button>
        </div>
      )}
    </form>
  );
}
