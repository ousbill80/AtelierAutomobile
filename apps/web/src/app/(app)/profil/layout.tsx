"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SettingsLayout } from "@atelieros/ui";
import { t } from "@/i18n/t";

export default function ProfileLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeKey = pathname.startsWith("/profil/securite") ? "securite" : "profil";

  return (
    <SettingsLayout
      items={[
        { key: "profil", label: t("nav.profile") },
        { key: "securite", label: t("nav.profileSecurity") },
      ]}
      activeKey={activeKey}
      onChange={(key) => router.push(key === "profil" ? "/profil" : "/profil/securite")}
    >
      {children}
    </SettingsLayout>
  );
}
