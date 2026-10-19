import { VehicleView } from "./vehicle-view";

export default async function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VehicleView id={id} />;
}
