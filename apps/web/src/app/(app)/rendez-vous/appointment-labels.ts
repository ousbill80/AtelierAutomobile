// Libellés français partagés par les écrans du module M03 (rendez-vous et planning).

export const APPOINTMENT_TYPE_LABELS: Record<string, string> = {
  SERVICE: "Révision",
  INSPECTION_PREP: "Pré-visite technique",
  REPAIR: "Réparation",
  DIAGNOSTIC: "Diagnostic",
  BODYWORK: "Carrosserie",
  TIRES: "Pneus",
  OTHER: "Autre",
};

export const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  BOOKED: "Réservé",
  CONFIRMED: "Confirmé",
  ARRIVED: "Arrivé",
  NO_SHOW: "Absent",
  CANCELLED: "Annulé",
  COMPLETED: "Terminé",
};

export const APPOINTMENT_SOURCE_LABELS: Record<string, string> = {
  STAFF: "Comptoir",
  PHONE: "Téléphone",
  WHATSAPP: "WhatsApp",
  PORTAL: "Portail",
  REMINDER: "Relance",
};

export function appointmentStatusTone(status: string): "ok" | "warn" | "bad" | "off" {
  switch (status) {
    case "CONFIRMED":
    case "COMPLETED":
      return "ok";
    case "ARRIVED":
      return "ok";
    case "NO_SHOW":
    case "CANCELLED":
      return "bad";
    default:
      return "warn";
  }
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
