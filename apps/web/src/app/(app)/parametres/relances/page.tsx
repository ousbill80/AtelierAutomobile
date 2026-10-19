"use client";

import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
// Imports profonds plutôt que le barrel `@atelieros/core` : ce dernier réexporte aussi
// `auth/password.ts` (module natif @node-rs/argon2), ce qui casse le bundle client dès qu'un
// composant "use client" importe quoi que ce soit du barrel (cf. inscription/page.tsx).
import { REMINDER_STOP_EVENTS } from "@atelieros/core/src/reminders/suppression";
import type { ReminderChannel, ReminderStep } from "@atelieros/core/src/reminders/types";
import {
  Button,
  CheckboxRow,
  DataTable,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHead,
  Select,
  StatusBadge,
} from "@atelieros/ui";
import type { AppRouter } from "@/server/routers/_app";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type RuleRow = RouterOutputs["reminderRules"]["list"][number];

const TYPES = [
  "INSPECTION",
  "SERVICE",
  "RECEIVABLE",
  "APPOINTMENT",
  "QUOTE_FOLLOWUP",
  "VEHICLE_READY",
  "INSURANCE_EXPIRY",
  "SATISFACTION",
] as const;
const CHANNELS: ReminderChannel[] = ["WHATSAPP", "SMS", "EMAIL"];
const WEEKDAYS = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mer" },
  { value: 4, label: "Jeu" },
  { value: 5, label: "Ven" },
  { value: 6, label: "Sam" },
  { value: 0, label: "Dim" },
] as const;

interface SendWindowForm {
  days: number[];
  from: string;
  to: string;
  preferredTime: string;
}

interface RuleForm {
  id?: string;
  type: (typeof TYPES)[number];
  name: string;
  isActive: boolean;
  steps: ReminderStep[];
  sendWindow: SendWindowForm;
  stopOn: string[];
}

function emptyStep(n: number): ReminderStep {
  return {
    key: `PALIER${n}`,
    label: `Palier ${n}`,
    offsetDays: 0,
    templateKey: "",
    autoSend: true,
    channels: ["WHATSAPP"],
  };
}

function toForm(rule: RuleRow): RuleForm {
  return {
    id: rule.id,
    type: rule.type as (typeof TYPES)[number],
    name: rule.name,
    isActive: rule.isActive,
    steps: (rule.steps as unknown as ReminderStep[]) ?? [],
    sendWindow: rule.sendWindow as unknown as SendWindowForm,
    stopOn: rule.stopOn,
  };
}

function newForm(): RuleForm {
  return {
    type: "INSPECTION",
    name: "",
    isActive: true,
    steps: [emptyStep(1)],
    sendWindow: { days: [1, 2, 3, 4, 5, 6], from: "08:00", to: "19:00", preferredTime: "09:00" },
    stopOn: [],
  };
}

export default function ReminderRulesPage() {
  const utils = trpc.useUtils();
  const rules = trpc.reminderRules.list.useQuery();
  const toggle = trpc.reminderRules.toggle.useMutation({
    onSuccess() {
      utils.reminderRules.list.invalidate();
    },
  });

  const [editing, setEditing] = useState<RuleForm | null>(null);

  return (
    <>
      <PageHead
        title={t("reminders.rules.title")}
        description={t("reminders.rules.description")}
        actions={
          <Button onClick={() => setEditing(newForm())}>{t("reminders.rules.createAction")}</Button>
        }
      />
      {rules.isLoading ? (
        <p>{t("common.loading")}</p>
      ) : rules.isError ? (
        <EmptyState title={t("common.genericError")} />
      ) : (
        <DataTable<RuleRow>
          columns={[
            {
              key: "type",
              header: t("reminders.rules.table.type"),
              render: (row) => t(`reminders.types.${row.type}`),
            },
            {
              key: "name",
              header: t("reminders.rules.table.name"),
              primary: true,
              render: (row) => row.name,
            },
            {
              key: "steps",
              header: t("reminders.rules.table.steps"),
              render: (row) => (row.steps as unknown as ReminderStep[])?.length ?? 0,
            },
            {
              key: "status",
              header: t("reminders.rules.table.status"),
              render: (row) => (
                <StatusBadge
                  tone={row.isActive ? "ok" : "off"}
                  label={
                    row.isActive
                      ? t("reminders.rules.statusActive")
                      : t("reminders.rules.statusInactive")
                  }
                />
              ),
            },
            {
              key: "actions",
              header: "",
              render: (row) => (
                <div className="row-actions">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(toForm(row))}>
                    {t("common.edit")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggle.mutate({ id: row.id, isActive: !row.isActive })}
                  >
                    {row.isActive ? t("common.deactivate") : t("common.activate")}
                  </Button>
                </div>
              ),
            },
          ]}
          rows={rules.data ?? []}
          rowKey={(row) => row.id}
          empty={<EmptyState title={t("common.genericError")} />}
        />
      )}

      {editing ? (
        <RuleEditorModal
          form={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            utils.reminderRules.list.invalidate();
          }}
        />
      ) : null}
    </>
  );
}

