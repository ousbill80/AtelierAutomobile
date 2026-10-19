import type { ReactNode } from "react";
import { t } from "@/i18n/t";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">{t("auth.brand")}</div>
        {children}
      </div>
    </div>
  );
}
