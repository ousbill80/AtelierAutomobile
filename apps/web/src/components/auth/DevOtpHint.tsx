"use client";

import { t } from "@/i18n/t";

export interface DevOtpHintProps {
  /** Code OTP renvoyé par le serveur en environnement de développement uniquement. */
  code: string | null | undefined;
  onUse: (code: string) => void;
}

/**
 * Affiche le code OTP de test quand le serveur le fournit (NODE_ENV=development).
 * En production le serveur ne renvoie jamais `devCode`, le composant ne rend rien.
 */
export function DevOtpHint({ code, onUse }: DevOtpHintProps) {
  if (!code) return null;
  return (
    <div className="dev-hint">
      <span>
        {t("auth.signIn.devOtpHint")} : <code>{code}</code>
      </span>
      <button type="button" className="link-btn" onClick={() => onUse(code)}>
        {t("auth.signIn.devOtpUse")}
      </button>
    </div>
  );
}
