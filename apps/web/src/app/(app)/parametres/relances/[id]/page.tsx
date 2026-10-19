import { RuleEditView } from "./rule-edit-view";

// Page authentifiée, propre à une règle : jamais prérendue statiquement.
export const instant = false;

export default async function EditReminderRulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RuleEditView id={id} />;
}
