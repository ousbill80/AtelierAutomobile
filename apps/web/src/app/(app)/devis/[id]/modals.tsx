"use client";

// M05 §7 — modales de la fiche devis : « Envoyer » (canal, destinataire, message),
// « Enregistrer la décision » (téléphone / en personne / WhatsApp / assureur) et
// « Valider la remise » (chef d'atelier).
import { useState } from "react";
import { formatFCFA } from "@atelieros/core/money";
import {
  Button,
  CheckboxRow,
  Input,
  Modal,
  MoneyInput,
  Select,
  SignaturePad,
  Textarea,
} from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { t } from "@/components/quotes/i18n";
import type { QuoteDetail } from "./quote-view";

type SendChannel = "WHATSAPP" | "SMS" | "EMAIL" | "WA_LINK" | "LINK_ONLY";

export function SendModal({
  open,
  quote,
  onClose,
  onDone,
}: {
  open: boolean;
  quote: QuoteDetail;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [channel, setChannel] = useState<SendChannel>("WHATSAPP");
  const [recipient, setRecipient] = useState("CUSTOMER");
  const [address, setAddress] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{ url: string; waLink: string | null } | null>(null);
  const send = trpc.quote.send.useMutation({
    onSuccess: (res) => {
      if (res.waLink) window.open(res.waLink, "_blank", "noopener");
      if (channel === "LINK_ONLY" || channel === "WA_LINK") {
        setResult({ url: res.publicUrl, waLink: res.waLink });
      } else {
        onDone(t("flash.sent", { channel: t(`sendChannels.${channel}`) }));
      }
    },
  });
  const recipientInput =
    recipient === "CUSTOMER"
      ? { type: "CUSTOMER" as const }
      : recipient.startsWith("contact:")
        ? { type: "CONTACT" as const, contactId: recipient.slice(8) }
        : { type: recipient as "INSURER" | "CUSTOM", address };
  return (
    <Modal
      open={open}
      title={t("send.title")}
      onClose={() => {
        setResult(null);
        onClose();
      }}
      footer={
        result ? (
          <Button
            onClick={() => onDone(t("flash.sent", { channel: t(`sendChannels.${channel}`) }))}
          >
            {t("send.done")}
          </Button>
        ) : (
          <Button
            loading={send.isPending}
            onClick={() =>
              send.mutate({
                id: quote.id,
                channel,
                recipient: recipientInput,
                message: message.trim() || undefined,
              })
            }
          >
            {channel === "WA_LINK"
              ? t("send.openWhatsapp")
              : channel === "LINK_ONLY"
                ? t("send.copyLink")
                : t("send.submit")}
          </Button>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-2 text-sm">
          <p>{t("send.linkReady")}</p>
          <p
            className="break-all rounded-md bg-surface-2 p-2 font-mono text-xs"
            data-testid="quote-public-url"
          >
            {result.url}
          </p>
          <Button
            variant="secondary"
            onClick={() => void navigator.clipboard?.writeText(result.url)}
          >
            {t("send.copy")}
          </Button>
          {result.waLink && (
            <a
              className="btn btn-secondary min-h-11"
              href={result.waLink}
              target="_blank"
              rel="noreferrer"
            >
              {t("send.openWhatsapp")}
            </a>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <fieldset className="flex flex-col gap-1">
            <legend className="font-semibold">{t("send.channel")}</legend>
            {(["WHATSAPP", "WA_LINK", "SMS", "EMAIL", "LINK_ONLY"] as const).map((c) => (
              <label key={c} className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="channel"
                  checked={channel === c}
                  onChange={() => setChannel(c)}
                />
                {t(`sendChannels.${c}`)}
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1">
            {t("send.recipient")}
            <Select
              value={recipient}
              className="min-h-11"
              onChange={(e) => setRecipient(e.target.value)}
            >
              <option value="CUSTOMER">
                {quote.customer.displayName}{" "}
                {quote.customer.phone ? `· ${quote.customer.phone}` : ""}
              </option>
              {quote.contacts.map((c) => (
                <option key={c.id} value={`contact:${c.id}`}>
                  {c.name} {c.role ? `(${c.role})` : ""}
                </option>
              ))}
              {quote.insuranceClaimId && <option value="INSURER">{t("send.insurer")}</option>}
              <option value="CUSTOM">{t("send.custom")}</option>
            </Select>
          </label>
          {(recipient === "CUSTOM" || recipient === "INSURER") && (
            <Input
              label={t("send.address")}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          )}
          <Textarea
            aria-label={t("send.message")}
            placeholder={t("send.messagePlaceholder")}
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          {send.error && (
            <p role="alert" className="text-status-bad">
              ⚠ {send.error.message}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

export function DecisionModal({
  quote,
  amendment,
  onClose,
  onDone,
}: {
  quote: QuoteDetail;
  amendment: boolean;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [channel, setChannel] = useState<"phone" | "in_person" | "whatsapp" | "insurer">("phone");
  const groups = quote.groups.filter((g) => !amendment || g.accepted === false);
  const [choices, setChoices] = useState<Record<string, boolean | undefined>>(() =>
    Object.fromEntries(groups.map((g) => [g.key, g.priority === "URGENT" ? true : undefined])),
  );
  const [counterpart, setCounterpart] = useState("");
  const [time, setTime] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [messageId, setMessageId] = useState("");
  const [confirmation, setConfirmation] = useState(true);
  const [overrideReason, setOverrideReason] = useState("");
  const [approvedAmount, setApprovedAmount] = useState<number | null>(null);
  const record = trpc.quote.recordDecision.useMutation({
    onSuccess: (res) =>
      onDone(
        res.confirmationNote ?? t("flash.decided", { status: t(`status.${res.quote.status}`) }),
      ),
  });
  const decisions = groups
    .filter((g) => choices[g.key] !== undefined || g.isOptional)
    .map((g) => ({ groupKey: g.key, accepted: choices[g.key] === true }));
  return (
    <Modal
      open
      size="lg"
      title={amendment ? t("decision.amendTitle") : t("decision.title")}
      onClose={onClose}
      footer={
        <Button
          loading={record.isPending}
          disabled={decisions.length === 0}
          onClick={() =>
            record.mutate({
              id: quote.id,
              channel,
              amendment,
              decisions: amendment ? decisions.filter((d) => d.accepted) : decisions,
              counterpartName: counterpart.trim() || undefined,
              decidedAtTime: time || undefined,
              signature:
                signature && counterpart.trim()
                  ? { dataUrl: signature, signerName: counterpart.trim() }
                  : undefined,
              messageId: messageId || undefined,
              sendWrittenConfirmation: confirmation,
              overrideExpiredReason:
                quote.expired && overrideReason.trim() ? overrideReason.trim() : undefined,
              insurerApprovedAmount: approvedAmount ?? undefined,
            })
          }
        >
          {t("decision.submit")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {!amendment && (
          <fieldset className="flex flex-wrap gap-3">
            <legend className="font-semibold">{t("decision.channel")}</legend>
            {(["phone", "in_person", "whatsapp", "insurer"] as const).map((c) => (
              <label key={c} className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="decision-channel"
                  checked={channel === c}
                  onChange={() => setChannel(c)}
                />
                {t(`channels.${c}`)}
              </label>
            ))}
          </fieldset>
        )}
        <ul className="flex flex-col gap-2">
          {groups.map((g) => (
            <li
              key={g.key}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-2 p-2"
            >
              <span>
                {g.label} · {formatFCFA(g.total)}
                {g.isOptional ? ` (${t("lines.optional")})` : ""}
              </span>
              <span className="flex gap-2" role="radiogroup" aria-label={g.label}>
                <Button
                  size="sm"
                  className="min-h-11"
                  variant={choices[g.key] === true ? "primary" : "secondary"}
                  aria-pressed={choices[g.key] === true}
                  onClick={() => setChoices((c) => ({ ...c, [g.key]: true }))}
                >
                  ✓ {t("decision.accept")}
                </Button>
                {!amendment && (
                  <Button
                    size="sm"
                    className="min-h-11"
                    variant={choices[g.key] === false ? "primary" : "secondary"}
                    aria-pressed={choices[g.key] === false}
                    onClick={() => setChoices((c) => ({ ...c, [g.key]: false }))}
                  >
                    ✕ {t("decision.decline")}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {!amendment && (
          <>
            <Input
              label={t("decision.counterpart")}
              value={counterpart}
              onChange={(e) => setCounterpart(e.target.value)}
            />
            {channel === "phone" && (
              <>
                <Input
                  label={t("decision.time")}
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
                <CheckboxRow
                  label={t("decision.sendConfirmation")}
                  checked={confirmation}
                  onChange={(e) => setConfirmation(e.target.checked)}
                />
              </>
            )}
            {channel === "in_person" && (
              <SignaturePad
                label={t("decision.signHere")}
                clearLabel={t("decision.clear")}
                onChange={setSignature}
              />
            )}
            {channel === "whatsapp" && (
              <label className="flex flex-col gap-1">
                {t("decision.proofMessage")}
                <Select
                  value={messageId}
                  className="min-h-11"
                  onChange={(e) => setMessageId(e.target.value)}
                >
                  <option value="">—</option>
                  {quote.inboundMessages.map((m) => (
                    <option key={m.id} value={m.id}>
                      {formatDateTime(m.createdAt, quote.timeZone)} — {m.body.slice(0, 60)}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {channel === "insurer" && (
              <MoneyInput
                label={t("decision.approvedAmount")}
                value={approvedAmount}
                onChange={setApprovedAmount}
              />
            )}
            {quote.expired && (
              <Input
                label={t("decision.overrideExpired")}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
              />
            )}
          </>
        )}
        {record.error && (
          <p role="alert" className="text-status-bad">
            ⚠ {record.error.message}
          </p>
        )}
      </div>
    </Modal>
  );
}

export function DiscountModal({
  open,
  quote,
  onClose,
  onDone,
  onError,
}: {
  open: boolean;
  quote: QuoteDetail;
  onClose: () => void;
  onDone: () => void;
  onError: (e: { message: string }) => void;
}) {
  const [maxRate, setMaxRate] = useState(String(quote.discount.cap.line));
  const decide = trpc.quote.decideDiscount.useMutation({ onSuccess: onDone, onError });
  const maxRequested = Math.max(
    0,
    ...quote.lines.map((l) => l.discountRate),
    quote.totals.globalDiscountRateEffective,
  );
  return (
    <Modal
      open={open}
      title={t("discount.modalTitle")}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap gap-2">
          <Button
            loading={decide.isPending}
            onClick={() => decide.mutate({ id: quote.id, decision: "APPROVE" })}
          >
            {t("discount.approve")}
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              decide.mutate({ id: quote.id, decision: "APPROVE_PARTIAL", maxRate: Number(maxRate) })
            }
          >
            {t("discount.approveAt", { rate: maxRate })}
          </Button>
          <Button
            variant="secondary"
            onClick={() => decide.mutate({ id: quote.id, decision: "REJECT" })}
          >
            {t("discount.reject")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2 text-sm">
        <p>{t("discount.requested", { rate: maxRequested })}</p>
        {quote.discountReason && <p>{t("discount.reason", { reason: quote.discountReason })}</p>}
        {quote.margin != null && (
          <p>{t("discount.margin", { amount: formatFCFA(quote.margin) })}</p>
        )}
        <Input
          label={t("discount.maxRate")}
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          value={maxRate}
          onChange={(e) => setMaxRate(e.target.value)}
        />
      </div>
    </Modal>
  );
}
