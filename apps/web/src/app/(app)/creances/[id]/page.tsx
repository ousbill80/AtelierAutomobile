import { CaseView } from "./case-view";

// Page authentifiée, propre à un dossier : jamais prérendue statiquement.
export const instant = false;

export default async function CollectionCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CaseView id={id} />;
}
