import { ConversationView } from "./conversation-view";

// Page authentifiée, propre à une conversation : jamais prérendue statiquement.
export const instant = false;

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ConversationView conversationId={id} />;
}
