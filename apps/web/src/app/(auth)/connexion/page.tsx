"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Eye, EyeOff, Lock, ShieldCheck, Tablet } from "lucide-react";
import { Button, Field, Input, OtpInput } from "@atelieros/ui";
import { DevOtpHint } from "@/components/auth/DevOtpHint";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";
import { getDeviceId } from "@/trpc/device-id";

const OTP_LENGTH = 6;

export default function ConnexionPage() {
  return (
    <Suspense fallback={null}>
      <ConnexionForm />
    </Suspense>
  );
}

function formatLockedUntil(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function ConnexionForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
        setOtpCode("");
        setDevOtpCode(result.devCode ?? null);
        setError(null);
        return;
      }
      if (result.status === "LOCKED") {
        setLockedUntil(result.lockedUntil ? String(result.lockedUntil) : "");
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

  function backToCredentials() {
    setNeedsOtp(false);
    setOtpCode("");
    setDevOtpCode(null);
    setError(null);
  }

  if (lockedUntil !== null) {
    return (
      <>
        <h1>{t("auth.signIn.title")}</h1>
        <div className="stack">
          <div className="alert alert-bad" role="alert">
            <Lock size={18} aria-hidden="true" />
            <div>
              <p>
                {lockedUntil
                  ? t("auth.signIn.lockedUntil", { time: formatLockedUntil(lockedUntil) })
                  : t("auth.signIn.locked")}
              </p>
              <p>{t("auth.signIn.lockedHelp")}</p>
            </div>
          </div>
          <Link href="/mot-de-passe-oublie" className="btn btn-primary btn-block">
            {t("auth.signIn.resetPassword")}
          </Link>
          <button type="button" className="link-btn" onClick={() => setLockedUntil(null)}>
            {t("auth.signIn.otpBack")}
          </button>
        </div>
      </>
    );
  }

  if (needsOtp) {
    return (
      <>
        <div className="auth-step-icon" aria-hidden="true">
          <ShieldCheck size={22} />
        </div>
        <h1>{t("auth.signIn.otpTitle")}</h1>
        <p className="auth-sub">{t("auth.signIn.otpDescription")}</p>
        <form onSubmit={handleSubmit} className="stack">
          <Field label={t("auth.verifyOtp.title")}>
            <OtpInput value={otpCode} onChange={setOtpCode} length={OTP_LENGTH} autoFocus />
          </Field>
          <DevOtpHint code={devOtpCode} onUse={setOtpCode} />
          {error ? (
            <div className="alert alert-bad" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}
          <Button
            type="submit"
            block
            loading={signIn.isPending}
            disabled={otpCode.length !== OTP_LENGTH || signIn.isPending}
          >
            {signIn.isPending ? t("auth.signIn.submitting") : t("auth.verifyOtp.submit")}
          </Button>
          <button type="button" className="link-btn" onClick={backToCredentials}>
            {t("auth.signIn.otpBack")}
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      <h1>{t("auth.signIn.title")}</h1>
      <p className="auth-sub">{t("auth.signIn.subtitle")}</p>
      <form onSubmit={handleSubmit} className="stack">
        <Field label={t("auth.signIn.identifierLabel")} hint={t("auth.signIn.identifierHint")}>
          <Input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder={t("auth.signIn.identifierPlaceholder")}
            autoComplete="username"
            autoFocus
            required
          />
        </Field>
        <Field label={t("auth.signIn.passwordLabel")} htmlFor="signin-password">
          <div className="input-wrap" id="signin-password-wrap">
            <Input
              id="signin-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className="input-action"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={
                showPassword ? t("auth.signIn.hidePassword") : t("auth.signIn.showPassword")
              }
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </Field>
        {error ? (
          <div className="alert alert-bad" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}
        <Button type="submit" block loading={signIn.isPending}>
          {signIn.isPending ? t("auth.signIn.submitting") : t("auth.signIn.submit")}
        </Button>
        <div className="auth-row">
          <Link href="/mot-de-passe-oublie">{t("auth.signIn.forgotPassword")}</Link>
        </div>
      </form>
      <hr className="sep" />
      <p className="auth-alt">
        {t("auth.signIn.noAccount")}{" "}
        <Link href="/inscription">{t("auth.signIn.createAccount")}</Link>
      </p>
      <p className="auth-alt">{t("auth.signIn.atelierHint")}</p>
      <Link href="/atelier" className="btn btn-secondary btn-block">
        <Tablet size={18} aria-hidden="true" />
        {t("auth.signIn.useAtelierMode")}
      </Link>
    </>
  );
}
