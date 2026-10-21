import type { ReactNode } from "react";
import {
  CheckCircle2,
  MessageSquare,
  Receipt,
  ShieldCheck,
  Smartphone,
  Wrench,
} from "lucide-react";
import { t } from "@/i18n/t";
import { WorkshopIllustration } from "./WorkshopIllustration";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="login-wrap">
      <div className="login-vector-bg" aria-hidden="true" />

      <div className="auth-container">
        <aside className="auth-showcase" aria-label={t("auth.brand")}>
          <div className="auth-showcase-badge">
            <span className="badge-dot" />
            <span>{t("auth.showcase.badge")}</span>
          </div>

          <div className="auth-showcase-head">
            <div className="auth-showcase-brand">
              <div className="auth-showcase-mark" aria-hidden="true">
                <Wrench size={22} strokeWidth={2.5} />
              </div>
              <span className="auth-showcase-title">{t("auth.brand")}</span>
            </div>
            <h2 className="auth-showcase-headline">{t("auth.showcase.headline")}</h2>
            <p className="auth-showcase-sub">{t("auth.showcase.subheadline")}</p>
          </div>

          <WorkshopIllustration />

          <div className="auth-features-list">
            <div className="auth-feature-item">
              <div className="auth-feature-icon" aria-hidden="true">
                <Wrench size={16} strokeWidth={2} />
              </div>
              <div className="auth-feature-body">
                <div className="auth-feature-title">{t("auth.showcase.feature1Title")}</div>
                <div className="auth-feature-desc">{t("auth.showcase.feature1Desc")}</div>
              </div>
            </div>

            <div className="auth-feature-item">
              <div className="auth-feature-icon" aria-hidden="true">
                <MessageSquare size={16} strokeWidth={2} />
              </div>
              <div className="auth-feature-body">
                <div className="auth-feature-title">{t("auth.showcase.feature2Title")}</div>
                <div className="auth-feature-desc">{t("auth.showcase.feature2Desc")}</div>
              </div>
            </div>

            <div className="auth-feature-item">
              <div className="auth-feature-icon" aria-hidden="true">
                <Receipt size={16} strokeWidth={2} />
              </div>
              <div className="auth-feature-body">
                <div className="auth-feature-title">{t("auth.showcase.feature3Title")}</div>
                <div className="auth-feature-desc">{t("auth.showcase.feature3Desc")}</div>
              </div>
            </div>
          </div>

          <div className="auth-trust-row">
            <div className="auth-trust-pill">
              <ShieldCheck size={14} />
              <span>{t("auth.showcase.trustSecurity")}</span>
            </div>
            <div className="auth-trust-pill">
              <CheckCircle2 size={14} />
              <span>{t("auth.showcase.trustDgi")}</span>
            </div>
            <div className="auth-trust-pill">
              <Smartphone size={14} />
              <span>{t("auth.showcase.trustTablet")}</span>
            </div>
          </div>
        </aside>

        <main className="login-card">
          <div className="login-mobile-brand">
            <div className="login-mobile-mark" aria-hidden="true">
              <Wrench size={22} strokeWidth={2.5} />
            </div>
            <div className="login-mobile-title">{t("auth.brand")}</div>
            <div className="login-mobile-sub">{t("auth.tagline")}</div>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
