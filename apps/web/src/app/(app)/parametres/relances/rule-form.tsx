"use client";

// Éditeur de règle de relance (création/modification), partagé par /parametres/relances/nouveau
// et /parametres/relances/[id]. Simplification documentée (PRD §7.3) : liste de paliers avec
// formulaire inline plutôt que la frise chronologique glisser-déposer, et conditions limitées à
// `customerTypes`/`minAmount` (tags/excludeTags/siteIds/vehicleMinYear/digest non exposés ici).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Button, Field, Input } from "@atelieros/ui";
import {
  reminderStopEventSchema,
  type ReminderRuleUpsertInput,
  type ReminderStepInput,
} from "@atelieros/validators";
import { trpc } from "@/trpc/client";
import {
  REMINDER_CHANNEL_LABELS,
  REMINDER_STOP_EVENT_LABELS,
  REMINDER_TYPE_LABELS,
} from "../../relances/reminder-labels";
import { EMPTY_RULE_INPUT } from "./rule-shape";

type StopEvent = z.infer<typeof reminderStopEventSchema>;
type CustomerType = "INDIVIDUAL" | "COMPANY";
type ChannelInput = "WHATSAPP" | "SMS" | "EMAIL";

const DAY_LABELS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const ANCHOR_LABELS: Record<ReminderStepInput["anchor"], string> = {
  default: "Par défaut",
  sentAt: "Date d'envoi du palier précédent",
  validUntil: "Date de validité",
};
const STOP_EVENTS = reminderStopEventSchema.options;
const CHANNELS: ChannelInput[] = ["WHATSAPP", "SMS", "EMAIL"];

function newStep(): ReminderStepInput {
  return {
    key: "",
    label: "",
    offsetDays: 0,
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
    setRule((r) => ({ ...r, steps: [...r.steps, newStep()] }));
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
      {upsert.error && (
        <p className="rounded-md bg-status-bad-bg p-3 text-sm text-status-bad">
          {upsert.error.message}
        </p>
      )}

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <h2 className="font-semibold">Général</h2>
        <Field label="Nom de la règle">
          <Input
            value={rule.name}
            onChange={(e) => setRule((r) => ({ ...r, name: e.target.value }))}
            required
          />
        </Field>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Type
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
            <span className="text-xs text-muted">
              Le type ne peut pas être modifié après création.
            </span>
          )}
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={rule.isActive}
            onChange={(e) => setRule((r) => ({ ...r, isActive: e.target.checked }))}
          />
          Règle active
        </label>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <h2 className="font-semibold">Fenêtre d&apos;envoi</h2>
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
            De
            <input
              type="text"
              placeholder="08:00"
              className="min-h-11 w-24 rounded-md border border-border bg-surface px-3 text-sm"
              value={rule.sendWindow.from}
              onChange={(e) =>
                setRule((r) => ({ ...r, sendWindow: { ...r.sendWindow, from: e.target.value } }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            À
            <input
              type="text"
              placeholder="19:00"
              className="min-h-11 w-24 rounded-md border border-border bg-surface px-3 text-sm"
              value={rule.sendWindow.to}
              onChange={(e) =>
                setRule((r) => ({ ...r, sendWindow: { ...r.sendWindow, to: e.target.value } }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Heure préférée
            <input
              type="text"
              placeholder="09:00"
              className="min-h-11 w-24 rounded-md border border-border bg-surface px-3 text-sm"
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
        <h2 className="font-semibold">Conditions</h2>
        <div className="flex flex-wrap gap-3">
          {(["INDIVIDUAL", "COMPANY"] as const).map((type) => (
            <label key={type} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={rule.conditions.customerTypes?.includes(type) ?? false}
                onChange={() => toggleCustomerType(type)}
              />
              {type === "INDIVIDUAL" ? "Particuliers" : "Entreprises"}
            </label>
          ))}
        </div>
        <label className="flex max-w-xs flex-col gap-1 text-sm font-medium">
          Montant minimum (FCFA)
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
        <h2 className="font-semibold">Arrêt de la séquence</h2>
        <p className="text-sm text-muted">
          La séquence s&apos;arrête automatiquement si l&apos;un de ces événements survient.
        </p>
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
          <h2 className="font-semibold">Paliers</h2>
          <Button
            type="button"
            variant="secondary"
            onClick={addStep}
            disabled={rule.steps.length >= 8}
          >
            + Ajouter un palier
          </Button>
        </div>
        <p className="text-sm text-muted">
          Les décalages (jours par rapport à l&apos;échéance) doivent être strictement croissants
          d&apos;un palier à l&apos;autre.
        </p>
        <div className="flex flex-col gap-4">
          {rule.steps.map((step, index) => (
            <div key={index} className="flex flex-col gap-3 rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Palier {index + 1}</p>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => removeStep(index)}
                  disabled={rule.steps.length <= 1}
                >
                  Supprimer
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Clé">
                  <Input
                    value={step.key}
                    onChange={(e) => updateStep(index, { key: e.target.value.toUpperCase() })}
                  />
                </Field>
                <Field label="Libellé">
                  <Input
                    value={step.label}
                    onChange={(e) => updateStep(index, { label: e.target.value })}
                  />
                </Field>
                <Field label="Décalage (jours)">
                  <Input
                    type="number"
                    value={step.offsetDays}
                    onChange={(e) => updateStep(index, { offsetDays: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Décalage (heures, facultatif)">
                  <Input
                    type="number"
                    value={step.offsetHours ?? ""}
                    onChange={(e) =>
                      updateStep(index, {
                        offsetHours: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                  />
                </Field>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Ancre
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
                <Field label="Modèle (templateKey)">
                  <Input
                    value={step.templateKey}
                    onChange={(e) => updateStep(index, { templateKey: e.target.value })}
                  />
                </Field>
                <Field label="Permission requise (facultatif)">
                  <Input
                    value={step.requiresPermission ?? ""}
                    onChange={(e) =>
                      updateStep(index, { requiresPermission: e.target.value || undefined })
                    }
                  />
                </Field>
                <Field label="Rattrapage (jours, facultatif)">
                  <Input
                    type="number"
                    value={step.catchUpDays ?? ""}
                    onChange={(e) =>
                      updateStep(index, {
                        catchUpDays: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                  />
                </Field>
                <Field label="Heure d'envoi imposée (HH:mm, facultatif)">
                  <Input
                    placeholder="09:00"
                    value={step.sendAt ?? ""}
                    onChange={(e) => updateStep(index, { sendAt: e.target.value || undefined })}
                  />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={step.autoSend}
                    onChange={(e) => updateStep(index, { autoSend: e.target.checked })}
                  />
                  Envoi automatique
                </label>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={step.internalOnly}
                    onChange={(e) => updateStep(index, { internalOnly: e.target.checked })}
                  />
                  Interne uniquement (alerte, pas d&apos;envoi client)
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

      <div className="flex gap-3">
        <Button type="submit" disabled={upsert.isPending}>
          Enregistrer
        </Button>
      </div>
    </form>
  );
}
