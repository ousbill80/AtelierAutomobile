import { portalLabels } from "../../_components/labels";
import { VehicleView } from "./vehicle-view";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <VehicleView token={token} labels={portalLabels} />;
}
