import { portalLabels } from "../../_components/labels";
import { FeedbackView } from "./feedback-view";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <FeedbackView token={token} labels={portalLabels} />;
}
