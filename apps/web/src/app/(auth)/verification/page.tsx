"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, OtpInput } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

const RESEND_COOLDOWN_SEC = 60;

export default function VerificationPage() {
  return (
    <Suspense fallback={null}>
      <VerificationForm />
    </Suspense>
  );
}

function VerificationForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const identifier = searchParams.get("identifier") ?? "";
  const purpose = (searchParams.get("purpose") ?? "VERIFY") as "VERIFY" | "RESET" | "NEW_DEVICE";
  const [channel, setChannel] = useState(searchParams.get("channel") ?? "EMAIL");
  const [code, setCode] = useState("");
  const deliveryFailed = searchParams.get("deliveryFailed") === "1";
  const [error, setError] = useState<string | null>(
    deliveryFailed ? t("auth.verifyOtp.deliveryFailed") : null,
  );
  const [cooldown, setCooldown] = useState(deliveryFailed ? 0 : RESEND_COOLDOWN_SEC);
  // Code OTP visible uniquement en développement
  const [devCode, setDevCode] = useState(searchParams.get("devCode"));

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const sendOtp = trpc.auth.sendOtp.useMutation({
    onSuccess(result) {
      setCooldown(RESEND_COOLDOWN_SEC);
      setError(null);
      // Repli WhatsApp → SMS (RG-M01-04) : afficher le canal réellement utilisé.
      setChannel(result.sentVia);
      // Mettre à jour le code de dev si disponible (renvoi OTP)
      if (result.devCode) {
        setDevCode(result.devCode);
      }
    },
    onError(err) {
      setError(err.message);
    },
  });

  const verifyOtp = trpc.auth.verifyOtp.useMutation({
    onSuccess() {
      router.push("/connexion");
    },
    onError(err) {
      setError(err.message);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    verifyOtp.mutate({ identifier, code, purpose });
  }

  return (
    <>
      <h1>{t("auth.verifyOtp.title")}</h1>
      <p>{t("auth.verifyOtp.description", { channel, identifier })}</p>
      {devCode ? (
        <div className="dev-code-banner">
          <strong>Mode dev — Code OTP :</strong> <code>{devCode}</code>
        </div>
      ) : null}
      <form onSubmit={handleSubmit} className="stack">
        <OtpInput value={code} onChange={setCode} />
        {error ? <p className="error">{error}</p> : null}
        <Button type="submit" block loading={verifyOtp.isPending} disabled={code.length !== 6}>
          {t("auth.verifyOtp.submit")}
        </Button>
      </form>
      <p>
        {cooldown > 0 ? (
          t("auth.verifyOtp.resendIn", { seconds: cooldown })
        ) : (
          <button
            type="button"
            className="link-btn"
            onClick={() =>
              sendOtp.mutate({
                identifier,
                purpose,
                channel: channel as "EMAIL" | "SMS" | "WHATSAPP",
              })
            }
          >
            {t("auth.verifyOtp.resend")}
          </button>
        )}
      </p>
      {channel !== "SMS" ? (
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setChannel("SMS");
            sendOtp.mutate({ identifier, purpose, channel: "SMS" });
          }}
        >
          {t("auth.verifyOtp.switchToSms")}
        </button>
      ) : null}
    </>
  );
}
