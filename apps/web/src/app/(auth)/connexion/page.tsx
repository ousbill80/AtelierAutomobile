"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button, Field, Input, OtpInput } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";
import { getDeviceId } from "@/trpc/device-id";

export default function ConnexionPage() {
  return (
    <Suspense fallback={null}>
      <ConnexionForm />
    </Suspense>
  );
}

function ConnexionForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [needsOtp, setNeedsOtp] = useState(false);
  const [devOtpCode, setDevOtpCode] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signIn = trpc.auth.signIn.useMutation({
    onSuccess(result) {
      if (result.status === "OK") {
        router.push(searchParams.get("next") ?? "/");
        return;
      }
      if (result.status === "OTP_REQUIRED") {
        setNeedsOtp(true);
        setDevOtpCode(result.devCode ?? null);
        setError(null);
        return;
      }
      if (result.status === "LOCKED") {
        setLockedUntil(result.lockedUntil ? String(result.lockedUntil) : null);
      }
    },
    onError(err) {
      setError(err.message);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    signIn.mutate({
      identifier,
      password,
      deviceId: getDeviceId(),
      otpCode: needsOtp ? otpCode : undefined,
    });
  }

  return (
    <>
      <h1>{t("auth.signIn.title")}</h1>
      {lockedUntil ? (
        <p className="error">{t("auth.signIn.locked")}</p>
      ) : (
        <form onSubmit={handleSubmit} className="stack">
          <Field label={t("auth.signIn.identifierLabel")}>
            <Input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={t("auth.signIn.identifierPlaceholder")}
              autoComplete="username"
              required
              disabled={needsOtp}
            />
          </Field>
          <Field label={t("auth.signIn.passwordLabel")}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              disabled={needsOtp}
            />
          </Field>
          {needsOtp ? (
            <Field label={t("auth.verifyOtp.title")}>
              <OtpInput value={otpCode} onChange={setOtpCode} />
              {devOtpCode ? (
                <p className="hint">Code de test (dev uniquement) : {devOtpCode}</p>
              ) : null}
            </Field>
          ) : null}
          {error ? <p className="error">{error}</p> : null}
          <Button type="submit" block loading={signIn.isPending}>
            {needsOtp ? t("auth.verifyOtp.submit") : t("auth.signIn.submit")}
          </Button>
          {!needsOtp ? (
            <Link href="/mot-de-passe-oublie" className="link-btn">
              {t("auth.signIn.forgotPassword")}
            </Link>
          ) : null}
        </form>
      )}
      <hr className="sep" />
      <p>
        {t("auth.signIn.noAccount")}{" "}
        <Link href="/inscription">{t("auth.signIn.createAccount")}</Link>
      </p>
      <p>
        <Link href="/atelier">{t("auth.signIn.useAtelierMode")}</Link>
      </p>
    </>
  );
}
