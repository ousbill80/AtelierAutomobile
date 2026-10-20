import { portalLabels } from "../../_components/labels";
import { TrackingView } from "./tracking-view";

// M14 US-M14-04 — suivi d'OR en temps réel (jeton REPAIR_ORDER).
export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <TrackingView token={token} labels={portalLabels} />;
}
