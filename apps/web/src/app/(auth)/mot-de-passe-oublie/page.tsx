"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { checkPasswordPolicy } from "@atelieros/core/src/auth/password-policy";
import { Button, Field, Input, OtpInput } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

type Step = "identifier" | "code" | "newPassword";

export default function MotDePasseOubliePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("identifier");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const sendOtp = trpc.auth.sendOtp.useMutation({
    onSuccess() {
      setStep("code");
      setError(null);
    },
    onError(err) {
      setError(err.message);
    },
  });

  const verifyOtp = trpc.auth.verifyOtp.useMutation({
    onSuccess(result) {
      if (result.resetToken) {
        setResetToken(result.resetToken);
        setStep("newPassword");
        setError(null);
      }
    },
    onError(err) {
      setError(err.message);
    },
  });

  const resetPassword = trpc.auth.resetPassword.useMutation({
    onSuccess() {
      router.push("/connexion");
    },
    onError(err) {
      setError(err.message);
    },
  });

  const policyViolation = newPassword ? checkPasswordPolicy(newPassword) : null;

  if (step === "newPassword") {
    return (
      <>
        <h1>{t("auth.forgotPassword.newPasswordTitle")}</h1>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            resetPassword.mutate({ resetToken, newPassword });
          }}
        >
          <Field
            label={t("auth.forgotPassword.newPasswordLabel")}
            error={policyViolation ? "Mot de passe trop faible." : undefined}
          >
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
          </Field>
          {error ? <p className="error">{error}</p> : null}
          <Button
            type="submit"
            block
            loading={resetPassword.isPending}
            disabled={!!policyViolation}
          >
            {t("auth.forgotPassword.submitNewPassword")}
          </Button>
        </form>
      </>
    );
  }

  if (step === "code") {
    return (
      <>
        <h1>{t("auth.verifyOtp.title")}</h1>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            verifyOtp.mutate({ identifier, code, purpose: "RESET" });
          }}
        >
          <OtpInput value={code} onChange={setCode} />
          {error ? <p className="error">{error}</p> : null}
          <Button type="submit" block loading={verifyOtp.isPending} disabled={code.length !== 6}>
            {t("auth.verifyOtp.submit")}
          </Button>
        </form>
      </>
    );
  }

  return (
    <>
      <h1>{t("auth.forgotPassword.title")}</h1>
      <p>{t("auth.forgotPassword.description")}</p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          sendOtp.mutate({ identifier, purpose: "RESET" });
        }}
      >
        <Field label={t("auth.signIn.identifierLabel")}>
          <Input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            autoComplete="username"
          />
        </Field>
        {error ? <p className="error">{error}</p> : null}
        <Button type="submit" block loading={sendOtp.isPending}>
          {t("auth.forgotPassword.submit")}
        </Button>
      </form>
    </>
  );
}
