import { ConversationView } from "./conversation-view";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ConversationView conversationId={id} />;
}
