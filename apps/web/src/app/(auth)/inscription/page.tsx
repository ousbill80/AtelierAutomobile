"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { checkPasswordPolicy } from "@atelieros/core/src/auth/password-policy";
import { Button, CheckboxRow, Field, Input, PhoneInput } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

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
    signUp.mutate({
      name,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      password,
      acceptTerms: true,
    });
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
                title={
                  showPassword ? t("auth.signIn.hidePassword") : t("auth.signIn.showPassword")
                }
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            }
          />
        </Field>
        <CheckboxRow
          label={t("auth.signUp.acceptTerms")}
          checked={acceptTerms}
          onChange={(e) => setAcceptTerms(e.target.checked)}
          required
        />
        {error ? <p className="error">{error}</p> : null}
        <Button type="submit" block loading={signUp.isPending} disabled={!acceptTerms}>
          {t("auth.signUp.submit")}
        </Button>
      </form>
      <hr className="sep" />
      <p>
        {t("auth.signUp.hasAccount")} <Link href="/connexion">{t("auth.signUp.signInLink")}</Link>
      </p>
    </>
  );
}
