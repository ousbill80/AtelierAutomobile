"use client";

// M07 §7 — /achats/[id] : lignes, quantités reçues, écarts de prix ; envoyer (WhatsApp,
// email, wa.me, manuel, PDF), réceptionner (saisie, frais d'approche, hors commande),
// solder, annuler, retour fournisseur.
import { useState } from "react";
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import { formatFCFA } from "@atelieros/core/money";
import {
  Button,
  DataTable,
  Field,
  Input,
  Modal,
  MoneyInput,
  Select,
  StatusBadge,
} from "@atelieros/ui";
import type { AppRouter } from "@/server/routers/_app";
import { trpc } from "@/trpc/react";
import {
  ErrorBox,
  InlineError,
  ListSkeleton,
  ModuleNav,
  ReasonModal,
  useCan,
} from "../../stock/_lib/components";
import {
  errorMessage,
  formatDateTime,
  formatDay,
  PO_TONE,
  qtyText,
  t,
} from "../../stock/_lib/i18n";
import { LinesEditor, toLineInput, type DraftLine } from "../_lib/po-form";

type PurchaseOrder = inferRouterOutputs<AppRouter>["purchaseOrder"]["get"];
type Dialog = "send" | "receive" | "close" | "cancel" | "edit" | "return" | null;

export function PurchaseView({ id }: { id: string }) {
  const can = useCan();
  const utils = trpc.useUtils();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string[] | null>(null);
  const query = trpc.purchaseOrder.get.useQuery({ id });
  const refresh = () => {
    void utils.purchaseOrder.invalidate();
    void utils.product.invalidate();
    void utils.stock.invalidate();
  };
  const close = trpc.purchaseOrder.close.useMutation({
    onSuccess() {
      setDialog(null);
      refresh();
    },
  });
  const cancel = trpc.purchaseOrder.cancel.useMutation({
    onSuccess() {
      setDialog(null);
      refresh();
    },
  });

  if (query.isLoading) return <ListSkeleton rows={5} />;
  if (query.isError || !query.data) {
    return (
      <ErrorBox
        message={query.error?.data?.code === "NOT_FOUND" ? t("purchases.notFound") : undefined}
        onRetry={() => query.refetch()}
      />
    );
  }
  const po = query.data;
  const open = po.status === "SENT" || po.status === "PARTIALLY_RECEIVED";

  const totalReceivedValue = po.lines.reduce(
    (acc, l) => acc + Math.round((l.receivedQty / l.product.quantityScale) * (l.receivedCost ?? l.unitCost)),
    0,
  );

  return (
    <div className="flex flex-col gap-6 pb-16">
      <ModuleNav section="purchases" />

      {/* En-tête enrichi */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <Link
            href="/achats"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted hover:text-foreground hover:bg-surface-2"
          >
            ←
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground font-mono">
                {po.number}
              </h1>
              <StatusBadge
                tone={PO_TONE[po.status] ?? "off"}
                label={t(`purchases.status.${po.status}`)}
              />
              {po.late && <StatusBadge tone="bad" label={t("purchases.late")} />}
            </div>
            <p className="text-xs text-muted">
              Fournisseur : <strong className="text-foreground">{po.supplier.name}</strong> · Site :{" "}
              {po.site.name}
              {po.repairOrder && ` · OR lié : ${po.repairOrder.number}`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(po.status === "DRAFT" || po.status === "SENT") && can("purchase:create") ? (
            <Button className="h-9 text-xs" onClick={() => setDialog("send")}>
              {t("purchases.send")}
            </Button>
          ) : null}
          {open && can("stock:receive") ? (
            <Button className="h-9 text-xs" onClick={() => setDialog("receive")}>
              {t("purchases.receive")}
            </Button>
          ) : null}
          {(po.status === "DRAFT" || open) && can("purchase:create") ? (
            <Button variant="secondary" className="h-9 text-xs" onClick={() => setDialog("edit")}>
              {t("purchases.editLines")}
            </Button>
          ) : null}
          <a
            href={`/api/achats/${po.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground hover:bg-surface-2"
          >
            {t("purchases.downloadPdf")}
          </a>
          {open && can("stock:receive") ? (
            <Button variant="ghost" className="h-9 text-xs" onClick={() => setDialog("close")}>
              {t("purchases.close")}
            </Button>
          ) : null}
          {po.receivedAt || po.status === "PARTIALLY_RECEIVED" ? (
            can("stock:receive") ? (
              <Button variant="ghost" className="h-9 text-xs" onClick={() => setDialog("return")}>
                {t("purchases.supplierReturn")}
              </Button>
            ) : null
          ) : null}
          {(po.status === "DRAFT" || po.status === "SENT") && can("purchase:approve") ? (
            <Button variant="ghost" className="h-9 text-xs text-status-bad hover:bg-status-bad-bg/20" onClick={() => setDialog("cancel")}>
              {t("purchases.cancel")}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Cartes KPI du bon de commande */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <span className="text-xs font-medium text-muted">Montant commandé</span>
          <div className="mt-2 text-xl font-bold tracking-tight text-foreground">
            {formatFCFA(po.total)}
          </div>
          <span className="mt-1 text-[11px] text-muted">Total HT engagé</span>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <span className="text-xs font-medium text-muted">Lignes commandées</span>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {po.lines.length}
          </div>
          <span className="mt-1 text-[11px] text-muted">Références d&apos;articles</span>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <span className="text-xs font-medium text-muted">Date prévisionnelle</span>
          <div className="mt-2 text-base font-bold tracking-tight text-foreground">
            {po.expectedAt ? formatDay(po.expectedAt) : "Non renseignée"}
          </div>
          <span className="mt-1 text-[11px] text-muted">
            {po.late ? "⚠️ Date dépassée" : "Délai de livraison estimé"}
          </span>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <span className="text-xs font-medium text-muted">Valeur réceptionnée</span>
          <div className="mt-2 text-xl font-bold tracking-tight text-status-ok">
            {formatFCFA(totalReceivedValue)}
          </div>
          <span className="mt-1 text-[11px] text-muted">Entré en magasin</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge
          tone={PO_TONE[po.status] ?? "off"}
          label={t(`purchases.status.${po.status}`)}
        />
        {po.late ? <StatusBadge tone="bad" label={t("purchases.late")} /> : null}
        <span className="text-sm">
          {t("common.total")} : <strong>{formatFCFA(po.total)}</strong>
        </span>
        {po.expectedAt ? (
          <span className="text-sm text-muted">
            {t("purchases.expectedAt")} : {formatDay(po.expectedAt)}
          </span>
        ) : null}
        {po.repairOrder ? (
          <span className="text-sm text-muted">
            {t("purchases.repairOrder", { number: po.repairOrder.number })}
          </span>
        ) : null}
      </div>
      {notice ? (
        <ul role="status" className="flex flex-col gap-1 rounded-md bg-surface-2 p-3 text-sm">
          {notice.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}

      <DataTable
        rows={po.lines}
        rowKey={(l) => l.id}
        columns={[
          {
            key: "product",
            header: t("common.product"),
            primary: true,
            render: (l) => (
              <Link href={`/stock/${l.product.id}`} className="font-medium hover:underline">
                {l.product.name}
              </Link>
            ),
          },
          {
            key: "ordered",
            header: t("purchases.ordered"),
            render: (l) => qtyText(l.quantity, l.product.quantityScale, l.product.unit),
          },
          {
            key: "received",
            header: t("purchases.received"),
            render: (l) => (
              <span data-testid={`received-${l.product.sku}`}>
                {qtyText(l.receivedQty, l.product.quantityScale)}
              </span>
            ),
          },
          {
            key: "remaining",
            header: t("purchases.remaining"),
            render: (l) =>
              qtyText(Math.max(l.quantity - l.receivedQty, 0), l.product.quantityScale),
          },
          { key: "cost", header: t("common.unitCost"), render: (l) => formatFCFA(l.unitCost) },
          {
            key: "receivedCost",
            header: t("purchases.receivedCost"),
            render: (l) =>
              l.receivedCost != null ? (
                <span className="flex flex-wrap items-center gap-1">
                  {formatFCFA(l.receivedCost)}
                  {l.variance ? (
                    <StatusBadge
                      tone={l.variance.diff > 0 ? "warn" : "ok"}
                      label={t("purchases.varianceValue", {
                        diff: `${l.variance.diff > 0 ? "+" : ""}${formatFCFA(l.variance.diff)}`,
                        pct: String(l.variance.pct).replace(".", ","),
                      })}
                    />
                  ) : null}
                </span>
              ) : (
                "—"
              ),
          },
        ]}
      />

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{t("purchases.movements")}</h2>
        {po.movements.length === 0 ? (
          <p className="text-sm text-muted">{t("purchases.noMovements")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {po.movements.map((m) => (
              <li key={m.id}>
                {formatDateTime(m.createdAt)} · {t(`movementTypes.${m.type}`)} ·{" "}
                {qtyText(m.quantity, m.product.quantityScale, m.product.unit)} {m.product.name}
                {m.unitCost != null ? ` · ${formatFCFA(m.unitCost)}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
      {po.notes ? (
        <section className="rounded-lg border border-border bg-surface p-3 text-sm">
          <h2 className="mb-1 font-semibold">{t("common.notes")}</h2>
          <p className="whitespace-pre-wrap">{po.notes}</p>
        </section>
      ) : null}

      {dialog === "send" ? <SendModal po={po} onClose={() => setDialog(null)} /> : null}
      {dialog === "receive" ? (
        <ReceiveModal
          po={po}
          onClose={() => setDialog(null)}
          onDone={(lines) => {
            setDialog(null);
            setNotice(lines);
            refresh();
          }}
        />
      ) : null}
      {dialog === "edit" ? <EditLinesModal po={po} onClose={() => setDialog(null)} /> : null}
      {dialog === "return" ? (
        <SupplierReturnModal
          po={po}
          onClose={() => setDialog(null)}
          onDone={(message) => {
            setDialog(null);
            setNotice([message]);
            refresh();
          }}
        />
      ) : null}
      <ReasonModal
        open={dialog === "close"}
        title={t("purchases.closeTitle")}
        submitLabel={t("purchases.close")}
        pending={close.isPending}
        error={close.error ? errorMessage(close.error) : null}
        onClose={() => setDialog(null)}
        onSubmit={(reason) => close.mutate({ id, reason })}
      />
      <ReasonModal
        open={dialog === "cancel"}
        title={t("purchases.cancelTitle")}
        submitLabel={t("purchases.cancel")}
        pending={cancel.isPending}
        error={cancel.error ? errorMessage(cancel.error) : null}
        onClose={() => setDialog(null)}
        onSubmit={(reason) => cancel.mutate({ id, reason })}
      />
    </div>
  );
}

function SendModal({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [waLink, setWaLink] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const send = trpc.purchaseOrder.send.useMutation({
    onSuccess(result) {
      void utils.purchaseOrder.invalidate();
      setSent(true);
      if (result.waLink) setWaLink(result.waLink);
    },
  });
  const hasWhatsapp = !!(po.supplier.whatsappPhone ?? po.supplier.phone);
  const hasEmail = !!po.supplier.email;
  return (
    <Modal open title={t("purchases.sendTitle", { number: po.number })} onClose={onClose}>
      {sent ? (
        <div className="flex flex-col gap-3" role="status">
          <p className="text-sm">{t("purchases.sent")}</p>
          {waLink ? (
            <a
              href={waLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground"
            >
              {t("purchases.openWaLink")}
            </a>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {!hasWhatsapp && !hasEmail ? (
            <p className="text-sm text-muted">{t("purchases.noContact")}</p>
          ) : null}
          {hasWhatsapp ? (
            <Button
              loading={send.isPending}
              onClick={() => send.mutate({ id: po.id, channel: "WHATSAPP" })}
            >
              {t("purchases.sendWhatsapp")}
            </Button>
          ) : null}
          {hasEmail ? (
            <Button
              variant="secondary"
              onClick={() => send.mutate({ id: po.id, channel: "EMAIL" })}
            >
              {t("purchases.sendEmail")}
            </Button>
          ) : null}
          {hasWhatsapp ? (
            <Button variant="secondary" onClick={() => send.mutate({ id: po.id, channel: "LINK" })}>
              {t("purchases.sendLink")}
            </Button>
          ) : null}
          <a
            href={`/api/achats/${po.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-surface-2 px-4 text-sm font-medium"
          >
            {t("purchases.downloadPdf")}
          </a>
          <Button variant="ghost" onClick={() => send.mutate({ id: po.id, channel: "MANUAL" })}>
            {t("purchases.markSent")}
          </Button>
          <InlineError message={send.error ? errorMessage(send.error) : null} />
        </div>
      )}
    </Modal>
  );
}

function ReceiveModal({
  po,
  onClose,
  onDone,
}: {
  po: PurchaseOrder;
  onClose: () => void;
  onDone: (notice: string[]) => void;
}) {
  const openLines = po.lines.filter((l) => l.receivedQty < l.quantity);
  const [qty, setQty] = useState<Record<string, string>>(
    Object.fromEntries(
      openLines.map((l) => [
        l.id,
        String((l.quantity - l.receivedQty) / l.product.quantityScale).replace(".", ","),
      ]),
    ),
  );
  const [cost, setCost] = useState<Record<string, number | null>>(
    Object.fromEntries(openLines.map((l) => [l.id, l.unitCost])),
  );
  const [landed, setLanded] = useState<number | null>(null);
  const [extra, setExtra] = useState<DraftLine[]>([]);
  const [aberrant, setAberrant] = useState<string | null>(null);
  const receive = trpc.purchaseOrder.receive.useMutation({
    onSuccess(result) {
      const notice = [t("purchases.receivedOk")];
      if (result.priceVariances.length > 0) {
        notice.push(
          t("purchases.priceVariances", {
            list: result.priceVariances
              .map((v) => `${v.productName} ${formatFCFA(v.expected)} → ${formatFCFA(v.actual)}`)
              .join(", "),
          }),
        );
      }
      if (result.promoted.length > 0) {
        notice.push(t("purchases.backordersPromoted", { count: result.promoted.length }));
      }
      onDone(notice);
    },
    onError(error) {
      // §11 : prix aberrant → le serveur demande une confirmation explicite.
      setAberrant(error.message.trim().endsWith("confirmer ?") ? error.message : null);
    },
  });
  function submit(confirmAberrantPrices: boolean) {
    receive.mutate({
      id: po.id,
      lines: openLines.map((l) => ({
        lineId: l.id,
        quantity: Number((qty[l.id] ?? "0").replace(",", ".")) || 0,
        unitCost: cost[l.id] ?? l.unitCost,
      })),
      extraLines: toLineInput(extra),
      landedCosts: landed ?? undefined,
      confirmAberrantPrices,
    });
  }
  return (
    <Modal
      open
      size="lg"
      title={t("purchases.receiveTitle", { number: po.number })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          {aberrant ? (
            <Button variant="danger" loading={receive.isPending} onClick={() => submit(true)}>
              {t("purchases.aberrantConfirm")}
            </Button>
          ) : (
            <Button loading={receive.isPending} onClick={() => submit(false)}>
              {t("purchases.receiveSubmit")}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2">
          {openLines.map((l) => (
            <li
              key={l.id}
              className="flex flex-col gap-2 rounded-md border border-border p-2 sm:flex-row sm:items-end"
            >
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium">{l.product.name}</div>
                <div className="text-xs text-muted">
                  {t("purchases.remaining")} :{" "}
                  {qtyText(l.quantity - l.receivedQty, l.product.quantityScale, l.product.unit)} ·{" "}
                  {formatFCFA(l.unitCost)}
                </div>
              </div>
              <div className="w-full sm:w-28">
                <Input
                  label={`${t("purchases.receiveQty")} — ${l.product.sku}`}
                  inputMode="decimal"
                  value={qty[l.id] ?? ""}
                  onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })}
                />
              </div>
              <div className="w-full sm:w-40">
                <Field label={`${t("common.unitCost")} — ${l.product.sku}`}>
                  <MoneyInput
                    value={cost[l.id] ?? null}
                    onChange={(v) => {
                      setCost({ ...cost, [l.id]: v });
                      setAberrant(null);
                    }}
                  />
                </Field>
              </div>
            </li>
          ))}
        </ul>
        <Field label={t("purchases.landedCosts")} hint={t("purchases.landedCostsHint")}>
          <MoneyInput value={landed} onChange={setLanded} />
        </Field>
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
            {t("purchases.extraLines")}
          </summary>
          <LinesEditor lines={extra} onChange={setExtra} />
        </details>
        {aberrant ? (
          <p role="alert" className="rounded-md bg-status-warn-bg p-2 text-sm text-status-warn">
            {aberrant}
          </p>
        ) : (
          <InlineError message={receive.error ? errorMessage(receive.error) : null} />
        )}
      </div>
    </Modal>
  );
}

function EditLinesModal({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const utils = trpc.useUtils();
  const isDraft = po.status === "DRAFT";
  const [expectedAt, setExpectedAt] = useState(
    po.expectedAt ? new Date(po.expectedAt).toISOString().slice(0, 10) : "",
  );
  const [lines, setLines] = useState<(DraftLine & { lineId?: string })[]>(
    po.lines.map((l) => ({
      lineId: l.id,
      product: { id: l.product.id, name: l.product.name, sku: l.product.sku, unit: l.product.unit },
      quantity: String(l.quantity / l.product.quantityScale).replace(".", ","),
      unitCost: l.unitCost,
    })),
  );
  const update = trpc.purchaseOrder.update.useMutation({
    onSuccess() {
      void utils.purchaseOrder.invalidate();
      onClose();
    },
  });
  return (
    <Modal
      open
      size="lg"
      title={t("purchases.editLines")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={update.isPending}
            onClick={() =>
              update.mutate({
                id: po.id,
                expectedAt: expectedAt || null,
                lines: lines.map((l) => ({
                  lineId: l.lineId,
                  productId: l.product.id,
                  quantity: Number(l.quantity.replace(",", ".")),
                  unitCost: l.unitCost ?? 0,
                })),
              })
            }
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          label={t("purchases.expectedAt")}
          type="date"
          value={expectedAt}
          onChange={(e) => setExpectedAt(e.target.value)}
        />
        <LinesEditor
          lines={lines}
          onChange={(next) =>
            setLines(
              next.map((l) => ({
                ...l,
                lineId: lines.find((x) => x.product.id === l.product.id)?.lineId,
              })),
            )
          }
        />
        {!isDraft ? <p className="text-xs text-muted">{t("purchases.sentEditHint")}</p> : null}
        <InlineError message={update.error ? errorMessage(update.error) : null} />
      </div>
    </Modal>
  );
}

function SupplierReturnModal({
  po,
  onClose,
  onDone,
}: {
  po: PurchaseOrder;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const received = po.lines.filter((l) => l.receivedQty > 0);
  const [lineId, setLineId] = useState(received[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const ret = trpc.purchaseOrder.supplierReturn.useMutation({
    onSuccess: (r) => onDone(t("purchases.supplierReturnDone", { value: formatFCFA(r.credit) })),
  });
  return (
    <Modal
      open
      title={t("purchases.supplierReturnTitle")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={ret.isPending}
            disabled={!lineId || reason.trim().length < 3 || ret.isPending}
            onClick={() =>
              ret.mutate({
                purchaseOrderId: po.id,
                lineId,
                quantity: Number(quantity.replace(",", ".")),
                reason: reason.trim(),
              })
            }
          >
            {t("common.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t("purchases.line")}>
          <Select value={lineId} onChange={(e) => setLineId(e.target.value)}>
            {received.map((l) => (
              <option key={l.id} value={l.id}>
                {l.product.name} ({qtyText(l.receivedQty, l.product.quantityScale, l.product.unit)})
              </option>
            ))}
          </Select>
        </Field>
        <Input
          label={t("common.quantity")}
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <Input
          label={t("common.reason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <InlineError message={ret.error ? errorMessage(ret.error) : null} />
      </div>
    </Modal>
  );
}
