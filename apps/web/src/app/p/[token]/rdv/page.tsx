import { PortalAppointment } from "./portal-appointment";

// US-M03-06 / US-M03-07 — portail public `/p/[token]/rdv` (jeton PortalToken, sans compte).
export default async function PortalAppointmentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PortalAppointment token={token} />;
}
