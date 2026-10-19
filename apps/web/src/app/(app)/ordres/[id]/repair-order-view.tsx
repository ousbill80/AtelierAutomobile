"use client";

// M04 §7 — fiche OR : en-tête (statut, client, véhicule, promesse), barre d'actions issue de la
// machine à états, onglets Travaux / Réception / Inspection / Devis / Pièces / Temps /
// Documents / Historique / Notes internes.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatFCFA } from "@atelieros/core/money";
import {
  BodyDiagram,
  Button,
  EmptyState,
  Input,
  Modal,
  MoneyInput,
  PlateBadge,
  Select,
  StatusBadge,
  Tabs,
  Textarea,
  type BodyType,
  type BodyView,
} from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { RepairOrderInvoiceButton } from "@/components/billing/repair-order-invoice-button";
import {
  InspectionResultBadge,
  LineApprovalBadge,
  PromiseCountdown,
  RepairOrderStatusBadge,
} from "@/components/repair-orders/badges";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import {
  formatDateTime,
  formatDay,
  fromLocalInput,
  t,
  toLocalInput,
} from "@/components/repair-orders/i18n";
import { LineForm } from "@/components/repair-orders/line-form";
import type { RepairOrderDetail, RepairOrderLineDetail } from "@/components/repair-orders/types";
import { QuoteStatusBadge } from "@/components/quotes/badges";

const TAB_KEYS = [
  "work",
  "reception",
  "inspection",
  "quotes",
  "parts",
  "time",
  "documents",
  "history",
  "notes",
] as const;
type TabKey = (typeof TAB_KEYS)[number];
const REASON_TRANSITIONS = new Set(["cancel", "reopen"]);
const LOCKED = new Set(["DELIVERED", "INVOICED", "CANCELLED"]);

export function RepairOrderView({ id }: { id: string }) {
  const utils = trpc.useUtils();
  const me = trpc.me.get.useQuery();
  const query = trpc.repairOrder.get.useQuery({ id });
  const [tab, setTab] = useState<TabKey>("work");
  const [flash, setFlash] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const refresh = () => {
    void utils.repairOrder.get.invalidate({ id });
    void utils.repairOrder.board.invalidate();
    void utils.repairOrder.list.invalidate();
  };
  const onError = (error: { message: string }) => setFlash({ tone: "bad", text: error.message });

  if (query.isLoading) return <ListSkeleton rows={4} />;
  if (query.isError || !query.data) {
    return (
      <ErrorBox
        message={query.error?.data?.code === "NOT_FOUND" ? t("notFound") : undefined}
        onRetry={() => query.refetch()}
      />
    );
  }
  const order = query.data;
  const perms = new Set(me.data?.permissions ?? []);

  return (
    <div className="flex min-w-0 flex-col gap-4 pb-24">
      <Link href="/ordres" className="text-sm text-accent">
        ← {t("back")}
      </Link>
      <Header order={order} perms={perms} onDone={refresh} onError={onError} />
      {flash && (
        <p
          role={flash.tone === "bad" ? "alert" : "status"}
          className={`rounded-md p-2 text-sm ${flash.tone === "bad" ? "bg-status-bad-bg text-status-bad" : "bg-status-ok-bg text-status-ok"}`}
        >
          {flash.text}
        </p>
      )}
      <ActionBar
        order={order}
        perms={perms}
        onDone={(text) => {
          setFlash(text ? { tone: "ok", text } : null);
          refresh();
        }}
        onError={onError}
      />
      <div className="max-w-full overflow-x-auto">
        <Tabs
          items={TAB_KEYS.map((key) => ({ key, label: t(`tabs.${key}`) }))}
          activeKey={tab}
          onChange={(key) => setTab(key as TabKey)}
        />
      </div>
      {tab === "work" && <WorkTab order={order} perms={perms} onDone={refresh} onError={onError} />}
      {tab === "reception" && <ReceptionTab order={order} />}
      {tab === "inspection" && (
        <InspectionTab
          order={order}
          perms={perms}
          onDone={(text) => {
            setFlash(text ? { tone: "ok", text } : null);
            refresh();
          }}
          onError={onError}
        />
      )}
      {tab === "quotes" && <QuotesTab order={order} perms={perms} />}
      {tab === "parts" && <PartsTab order={order} />}
      {tab === "time" && <TimeTab order={order} />}
      {tab === "documents" && <DocumentsTab order={order} />}
      {tab === "history" && <HistoryTab order={order} />}
      {tab === "notes" && (
        <NotesTab order={order} perms={perms} onDone={refresh} onError={onError} />
      )}
    </div>
  );
}

