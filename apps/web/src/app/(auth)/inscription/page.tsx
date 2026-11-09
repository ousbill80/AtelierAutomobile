"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, MessageSquare, Smartphone } from "lucide-react";
import { checkPasswordPolicy } from "@atelieros/core/src/auth/password-policy";
import { Button, CheckboxRow, cn, Field, Input, OtpInput, PhoneInput } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";
import { getDeviceId } from "@/trpc/device-id";

const POLICY_MESSAGES: Record<string, string> = {
  TOO_SHORT: "8 caractères minimum.",
  MISSING_LETTER_OR_DIGIT: "Au moins une lettre et un chiffre.",
  COMMON_PASSWORD: "Ce mot de passe est trop courant.",
  CONTEXTUAL_MATCH: "Évitez votre nom de garage ou votre numéro de téléphone.",
};

export default function InscriptionPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<"MESSAGE" | "APP">("MESSAGE");
  const [pending, setPending] = useState<{
    pendingToken: string;
    secret: string;
    qrCode: string;
  } | null>(null);
  const [appCode, setAppCode] = useState("");

  const options = trpc.auth.signUpOptions.useQuery();
  const messageAvailable = options.data?.messageCodeAvailable ?? false;
  const effectiveMethod = messageAvailable ? method : "APP";

  const signUpTotpStart = trpc.auth.signUpTotpStart.useMutation({
    onSuccess(result) {
      setPending(result);
      setAppCode("");
      setError(null);
    },
    onError(err) {
      setError(err.message);
    },
  });

  const signUpTotpConfirm = trpc.auth.signUpTotpConfirm.useMutation({
    onSuccess() {
      router.push("/");
    },
    onError(err) {
      setError(err.message);
    },
  });

  const signUp = trpc.auth.signUp.useMutation({
    onSuccess(result) {
      const identifier = phone.trim() || email.trim();
      const params = new URLSearchParams({
        identifier,
        purpose: "VERIFY",
        channel: result.otpChannel,
      });
      // En développement, passer le code OTP pour faciliter les tests
      if (result.devCode) {
        params.set("devCode", result.devCode);
      }
      if ("deliveryFailed" in result && result.deliveryFailed) {
        params.set("deliveryFailed", "1");
      }
      router.push(`/verification?${params.toString()}`);
    },
    onError(err) {
      setError(err.message);
    },
  });

  const policyViolation = password ? checkPasswordPolicy(password, { phone }) : null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!acceptTerms) return;
    const input = {
      name,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      password,
      acceptTerms: true as const,
    };
    if (effectiveMethod === "APP") signUpTotpStart.mutate(input);
    else signUp.mutate(input);
  }

  if (pending) {
    return (
      <>
        <h1>{t("auth.signUp.scanTitle")}</h1>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            signUpTotpConfirm.mutate({
              pendingToken: pending.pendingToken,
              code: appCode,
              deviceId: getDeviceId(),
            });
          }}
        >
          <p style={{ margin: 0 }}>{t("auth.signUp.scanStep1")}</p>
          <img
            src={pending.qrCode}
            alt={t("profile.security.totp.qrAlt")}
            width={200}
            height={200}
            style={{ background: "#fff", borderRadius: 8, padding: 8, alignSelf: "center" }}
          />
          <p className="hint" style={{ margin: 0 }}>
            {t("profile.security.totp.manualKey")}
          </p>
          <code style={{ wordBreak: "break-all", fontSize: 14, userSelect: "all" }}>
            {pending.secret.replace(/(.{4})/g, "$1 ").trim()}
          </code>
          <p style={{ margin: 0 }}>{t("auth.signUp.scanStep2")}</p>
          <Field label={t("auth.signUp.codeLabel")}>
            <OtpInput value={appCode} onChange={setAppCode} />
          </Field>
          <p className="hint" style={{ margin: 0 }}>
            {t("auth.signUp.expiresHint")}
          </p>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            block
            loading={signUpTotpConfirm.isPending}
            disabled={appCode.length !== 6}
          >
            {t("auth.signUp.confirm")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            block
            onClick={() => {
              setPending(null);
              setError(null);
            }}
          >
            {t("auth.signUp.back")}
          </Button>
        </form>
      </>
    );
  }

  return (
    <>
      <h1>{t("auth.signUp.title")}</h1>
      <form onSubmit={handleSubmit} className="stack">
        <Field label={t("auth.signUp.nameLabel")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        </Field>
        <Field label={`${t("auth.signUp.phoneLabel")} ${t("common.optional")}`}>
          <PhoneInput value={phone} onChange={setPhone} />
        </Field>
        <Field label={`${t("auth.signUp.emailLabel")} ${t("common.optional")}`}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field
          label={t("auth.signUp.passwordLabel")}
          hint={!policyViolation ? t("auth.signUp.passwordHint") : undefined}
          error={policyViolation ? POLICY_MESSAGES[policyViolation] : undefined}
        >
          <Input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
            rightAction={
              <button
                type="button"
                className="input-toggle-btn"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={
                  showPassword ? t("auth.signIn.hidePassword") : t("auth.signIn.showPassword")
                }
                title={showPassword ? t("auth.signIn.hidePassword") : t("auth.signIn.showPassword")}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            }
          />
        </Field>
        {messageAvailable ? (
          <div className="field">
            <label>{t("auth.signUp.verificationLabel")}</label>
            <div className="auth-mode-tabs" role="radiogroup">
              <button
                type="button"
                role="radio"
                aria-checked={method === "APP"}
                className={cn("auth-mode-tab", method === "APP" && "active")}
                onClick={() => setMethod("APP")}
              >
                <Smartphone size={15} />
                <span>{t("auth.signUp.methodApp")}</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={method === "MESSAGE"}
                className={cn("auth-mode-tab", method === "MESSAGE" && "active")}
                onClick={() => setMethod("MESSAGE")}
              >
                <MessageSquare size={15} />
                <span>{t("auth.signUp.methodMessage")}</span>
              </button>
            </div>
            <span className="hint">
              {method === "APP"
                ? t("auth.signUp.methodAppDesc")
                : t("auth.signUp.methodMessageDesc")}
            </span>
          </div>
        ) : (
          <p className="hint" style={{ margin: 0 }}>
            {t("auth.signUp.appOnlyInfo")}
          </p>
        )}
        <CheckboxRow
          label={t("auth.signUp.acceptTerms")}
          checked={acceptTerms}
          onChange={(e) => setAcceptTerms(e.target.checked)}
          required
        />
        {error ? <p className="error">{error}</p> : null}
        <Button
          type="submit"
          block
          loading={signUp.isPending || signUpTotpStart.isPending}
          disabled={!acceptTerms || options.isLoading}
        >
          {effectiveMethod === "APP" ? t("auth.signUp.continue") : t("auth.signUp.submit")}
        </Button>
      </form>
      <hr className="sep" />
      <p>
        {t("auth.signUp.hasAccount")} <Link href="/connexion">{t("auth.signUp.signInLink")}</Link>
      </p>
    </>
  );
}
