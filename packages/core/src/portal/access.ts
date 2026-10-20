// M14 RG-M14-06 — protection du portail : IP tronquée, téléphone masqué, limitation de débit
// (30 requêtes/min par IP, 5 jetons invalides en 10 min → blocage 30 min). Fonctions pures :
// le stockage des compteurs (Redis ou mémoire) est fourni par l'appelant.

/** IP tronquée : /24 en IPv4, /48 en IPv6 (la preuve garde le réseau, pas l'adresse). */
export function ipPrefix(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const raw = ip.trim().replace(/^::ffff:/i, "");
  const v4 = raw.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0`;
  if (raw.includes(":")) {
    const groups = raw.split(":").filter((g) => g.length > 0);
    return `${groups.slice(0, 3).join(":")}::`;
  }
  return null;
}

/** `+2250747218890` → `+225 07 •• •• 88 90` (seuls l'opérateur et les 4 derniers chiffres restent). */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("225") && digits.length === 13) {
    const local = digits.slice(3);
    return `+225 ${local.slice(0, 2)} •• •• ${local.slice(6, 8)} ${local.slice(8, 10)}`;
  }
  if (digits.length < 6) return "••••";
  return `${"•".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

/** User-agent journalisé, tronqué. */
export function truncateUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  return ua.slice(0, 300);
}

export const PORTAL_RATE_LIMITS = {
  /** 30 requêtes par minute et par IP sur `/p/*`. */
  requestsPerMinute: 30,
  requestWindowMs: 60_000,
  /** 5 jetons invalides en 10 minutes… */
  invalidTokensMax: 5,
  invalidWindowMs: 10 * 60_000,
  /** … → blocage 30 minutes. */
  blockMs: 30 * 60_000,
} as const;

/** Clé de fenêtre fixe : un compteur par IP et par tranche de `windowMs`. */
export function windowKey(prefix: string, subject: string, now: Date, windowMs: number): string {
  return `${prefix}:${subject}:${Math.floor(now.getTime() / windowMs)}`;
}

/** Durée de vie restante de la fenêtre courante (pour l'expiration du compteur). */
export function windowTtlMs(now: Date, windowMs: number): number {
  return windowMs - (now.getTime() % windowMs);
}

export type RateDecision = { allowed: true } | { allowed: false; reason: "BLOCKED" | "TOO_MANY" };

/** Décision d'une requête : bloquée si l'IP est sous blocage ou au-delà du quota par minute. */
export function decideRequest(input: { blocked: boolean; countInWindow: number }): RateDecision {
  if (input.blocked) return { allowed: false, reason: "BLOCKED" };
  if (input.countInWindow > PORTAL_RATE_LIMITS.requestsPerMinute) {
    return { allowed: false, reason: "TOO_MANY" };
  }
  return { allowed: true };
}

/** Un jeton invalide de plus : faut-il bloquer l'IP ? */
export function shouldBlockAfterInvalid(invalidCountInWindow: number): boolean {
  return invalidCountInWindow >= PORTAL_RATE_LIMITS.invalidTokensMax;
}

/** Actions journalisées dans `PortalAccess.action` (M14 §14). */
export const PORTAL_ACCESS_ACTIONS = [
  "open",
  "quote_decide",
  "pay_click",
  "book",
  "cancel",
  "confirm",
  "reschedule",
  "feedback",
  "new_link_request",
  "otp_login",
  "document_open",
] as const;
export type PortalAccessAction = (typeof PORTAL_ACCESS_ACTIONS)[number];