function Header({
  order,
  perms,
  onDone,
  onError,
}: {
  order: RepairOrderDetail;
  perms: Set<string>;
  onDone: () => void;
  onError: (e: { message: string }) => void;
}) {
  const [editPromise, setEditPromise] = useState(false);
  const [promise, setPromise] = useState(toLocalInput(order.promisedAt, order.timeZone));
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [delayReason, setDelayReason] = useState("");
  const update = trpc.repairOrder.update.useMutation({
    onSuccess: () => {
      setEditPromise(false);
      onDone();
    },
    onError,
  });
  const canUpdate = perms.has("repair_order:update") && !LOCKED.has(order.status);
  const phone = order.customer.whatsappPhone ?? order.customer.phone;

  return (
    <header className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-mono text-xl font-semibold">{order.number}</h1>
        <RepairOrderStatusBadge status={order.status} />
        {order.late && <StatusBadge tone="bad" label={`⏰ ${t("detail.late")}`} />}
        {order.cashOnly && <StatusBadge tone="warn" label={t("detail.cashOnly")} />}
        {order.isComeback && order.comebackOf && (
          <Link
            href={`/ordres/${order.comebackOf.id}`}
            className="text-sm text-status-bad underline"
          >
            ↩ {t("detail.comebackOf", { number: order.comebackOf.number })}
          </Link>
        )}
      </div>
      <div className="grid gap-3 text-sm md:grid-cols-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">{t("detail.customer")}</span>
          <Link href={`/clients/${order.customer.id}`} className="font-medium text-accent">
            {order.customer.displayName}
          </Link>
          {order.customer.phone && (
            <span className="flex flex-wrap gap-2">
              <a className="btn btn-ghost btn-sm min-h-11" href={`tel:${order.customer.phone}`}>
                📞 {t("detail.call")}
              </a>
              {phone && (
                <a
                  className="btn btn-ghost btn-sm min-h-11"
                  href={`https://wa.me/${phone.replace(/[^\d]/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  💬 {t("detail.whatsapp")}
                </a>
              )}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">{t("detail.vehicle")}</span>
          <Link
            href={`/vehicules/${order.vehicle.id}`}
            className="flex flex-wrap items-center gap-2"
          >
            <PlateBadge plate={order.vehicle.plate} />
            <span>
              {order.vehicle.make} {order.vehicle.model}
            </span>
          </Link>
          <span className="text-xs text-muted">
            {order.mileageIn != null ? `${order.mileageIn.toLocaleString("fr-FR")} km` : "—"} ·{" "}
            {order.site.name}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">{t("detail.promise")}</span>
          <PromiseCountdown
            promisedAt={order.promisedAt}
            late={order.late}
            timeZone={order.timeZone}
          />
          <span className="text-xs text-muted">
            {t("detail.advisor")} : {order.advisor?.user.name ?? "—"} · {t("detail.priority")} :{" "}
            {t(`priority.${order.priority}`)}
          </span>
          {canUpdate && !editPromise && (
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() => setEditPromise(true)}
            >
              {t("detail.editPromise")}
            </Button>
          )}
        </div>
      </div>
      {editPromise && (
        <div className="flex flex-col gap-2 rounded-md bg-surface-2 p-3">
          <Input
            type="datetime-local"
            label={t("detail.promise")}
            value={promise}
            onChange={(e) => setPromise(e.target.value)}
          />
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={notifyCustomer}
              onChange={(e) => setNotifyCustomer(e.target.checked)}
            />
            {t("detail.notifyCustomer")}
          </label>
          {notifyCustomer && (
            <Input
              label={t("detail.delayReason")}
              value={delayReason}
              onChange={(e) => setDelayReason(e.target.value)}
            />
          )}
          <div className="flex gap-2">
            <Button
              loading={update.isPending}
              onClick={() =>
                update.mutate({
                  id: order.id,
                  promisedAt: fromLocalInput(promise, order.timeZone) ?? null,
                  notifyCustomer,
                  delayReason: delayReason || undefined,
                })
              }
            >
              {t("save")}
            </Button>
            <Button variant="ghost" onClick={() => setEditPromise(false)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}
      {canUpdate && (
        <label className="flex max-w-xs flex-col gap-1 text-sm">
          <span>{t("detail.priority")}</span>
          <Select
            value={order.priority}
            onChange={(e) => update.mutate({ id: order.id, priority: e.target.value as "NORMAL" })}
          >
            {(["LOW", "NORMAL", "HIGH", "URGENT"] as const).map((p) => (
              <option key={p} value={p}>
                {t(`priority.${p}`)}
              </option>
            ))}
          </Select>
        </label>
      )}
    </header>
  );
}

function ActionBar({
  order,
  perms,
  onDone,
  onError,
}: {
  order: RepairOrderDetail;
  perms: Set<string>;
  onDone: (text?: string) => void;
  onError: (e: { message: string }) => void;
}) {
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [cancelPreset, setCancelPreset] = useState("pickedUp");
  const [warrantyOpen, setWarrantyOpen] = useState(false);
  const transition = trpc.repairOrder.transition.useMutation({
    onSuccess: (o) => {
      setReasonFor(null);
      setReason("");
      onDone(`${o.number} : ${t(`status.${o.status}`)}`);
    },
    onError,
  });
  const tracking = trpc.repairOrder.sendTrackingLink.useMutation({
    onSuccess: () => onDone(t("detail.trackingSent")),
    onError,
  });
  const storageFee = trpc.repairOrder.storageFee.useQuery(
    { id: order.id },
    { enabled: order.status === "READY" && order.settings.storageFeeEnabled },
  );
  const addFee = trpc.repairOrder.addStorageFee.useMutation({ onSuccess: () => onDone(), onError });

  const run = (name: string) => {
    if (REASON_TRANSITIONS.has(name)) {
      setReasonFor(name);
      return;
    }
    transition.mutate({ id: order.id, transition: name as never });
  };
  const presetReason =
    reasonFor === "cancel" && cancelPreset !== "other"
      ? t(`transitions.cancelReasons.${cancelPreset}`)
      : reason;

  return (
    <div className="flex flex-col gap-2">
      {order.isComeback && !order.warrantyDecision && (
        <p className="rounded-md bg-status-warn-bg p-2 text-sm text-status-warn">
          ⚠ {t("warranty.required")}
        </p>
      )}
      {storageFee.data && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-status-warn-bg p-2 text-sm text-status-warn">
          <span>
            {t("detail.storageFee", {
              description: storageFee.data.description,
              amount: formatFCFA(storageFee.data.amount),
            })}
          </span>
          {perms.has("repair_order:update") && (
            <Button
              size="sm"
              variant="secondary"
              loading={addFee.isPending}
              onClick={() => addFee.mutate({ id: order.id })}
            >
              {t("detail.addStorageFee")}
            </Button>
          )}
        </div>
      )}
      <div
        className="fixed inset-x-0 bottom-0 z-20 flex gap-2 overflow-x-auto border-t border-border bg-surface p-2 md:static md:flex-wrap md:rounded-lg md:border"
        aria-label={t("detail.actions")}
      >
        {order.transitions.map((tr) => (
          <Button
            key={tr.transition}
            size="sm"
            className="min-h-11 shrink-0"
            variant={tr.transition === "cancel" ? "danger" : tr.ok ? "primary" : "secondary"}
            disabled={!tr.ok || transition.isPending}
            title={tr.message}
            onClick={() => run(tr.transition)}
          >
            {t(`transitions.${tr.transition}`)}
          </Button>
        ))}
        {!LOCKED.has(order.status) &&
          order.status !== "DRAFT" &&
          perms.has("inspection:perform") && (
            <Link
              href={`/ordres/${order.id}/inspection`}
              className="btn btn-secondary btn-sm min-h-11 shrink-0"
            >
              {t("detail.inspection")}
            </Link>
          )}
        {order.status === "QUALITY_CHECK" && perms.has("repair_order:qc") && (
          <Link
            href={`/ordres/${order.id}/controle-qualite`}
            className="btn btn-primary btn-sm min-h-11 shrink-0"
          >
            {t("detail.qc")}
          </Link>
        )}
        {(order.status === "READY" ||
          (order.status === "QUALITY_CHECK" && perms.has("repair_order:qc"))) &&
          perms.has("repair_order:deliver") && (
            <Link
              href={`/ordres/${order.id}/restitution`}
              className="btn btn-primary btn-sm min-h-11 shrink-0"
            >
              {t("detail.deliver")}
            </Link>
          )}
        {["READY", "DELIVERED", "INVOICED"].includes(order.status) && perms.has("invoice:read") && (
          <RepairOrderInvoiceButton
            repairOrderId={order.id}
            canCreate={perms.has("invoice:create")}
          />
        )}
        {perms.has("repair_order:update") && !LOCKED.has(order.status) && (
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 shrink-0"
            loading={tracking.isPending}
            onClick={() => tracking.mutate({ id: order.id })}
          >
            {t("detail.sendTracking")}
          </Button>
        )}
        {order.isComeback && perms.has("repair_order:warranty_decide") && (
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 shrink-0"
            onClick={() => setWarrantyOpen(true)}
          >
            {t("detail.warrantyDecision")}
          </Button>
        )}
      </div>
      {order.transitions.some((tr) => !tr.ok && tr.message) && (
        <ul className="text-xs text-muted">
          {order.transitions
            .filter((tr) => !tr.ok && tr.message)
            .map((tr) => (
              <li key={tr.transition}>
                {t(`transitions.${tr.transition}`)} : {tr.message}
              </li>
            ))}
        </ul>
      )}
      <Modal
        open={reasonFor !== null}
        title={reasonFor ? t(`transitions.${reasonFor}`) : ""}
        onClose={() => setReasonFor(null)}
        footer={
          <Button
            variant={reasonFor === "cancel" ? "danger" : "primary"}
            loading={transition.isPending}
            disabled={!presetReason.trim()}
            onClick={() =>
              transition.mutate({
                id: order.id,
                transition: reasonFor as never,
                reason: presetReason,
              })
            }
          >
            {t("confirm")}
          </Button>
        }
      >
        <div className="flex flex-col gap-2">
          {reasonFor === "cancel" && (
            <Select
              aria-label={t("transitions.reasonLabel")}
              value={cancelPreset}
              onChange={(e) => setCancelPreset(e.target.value)}
            >
              {(["pickedUp", "duplicate", "quoteDeclined", "other"] as const).map((key) => (
                <option key={key} value={key}>
                  {t(`transitions.cancelReasons.${key}`)}
                </option>
              ))}
            </Select>
          )}
          {(reasonFor !== "cancel" || cancelPreset === "other") && (
            <label className="flex flex-col gap-1 text-sm">
              <span>{t("transitions.reasonLabel")}</span>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
          )}
        </div>
      </Modal>
      <WarrantyModal
        order={order}
        open={warrantyOpen}
        onClose={() => setWarrantyOpen(false)}
        onDone={() => {
          setWarrantyOpen(false);
          onDone();
        }}
        onError={onError}
      />
    </div>
  );
}

function WarrantyModal({
  order,
  open,
  onClose,
  onDone,
  onError,
}: {
  order: RepairOrderDetail;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  onError: (e: { message: string }) => void;
}) {
  const [decision, setDecision] = useState<"COVERED" | "NOT_COVERED" | "PARTIAL">(
    order.warrantyDecision ?? "COVERED",
  );
  const [reason, setReason] = useState(order.warrantyDecisionReason ?? "");
  const mutation = trpc.repairOrder.setWarrantyDecision.useMutation({ onSuccess: onDone, onError });
  return (
    <Modal
      open={open}
      title={t("warranty.decision")}
      onClose={onClose}
      footer={
        <Button
          loading={mutation.isPending}
          disabled={reason.trim().length < 3}
          onClick={() => mutation.mutate({ id: order.id, decision, reason })}
        >
          {t("save")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {order.comebackLines.length > 0 && (
          <div className="text-sm">
            <span className="font-medium">{t("warranty.linesUnderWarranty")}</span>
            <ul className="mt-1 list-disc pl-5">
              {order.comebackLines.map((l) => (
                <li key={l.id}>
                  {l.description} — {t("warranty.until", { date: formatDay(l.warrantyUntilDate) })}
                  {l.warrantyUntilMileage
                    ? ` ${t("warranty.untilKm", { km: l.warrantyUntilMileage.toLocaleString("fr-FR") })}`
                    : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        <Select
          aria-label={t("warranty.decision")}
          value={decision}
          onChange={(e) => setDecision(e.target.value as typeof decision)}
        >
          {(["COVERED", "NOT_COVERED", "PARTIAL"] as const).map((d) => (
            <option key={d} value={d}>
              {t(`warranty.decisions.${d}`)}
            </option>
          ))}
        </Select>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("warranty.reason")}</span>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}

function WorkTab({
  order,
  perms,
  onDone,
  onError,
}: {
  order: RepairOrderDetail;
  perms: Set<string>;
  onDone: () => void;
  onError: (e: { message: string }) => void;
}) {
  const [addError, setAddError] = useState<string | null>(null);
  const add = trpc.repairOrderLine.add.useMutation({
    onSuccess: (res) => {
      setAddError(res.line.approval === "PENDING" ? t("lines.pendingNotice") : null);
      onDone();
    },
    onError: (e) => setAddError(e.message),
  });
  const locked = LOCKED.has(order.status);
  const canEdit = !locked && (perms.has("repair_order:update") || perms.has("inspection:perform"));
  const live = order.lines.filter((l) => l.status !== "CANCELLED" && l.approval !== "DECLINED");
  const refused = order.lines.filter((l) => l.approval === "DECLINED" || l.status === "CANCELLED");
  const types = ["LABOR", "PART", "CONSUMABLE", "SUBCONTRACT", "FEE"] as const;

  return (
    <section className="flex flex-col gap-4">
      {locked && <p className="text-sm text-muted">🔒 {t("lines.lockedNotice")}</p>}
      {live.length === 0 && <EmptyState title={t("lines.empty")} />}
      {types.map((type) => {
        const lines = live.filter((l) => l.type === type);
        if (lines.length === 0) return null;
        return (
          <div key={type} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{t(`lineType.${type}`)}</h3>
            {lines.map((line) => (
              <LineRow
                key={line.id}
                order={order}
                line={line}
                perms={perms}
                canEdit={canEdit}
                onDone={onDone}
                onError={onError}
              />
            ))}
          </div>
        );
      })}
      <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-1 rounded-lg bg-surface p-3 text-sm">
        <dt>{t("lines.subtotal")}</dt>
        <dd className="text-right">{formatFCFA(order.totals.subtotal)}</dd>
        <dt>{t("lines.vatTotal")}</dt>
        <dd className="text-right">{formatFCFA(order.totals.vatTotal)}</dd>
        <dt className="font-semibold">{t("lines.totalTtc")}</dt>
        <dd className="text-right font-semibold" data-testid="order-total">
          {formatFCFA(order.totals.total)}
        </dd>
        <dt className="text-muted">{t("lines.estimate")}</dt>
        <dd className="text-right text-muted">{formatFCFA(order.totals.totalEstimate)}</dd>
        {order.totals.pendingTotal > 0 && (
          <>
            <dt className="text-status-warn">{t("lines.pendingTotal")}</dt>
            <dd className="text-right text-status-warn">{formatFCFA(order.totals.pendingTotal)}</dd>
          </>
        )}
      </dl>
      {refused.length > 0 && (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2">
            {t("lines.declinedHistory")} ({refused.length})
          </summary>
          <ul className="flex flex-col gap-1">
            {refused.map((l) => (
              <li key={l.id} className="text-muted line-through">
                {l.description} — {formatFCFA(l.amounts.total)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {canEdit && (
        <LineForm
          showPayer
          submitting={add.isPending}
          error={addError}
          onSubmit={(line) => add.mutateAsync({ repairOrderId: order.id, ...line })}
        />
      )}
    </section>
  );
}

function LineRow({
  order,
  line,
  perms,
  canEdit,
  onDone,
  onError,
}: {
  order: RepairOrderDetail;
  line: RepairOrderLineDetail;
  perms: Set<string>;
  canEdit: boolean;
  onDone: () => void;
  onError: (e: { message: string }) => void;
}) {
  const update = trpc.repairOrderLine.update.useMutation({
    onSuccess: () => {
      setEditing(false);
      onDone();
    },
    onError,
  });
  const setStatus = trpc.repairOrderLine.setStatus.useMutation({ onSuccess: onDone, onError });
  const assign = trpc.repairOrderLine.assign.useMutation({ onSuccess: onDone, onError });
  const remove = trpc.repairOrderLine.remove.useMutation({ onSuccess: onDone, onError });
  const subcontract = trpc.repairOrderLine.setSubcontractStatus.useMutation({
    onSuccess: onDone,
    onError,
  });
  const [editing, setEditing] = useState(false);
  const [quantity, setQuantity] = useState(String(line.quantity));
  const [unitPrice, setUnitPrice] = useState<number | null>(line.unitPrice);
  const [discount, setDiscount] = useState(String(line.discountRate));
  const workable = line.approval === "APPROVED" || line.approval === "NOT_REQUIRED";
  const working = ["APPROVED", "IN_PROGRESS", "WAITING_PARTS", "QUALITY_CHECK"].includes(
    order.status,
  );
  const mechanics = order.members.filter((m) => ["MECHANIC", "MANAGER", "OWNER"].includes(m.role));

  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border bg-surface p-3 text-sm ${line.approval === "PENDING" ? "border-status-warn" : "border-border"}`}
      data-testid="order-line"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="font-medium">{line.description}</span>
          {line.isCustomerSupplied && (
            <span className="text-xs text-status-warn">{t("lines.customerSuppliedNote")}</span>
          )}
          {line.type === "SUBCONTRACT" && line.subcontractStatus && (
            <span className="text-xs text-muted">
              {t(`subcontract.${line.subcontractStatus}`)}
              {line.subcontractExpectedAt
                ? ` · ${t("subcontract.expected", { date: formatDay(line.subcontractExpectedAt, order.timeZone) })}`
                : ""}
            </span>
          )}
        </div>
        <span className="font-semibold">{formatFCFA(line.amounts.total)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>
          {line.quantity.toLocaleString("fr-FR")} ×{" "}
          {formatFCFA(line.type === "PART" && line.isCustomerSupplied ? 0 : line.unitPrice)}
          {line.discountRate ? ` − ${line.discountRate} %` : ""} · TVA {line.vatRate} %
        </span>
        <LineApprovalBadge approval={line.approval} />
        {line.approvalSource && <span>({t(`approvalSource.${line.approvalSource}`)})</span>}
        <LineStockBadge state={line.stockState} />
        <StatusBadge
          tone={line.status === "DONE" ? "ok" : line.status === "IN_PROGRESS" ? "warn" : "off"}
          label={t(`lineStatus.${line.status}`)}
        />
        <span>{t(`payer.${line.payer}`)}</span>
        {line.costPrice != null && (
          <span>
            {t("lines.costPrice")} : {formatFCFA(line.costPrice)}
          </span>
        )}
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {perms.has("repair_order:assign") ? (
            <Select
              aria-label={`${t("lines.assign")} — ${line.description}`}
              className="min-h-11 max-w-48"
              value={line.assignedTo?.id ?? ""}
              onChange={(e) => assign.mutate({ id: line.id, membershipId: e.target.value || null })}
            >
              <option value="">{t("lines.unassigned")}</option>
              {mechanics.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          ) : (
            <span className="text-xs">
              🔧 {line.assignedTo?.user.name ?? t("lines.unassigned")}
            </span>
          )}
          {line.approval === "PENDING" && perms.has("repair_order:update") && (
            <>
              <Button
                size="sm"
                variant="secondary"
                className="min-h-11"
                onClick={() =>
                  update.mutate({
                    id: line.id,
                    patch: { approval: "APPROVED", approvalSource: "PHONE" },
                  })
                }
              >
                📞 {t("lines.approvePhone")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="min-h-11"
                onClick={() =>
                  update.mutate({
                    id: line.id,
                    patch: { approval: "APPROVED", approvalSource: "IN_PERSON" },
                  })
                }
              >
                {t("lines.approveInPerson")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11"
                onClick={() => update.mutate({ id: line.id, patch: { approval: "DECLINED" } })}
              >
                {t("lines.decline")}
              </Button>
            </>
          )}
          {workable && working && line.status === "PENDING" && (
            <Button
              size="sm"
              variant="secondary"
              className="min-h-11"
              onClick={() => setStatus.mutate({ id: line.id, status: "IN_PROGRESS" })}
            >
              ▶ {t("lines.markInProgress")}
            </Button>
          )}
          {workable && working && line.status !== "DONE" && (
            <Button
              size="sm"
              className="min-h-11"
              onClick={() => setStatus.mutate({ id: line.id, status: "DONE" })}
            >
              ✓ {t("lines.markDone")}
            </Button>
          )}
          {line.type === "SUBCONTRACT" && perms.has("repair_order:update") && (
            <Select
              aria-label={t("lines.supplier")}
              className="min-h-11 max-w-40"
              value={line.subcontractStatus ?? "TO_SEND"}
              onChange={(e) =>
                subcontract.mutate({ id: line.id, status: e.target.value as "SENT" })
              }
            >
              {(["TO_SEND", "SENT", "RETURNED"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`subcontract.${s}`)}
                </option>
              ))}
            </Select>
          )}
          {perms.has("repair_order:update") && (
            <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setEditing(true)}>
              {t("lines.edit")}
            </Button>
          )}
          {perms.has("repair_order:update") && (
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11"
              onClick={() => remove.mutate({ id: line.id })}
            >
              {t("lines.remove")}
            </Button>
          )}
        </div>
      )}
      <Modal
        open={editing}
        title={t("lines.editTitle")}
        onClose={() => setEditing(false)}
        footer={
          <Button
            loading={update.isPending}
            onClick={() =>
              update.mutate({
                id: line.id,
                expectedUpdatedAt: line.updatedAt,
                patch: {
                  quantity: Number(quantity.replace(",", ".")) || line.quantity,
                  unitPrice: unitPrice ?? line.unitPrice,
                  discountRate: Math.min(100, Math.max(0, Number(discount) || 0)),
                },
              })
            }
          >
            {t("save")}
          </Button>
        }
      >
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{line.description}</span>
          <Input
            label={t("lines.quantity")}
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <label className="flex flex-col gap-1 text-sm">
            <span>{t("lines.unitPrice")}</span>
            <MoneyInput
              aria-label={t("lines.unitPrice")}
              value={unitPrice}
              onChange={setUnitPrice}
            />
          </label>
          <Input
            label={t("lines.discount")}
            inputMode="numeric"
            value={discount}
            onChange={(e) => setDiscount(e.target.value.replace(/\D/g, ""))}
          />
        </div>
      </Modal>
    </div>
  );
}

function ReceptionTab({ order }: { order: RepairOrderDetail }) {
  const c = order.checkIn as Record<string, unknown> & {
    damages?: {
      n: number;
      view: BodyView;
      x: number;
      y: number;
      zone: string;
      type: string;
      severity: string;
    }[];
    items?: { key: string; present: boolean }[];
  };
  const viewLabels = Object.fromEntries(
    (["TOP", "FRONT", "REAR", "LEFT", "RIGHT"] as const).map((v) => [v, t(`reception.views.${v}`)]),
  ) as Record<BodyView, string>;
  const photos = order.attachments.filter(
    (a) => a.kind === "photo_checkin" || a.kind === "photo_damage",
  );
  const signature = order.attachments.find((a) => a.kind === "signature");
  const checkOut = c.checkOut as { at: string; collectedBy: { name: string } } | undefined;
  return (
    <section className="flex flex-col gap-4 text-sm">
      <div className="grid gap-2 rounded-lg bg-surface p-3 sm:grid-cols-2">
        <span>
          {t("reception.summaryMileage", {
            value:
              order.mileageIn != null
                ? `${order.mileageIn.toLocaleString("fr-FR")} km`
                : t("reception.odometerUnreadable"),
          })}
        </span>
        <span>{t("reception.summaryFuel", { value: order.fuelLevel ?? "—" })}</span>
        <span>{t("receptionTab.keys", { count: String(c.keysCount ?? "—") })}</span>
        <span>
          {t("receptionTab.oldParts", {
            value: c.returnOldParts ? t("receptionTab.yes") : t("receptionTab.no"),
          })}
        </span>
        <span className="sm:col-span-2">
          {t("reception.belongings")} : {String(c.belongings || "—")}
        </span>
        <span className="sm:col-span-2">
          {t("reception.items")} :{" "}
          {(c.items ?? [])
            .filter((i) => i.present)
            .map((i) => t(`checkInItems.${i.key}`))
            .join(", ") || "—"}
        </span>
        {Array.isArray(c.warningLights) && c.warningLights.length > 0 && (
          <span className="text-status-bad sm:col-span-2">
            ⚠ {t("reception.warningLights")} :{" "}
            {(c.warningLights as string[]).map((l) => t(`reception.lights.${l}`)).join(", ")}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">{t("reception.steps.condition")}</h3>
        {c.noDamage ? (
          <p>{t("reception.noDamage")}</p>
        ) : (
          <>
            <BodyDiagram
              bodyType={(c.bodyType as BodyType) ?? "SEDAN"}
              markers={c.damages ?? []}
              viewLabels={viewLabels}
            />
            <ol className="flex flex-col gap-1">
              {(c.damages ?? []).map((d) => (
                <li key={d.n}>
                  {t("reception.damageListItem", {
                    n: d.n,
                    zone: d.zone,
                    type: t(`reception.damageTypes.${d.type}`).toLowerCase(),
                    severity: t(`reception.severities.${d.severity}`).toLowerCase(),
                  })}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">{t("receptionTab.photos")}</h3>
        {photos.length === 0 ? (
          <p className="text-muted">{t("receptionTab.noPhotos")}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {photos.map((p) => (
              <a key={p.id} href={`/api/attachments/${p.id}`} target="_blank" rel="noreferrer">
                <img
                  src={`/api/attachments/${p.id}`}
                  alt={t("receptionTab.photos")}
                  className="aspect-[4/3] w-full rounded object-cover"
                />
              </a>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">{t("reception.signatureMode")}</h3>
        {c.signatureRefused ? (
          <p className="text-status-bad">
            {t("receptionTab.refused", {
              by: String(c.signatureRefusedBy ?? "—"),
              date: formatDateTime(String(c.signatureRefusedAt ?? ""), order.timeZone),
            })}
          </p>
        ) : c.remoteSignaturePending ? (
          <p className="text-status-warn">✍ {t("receptionTab.remotePending")}</p>
        ) : order.signedAt ? (
          <p>
            {t("receptionTab.signedBy", {
              name: String(c.signerName ?? order.customer.displayName),
              date: formatDateTime(order.signedAt, order.timeZone),
            })}
          </p>
        ) : (
          <p className="text-muted">{t("receptionTab.unsigned")}</p>
        )}
        {signature && (
          <img
            src={`/api/attachments/${signature.id}`}
            alt={t("reception.signatureMode")}
            className="h-24 w-60 rounded border border-border bg-white object-contain"
          />
        )}
        {checkOut && (
          <p>
            {t("receptionTab.checkout", {
              date: formatDateTime(checkOut.at, order.timeZone),
              name: checkOut.collectedBy.name,
            })}
          </p>
        )}
      </div>
    </section>
  );
}

function InspectionTab({
  order,
  perms,
  onDone,
  onError,
}: {
  order: RepairOrderDetail;
  perms: Set<string>;
  onDone: (text?: string) => void;
  onError: (e: { message: string }) => void;
}) {
  const router = useRouter();
  const start = trpc.inspection.start.useMutation({
    onSuccess: () => router.push(`/ordres/${order.id}/inspection`),
    onError,
  });
  const addRecs = trpc.inspection.addRecommendationsToOrder.useMutation({
    onSuccess: (r) => onDone(t("inspection.added", { count: r.created })),
    onError,
  });
  // M05 US-M05-01 : devis depuis l'inspection (un groupe par point urgent / à surveiller).
  const createQuote = trpc.quote.createFromInspection.useMutation({
    onSuccess: (r) => router.push(`/devis/${r.id}`),
    onError,
  });
  const canPerform =
    perms.has("inspection:perform") && !LOCKED.has(order.status) && order.status !== "DRAFT";
  if (order.inspections.length === 0) {
    return (
      <EmptyState
        title={t("inspection.none")}
        action={
          canPerform ? (
            <Button
              loading={start.isPending}
              onClick={() => start.mutate({ repairOrderId: order.id })}
            >
              {t("inspection.start")}
            </Button>
          ) : undefined
        }
      />
    );
  }
  return (
    <section className="flex flex-col gap-4">
      {order.inspections.map((inspection) => {
        const findings = inspection.items.filter(
          (i) => i.result === "URGENT" || i.result === "WATCH",
        );
        const summary = inspection.summary as {
          urgent: number;
          watch: number;
          ok: number;
          notChecked: number;
        } | null;
        return (
          <div
            key={inspection.id}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{inspection.template?.name}</span>
              {inspection.completedAt ? (
                <span className="text-muted">
                  {t("inspection.readOnly", {
                    date: formatDateTime(inspection.completedAt, order.timeZone),
                  })}
                </span>
              ) : (
                <Link
                  href={`/ordres/${order.id}/inspection`}
                  className="btn btn-secondary btn-sm min-h-11"
                >
                  {t("inspection.open")}
                </Link>
              )}
            </div>
            {summary && <span>{t("inspection.summary", summary)}</span>}
            <ul className="flex flex-col gap-1">
              {findings.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-2">
                  <InspectionResultBadge result={item.result} />
                  <span>
                    {item.category} — {item.label}
                    {item.measurement ? ` (${item.measurement})` : ""}
                  </span>
                </li>
              ))}
            </ul>
            {inspection.completedAt &&
              perms.has("repair_order:update") &&
              !LOCKED.has(order.status) && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="min-h-11"
                    loading={addRecs.isPending}
                    onClick={() => addRecs.mutate({ inspectionId: inspection.id })}
                  >
                    {t("inspection.addToOrder")}
                  </Button>
                  {perms.has("quote:create") && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="min-h-11"
                      loading={createQuote.isPending}
                      onClick={() => createQuote.mutate({ inspectionId: inspection.id })}
                    >
                      {t("inspection.createQuote")}
                    </Button>
                  )}
                </div>
              )}
          </div>
        );
      })}
    </section>
  );
}

/** M07 : « Pièce manquante » tant qu'une réservation attend une réception (RG-M07-04). */
function LineStockBadge({
  state,
  showAll = false,
}: {
  state: "none" | "reserved" | "partial" | "missing" | "issued" | null;
  showAll?: boolean;
}) {
  if (!state) return null;
  if (state === "missing" || state === "partial") {
    return <StatusBadge tone="bad" label={t(`parts.stock.${state}`)} />;
  }
  if (!showAll) return null;
  return (
    <StatusBadge
      tone={state === "reserved" || state === "issued" ? "ok" : "off"}
      label={t(`parts.stock.${state}`)}
    />
  );
}

function QuotesTab({ order, perms }: { order: RepairOrderDetail; perms: Set<string> }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // M05 : devis reprenant les lignes en attente d'accord (« accord tracé » M04 → devis).
  const fromPending = trpc.quote.createFromRepairOrderPending.useMutation({
    onSuccess: (r) => router.push(`/devis/${r.id}`),
    onError: (e) => setError(e.message),
  });
  const create = trpc.quote.create.useMutation({
    onSuccess: (r) => router.push(`/devis/${r.id}`),
    onError: (e) => setError(e.message),
  });
  const pending = order.lines.some(
    (l) => l.approval === "PENDING" && l.status !== "CANCELLED" && !l.quoteLineId,
  );
  const canCreate = perms.has("quote:create") && !LOCKED.has(order.status);
  return (
    <section className="flex flex-col gap-2 text-sm">
      {canCreate && (
        <div className="flex flex-wrap gap-2">
          {pending && (
            <Button
              size="sm"
              className="min-h-11"
              loading={fromPending.isPending}
              onClick={() => fromPending.mutate({ repairOrderId: order.id })}
            >
              {t("quotes.fromPending")}
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            className="min-h-11"
            loading={create.isPending}
            onClick={() => create.mutate({ repairOrderId: order.id, origin: "REPAIR_ORDER" })}
          >
            {t("quotes.new")}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-status-bad">
          ⚠ {error}
        </p>
      )}
      {order.quotes.length === 0 ? (
        <EmptyState title={t("quotes.none")} />
      ) : (
        <ul className="flex flex-col gap-2">
          {order.quotes.map((q) => (
            <li key={q.id}>
              <Link
                href={`/devis/${q.id}`}
                className="flex flex-wrap justify-between gap-2 rounded-md bg-surface p-3 hover:text-accent"
              >
                <span className="font-mono">
                  {q.number}
                  {q.version > 1 ? ` v${q.version}` : ""}
                </span>
                <QuoteStatusBadge status={q.status} />
                <span>{formatFCFA(q.total)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PartsTab({ order }: { order: RepairOrderDetail }) {
  const parts = order.lines.filter((l) => l.type === "PART" && l.status !== "CANCELLED");
  return (
    <section className="flex flex-col gap-2 text-sm">
      <p className="text-xs text-muted">{t("parts.m07")}</p>
      {parts.length === 0 ? (
        <EmptyState title={t("parts.none")} />
      ) : (
        parts.map((l) => (
          <div
            key={l.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface p-3"
          >
            <span>
              {l.description} × {l.quantity}
            </span>
            {l.isCustomerSupplied ? (
              <StatusBadge tone="off" label={t("parts.customerSupplied")} />
            ) : l.productId ? (
              <span className="flex flex-wrap gap-1">
                <LineApprovalBadge approval={l.approval} />
                <LineStockBadge state={l.stockState} showAll />
              </span>
            ) : (
              <StatusBadge tone="warn" label={t("parts.toOrder")} />
            )}
          </div>
        ))
      )}
      {order.stockMovements.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold">{t("parts.movements")}</h3>
          {order.stockMovements.map((m) => (
            <span key={m.id}>
              {formatDay(m.createdAt, order.timeZone)} · {m.type} · {m.quantity}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function TimeTab({ order }: { order: RepairOrderDetail }) {
  if (order.timeEntries.length === 0) return <EmptyState title={t("time.none")} />;
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {order.timeEntries.map((e) => {
        const line = order.lines.find((l) => l.id === e.repairOrderLineId);
        const minutes = e.endedAt
          ? Math.round((new Date(e.endedAt).getTime() - new Date(e.startedAt).getTime()) / 60000) -
            e.pauseMinutes
          : null;
        return (
          <li key={e.id} className="flex flex-wrap justify-between gap-2 rounded-md bg-surface p-3">
            <span>{e.membership.user.name}</span>
            <span>{line?.description ?? "—"}</span>
            <span>{minutes === null ? t("time.running") : t("time.minutes", { minutes })}</span>
            {line?.laborOperation && (
              <span className="text-muted">
                {t("time.standard", { hours: line.laborOperation.standardHours })}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function DocumentsTab({ order }: { order: RepairOrderDetail }) {
  const kinds = ["reception", "workshop", "full", "delivery"] as const;
  return (
    <section className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap gap-2">
        {kinds
          .filter((k) => k !== "delivery" || order.deliveredAt)
          .map((kind) => (
            <a
              key={kind}
              href={`/api/ordres/${order.id}/pdf?kind=${kind}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary min-h-11"
            >
              📄 {t(`documents.${kind}`)}
            </a>
          ))}
      </div>
      <h3 className="font-semibold">{t("documents.invoices")}</h3>
      {order.invoices.length === 0 ? (
        <p className="text-muted">{t("documents.noInvoice")}</p>
      ) : (
        order.invoices.map((i) => (
          <span key={i.id}>
            {i.number} · {formatFCFA(i.total)}
          </span>
        ))
      )}
    </section>
  );
}

function HistoryTab({ order }: { order: RepairOrderDetail }) {
  return (
    <section className="flex flex-col gap-4 text-sm">
      <ol className="flex flex-col gap-1">
        {order.history.map((h) => (
          <li key={h.id} className="flex flex-wrap gap-2 rounded-md bg-surface p-2">
            <span className="text-muted">{formatDateTime(h.createdAt, order.timeZone)}</span>
            <span>
              {t("history.transition", {
                from: h.fromStatus ? t(`status.${h.fromStatus}`) : "—",
                to: t(`status.${h.toStatus}`),
              })}
            </span>
            <span className="text-muted">{h.by ?? t("history.auto")}</span>
            {h.reason && <span className="italic">« {h.reason} »</span>}
          </li>
        ))}
      </ol>
      <h3 className="font-semibold">{t("history.messages")}</h3>
      {order.messages.length === 0 ? (
        <p className="text-muted">{t("history.none")}</p>
      ) : (
        order.messages.map((m) => (
          <div key={m.id} className="rounded-md bg-surface p-2">
            <span className="text-xs text-muted">
              {formatDateTime(m.createdAt, order.timeZone)} · {m.channel} · {m.status}
            </span>
            <p>{m.body}</p>
          </div>
        ))
      )}
      <h3 className="font-semibold">{t("history.audit")}</h3>
      {order.audit.map((a) => (
        <span key={a.id}>
          {formatDateTime(a.createdAt, order.timeZone)} · {a.action} · {a.by ?? "—"}
          {a.reason ? ` — « ${a.reason} »` : ""}
        </span>
      ))}
    </section>
  );
}

function NotesTab({
  order,
  perms,
  onDone,
  onError,
}: {
  order: RepairOrderDetail;
  perms: Set<string>;
  onDone: () => void;
  onError: (e: { message: string }) => void;
}) {
  const [notes, setNotes] = useState(order.internalNotes ?? "");
  const [diagnosis, setDiagnosis] = useState(order.diagnosis ?? "");
  const update = trpc.repairOrder.update.useMutation({ onSuccess: onDone, onError });
  const canEdit = perms.has("repair_order:update");
  return (
    <section className="flex flex-col gap-3 text-sm">
      <label className="flex flex-col gap-1">
        <span>{t("notes.diagnosis")}</span>
        <Textarea
          rows={3}
          value={diagnosis}
          disabled={!canEdit}
          onChange={(e) => setDiagnosis(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>{t("notes.label")}</span>
        <Textarea
          rows={5}
          value={notes}
          disabled={!canEdit}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      {canEdit && (
        <Button
          className="self-start"
          loading={update.isPending}
          onClick={() => update.mutate({ id: order.id, internalNotes: notes, diagnosis })}
        >
          {t("save")}
        </Button>
      )}
    </section>
  );
}
