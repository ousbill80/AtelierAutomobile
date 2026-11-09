"use client";

import { useState } from "react";
import { CircleCheck, CircleOff, KeyRound, Smartphone } from "lucide-react";
import { formatDate } from "@atelieros/core";
import { Button, Card, Field, Input, OtpInput, StatusBadge } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

const DISPLAY_TIME_ZONE = "Africa/Abidjan";

type Step = "IDLE" | "PASSWORD" | "SCAN" | "DISABLE";

/** Les sessions PIN d'atelier sont redirigées hors de (app) : seul le compte avec mot de passe arrive ici. */
export function TotpCard() {
  const utils = trpc.useUtils();
  const status = trpc.totp.status.useQuery();
  const [step, setStep] = useState<Step>("IDLE");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setupData, setSetupData] = useState<{ secret: string; qrCode: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function reset(next: Step = "IDLE") {
    setStep(next);
    setPassword("");
    setCode("");
    setSetupData(null);
    setError(null);
  }

  const setup = trpc.totp.setup.useMutation({
    onSuccess(data) {
      setSetupData({ secret: data.secret, qrCode: data.qrCode });
      setPassword("");
      setError(null);
      setStep("SCAN");
    },
    onError: (err) => setError(err.message),
  });

  const enable = trpc.totp.enable.useMutation({
    onSuccess() {
      reset();
      setNotice(t("profile.security.totp.enabledToast"));
      void utils.totp.status.invalidate();
    },
    onError: (err) => setError(err.message),
  });

  const disable = trpc.totp.disable.useMutation({
    onSuccess() {
      reset();
      setNotice(t("profile.security.totp.disabledToast"));
      void utils.totp.status.invalidate();
    },
    onError: (err) => setError(err.message),
  });

  const enabled = status.data?.enabled ?? false;

  const badge = status.isLoading ? null : enabled ? (
    <StatusBadge tone="ok">
      <CircleCheck size={14} aria-hidden="true" /> {t("profile.security.totp.statusOn")}
    </StatusBadge>
  ) : (
    <StatusBadge tone="off">
      <CircleOff size={14} aria-hidden="true" /> {t("profile.security.totp.statusOff")}
    </StatusBadge>
  );

  return (
    <Card title={t("profile.security.totp.title")} actions={badge}>
      <div className="stack">
        <p className="hint" style={{ margin: 0 }}>
          {t("profile.security.totp.description")}
        </p>

        {status.isLoading ? (
          <div className="skeleton" style={{ height: 44 }} aria-busy="true" />
        ) : status.isError ? (
          <div className="auth-alert" role="alert">
            {status.error.message}
          </div>
        ) : null}

        {notice ? (
          <p role="status" className="hint">
            {notice}
          </p>
        ) : null}

        {!status.isLoading && !status.isError ? (
          <>
            {enabled && status.data?.enabledAt && step === "IDLE" ? (
              <p className="hint" style={{ margin: 0 }}>
                {t("profile.security.totp.enabledSince", {
                  date: formatDate(new Date(status.data.enabledAt), DISPLAY_TIME_ZONE),
                })}
              </p>
            ) : null}

            {step === "IDLE" ? (
              enabled ? (
                <div>
                  <Button
                    variant="danger"
                    onClick={() => {
                      setNotice(null);
                      reset("DISABLE");
                    }}
                  >
                    {t("profile.security.totp.disable")}
                  </Button>
                </div>
              ) : (
                <div>
                  <Button
                    onClick={() => {
                      setNotice(null);
                      reset("PASSWORD");
                    }}
                  >
                    <Smartphone size={16} aria-hidden="true" /> {t("profile.security.totp.start")}
                  </Button>
                </div>
              )
            ) : null}

            {step === "PASSWORD" || step === "DISABLE" ? (
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  setError(null);
                  if (step === "PASSWORD") setup.mutate({ password });
                  else disable.mutate({ password });
                }}
              >
                {step === "DISABLE" ? (
                  <p className="hint" style={{ margin: 0 }}>
                    {t("profile.security.totp.disableConfirm")}
                  </p>
                ) : null}
                <Field
                  label={t("profile.security.totp.passwordLabel")}
                  hint={t("profile.security.totp.passwordHint")}
                  htmlFor="totp-password"
                >
                  <Input
                    id="totp-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    leftIcon={<KeyRound size={16} />}
                  />
                </Field>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button
                    type="submit"
                    variant={step === "DISABLE" ? "danger" : "primary"}
                    loading={setup.isPending || disable.isPending}
                  >
                    {step === "DISABLE"
                      ? t("profile.security.totp.disable")
                      : t("profile.security.totp.continue")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => reset()}>
                    {t("profile.security.totp.cancel")}
                  </Button>
                </div>
              </form>
            ) : null}

            {step === "SCAN" && setupData ? (
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  setError(null);
                  enable.mutate({ code });
                }}
              >
                <p style={{ margin: 0 }}>{t("profile.security.totp.step1")}</p>
                <img
                  src={setupData.qrCode}
                  alt={t("profile.security.totp.qrAlt")}
                  width={200}
                  height={200}
                  style={{ background: "#fff", borderRadius: 8, padding: 8 }}
                />
                <p className="hint" style={{ margin: 0 }}>
                  {t("profile.security.totp.manualKey")}
                </p>
                <code style={{ wordBreak: "break-all", fontSize: 14, userSelect: "all" }}>
                  {setupData.secret.replace(/(.{4})/g, "$1 ").trim()}
                </code>
                <p style={{ margin: 0 }}>{t("profile.security.totp.step2")}</p>
                <Field label={t("profile.security.totp.codeLabel")}>
                  <OtpInput value={code} onChange={setCode} />
                </Field>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button type="submit" loading={enable.isPending} disabled={code.length !== 6}>
                    {t("profile.security.totp.activate")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => reset()}>
                    {t("profile.security.totp.cancel")}
                  </Button>
                </div>
              </form>
            ) : null}

            {error ? (
              <div className="auth-alert" role="alert">
                {error}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Card>
  );
}
