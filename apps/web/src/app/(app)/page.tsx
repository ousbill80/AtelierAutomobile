import { EmptyState, PageHead } from "@atelieros/ui";
import { t } from "@/i18n/t";

export default function DashboardPage() {
  return (
    <>
      <PageHead title={t("nav.dashboard")} />
      <EmptyState
        title="Tableau de bord"
        description="Les indicateurs d'atelier arrivent dans une prochaine étape."
      />
    </>
  );
}
