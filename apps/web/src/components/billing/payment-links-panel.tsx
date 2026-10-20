"use client";

// M08 US-M08-09 / US-M08-14 · M14 §7 « Lien client » — fiche facture : création d'un lien de
// paiement mobile money (montant ≤ solde, durée, envoi immédiat), envoi de la facture (WhatsApp,
// SMS, email ; lien portail + lien de paiement), copie du lien client, historique des liens
// (vérifier auprès du fournisseur, annuler).
import { useState } from "react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, CheckboxRow, Field, Modal, MoneyInput, Select, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { t } from "@/components/billing/i18n";
import type { Tone } from "@/components/billing/i18n";

const OPEN = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"];
const CHANNELS = ["WHATSAPP", "SMS", "EMAIL"] as const;
type Channel = (typeof CHANNELS)[number];
const EXPIRY_HOURS = [24, 72, 168] as const;

const LINK_TONE: Record<string, Tone> = {
  PENDING: "warn",
  CONFIRMED: "ok",
  FAILED: "off",
  REFUNDED: "off",
  EXPIRED: "off",
};

const LINK_ICON: Record<string, string> = {
  PENDING: "⏳",
  CONFIRMED: "✓",
  FAILED: "✕",
  REFUNDED: "↩",
  EXPIRED: "⌛",
};

