"use client";

import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, PageHead } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

export default function ProfilePage() {
  const router = useRouter();
  const me = trpc.me.get.useQuery();

  if (me.isLoading) {
    return <p>{t("common.loading")}</p>;
  }

  const user = me.data?.user;

  return (
    <>
      <PageHead title={t("profile.title")} />
      <Card>
        <div className="stack">
          <Field label={t("profile.nameLabel")}>
            <Input value={user?.name ?? ""} readOnly />
          </Field>
          <Field label={t("profile.phoneLabel")}>
            <Input value={user?.phone ?? ""} readOnly />
          </Field>
          <Field label={t("profile.emailLabel")}>
            <Input value={user?.email ?? ""} readOnly />
          </Field>
          <Button variant="secondary" onClick={() => router.push("/mot-de-passe-oublie")}>
            {t("profile.changePassword")}
          </Button>
        </div>
      </Card>
    </>
  );
}
