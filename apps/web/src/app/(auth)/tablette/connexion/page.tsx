"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Field, Input } from "@atelieros/ui";
import { t } from "@/i18n/t";

const ERRORS: Record<string, string> = {
  incomplete: "auth.atelier.pinIncomplete",
  device: "auth.atelier.deviceDenied",
  member: "auth.atelier.memberDenied",
  none: "auth.atelier.noPin",
  locked: "auth.atelier.blocked",
  pin: "auth.atelier.wrongPin",
  rate: "auth.atelier.tooMany",
};

function PinForm() {
  const code = useSearchParams().get("e");
  const errorKey = code ? ERRORS[code] : undefined;

  return (
    <>
      <h1>{t("auth.atelier.title")}</h1>
      <form method="post" action="/api/auth/pin" className="stack" autoComplete="off">
        <Field label={t("auth.atelier.membershipLabel")}>
          <Input name="membershipId" autoComplete="off" required />
        </Field>
        <Field label={t("auth.atelier.pinLabel")} hint={t("auth.atelier.pinHint")}>
          <Input
            name="pin"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            pattern="[0-9]{6}"
            required
          />
        </Field>
        {errorKey ? (
          <p className="error" role="alert">
            {t(errorKey)}
          </p>
        ) : null}
        <Button type="submit" block>
          {t("auth.signIn.submit")}
        </Button>
      </form>
    </>
  );
}

export default function AtelierPage() {
  return (
    <Suspense fallback={null}>
      <PinForm />
    </Suspense>
  );
}