function expiryLabel(hours: number) {
  return hours % 24 === 0 && hours >= 48
    ? t("paymentLinks.days", { count: hours / 24 })
    : t("paymentLinks.hours", { count: hours });
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

interface InvoiceLike {
  id: string;
  status: string;
  type: string;
  billTo: string;
  balance: number;
  sentAt?: Date | string | null;
}

export function PaymentLinkActions({
  invoice,
  permissions,
  timeZone,
  onChanged,
}: {
  invoice: InvoiceLike;
  permissions: Set<string>;
  timeZone: string;
  onChanged: () => void;
}) {
  const [modal, setModal] = useState<"link" | "send" | null>(null);
  const [copied, setCopied] = useState(false);
  const portalLink = trpc.invoice.portalLink.useMutation({
    onSuccess: async ({ url }) => setCopied(await copy(url)),
  });
  const canSend =
    permissions.has("invoice:read") &&
    permissions.has("message:send") &&
    invoice.type !== "CREDIT_NOTE" &&
    invoice.billTo === "CUSTOMER";
  if (!canSend || invoice.status === "DRAFT" || invoice.status === "VOID") return null;
  const payable = OPEN.includes(invoice.status) && invoice.balance > 0;
  return (
    <>
      {payable && (
        <Button variant="secondary" onClick={() => setModal("link")}>
          📲 {t("paymentLinks.create")}
        </Button>
      )}
      <Button variant="secondary" onClick={() => setModal("send")}>
        ✉ {t("send.action")}
      </Button>
      <Button
        variant="ghost"
        loading={portalLink.isPending}
        onClick={() => {
          setCopied(false);
          portalLink.mutate({ id: invoice.id });
        }}
      >
        🔗 {copied ? t("send.linkCopied") : t("send.copyLink")}
      </Button>
      {invoice.sentAt && (
        <span className="self-center text-xs text-muted">
          {t("send.sentAt", { date: formatDateTime(invoice.sentAt, timeZone) })}
        </span>
      )}
      {portalLink.data && !copied && (
        <span className="w-full break-all text-xs" data-testid="portal-link">
          {portalLink.data.url}
        </span>
      )}
      {modal === "link" && (
        <CreateLinkModal
          invoiceId={invoice.id}
          balance={invoice.balance}
          onClose={() => setModal(null)}
          onDone={onChanged}
        />
      )}
      {modal === "send" && (
        <SendModal
          invoiceId={invoice.id}
          payable={payable}
          onClose={() => setModal(null)}
          onDone={onChanged}
        />
      )}
    </>
  );
}

function CreateLinkModal({
  invoiceId,
  balance,
  onClose,
  onDone,
}: {
  invoiceId: string;
  balance: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const [amount, setAmount] = useState<number | null>(balance);
  const [hours, setHours] = useState<number>(72);
  const [channel, setChannel] = useState<Channel | "">("WHATSAPP");
  const [copied, setCopied] = useState(false);
  const create = trpc.paymentLink.create.useMutation({
    onSuccess: () => {
      void utils.paymentLink.list.invalidate({ invoiceId });
      onDone();
    },
  });
  const link = create.data?.link;
  return (
    <Modal
      open
      title={t("paymentLinks.createTitle")}
      onClose={onClose}
      footer={
        link ? (
          <Button onClick={onClose}>{t("actions.close")}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t("actions.cancel")}
            </Button>
            <Button
              loading={create.isPending}
              disabled={!amount || amount <= 0 || amount > balance}
              onClick={() =>
                create.mutate({
                  invoiceId,
                  amount: amount ?? undefined,
                  expiresInHours: hours,
                  send: channel || undefined,
                })
              }
            >
              {t("paymentLinks.submit")}
            </Button>
          </>
        )
      }
    >
      {link ? (
        <div className="flex flex-col gap-2 text-sm">
          <p className="font-semibold text-status-ok">
            ✓ {formatFCFA(link.amount)} ·{" "}
            {t("paymentLinks.expiresAt", { date: formatDateTime(link.expiresAt) })}
          </p>
          <p className="break-all rounded-md bg-surface-2 p-2" data-testid="payment-link-url">
            {link.url}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={async () => setCopied(await copy(link.url))}>
              {copied ? t("paymentLinks.copied") : t("paymentLinks.copy")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <MoneyInput label={t("paymentLinks.amount")} value={amount} onChange={setAmount} />
          <Field label={t("paymentLinks.expiry")}>
            <Select value={String(hours)} onChange={(e) => setHours(Number(e.target.value))}>
              {EXPIRY_HOURS.map((h) => (
                <option key={h} value={h}>
                  {expiryLabel(h)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("paymentLinks.sendNow")}>
            <Select value={channel} onChange={(e) => setChannel(e.target.value as Channel | "")}>
              <option value="">{t("paymentLinks.noSend")}</option>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {t(`send.channels.${c}`)}
                </option>
              ))}
            </Select>
          </Field>
          {create.error && (
            <p role="alert" className="text-sm text-status-bad">
              ⚠ {create.error.message}
              {create.error.data?.code === "PRECONDITION_FAILED" && (
                <>
                  {" "}
                  <a href="/parametres/paiements" className="text-accent">
                    {t("paymentLinks.configure")}
                  </a>
                </>
              )}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

function SendModal({
  invoiceId,
  payable,
  onClose,
  onDone,
}: {
  invoiceId: string;
  payable: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const [channel, setChannel] = useState<Channel>("WHATSAPP");
  const [withLink, setWithLink] = useState(payable);
  const send = trpc.invoice.send.useMutation({
    onSuccess: () => {
      void utils.paymentLink.list.invalidate({ invoiceId });
      onDone();
    },
  });
  return (
    <Modal
      open
      title={t("send.title")}
      onClose={onClose}
      footer={
        send.data ? (
          <Button onClick={onClose}>{t("actions.close")}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t("actions.cancel")}
            </Button>
            <Button
              loading={send.isPending}
              onClick={() => send.mutate({ id: invoiceId, channel, includePaymentLink: withLink })}
            >
              {t("send.submit")}
            </Button>
          </>
        )
      }
    >
      {send.data ? (
        <p className="text-sm font-semibold text-status-ok" role="status">
          ✓ {t("send.sent", { to: send.data.sentTo })}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">{t("send.hint")}</p>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">{t("send.channel")}</legend>
            {CHANNELS.map((c) => (
              <label key={c} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="invoice-send-channel"
                  checked={channel === c}
                  onChange={() => setChannel(c)}
                />
                {t(`send.channels.${c}`)}
              </label>
            ))}
          </fieldset>
          {payable && (
            <CheckboxRow
              label={t("send.withPaymentLink")}
              checked={withLink}
              onChange={(e) => setWithLink(e.target.checked)}
            />
          )}
          {send.error && (
            <p role="alert" className="text-sm text-status-bad">
              ⚠ {send.error.message}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Historique des liens de paiement de la facture. */
export function PaymentLinksList({
  invoiceId,
  timeZone,
  canManage,
  onChanged,
}: {
  invoiceId: string;
  timeZone: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const utils = trpc.useUtils();
  const list = trpc.paymentLink.list.useQuery({ invoiceId });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const refresh = () => {
    void utils.paymentLink.list.invalidate({ invoiceId });
    onChanged();
  };
  const check = trpc.paymentLink.checkStatus.useMutation({ onSuccess: refresh });
  const cancel = trpc.paymentLink.cancel.useMutation({ onSuccess: refresh });
  if (!list.data || list.data.length === 0) return null;
  const error = check.error ?? cancel.error;
  return (
    <section className="flex flex-col gap-2" aria-label={t("paymentLinks.title")}>
      <h2 className="font-semibold">{t("paymentLinks.title")}</h2>
      <ul className="flex flex-col gap-2">
        {list.data.map((l) => {
          const status = l.expired ? "EXPIRED" : l.status;
          return (
            <li
              key={l.id}
              className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3 text-sm"
              data-testid="payment-link"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    tone={LINK_TONE[status] ?? "off"}
                    label={`${LINK_ICON[status] ?? ""} ${t(`paymentLinks.status.${status}`)}`}
                  />
                  <span className="font-semibold">{formatFCFA(l.amount)}</span>
                  {l.method && <span>{t(`method.${l.method}`)}</span>}
                </span>
                <span className="text-xs text-muted">
                  {l.createdByName
                    ? t("paymentLinks.createdBy", { name: l.createdByName })
                    : t("paymentLinks.byPortal")}{" "}
                  · {formatDateTime(l.createdAt, timeZone)}
                </span>
              </div>
              <p className="text-xs text-muted">
                {l.status === "CONFIRMED" && l.confirmedAt
                  ? t("paymentLinks.confirmedAt", { date: formatDateTime(l.confirmedAt, timeZone) })
                  : l.status === "PENDING"
                    ? t("paymentLinks.expiresAt", { date: formatDateTime(l.expiresAt, timeZone) })
                    : l.closeReason
                      ? t(`paymentLinks.closeReason.${l.closeReason}`)
                      : ""}
                {l.payment ? ` · ${l.payment.number}` : ""}
                {l.confirmedAmount != null && l.confirmedAmount !== l.amount
                  ? ` · ${t("paymentLinks.mismatch", { amount: formatFCFA(l.confirmedAmount) })}`
                  : ""}
              </p>
              {l.status === "PENDING" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => setCopiedId((await copy(l.url)) ? l.id : null)}
                  >
                    {copiedId === l.id ? t("paymentLinks.copied") : t("paymentLinks.copy")}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={check.isPending && check.variables?.id === l.id}
                    onClick={() => check.mutate({ id: l.id })}
                  >
                    {t("paymentLinks.check")}
                  </Button>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={cancel.isPending && cancel.variables?.id === l.id}
                      onClick={() => cancel.mutate({ id: l.id })}
                    >
                      {t("paymentLinks.cancel")}
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {check.data && (
        <p className="text-sm" role="status">
          {t(`paymentLinks.checkResult.${check.data.outcome}`)}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-status-bad">
          ⚠ {error.message}
        </p>
      )}
    </section>
  );
}
