import type { ReactNode } from "react";
import { BellRing, CalendarCheck, Receipt } from "lucide-react";
import { t } from "@/i18n/t";

const POINTS = [
  { icon: CalendarCheck, title: "auth.panel.point1Title", desc: "auth.panel.point1Desc" },
  { icon: BellRing, title: "auth.panel.point2Title", desc: "auth.panel.point2Desc" },
  { icon: Receipt, title: "auth.panel.point3Title", desc: "auth.panel.point3Desc" },
] as const;

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-wrap">
      <aside className="auth-panel">
        <div className="auth-brand">
          <span className="mark" aria-hidden="true">
            A
          </span>
          <span>{t("auth.brand")}</span>
        </div>
        <div>
          <h2>{t("auth.panel.title")}</h2>
          <ul className="auth-points">
            {POINTS.map(({ icon: Icon, title, desc }) => (
              <li key={title}>
                <span className="ic" aria-hidden="true">
                  <Icon size={20} />
                </span>
                <div>
                  <strong>{t(title)}</strong>
                  <span>{t(desc)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="auth-panel-foot">{t("auth.panel.foot")}</p>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-mobile-brand">
            <span className="mark" aria-hidden="true">
              A
            </span>
            <div>
              <div className="name">{t("auth.brand")}</div>
              <div className="sub">{t("auth.tagline")}</div>
            </div>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
