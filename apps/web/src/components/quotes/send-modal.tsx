"use client";

// US-M05-04 — envoi du devis : canal (WhatsApp, SMS, email, wa.me, lien seul), destinataire
// (client, contact entreprise, assureur, autre), message pré-rédigé modifiable.
import { useState } from "react";
import { Button, Modal, Select, Textarea, Input } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { t } from "./i18n";
import type { QuoteDetail } from "./types";

const CHANNELS = ["WHATSAPP", "SMS", "EMAIL", "WA_LINK", "LINK_ONLY"] as const;
type Channel = (typeof CHANNELS)[number];

export function SendModal({
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
  const [channel, setChannel] = useState<Channel>("WHATSAPP");
  const [recipient, setRecipient] = useState<string>("CUSTOMER");
  const [custom, setCustom] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{ publicUrl: string; waLink: string | null } | null>(null);
  const send = trpc.quote.send.useMutation({
    onSuccess: (r) => {
      setResult({ publicUrl: r.publicUrl, waLink: r.waLink });
      onDone(channel === "LINK_ONLY" || channel === "WA_LINK" ? t("send.linkReady") : t("send.sent"));
      if (channel === "WA_LINK" && r.waLink) window.open(r.waLink, "_blank", "noopener");
    },
    onError,
  });

  return (
    <Modal open={open} title={t("send.title")} onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span>{t("send.channel")}</span>
          <Select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {t(`send.channels.${c}`)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span>{t("send.recipient")}</span>
          <Select value={recipient} onChange={(e) => setRecipient(e.target.value)}>
            <option value="CUSTOMER">{t("send.recipientCustomer")}</option>
            {quote.contacts.map((c) => (
              <option key={c.id} value={`CONTACT:${c.id}`}>
                {t("send.recipientContact", { name: c.name })}
              </option>
            ))}
            {quote.insuranceClaimId && <option value="INSURER">{t("send.recipientInsurer")}</option>}
            <option value="CUSTOM">{t("send.recipientCustom")}</option>
          </Select>
        </label>
        {recipient === "CUSTOM" && (
          <Input
            label={t("send.recipientCustom")}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        )}
        <label className="flex flex-col gap-1">
          <span>{t("send.message")}</span>
          <Textarea
            rows={4}
            placeholder={`Bonjour ${quote.customer.displayName}, voici le devis ${quote.number}… (message par défaut si vide)`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        {result && (
          <div className="flex flex-col gap-2 rounded-md bg-status-ok-bg p-3 text-status-ok">
            <span className="break-all font-mono text-xs">{result.publicUrl}</span>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="min-h-11"
                onClick={() => void navigator.clipboard?.writeText(result.publicUrl)}
              >
                {t("actions.copyLink")}
              </Button>
              {result.waLink && (
                <a href={result.waLink} target="_blank" rel="noopener" className="btn btn-primary min-h-11">
                  {t("send.openWhatsapp")}
                </a>
              )}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="min-h-11" onClick={onClose}>
            {t("close")}
          </Button>
          {!result && (
            <Button
              className="min-h-11"
              loading={send.isPending}
              onClick={() =>
                send.mutate({
                  id: quote.id,
                  channel,
                  recipient: recipient.startsWith("CONTACT:")
                    ? { type: "CONTACT", contactId: recipient.slice(8) }
                    : recipient === "CUSTOM"
                      ? { type: "CUSTOM", address: custom }
                      : { type: recipient as "CUSTOMER" | "INSURER" },
                  message: message.trim() || undefined,
                })
              }
            >
              {t("send.submit")}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
