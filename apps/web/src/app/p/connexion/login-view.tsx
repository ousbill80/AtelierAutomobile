"use client";

// M14 US-M14-08 — connexion par téléphone + OTP. Le message après « Recevoir le code » est le
// même que le numéro soit connu ou non (aucune existence de client révélée).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/trpc/react";
import type { PortalLabels } from "../_components/labels";
import { PortalFrame } from "../_components/portal-frame";

export function LoginView({ orgSlug, labels }: { orgSlug: string | null; labels: PortalLabels }) {
  const L = labels.account;
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const request = trpc.portal.auth.requestOtp.useMutation({
    onSuccess: (r) => setSentMessage(r.message),
  });
  const verify = trpc.portal.auth.verifyOtp.useMutation({
    onSuccess: () => router.push("/p/compte"),
  });

  return (
    <PortalFrame labels={labels}>
      <h1 className="text-xl font-semibold">{L.loginTitle}</h1>
      <p className="text-muted">{L.loginIntro}</p>
      {!orgSlug ? (
        <p role="alert" className="rounded-md bg-status-warn-bg p-3 text-status-warn">
          {L.missingGarage}
        </p>
      ) : !sentMessage ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            request.mutate({ orgSlug, phone });
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="font-medium">{L.phone}</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              value={phone}
              placeholder={L.phonePlaceholder}
              onChange={(e) => setPhone(e.target.value)}
              className="min-h-12 rounded-md border border-border bg-surface px-3 text-base"
            />
          </label>
          {request.error && (
            <p role="alert" className="text-status-bad">
              {request.error.message}
            </p>
          )}
          <button
            type="submit"
            className="btn btn-primary min-h-12"
            disabled={request.isPending || phone.trim().length < 8}
          >
            {L.sendCode}
          </button>
        </form>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            verify.mutate({ orgSlug, phone, code });
          }}
        >
          <p role="status" className="rounded-md bg-surface p-3">
            {sentMessage}
          </p>
          <label className="flex flex-col gap-1">
            <span className="font-medium">{L.code}</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="min-h-12 rounded-md border border-border bg-surface px-3 text-center text-xl tracking-[0.5em]"
            />
          </label>
          {verify.error && (
            <p role="alert" className="text-status-bad">
              {verify.error.message}
            </p>
          )}
          <button
            type="submit"
            className="btn btn-primary min-h-12"
            disabled={verify.isPending || code.length !== 6}
          >
            {L.verify}
          </button>
          <button
            type="button"
            className="btn btn-secondary min-h-12"
            onClick={() => {
              setSentMessage(null);
              setCode("");
            }}
          >
            {L.otherNumber}
          </button>
        </form>
      )}
    </PortalFrame>
  );
}
