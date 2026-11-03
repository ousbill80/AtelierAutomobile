"use client";

// M09 RG-M09-16 — mise en demeure de payer depuis le dossier : aperçu PDF, envoi par email
// (accusé de réception du fournisseur), « Marquer comme remise » (main propre, huissier,
// recommandé…). Réservé au gérant (`receivable:formal_notice`).
import { useState } from "react";
import { FileText, Mail, Stamp } from "lucide-react";
import { Button } from "@atelieros/ui";
import { FORMAL_NOTICE_METHODS } from "@atelieros/core/receivables/formalNotice";
import { trpc } from "@/trpc/react";
import { DeliveryTicks } from "@/components/messaging/delivery-ticks";
import { formatDay, t } from "../i18n";

type DeliveryState = "pending" | "sent" | "delivered" | "read" | "failed" | "manual" | "simulated";

export function FormalNoticeSection({
  caseId,
  active,
  today,
  notice,
  onChanged,
}: {
  caseId: string;
  active: boolean;
  today: string;
  notice: {
    issuedAt: Date | string | null;
    deliveredAt: Date | string | null;
    method: string | null;
    sendings: { id: string; to: string; createdAt: Date | string; state: string }[];
  };
  onChanged: () => void;
}) {
  const me = trpc.me.get.useQuery();
  const allowed = me.data?.permissions.includes("receivable:formal_notice") ?? false;
  const [marking, setMarking] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [deliveredOn, setDeliveredOn] = useState(today);
  const [method, setMethod] = useState<(typeof FORMAL_NOTICE_METHODS)[number]>("hand");
  const [note, setNote] = useState("");
  const send = trpc.collections.formalNoticeSend.useMutation({
    onSuccess: () => {
      setConfirmSend(false);
      onChanged();
    },
  });
  const delivered = trpc.collections.formalNoticeDelivered.useMutation({
    onSuccess: () => {
      setMarking(false);
      onChanged();
    },
  });

  const pdfUrl = `/api/creances/mise-en-demeure/${caseId}`;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Stamp size={18} aria-hidden /> {t("formalNotice.title")}
          </h2>
          <p className="text-sm text-muted">{t("formalNotice.intro")}</p>
        </div>
      </div>

      {/* État : préparée / envoyée (✓✓) / remise (accusé de réception). */}
      <ul className="flex flex-col gap-1.5 text-sm">
        {!notice.issuedAt && notice.sendings.length === 0 && !notice.deliveredAt && (
          <li className="text-muted">{t("formalNotice.none")}</li>
        )}
        {notice.issuedAt && (
          <li>{t("formalNotice.issuedOn", { date: formatDay(notice.issuedAt) })}</li>
        )}
        {notice.sendings.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2">
            <Mail size={14} className="text-muted" aria-hidden />
            {t("formalNotice.sentTo", { to: s.to, date: formatDay(s.createdAt) })}
            <DeliveryTicks state={s.state as DeliveryState} />
          </li>
        ))}
        {notice.deliveredAt ? (
          <li className="font-medium text-status-ok">
            ✓{" "}
            {t("formalNotice.deliveredOn", {
              date: formatDay(notice.deliveredAt),
              method: t(`formalNotice.methods.${notice.method ?? "hand"}`),
            })}
          </li>
        ) : notice.issuedAt ? (
          <li className="text-status-warn">{t("formalNotice.notDeliveredYet")}</li>
        ) : null}
      </ul>

      {!allowed ? (
        <p className="text-xs text-muted">{t("formalNotice.ownerOnly")}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary min-h-11"
            >
              <FileText size={16} aria-hidden /> {t("formalNotice.preview")}
            </a>
            {active && !confirmSend && (
              <Button variant="secondary" onClick={() => setConfirmSend(true)}>
                <Mail size={16} aria-hidden /> {t("formalNotice.sendEmail")}
              </Button>
            )}
            {!marking && (
              <Button variant="secondary" onClick={() => setMarking(true)}>
                <Stamp size={16} aria-hidden /> {t("formalNotice.markDelivered")}
              </Button>
            )}
          </div>

          {confirmSend && (
            <div className="flex flex-col gap-2 rounded-md border border-accent/40 bg-accent/5 p-3 text-sm">
              <p>{t("formalNotice.confirmSend")}</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => send.mutate({ caseId })} disabled={send.isPending}>
                  {send.isPending ? t("formalNotice.sending") : t("formalNotice.confirmSendButton")}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmSend(false)}>
                  {t("actions.cancel")}
                </Button>
              </div>
            </div>
          )}
          {send.isSuccess && (
            <p role="status" className="text-sm text-status-ok">
              {t("formalNotice.sent", { to: send.data.to })}
            </p>
          )}
          {send.error && <p className="text-sm text-status-bad">{send.error.message}</p>}

          {marking && (
            <form
              className="flex flex-col gap-3 rounded-md border border-border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                delivered.mutate({ caseId, deliveredOn, method, note: note.trim() || undefined });
              }}
            >
              <p className="text-sm">{t("formalNotice.markHint")}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted">{t("formalNotice.deliveredOnLabel")}</span>
                  <input
                    type="date"
                    max={today}
                    className="min-h-11 rounded-md border border-border bg-surface px-3"
                    value={deliveredOn}
                    onChange={(e) => setDeliveredOn(e.target.value)}
                    required
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted">{t("formalNotice.methodLabel")}</span>
                  <select
                    className="min-h-11 rounded-md border border-border bg-surface px-2"
                    value={method}
                    onChange={(e) => setMethod(e.target.value as typeof method)}
                  >
                    {FORMAL_NOTICE_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {t(`formalNotice.methods.${m}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">{t("formalNotice.noteLabel")}</span>
                <input
                  className="min-h-11 rounded-md border border-border bg-surface px-3"
                  placeholder={t("formalNotice.notePlaceholder")}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <div className="flex gap-2">
                <Button type="submit" disabled={delivered.isPending}>
                  {t("actions.save")}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setMarking(false)}>
                  {t("actions.cancel")}
                </Button>
              </div>
              {delivered.error && (
                <p className="text-sm text-status-bad">{delivered.error.message}</p>
              )}
            </form>
          )}
          <p className="text-xs text-muted">{t("formalNotice.legal")}</p>
        </>
      )}
    </section>
  );
}
