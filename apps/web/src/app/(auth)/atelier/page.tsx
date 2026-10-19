"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";
import { getDeviceId } from "@/trpc/device-id";

export default function AtelierPage() {
  const router = useRouter();
  const [membershipId, setMembershipId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const pinSignIn = trpc.auth.pinSignIn.useMutation({
    onSuccess() {
      router.push("/");
    },
    onError(err) {
      setError(err.message);
    },
  });

  return (
    <>
      <h1>{t("auth.atelier.title")}</h1>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          pinSignIn.mutate({ deviceId: getDeviceId(), membershipId, pin });
        }}
      >
        <Field label="Identifiant du membre">
          <Input value={membershipId} onChange={(e) => setMembershipId(e.target.value)} required />
        </Field>
        <Field label={t("auth.atelier.pinLabel")}>
          <Input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            required
            minLength={4}
            maxLength={4}
          />
        </Field>
        {error ? <p className="error">{error}</p> : null}
        <Button type="submit" block loading={pinSignIn.isPending} disabled={pin.length !== 4}>
          {t("auth.signIn.submit")}
        </Button>
      </form>
    </>
  );
}
