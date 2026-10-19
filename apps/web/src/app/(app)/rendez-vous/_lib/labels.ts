import { t } from "@/i18n/t";

export type AppointmentTypeKey =
  "SERVICE" | "INSPECTION_PREP" | "REPAIR" | "DIAGNOSTIC" | "BODYWORK" | "TIRES" | "OTHER";
export type AppointmentStatusKey =
  "BOOKED" | "CONFIRMED" | "ARRIVED" | "COMPLETED" | "NO_SHOW" | "CANCELLED";
export type AppointmentSourceKey = "STAFF" | "PHONE" | "WHATSAPP" | "PORTAL" | "REMINDER";

export const APPOINTMENT_TYPES: AppointmentTypeKey[] = [
  "SERVICE",
  "INSPECTION_PREP",
  "REPAIR",
  "DIAGNOSTIC",
  "BODYWORK",
  "TIRES",
  "OTHER",
];
export const APPOINTMENT_STATUSES: AppointmentStatusKey[] = [
  "BOOKED",
  "CONFIRMED",
  "ARRIVED",
  "COMPLETED",
  "NO_SHOW",
  "CANCELLED",
];
export const APPOINTMENT_SOURCES: AppointmentSourceKey[] = [
  "STAFF",
  "PHONE",
  "WHATSAPP",
  "PORTAL",
  "REMINDER",
];

/** Couleurs par type (M03 §7) : Révision bleu, Pré-VT violet, Réparation orange, Diagnostic cyan, Carrosserie rouge brique, Pneus ardoise, Autre gris. */
export const TYPE_COLORS: Record<AppointmentTypeKey, string> = {
  SERVICE: "oklch(55% 0.17 255)",
  INSPECTION_PREP: "oklch(52% 0.2 300)",
  REPAIR: "oklch(66% 0.185 42)",
  DIAGNOSTIC: "oklch(62% 0.12 210)",
  BODYWORK: "oklch(50% 0.16 25)",
  TIRES: "oklch(45% 0.03 240)",
  OTHER: "oklch(60% 0.01 240)",
};

/** Statuts : couleur + icône + texte, jamais la couleur seule. */
export const STATUS_META: Record<
  AppointmentStatusKey,
  { tone: "ok" | "warn" | "bad" | "off"; icon: string }
> = {
  BOOKED: { tone: "off", icon: "🕒" },
  CONFIRMED: { tone: "ok", icon: "✔" },
  ARRIVED: { tone: "ok", icon: "🚗" },
  COMPLETED: { tone: "ok", icon: "🏁" },
  NO_SHOW: { tone: "bad", icon: "✖" },
  CANCELLED: { tone: "off", icon: "⊘" },
};

export const SOURCE_ICONS: Record<AppointmentSourceKey, string> = {
  STAFF: "🏪",
  PHONE: "📞",
  WHATSAPP: "💬",
  PORTAL: "🌐",
  REMINDER: "🔔",
};

export const typeLabel = (type: string) => t(`appointments.types.${type}`);
export const statusLabel = (status: string) => t(`appointments.statuses.${status}`);
export const sourceLabel = (source: string) => t(`appointments.sources.${source}`);
