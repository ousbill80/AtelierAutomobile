// Libellés, couleurs et icônes du module M03 (§7) : statut = couleur + icône + texte, type =
// pastille couleur + libellé, jamais la couleur seule. Libellés dans messages/fr.json.
import {
  Ban,
  Bell,
  Car,
  Check,
  Clock,
  Flag,
  Globe,
  MessageCircle,
  Phone,
  Store,
  X,
  type LucideIcon,
} from "lucide-react";
import type { TRPCClientErrorLike } from "@trpc/client";
import { formatDayFr, formatTimeFr, localDateKey, zonedInstant } from "@atelieros/core/planning";
import { t } from "@/i18n/t";
import type { AppRouter } from "@/server/routers/_app";

export function ta(key: string, vars?: Record<string, string | number>): string {
  return t(`appointments.${key}`, vars);
}

export const TYPES = [
  "SERVICE",
  "INSPECTION_PREP",
  "REPAIR",
  "DIAGNOSTIC",
  "BODYWORK",
  "TIRES",
  "OTHER",
] as const;
export type AppointmentType = (typeof TYPES)[number];
export const STATUSES = [
  "BOOKED",
  "CONFIRMED",
  "ARRIVED",
  "COMPLETED",
  "NO_SHOW",
  "CANCELLED",
] as const;
export type AppointmentStatus = (typeof STATUSES)[number];
export const SOURCES = ["STAFF", "PHONE", "WHATSAPP", "PORTAL", "REMINDER"] as const;
export type AppointmentSource = (typeof SOURCES)[number];

/** §7 « Couleurs par type ». */
export const TYPE_COLORS: Record<AppointmentType, string> = {
  SERVICE: "#2f6fd6",
  INSPECTION_PREP: "#7c4dcc",
  REPAIR: "#e07b1a",
  DIAGNOSTIC: "#0e9fb3",
  BODYWORK: "#b5502f",
  TIRES: "#5b6b7a",
  OTHER: "#8a8f98",
};

type Tone = "ok" | "warn" | "bad" | "off";

export const STATUS_META: Record<
  AppointmentStatus,
  { tone: Tone; Icon: LucideIcon; color: string }
> = {
  BOOKED: { tone: "off", Icon: Clock, color: "#6b7280" },
  CONFIRMED: { tone: "ok", Icon: Check, color: "#1f9d55" },
  ARRIVED: { tone: "warn", Icon: Car, color: "#2f6fd6" },
  COMPLETED: { tone: "ok", Icon: Flag, color: "#14653a" },
  NO_SHOW: { tone: "bad", Icon: X, color: "#c62828" },
  CANCELLED: { tone: "off", Icon: Ban, color: "#6b7280" },
};

export const SOURCE_ICONS: Record<AppointmentSource, LucideIcon> = {
  STAFF: Store,
  PHONE: Phone,
  WHATSAPP: MessageCircle,
  PORTAL: Globe,
  REMINDER: Bell,
};

export function TypeDot({ type }: { type: AppointmentType }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: TYPE_COLORS[type] }}
      />
      {ta(`types.${type}`)}
    </span>
  );
}

export function StatusLabel({ status }: { status: AppointmentStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.Icon;
  return (
    <span
      className={`pill pill-${meta.tone} ${status === "CANCELLED" ? "line-through" : ""}`}
      data-status={status}
    >
      <Icon aria-hidden size={13} style={{ color: meta.color }} />
      {ta(`statuses.${status}`)}
    </span>
  );
}

export function SourceIcon({ source }: { source: AppointmentSource }) {
  const Icon = SOURCE_ICONS[source];
  return <Icon aria-label={ta(`sources.${source}`)} size={14} className="shrink-0 text-muted" />;
}

export const fmtTime = (date: Date | string, tz: string) => formatTimeFr(new Date(date), tz);
export const fmtDay = (date: Date | string, tz: string) => formatDayFr(new Date(date), tz);
export const dayKeyOf = (date: Date | string, tz: string) => localDateKey(new Date(date), tz);

/** « 2026-10-24 » + « 09:30 » (heure locale du garage) → instant UTC. */
export function instantOf(dateKey: string, hhmm: string, tz: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return zonedInstant(dateKey, (h ?? 0) * 60 + (m ?? 0), tz);
}

/** Message d'erreur tRPC lisible + code métier (`data.domainCode`, cf. server/trpc.ts). */
export function errorInfo(error: TRPCClientErrorLike<AppRouter> | null | undefined) {
  if (!error) return null;
  const data = error.data as
    { domainCode?: string | null; domainDetails?: { forcible?: boolean } | null } | undefined;
  return {
    message: error.message || ta("errors.generic"),
    code: data?.domainCode ?? null,
    forcible: !!data?.domainDetails?.forcible,
  };
}
