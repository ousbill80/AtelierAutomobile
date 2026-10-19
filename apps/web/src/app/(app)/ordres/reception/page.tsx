import { ReceptionWizard } from "./reception-wizard";

// M04 §7 — /ordres/reception (?vehicleId=…&appointmentId=… depuis « Client arrivé », M03).
export default async function ReceptionPage({
  searchParams,
}: {
  searchParams: Promise<{ vehicleId?: string; appointmentId?: string }>;
}) {
  const params = await searchParams;
  return (
    <ReceptionWizard initialVehicleId={params.vehicleId} appointmentId={params.appointmentId} />
  );
}
