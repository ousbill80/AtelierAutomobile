"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  Tablet,
} from "lucide-react";
import { Button, cn, Field, Input, OtpInput } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";
import { getDeviceId } from "@/trpc/device-id";

type AuthMode = "PHONE" | "EMAIL";

/**
 * Masque de saisie pour numéro de téléphone en Côte d'Ivoire.
 * Formate à la volée en 5 groupes de 2 chiffres : 07 00 00 00 00 (10 chiffres).
 * Gère également le collage avec préfixes +225 ou 00225.
 */
function formatPhoneCIInput(val: string, prevVal = ""): string {
  let digits = val.replace(/\D/g, "");
  const prevDigits = prevVal.replace(/\D/g, "");

  if (digits === prevDigits && val.length < prevVal.length) {
    digits = digits.slice(0, -1);
  }

  if (digits.startsWith("00225")) {
    digits = digits.slice(5);
  } else if (digits.startsWith("225") && digits.length > 10) {
    digits = digits.slice(3);
  }

  digits = digits.slice(0, 10);

  const groups: string[] = [];
  for (let i = 0; i < digits.length; i += 2) {
    groups.push(digits.slice(i, i + 2));
  }
  return groups.join(" ");
}

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
  const [mode, setMode] = useState<AuthMode>("PHONE");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
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

  function handlePhoneChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    if (raw.includes("@") || /[a-zA-Z]/.test(raw)) {
      setMode("EMAIL");
      setEmail(raw);
      return;
    }
    const formatted = formatPhoneCIInput(raw, phone);
    setPhone(formatted);
  }

  function handleEmailChange(e: React.ChangeEvent<HTMLInputElement>) {
    setEmail(e.target.value);
  }

  function handleSwitchMode(target: AuthMode) {
    if (needsOtp || target === mode) return;
    setMode(target);
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const identifier = mode === "PHONE" ? phone.replace(/\s+/g, "") : email.trim();
    signIn.mutate({
      identifier,
      password,
      deviceId: getDeviceId(),
      otpCode: needsOtp ? otpCode : undefined,
    });
  }

  return (
    <>
      <div className="auth-card-head">
        <h1>{t("auth.signIn.title")}</h1>
        <p className="auth-card-sub">{t("auth.signIn.subtitle")}</p>
      </div>

      {lockedUntil ? (
        <div className="stack">
          <div className="auth-alert" role="alert">
            <AlertTriangle size={18} className="icon" />
            <div>{t("auth.signIn.locked")}</div>
          </div>
          <Link href="/mot-de-passe-oublie">
            <Button variant="primary" block>
              {t("auth.signIn.resetLocked")}
            </Button>
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="stack">
          <div className="auth-mode-tabs" role="tablist" aria-label="Mode de connexion">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "PHONE"}
              className={cn("auth-mode-tab", mode === "PHONE" && "active")}
              onClick={() => handleSwitchMode("PHONE")}
              disabled={needsOtp}
            >
              <Phone size={15} />
              <span>{t("auth.signIn.phoneTab")}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "EMAIL"}
              className={cn("auth-mode-tab", mode === "EMAIL" && "active")}
              onClick={() => handleSwitchMode("EMAIL")}
              disabled={needsOtp}
            >
              <Mail size={15} />
              <span>{t("auth.signIn.emailTab")}</span>
            </button>
          </div>

          <div className="field">
            <label htmlFor="login-identifier">
              {mode === "PHONE" ? t("auth.signIn.phoneLabel") : t("auth.signIn.emailLabel")}
              <span className="visually-hidden"> {t("auth.signIn.identifierLabel")}</span>
            </label>
            {mode === "PHONE" ? (
              <Input
                id="login-identifier"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                value={phone}
                onChange={handlePhoneChange}
                placeholder={t("auth.signIn.phonePlaceholder")}
                required
                disabled={needsOtp}
                maxLength={14}
                leftIcon={<Phone size={17} />}
              />
            ) : (
              <Input
                id="login-identifier"
                type="email"
                inputMode="email"
                autoComplete="username"
                value={email}
                onChange={handleEmailChange}
                placeholder={t("auth.signIn.emailPlaceholder")}
                required
                disabled={needsOtp}
                leftIcon={<Mail size={17} />}
              />
            )}
            {mode === "PHONE" ? <span className="hint">{t("auth.signIn.phoneHint")}</span> : null}
          </div>

          <div className="field">
            <div className="field-label-row">
              <label htmlFor="login-password">{t("auth.signIn.passwordLabel")}</label>
              {!needsOtp ? (
                <Link href="/mot-de-passe-oublie" className="field-forgot-link">
                  {t("auth.signIn.forgotPassword")}
                </Link>
              ) : null}
            </div>
            <Input
              id="login-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              disabled={needsOtp}
              leftIcon={<Lock size={17} />}
              rightAction={
                <button
                  type="button"
                  className="input-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={
                    showPassword ? t("auth.signIn.hidePassword") : t("auth.signIn.showPassword")
                  }
                  title={
                    showPassword ? t("auth.signIn.hidePassword") : t("auth.signIn.showPassword")
                  }
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              }
            />
          </div>

          {needsOtp ? (
            <div
              className="stack"
              style={{
                background: "var(--surface-2)",
                padding: 14,
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <ShieldCheck size={18} style={{ color: "var(--accent)" }} />
                <span style={{ fontSize: 13, fontWeight: 700 }}>
                  {t("auth.signIn.securityCheck")}
                </span>
              </div>
              <p style={{ fontSize: 12.5, color: "var(--muted)", margin: 0 }}>
                {t("auth.signIn.securityCheckDesc")}
              </p>
              <Field label={t("auth.verifyOtp.title")}>
                <OtpInput value={otpCode} onChange={setOtpCode} />
              </Field>
              {devOtpCode ? (
                <div className="auth-dev-badge">
                  <span>{t("auth.signIn.devTestCode")}</span>
                  <strong>{devOtpCode}</strong>
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="auth-alert" role="alert">
              <AlertCircle size={18} className="icon" />
              <div>{error}</div>
            </div>
          ) : null}

          <Button type="submit" block loading={signIn.isPending}>
            {needsOtp ? t("auth.verifyOtp.submit") : t("auth.signIn.submit")}
          </Button>

          <Link href="/tablette/connexion" className="atelier-shortcut-box">
            <div className="atelier-shortcut-icon" aria-hidden="true">
              <Tablet size={18} />
            </div>
            <div className="atelier-shortcut-body">
              <div className="atelier-shortcut-title">
                <span>{t("auth.signIn.atelierModeTitle")}</span>
              </div>
              <div className="atelier-shortcut-desc">{t("auth.signIn.atelierModeDesc")}</div>
            </div>
            <ArrowRight size={16} className="atelier-shortcut-arrow" />
          </Link>
        </form>
      )}

      <hr className="sep" />

      <p className="auth-footer-text">
        {t("auth.signIn.noAccount")}{" "}
        <Link href="/inscription">{t("auth.signIn.createAccount")}</Link>
      </p>
    </>
  );
}
