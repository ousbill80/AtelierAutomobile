import type { Metadata } from "next";
import { connection } from "next/server";
import { PortalBooking } from "./PortalBooking";
import "./portal.css";

export const metadata: Metadata = {
  title: "Prendre rendez-vous",
  robots: { index: false, follow: false },
};

/**
 * `/p/[token]/rdv` — portail public de prise de RDV (US-M03-06, US-M03-07, RG-M14-06) : rendu
 * léger, mobile d'abord, aucune session. Toute donnée passe par le jeton à portée limitée.
 */
export default async function PortalAppointmentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await connection();
  const { token } = await params;
  return (
    <main className="portal">
      <PortalBooking token={token} />
    </main>
  );
}
