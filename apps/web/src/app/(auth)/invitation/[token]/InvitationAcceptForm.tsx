"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

export function InvitationAcceptForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const accept = trpc.invitation.accept.useMutation({
    onSuccess() {
      router.push("/connexion");
    },
    onError(err) {
      setError(err.message);
    },
  });

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        accept.mutate({ token, password: password.trim() || undefined });
      }}
    >
      <p className="hint">{t("auth.invitation.existingAccountNote")}</p>
      <Field label={t("auth.invitation.passwordLabel")}>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
        />
      </Field>
      {error ? <p className="error">{error}</p> : null}
      <Button type="submit" block loading={accept.isPending}>
        {t("auth.invitation.submit")}
      </Button>
    </form>
  );
}
