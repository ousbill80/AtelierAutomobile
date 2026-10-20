import type { ReactNode } from "react";
import { t } from "@/i18n/t";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <div className="mark" aria-hidden>
            {t("auth.brandMark")}
          </div>
          <h1>{t("auth.brand")}</h1>
          <p className="sub">{t("auth.tagline")}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
