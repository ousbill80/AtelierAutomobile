"use client";

// US-M05-07 — décision enregistrée par le personnel : canal (téléphone, en personne, WhatsApp,
// assureur), cases par groupe, interlocuteur, signature tablette, confirmation écrite.
import { useState } from "react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, Input, Modal, MoneyInput, Select, SignaturePad } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { PriorityBadge } from "./badges";
import { t } from "./i18n";
import type { QuoteDetail } from "./types";

const CHANNELS = ["phone", "in_person", "whatsapp", "insurer"] as const;
type Channel = (typeof CHANNELS)[number];
const REASONS = ["TOO_EXPENSIVE", "LATER", "ELSEWHERE", "OTHER"] as const;

export function DecisionModal({
  quote,
  open,
  onClose,
  onDone,
  onError,
}: {
  quote: QuoteDetail;
  open: boolean;
  onClose: () => void;
  onDone: (text: string) => void;
  onError: (e: { message: string }) => void;
}) {
  const amendment = ["PARTIALLY_ACCEPTED", "DECLINED"].includes(quote.status);
  const [channel, setChannel] = useState<Channel>("phone");
  const [choices, setChoices] = useState<Record<string, boolean | null>>(() =>
    Object.fromEntries(
      quote.groups.map((g) => [g.key, amendment ? g.accepted : g.isOptional ? null : true]),
    ),
  );
  const [counterpart, setCounterpart] = useState("");
  const [signerName, setSignerName] = useState(quote.customer.displayName);
  const [signature, setSignature] = useState<string | null>(null);
  const [messageId, setMessageId] = useState("");
  const [approvedAmount, setApprovedAmount] = useState<number | null>(quote.insurance?.approvedAmount ?? null);
  const [sendConfirmation, setSendConfirmation] = useState(true);
  const [declineReason, setDeclineReason] = useState<(typeof REASONS)[number]>("LATER");
  const [overrideReason, setOverrideReason] = useState("");
  const record = trpc.quote.recordDecision.useMutation({
    onSuccess: (r) => {
      const extra =
        r.confirmationMessageId
          ? ` ${t("decision.confirmationSent")}`
          : r.confirmationNote
            ? ` ${t("decision.confirmationImpossible")}`
            : "";
      onDone(t("decision.recorded", { status: t(`status.${r.status}`) }) + extra);
      onClose();
    },
    onError,
  });

  const acceptedTotal = quote.groups
    .filter((g) => choices[g.key] === true)
    .reduce((s, g) => s + g.total, 0);
  const undecidedRequired = quote.groups.some((g) => !g.isOptional && choices[g.key] == null);

  return (
    <Modal open={open} title={t("decision.title")} onClose={onClose} size="lg">
      <div className="flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span>{t("decision.channel")}</span>
          <Select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {t(`decision.channels.${c}`)}
              </option>
            ))}
          </Select>
        </label>
        {amendment && <p className="rounded-md bg-surface-2 p-2">{t("decision.amendment")}</p>}
        <ul className="flex flex-col gap-2" aria-label={t("detail.groups")}>
          {quote.groups.map((g) => {
            const locked = amendment && g.accepted === true;
            return (
              <li key={g.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-2 p-2">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{g.label}</span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <PriorityBadge priority={g.priority} />
                    {g.isOptional ? t("portal.optional") : ""} · {formatFCFA(g.total)}
                  </span>
                </span>
                <span className="flex gap-1" role="group" aria-label={g.label}>
                  <button
                    type="button"
                    aria-pressed={choices[g.key] === true}
                    disabled={locked}
                    onClick={() => setChoices((c) => ({ ...c, [g.key]: true }))}
                    className={`min-h-11 rounded-md border px-3 ${choices[g.key] === true ? "border-status-ok bg-status-ok-bg text-status-ok" : "border-border"}`}
                  >
                    ✓ {t("decision.accept")}
                  </button>
                  <button
                    type="button"
                    aria-pressed={choices[g.key] === false}
                    disabled={locked}
                    onClick={() => setChoices((c) => ({ ...c, [g.key]: false }))}
                    className={`min-h-11 rounded-md border px-3 ${choices[g.key] === false ? "border-status-bad bg-status-bad-bg text-status-bad" : "border-border"}`}
                  >
                    ✗ {t("decision.decline")}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="font-semibold">
          {t("editor.acceptedTotal")} : {formatFCFA(acceptedTotal)}
        </p>
        {quote.groups.some((g) => choices[g.key] === false) && (
          <label className="flex flex-col gap-1">
            <span>{t("decision.declineReason")}</span>
            <Select value={declineReason} onChange={(e) => setDeclineReason(e.target.value as typeof declineReason)}>
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`decision.reasons.${r}`)}
                </option>
              ))}
            </Select>
          </label>
        )}
        {channel !== "insurer" && (
          <Input
            label={t("decision.counterpart")}
            placeholder={t("decision.counterpartHint")}
            value={counterpart}
            onChange={(e) => setCounterpart(e.target.value)}
          />
        )}
        {channel === "in_person" && (
          <>
            <Input label={t("decision.signerName")} value={signerName} onChange={(e) => setSignerName(e.target.value)} />
            <SignaturePad
              label={t("decision.signature")}
              clearLabel={t("decision.clearSignature")}
              onChange={setSignature}
            />
          </>
        )}
        {channel === "whatsapp" && (
          <Input label={t("decision.messageProof")} value={messageId} onChange={(e) => setMessageId(e.target.value)} />
        )}
        {channel === "insurer" && (
          <label className="flex flex-col gap-1">
            <span>{t("decision.approvedAmount")}</span>
            <MoneyInput aria-label={t("decision.approvedAmount")} value={approvedAmount} onChange={setApprovedAmount} />
          </label>
        )}
        {channel !== "insurer" && (
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={sendConfirmation}
              onChange={(e) => setSendConfirmation(e.target.checked)}
            />
            {t("decision.sendConfirmation")}
          </label>
        )}
        {quote.isExpired && (
          <Input
            label={t("decision.overrideExpired")}
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
          />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="min-h-11" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            className="min-h-11"
            loading={record.isPending}
            disabled={undecidedRequired || (channel === "in_person" && acceptedTotal > 0 && !signature)}
            onClick={() =>
              record.mutate({
                id: quote.id,
                channel,
                decisions: quote.groups
                  .filter((g) => choices[g.key] != null && !(amendment && g.accepted === true))
                  .map((g) => ({ groupKey: g.key, accepted: choices[g.key] === true })),
                counterpartName: counterpart.trim() || undefined,
                signerName: channel === "in_person" ? signerName.trim() || undefined : undefined,
                signatureDataUrl: channel === "in_person" ? (signature ?? undefined) : undefined,
                messageId: channel === "whatsapp" && messageId.trim() ? messageId.trim() : undefined,
                approvedAmount: channel === "insurer" ? (approvedAmount ?? undefined) : undefined,
                sendWrittenConfirmation: channel !== "insurer" && sendConfirmation,
                amendment: amendment || undefined,
                declineReason: quote.groups.some((g) => choices[g.key] === false) ? declineReason : undefined,
                overrideExpiredReason: quote.isExpired ? overrideReason.trim() || undefined : undefined,
              })
            }
          >
            {t("decision.submit")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
