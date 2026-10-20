"use client";

// M07 §7 — /stock/transferts : transferts entre sites par statut ; créer, expédier
// (TRANSFER_OUT), réceptionner (TRANSFER_IN, écart à justifier), annuler un brouillon.
import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";
import { Button, EmptyState, Input, Modal, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import {
  ErrorBox,
  InlineError,
  ListSkeleton,
  ModuleNav,
  PageTitle,
  ProductPicker,
  SiteSelect,
  useDefaultSite,
  useMe,
  type PickedProduct,
} from "../_lib/components";
import { errorMessage, formatDay, qtyText, t, TRANSFER_TONE } from "../_lib/i18n";

type Transfer = inferRouterOutputs<AppRouter>["stockTransfer"]["list"][number];

export default function TransfersPage() {
  const utils = trpc.useUtils();
  const list = trpc.stockTransfer.list.useQuery({});
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState<Transfer | null>(null);
  const refresh = () => {
    void utils.stockTransfer.invalidate();
    void utils.product.invalidate();
  };
  const ship = trpc.stockTransfer.ship.useMutation({ onSuccess: refresh });
  const cancel = trpc.stockTransfer.cancel.useMutation({ onSuccess: refresh });
  const error = ship.error ?? cancel.error;

  return (
    <div className="flex flex-col gap-4">
      <ModuleNav section="stock" />
      <PageTitle
        title={t("transfers.title")}
        actions={<Button onClick={() => setCreating(true)}>{t("transfers.new")}</Button>}
      />
      <InlineError message={error ? errorMessage(error) : null} />
      {list.isLoading ? <ListSkeleton /> : null}
      {list.isError ? <ErrorBox onRetry={() => list.refetch()} /> : null}
      {list.data && list.data.length === 0 ? <EmptyState title={t("transfers.empty")} /> : null}
      {list.data && list.data.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {list.data.map((tr) => (
            <li
              key={tr.id}
              className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-semibold">{tr.number}</div>
                  <div className="text-sm text-muted">
                    {tr.fromSite.name} → {tr.toSite.name} ·{" "}
                    {formatDay(tr.shippedAt ?? tr.createdAt)}
                  </div>
                </div>
                <StatusBadge
                  tone={TRANSFER_TONE[tr.status] ?? "off"}
                  label={t(`transfers.status.${tr.status}`)}
                />
              </div>
              <ul className="text-sm">
                {tr.lines.map((l) => (
                  <li key={l.id}>
                    {qtyText(l.quantity, l.product.quantityScale, l.product.unit)} ×{" "}
                    {l.product.name}
                    {tr.status === "RECEIVED" && l.receivedQty !== l.quantity ? (
                      <span className="text-status-bad">
                        {" "}
                        ·{" "}
                        {t("transfers.shortfall", {
                          qty: qtyText(l.quantity - l.receivedQty, l.product.quantityScale),
                        })}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                {tr.status === "DRAFT" ? (
                  <>
                    <Button loading={ship.isPending} onClick={() => ship.mutate({ id: tr.id })}>
                      {t("transfers.ship")}
                    </Button>
                    <Button variant="ghost" onClick={() => cancel.mutate({ id: tr.id })}>
                      {t("common.cancel")}
                    </Button>
                  </>
                ) : null}
                {tr.status === "IN_TRANSIT" ? (
                  <Button onClick={() => setReceiving(tr)}>{t("transfers.receive")}</Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {creating ? <CreateTransferModal onClose={() => setCreating(false)} /> : null}
      {receiving ? (
        <ReceiveTransferModal transfer={receiving} onClose={() => setReceiving(null)} />
      ) : null}
    </div>
  );
}

function CreateTransferModal({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const me = useMe();
  const [fromSiteId, setFrom] = useDefaultSite();
  const [toSiteId, setTo] = useState("");
  const [lines, setLines] = useState<{ product: PickedProduct; quantity: string }[]>([]);
  const create = trpc.stockTransfer.create.useMutation({
    onSuccess() {
      void utils.stockTransfer.invalidate();
      onClose();
    },
  });
  const otherSite = me.data?.allowedSites.find((s) => s.id !== fromSiteId)?.id ?? "";
  const target = toSiteId || otherSite;
  return (
    <Modal
      open
      size="lg"
      title={t("transfers.new")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={create.isPending}
            disabled={!fromSiteId || !target || lines.length === 0 || create.isPending}
            onClick={() =>
              create.mutate({
                fromSiteId,
                toSiteId: target,
                lines: lines.map((l) => ({
                  productId: l.product.id,
                  quantity: Number(l.quantity.replace(",", ".")),
                })),
              })
            }
          >
            {t("transfers.create")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <SiteSelect label={t("transfers.from")} value={fromSiteId} onChange={setFrom} />
          <SiteSelect label={t("transfers.to")} value={target} onChange={setTo} />
        </div>
        <ProductPicker
          label={t("transfers.addLine")}
          onPick={(p) =>
            setLines((ls) =>
              ls.some((l) => l.product.id === p.id) ? ls : [...ls, { product: p, quantity: "1" }],
            )
          }
        />
        <ul className="flex flex-col gap-2">
          {lines.map((l, i) => (
            <li key={l.product.id} className="flex flex-wrap items-end gap-2">
              <span className="min-w-0 flex-1 text-sm">{l.product.name}</span>
              <div className="w-28">
                <Input
                  label={`${t("common.quantity")} (${l.product.unit})`}
                  inputMode="decimal"
                  value={l.quantity}
                  onChange={(e) =>
                    setLines((ls) =>
                      ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)),
                    )
                  }
                />
              </div>
              <Button
                variant="ghost"
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
              >
                {t("common.remove")}
              </Button>
            </li>
          ))}
        </ul>
        <InlineError message={create.error ? errorMessage(create.error) : null} />
      </div>
    </Modal>
  );
}

function ReceiveTransferModal({ transfer, onClose }: { transfer: Transfer; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [qty, setQty] = useState<Record<string, string>>(
    Object.fromEntries(
      transfer.lines.map((l) => [
        l.id,
        String(l.quantity / l.product.quantityScale).replace(".", ","),
      ]),
    ),
  );
  const receive = trpc.stockTransfer.receive.useMutation({
    onSuccess() {
      void utils.stockTransfer.invalidate();
      void utils.product.invalidate();
      onClose();
    },
  });
  return (
    <Modal
      open
      title={t("transfers.receiveTitle", { number: transfer.number })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={receive.isPending}
            onClick={() =>
              receive.mutate({
                id: transfer.id,
                lines: transfer.lines.map((l) => ({
                  lineId: l.id,
                  receivedQty: Number((qty[l.id] ?? "0").replace(",", ".")),
                })),
              })
            }
          >
            {t("transfers.receive")}
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-3">
        {transfer.lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 text-sm">
              <div>{l.product.name}</div>
              <div className="text-xs text-muted">
                {t("transfers.sentQty", {
                  qty: qtyText(l.quantity, l.product.quantityScale, l.product.unit),
                })}
              </div>
            </div>
            <div className="w-28">
              <Input
                label={t("transfers.receivedQty")}
                inputMode="decimal"
                value={qty[l.id] ?? ""}
                onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })}
              />
            </div>
          </li>
        ))}
      </ul>
      <InlineError message={receive.error ? errorMessage(receive.error) : null} />
    </Modal>
  );
}
