"use client";

import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
// Import profond plutôt que le barrel `@atelieros/core` : ce dernier réexporte aussi
// `auth/password.ts` (module natif @node-rs/argon2), ce qui casse le bundle client dès qu'un
// composant "use client" importe quoi que ce soit du barrel (cf. inscription/page.tsx).
import { formatFCFA } from "@atelieros/core/src/money/format";
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
  Tabs,
  Textarea,
} from "@atelieros/ui";
import type { AppRouter } from "@/server/routers/_app";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type QueueItem = RouterOutputs["reminders"]["queue"]["items"][number];

const TABS = [
  "NEEDS_APPROVAL",
  "CALL_LIST",
  "PLANNED_TODAY",
  "SENT_TODAY",
  "FAILED",
  "EXPIRED",
] as const;
type QueueTab = (typeof TABS)[number];

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

const CHANNELS = ["WHATSAPP", "SMS", "EMAIL"] as const;

function statusTone(status: string): "ok" | "warn" | "bad" | "off" {
  switch (status) {
    case "SENT":
      return "ok";
    case "FAILED":
      return "bad";
    case "NEEDS_APPROVAL":
    case "PLANNED":
    case "QUEUED":
      return "warn";
    default:
      return "off";
  }
}

export default function RemindersQueuePage() {
  const [tab, setTab] = useState<QueueTab>("NEEDS_APPROVAL");
  const [typeFilter, setTypeFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [snoozeIds, setSnoozeIds] = useState<string[] | null>(null);
  const [snoozeDate, setSnoozeDate] = useState("");
  const [skipIds, setSkipIds] = useState<string[] | null>(null);
  const [skipReason, setSkipReason] = useState("");
  const [stopSequence, setStopSequence] = useState(false);

  const utils = trpc.useUtils();
  const me = trpc.me.get.useQuery();
  const canApprove = new Set(me.data?.permissions ?? []).has("reminder:approve");

  const queue = trpc.reminders.queue.useQuery({
    tab,
    types: typeFilter ? [typeFilter as (typeof TYPES)[number]] : undefined,
    channels: channelFilter ? [channelFilter as (typeof CHANNELS)[number]] : undefined,
    limit: 50,
  });

  function invalidateAll() {
    utils.reminders.queue.invalidate();
    utils.reminders.get.invalidate();
  }

  const approve = trpc.reminders.approve.useMutation({
    onSuccess() {
      setSelected(new Set());
      invalidateAll();
    },
  });
  const snooze = trpc.reminders.snooze.useMutation({
    onSuccess() {
      setSnoozeIds(null);
      setSnoozeDate("");
      setSelected(new Set());
      invalidateAll();
    },
  });
  const skip = trpc.reminders.skip.useMutation({
    onSuccess() {
      setSkipIds(null);
      setSkipReason("");
      setStopSequence(false);
      setSelected(new Set());
      invalidateAll();
    },
  });

  const items = queue.data?.items ?? [];
  const counts: Record<string, number> = queue.data?.counts ?? {};

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <PageHead title={t("reminders.queue.title")} description={t("reminders.queue.description")} />
      <Tabs
        items={TABS.map((key) => ({
          key,
          label: `${t(`reminders.queue.tabs.${key}`)} (${counts[key] ?? 0})`,
        }))}
        activeKey={tab}
        onChange={(key) => {
          setTab(key as QueueTab);
          setSelected(new Set());
        }}
      />
      <div className="row-actions">
        <Field label={t("reminders.queue.filters.type")}>
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">{t("reminders.queue.filters.allTypes")}</option>
            {TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {t(`reminders.types.${ty}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("reminders.queue.filters.channel")}>
          <Select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}>
            <option value="">{t("reminders.queue.filters.allChannels")}</option>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {t(`common.channels.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {selected.size > 0 && canApprove ? (
        <div className="row-actions">
          <Button
            onClick={() => approve.mutate({ ids: Array.from(selected) })}
            loading={approve.isPending}
          >
            {t("reminders.queue.actions.approveSelected", { count: selected.size })}
          </Button>
          <Button variant="secondary" onClick={() => setSnoozeIds(Array.from(selected))}>
            {t("reminders.queue.actions.snoozeSelected")}
          </Button>
          <Button variant="danger" onClick={() => setSkipIds(Array.from(selected))}>
            {t("reminders.queue.actions.skipSelected")}
          </Button>
        </div>
      ) : null}

      {queue.isLoading ? (
        <p>{t("common.loading")}</p>
      ) : queue.isError ? (
        <EmptyState title={t("common.genericError")} />
      ) : (
        <DataTable<QueueItem>
          columns={[
            {
              key: "select",
              header: "",
              render: (row) => (
                <CheckboxRow
                  label=""
                  checked={selected.has(row.id)}
                  onChange={() => toggleSelected(row.id)}
                />
              ),
            },
            {
              key: "type",
              header: t("reminders.queue.table.type"),
              primary: true,
              render: (row) => t(`reminders.types.${row.type}`),
            },
            {
              key: "customer",
              header: t("reminders.queue.table.customer"),
              render: (row) => row.customer.displayName,
            },
            {
              key: "vehicle",
              header: t("reminders.queue.table.vehicle"),
              render: (row) => (row.vehicle ? row.vehicle.plate : "—"),
            },
            {
              key: "due",
              header: t("reminders.queue.table.due"),
              render: (row) => row.countdown,
            },
            {
              key: "channel",
              header: t("reminders.queue.table.channel"),
              render: (row) =>
                row.channel ? (
                  <StatusBadge tone="ok" label={t(`common.channels.${row.channel}`)} />
                ) : (
                  <StatusBadge tone="warn" label={t("reminders.queue.noChannel")} />
                ),
            },
            {
              key: "amount",
              header: t("reminders.queue.table.amount"),
              render: (row) => (row.amount != null ? formatFCFA(row.amount) : "—"),
            },
            {
              key: "actions",
              header: "",
              render: (row) => (
                <Button variant="ghost" size="sm" onClick={() => setDetailId(row.id)}>
                  {t("reminders.queue.view")}
                </Button>
              ),
            },
          ]}
          rows={items}
          rowKey={(row) => row.id}
          onRowClick={(row) => setDetailId(row.id)}
          empty={
            <EmptyState
              title={t("reminders.queue.empty.title")}
              description={t("reminders.queue.empty.description")}
            />
          }
        />
      )}

      {detailId ? (
        <ReminderDetailModal
          id={detailId}
          canApprove={canApprove}
          onClose={() => setDetailId(null)}
          onApprove={(id) => approve.mutate({ ids: [id] })}
          approving={approve.isPending}
          onSnooze={(id) => setSnoozeIds([id])}
          onSkip={(id) => setSkipIds([id])}
          onDone={invalidateAll}
        />
      ) : null}

      <Modal
        open={snoozeIds != null}
        title={t("reminders.queue.snoozeModal.title")}
        onClose={() => setSnoozeIds(null)}
        footer={
          <Button
            onClick={() => {
              if (!snoozeIds || !snoozeDate) return;
              snooze.mutate({ ids: snoozeIds, until: new Date(snoozeDate) });
            }}
            loading={snooze.isPending}
            disabled={!snoozeDate}
          >
            {t("reminders.queue.snoozeModal.submit")}
          </Button>
        }
      >
        <Field label={t("reminders.queue.snoozeModal.untilLabel")}>
          <Input type="date" value={snoozeDate} onChange={(e) => setSnoozeDate(e.target.value)} />
        </Field>
      </Modal>

      <Modal
        open={skipIds != null}
        title={t("reminders.queue.skipModal.title")}
        onClose={() => setSkipIds(null)}
        footer={
          <Button
            variant="danger"
            onClick={() => {
              if (!skipIds || !skipReason.trim()) return;
              skip.mutate({ ids: skipIds, reason: skipReason.trim(), stopSequence });
            }}
            loading={skip.isPending}
            disabled={!skipReason.trim()}
          >
            {t("reminders.queue.skipModal.submit")}
          </Button>
        }
      >
        <Field label={t("reminders.queue.skipModal.reasonLabel")}>
          <Textarea value={skipReason} onChange={(e) => setSkipReason(e.target.value)} />
        </Field>
        <CheckboxRow
          label={t("reminders.queue.skipModal.stopSequence")}
          checked={stopSequence}
          onChange={(e) => setStopSequence(e.target.checked)}
        />
      </Modal>
    </>
  );
}

function ReminderDetailModal({
  id,
  canApprove,
  onClose,
  onApprove,
  approving,
  onSnooze,
  onSkip,
  onDone,
}: {
  id: string;
  canApprove: boolean;
  onClose: () => void;
  onApprove: (id: string) => void;
  approving: boolean;
  onSnooze: (id: string) => void;
  onSkip: (id: string) => void;
  onDone: () => void;
}) {
  const detail = trpc.reminders.get.useQuery({ id });
  const reminder = detail.data?.reminder;
  const channel = reminder?.channel as "WHATSAPP" | "SMS" | "EMAIL" | null | undefined;

  const preview = trpc.reminders.preview.useQuery(
    { id, channel: channel as "WHATSAPP" | "SMS" | "EMAIL" },
    { enabled: Boolean(channel) },
  );

  const markWaLinkSent = trpc.reminders.markWaLinkSent.useMutation({
    onSuccess() {
      onDone();
      onClose();
    },
  });

  const retry = trpc.reminders.retry.useMutation({
    onSuccess() {
      onDone();
      onClose();
    },
  });

  const customer = reminder?.customer;
  const phoneDigits = customer
    ? ((customer.whatsappPhone ?? customer.phone ?? customer.phone2 ?? "") as string).replace(
        /[^0-9]/g,
        "",
      )
    : "";
  const waLink =
    channel === "WHATSAPP" && phoneDigits && preview.data?.body
      ? `https://wa.me/${phoneDigits}?text=${encodeURIComponent(preview.data.body)}`
      : null;

  return (
    <Modal
      open
      size="lg"
      title={t("reminders.queue.detail.title")}
      onClose={onClose}
      footer={
        reminder ? (
          <div className="row-actions">
            {reminder.status === "FAILED" ? (
              <Button onClick={() => retry.mutate({ id })} loading={retry.isPending}>
                {t("reminders.queue.detail.retry")}
              </Button>
            ) : null}
            {canApprove &&
            (reminder.status === "NEEDS_APPROVAL" || reminder.status === "PLANNED") ? (
              <>
                <Button onClick={() => onApprove(id)} loading={approving}>
                  {t("reminders.queue.detail.approve")}
                </Button>
                <Button variant="secondary" onClick={() => onSnooze(id)}>
                  {t("reminders.queue.detail.snooze")}
                </Button>
                <Button variant="danger" onClick={() => onSkip(id)}>
                  {t("reminders.queue.detail.skip")}
                </Button>
              </>
            ) : null}
          </div>
        ) : undefined
      }
    >
      {detail.isLoading || !reminder ? (
        <p>{t("common.loading")}</p>
      ) : (
        <div className="stack">
          <div className="field-pair">
            <span className="k">{t("reminders.queue.detail.customer")}</span>
            <span>{reminder.customer.displayName}</span>
          </div>
          {reminder.vehicle ? (
            <div className="field-pair">
              <span className="k">{t("reminders.queue.detail.vehicle")}</span>
              <span>
                {reminder.vehicle.make} {reminder.vehicle.model} ({reminder.vehicle.plate})
              </span>
            </div>
          ) : null}
          <div className="field-pair">
            <span className="k">{t("reminders.queue.detail.status")}</span>
            <StatusBadge
              tone={statusTone(reminder.status)}
              label={t(`reminders.status.${reminder.status}`)}
            />
          </div>

          {!channel ? (
            <EmptyState
              title={t("reminders.queue.detail.noChannelNote")}
              description={
                phoneDigits
                  ? t("reminders.queue.detail.phoneLabel") + " : " + phoneDigits
                  : undefined
              }
            />
          ) : preview.isLoading ? (
            <p>{t("common.loading")}</p>
          ) : (
            <>
              {preview.data?.subject ? <p className="hint">{preview.data.subject}</p> : null}
              <Textarea value={preview.data?.body ?? ""} readOnly rows={6} />
              {preview.data?.sms ? (
                <p className="hint">
                  {t("reminders.queue.detail.smsSegments", {
                    segments: preview.data.sms.segments,
                    chars: preview.data.sms.chars,
                  })}
                </p>
              ) : null}
              {channel === "WHATSAPP" && waLink ? (
                <div className="row-actions">
                  <Button variant="secondary" onClick={() => window.open(waLink, "_blank")}>
                    {t("reminders.queue.detail.openWhatsapp")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => markWaLinkSent.mutate({ id })}
                    loading={markWaLinkSent.isPending}
                  >
                    {t("reminders.queue.detail.markWaSent")}
                  </Button>
                </div>
              ) : null}
            </>
          )}

          <div>
            <h4>{t("reminders.queue.detail.history")}</h4>
            {detail.data?.history.length ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("reminders.queue.table.type")}</th>
                    <th>{t("reminders.queue.table.channel")}</th>
                    <th>{t("reminders.queue.detail.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data.history.map((h) => (
                    <tr key={h.id}>
                      <td>{h.stepKey}</td>
                      <td>{h.channel ? t(`common.channels.${h.channel}`) : "—"}</td>
                      <td>{t(`reminders.status.${h.status}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="hint">{t("reminders.queue.detail.historyEmpty")}</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
