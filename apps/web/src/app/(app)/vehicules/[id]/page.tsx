import { VehicleView } from "./vehicle-view";

// Page authentifiée, propre à un véhicule : jamais prérendue statiquement.
export const instant = false;

export default async function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VehicleView id={id} />;
}
