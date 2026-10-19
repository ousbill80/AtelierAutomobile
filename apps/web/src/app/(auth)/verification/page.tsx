"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, OtpInput } from "@atelieros/ui";
import { DevOtpHint } from "@/components/auth/DevOtpHint";
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
  const [devCode, setDevCode] = useState<string | null>(searchParams.get("devCode"));
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SEC);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const sendOtp = trpc.auth.sendOtp.useMutation({
    onSuccess(result) {
      setCooldown(RESEND_COOLDOWN_SEC);
      setDevCode(result.devCode ?? null);
      setCode("");
      setError(null);
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
      <form onSubmit={handleSubmit} className="stack">
        <OtpInput value={code} onChange={setCode} autoFocus />
        <DevOtpHint code={devCode} onUse={setCode} />
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
