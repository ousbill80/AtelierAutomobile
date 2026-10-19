import { RuleEditView } from "./rule-edit-view";

export default async function EditReminderRulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RuleEditView id={id} />;
}