function RuleEditorModal({
  form,
  onClose,
  onSaved,
}: {
  form: RuleForm;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<RuleForm>(form);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [simulateResult, setSimulateResult] = useState<
    RouterOutputs["reminderRules"]["simulate"] | null
  >(null);
  const [simulating, setSimulating] = useState(false);

  const utils = trpc.useUtils();

  const upsert = trpc.reminderRules.upsert.useMutation({
    onSuccess() {
      onSaved();
    },
    onError(err: { message: string }) {
      setError(err.message);
    },
  });

  async function runSimulate() {
    setError(null);
    setSimulating(true);
    try {
      const result = await utils.reminderRules.simulate.fetch({ rule: buildInput(), days: 30 });
      setSimulateResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.genericError"));
    } finally {
      setSimulating(false);
    }
  }

  const preview = trpc.reminderRules.previewTemplate.useQuery(
    { key: previewKey ?? "" },
    { enabled: previewKey != null },
  );

  function updateStep(index: number, patch: Partial<ReminderStep>) {
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  }

  function toggleStepChannel(index: number, channel: ReminderChannel) {
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, i) => {
        if (i !== index) return s;
        const has = s.channels.includes(channel);
        return {
          ...s,
          channels: has ? s.channels.filter((c) => c !== channel) : [...s.channels, channel],
        };
      }),
    }));
  }

  function removeStep(index: number) {
    setDraft((d) => ({ ...d, steps: d.steps.filter((_, i) => i !== index) }));
  }

  function addStep() {
    setDraft((d) => ({ ...d, steps: [...d.steps, emptyStep(d.steps.length + 1)] }));
  }

  function toggleStopEvent(event: string) {
    setDraft((d) => ({
      ...d,
      stopOn: d.stopOn.includes(event) ? d.stopOn.filter((e) => e !== event) : [...d.stopOn, event],
    }));
  }

  function toggleDay(value: number) {
    setDraft((d) => ({
      ...d,
      sendWindow: {
        ...d.sendWindow,
        days: d.sendWindow.days.includes(value)
          ? d.sendWindow.days.filter((v) => v !== value)
          : [...d.sendWindow.days, value],
      },
    }));
  }

  function buildInput() {
    return {
      id: draft.id,
      type: draft.type,
      name: draft.name,
      isActive: draft.isActive,
      steps: draft.steps,
      sendWindow: draft.sendWindow as RuleForm["sendWindow"] & {
        days: (0 | 1 | 2 | 3 | 4 | 5 | 6)[];
      },
      conditions: {},
      stopOn: draft.stopOn,
    };
  }

  return (
    <Modal
      open
      size="lg"
      title={t("reminders.rules.editor.title")}
      onClose={onClose}
      footer={
        <div className="row-actions">
          <Button variant="secondary" onClick={runSimulate} loading={simulating}>
            {t("reminders.rules.editor.simulateAction")}
          </Button>
          <Button
            onClick={() => {
              setError(null);
              upsert.mutate(buildInput());
            }}
            loading={upsert.isPending}
          >
            {t("reminders.rules.editor.submit")}
          </Button>
        </div>
      }
    >
      <div className="stack">
        {error ? <p className="error">{error}</p> : null}
        <div className="grid-2">
          <Field label={t("reminders.rules.editor.nameLabel")}>
            <Input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </Field>
          <Field label={t("reminders.rules.editor.typeLabel")}>
            <Select
              value={draft.type}
              disabled={Boolean(draft.id)}
              onChange={(e) =>
                setDraft((d) => ({ ...d, type: e.target.value as RuleForm["type"] }))
              }
            >
              {TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t(`reminders.types.${ty}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <CheckboxRow
          label={t("reminders.rules.editor.activeLabel")}
          checked={draft.isActive}
          onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
        />

        <h4>{t("reminders.rules.editor.stepsTitle")}</h4>
        {draft.steps.map((step, index) => (
          <div key={index} className="card">
            <div className="grid-2">
              <Field label={t("reminders.rules.editor.stepKeyLabel")}>
                <Input
                  value={step.key}
                  onChange={(e) => updateStep(index, { key: e.target.value })}
                />
              </Field>
              <Field label={t("reminders.rules.editor.stepLabelLabel")}>
                <Input
                  value={step.label}
                  onChange={(e) => updateStep(index, { label: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid-2">
              <Field label={t("reminders.rules.editor.offsetDaysLabel")}>
                <Input
                  type="number"
                  value={step.offsetDays}
                  onChange={(e) => updateStep(index, { offsetDays: Number(e.target.value) })}
                />
              </Field>
              <Field label={t("reminders.rules.editor.sendAtLabel")}>
                <Input
                  type="time"
                  value={step.sendAt ?? ""}
                  onChange={(e) => updateStep(index, { sendAt: e.target.value || undefined })}
                />
              </Field>
            </div>
            <Field label={t("reminders.rules.editor.templateKeyLabel")}>
              <div className="row-actions">
                <Input
                  value={step.templateKey}
                  onChange={(e) => updateStep(index, { templateKey: e.target.value })}
                />
                <Button variant="ghost" size="sm" onClick={() => setPreviewKey(step.templateKey)}>
                  {t("reminders.rules.editor.previewAction")}
                </Button>
              </div>
            </Field>
            <div className="row-actions">
              {CHANNELS.map((c) => (
                <CheckboxRow
                  key={c}
                  label={t(`common.channels.${c}`)}
                  checked={step.channels.includes(c)}
                  onChange={() => toggleStepChannel(index, c)}
                />
              ))}
            </div>
            <CheckboxRow
              label={t("reminders.rules.editor.autoSendLabel")}
              checked={step.autoSend}
              onChange={(e) => updateStep(index, { autoSend: e.target.checked })}
            />
            <Button variant="danger" size="sm" onClick={() => removeStep(index)}>
              {t("reminders.rules.editor.removeStep")}
            </Button>
          </div>
        ))}
        <Button variant="secondary" size="sm" onClick={addStep} disabled={draft.steps.length >= 8}>
          {t("reminders.rules.editor.addStep")}
        </Button>

        <h4>{t("reminders.rules.editor.stopOnLabel")}</h4>
        <div className="row-actions" style={{ flexWrap: "wrap" }}>
          {REMINDER_STOP_EVENTS.map((event) => (
            <CheckboxRow
              key={event}
              label={event}
              checked={draft.stopOn.includes(event)}
              onChange={() => toggleStopEvent(event)}
            />
          ))}
        </div>

        <h4>{t("reminders.rules.editor.sendWindowTitle")}</h4>
        <div className="row-actions">
          {WEEKDAYS.map((d) => (
            <CheckboxRow
              key={d.value}
              label={d.label}
              checked={draft.sendWindow.days.includes(d.value)}
              onChange={() => toggleDay(d.value)}
            />
          ))}
        </div>
        <div className="grid-2">
          <Field label={t("reminders.rules.editor.fromLabel")}>
            <Input
              type="time"
              value={draft.sendWindow.from}
              onChange={(e) =>
                setDraft((d) => ({ ...d, sendWindow: { ...d.sendWindow, from: e.target.value } }))
              }
            />
          </Field>
          <Field label={t("reminders.rules.editor.toLabel")}>
            <Input
              type="time"
              value={draft.sendWindow.to}
              onChange={(e) =>
                setDraft((d) => ({ ...d, sendWindow: { ...d.sendWindow, to: e.target.value } }))
              }
            />
          </Field>
        </div>

        {simulateResult ? (
          <p className="hint">
            {t("reminders.rules.editor.simulateResult", {
              total: simulateResult.total,
              days: 30,
              grouped: simulateResult.grouped,
              noChannel: simulateResult.noChannel,
            })}
          </p>
        ) : null}

        {previewKey != null ? (
          <div className="card">
            <div className="card-head">
              <span className="card-title">{previewKey}</span>
              <Button variant="ghost" size="sm" onClick={() => setPreviewKey(null)}>
                {t("common.close")}
              </Button>
            </div>
            {preview.isLoading ? (
              <p>{t("common.loading")}</p>
            ) : preview.data && preview.data.length > 0 ? (
              preview.data.map((tpl) => (
                <div key={tpl.id} className="field-pair">
                  <span className="k">{t(`common.channels.${tpl.channel}`)}</span>
                  <span>
                    {tpl.subject ? `${tpl.subject} — ` : ""}
                    {tpl.body}
                  </span>
                </div>
              ))
            ) : (
              <p className="hint">{t("reminders.rules.editor.previewEmpty")}</p>
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
