import { t } from "@/i18n/t";

// Squelette affiché instantanément pendant le chargement d'une page de l'application.
export default function AppLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("common.loading")}</span>
      <div className="page-head">
        <div className="flex flex-col gap-2">
          <div className="skeleton h-7 w-56" />
          <div className="skeleton h-4 w-80 max-w-full" />
        </div>
        <div className="skeleton h-11 w-36" />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton h-24" />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton h-14" />
        ))}
      </div>
    </div>
  );
}
