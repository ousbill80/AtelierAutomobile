"use client";

// « Installer l'application » : bouton natif sur Android/Chrome/Edge (beforeinstallprompt),
// mode d'emploi sur iPhone/iPad (Partager → Sur l'écran d'accueil). Masqué une fois installée.
import { useSyncExternalStore } from "react";
import { Download, Share, SquarePlus } from "lucide-react";
import { Button } from "@atelieros/ui";
import { t } from "@/i18n/t";
import {
  getInstallPrompt,
  isIos,
  isStandalone,
  setInstallPrompt,
  subscribeInstallPrompt,
} from "./pwa-state";

const noop = () => () => undefined;

export function useInstallState() {
  const prompt = useSyncExternalStore(subscribeInstallPrompt, getInstallPrompt, () => null);
  const standalone = useSyncExternalStore(noop, isStandalone, () => false);
  const ios = useSyncExternalStore(noop, isIos, () => false);
  return { prompt, standalone, ios };
}

export function InstallCard({ compact = false }: { compact?: boolean }) {
  const { prompt, standalone, ios } = useInstallState();
  if (standalone) {
    return compact ? null : <p className="text-sm text-status-ok">{t("pwa.install.installed")}</p>;
  }

  if (prompt) {
    return (
      <div className="flex flex-col gap-2">
        {!compact && <p className="text-sm text-muted">{t("pwa.install.hint")}</p>}
        <Button
          onClick={async () => {
            await prompt.prompt();
            await prompt.userChoice.catch(() => undefined);
            setInstallPrompt(null);
          }}
        >
          <Download size={16} aria-hidden />
          {t("pwa.install.button")}
        </Button>
      </div>
    );
  }

  if (ios) {
    return (
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
        <li>
          {t("pwa.install.iosStep1")}{" "}
          <Share
            size={14}
            className="inline align-text-bottom"
            aria-label={t("pwa.install.shareIcon")}
          />
        </li>
        <li>
          {t("pwa.install.iosStep2")}{" "}
          <SquarePlus size={14} className="inline align-text-bottom" aria-hidden />
        </li>
        <li>{t("pwa.install.iosStep3")}</li>
      </ol>
    );
  }

  return compact ? null : <p className="text-sm text-muted">{t("pwa.install.browserMenu")}</p>;
}
