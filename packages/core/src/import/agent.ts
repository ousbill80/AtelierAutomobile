/**
 * M13 partie 2 — agent local (RG-M13-28). Fonctions pures partagées par le serveur
 * (appairage, battement, réception des lots) et par l'agent (`apps/sync-agent` : lots,
 * empreintes de lignes). Hasard et empreintes via Web Crypto (Node 20+ et navigateur).
 */
import { canonicalize } from "./hash";

/** Alphabet sans caractères ambigus (0/O, 1/I/L) : le code est recopié à la main. */
const PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export const PAIRING_CODE_LENGTH = 8;
export const PAIRING_VALIDITY_MS = 15 * 60 * 1000;
/** RG-M13-28 : battement toutes les 5 min ; hors ligne sans battement depuis 15 min (§5). */
export const AGENT_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
export const AGENT_OFFLINE_AFTER_MS = 15 * 60 * 1000;
/** M13 §11 : horloge de l'agent décalée de plus de 5 min → avertissement. */
export const AGENT_CLOCK_SKEW_WARNING_MS = 5 * 60 * 1000;
/** RG-M13-28 : lots de 500 lignes. */
export const SYNC_BATCH_SIZE = 500;
/** RG-M13-28 : file locale conservée 7 jours si internet est coupé. */
export const AGENT_QUEUE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type AgentStatus = "PAIRING" | "ONLINE" | "OFFLINE" | "REVOKED";

function randomString(alphabet: string, length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  // 256 n'est pas un multiple de la taille de l'alphabet : on rejette les octets hors plage
  // pour ne pas biaiser la distribution.
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  let i = 0;
  while (out.length < length) {
    if (i >= bytes.length) {
      globalThis.crypto.getRandomValues(bytes);
      i = 0;
    }
    const b = bytes[i++]!;
    if (b < limit) out += alphabet[b % alphabet.length];
  }
  return out;
}

/** Code d'appairage à 8 caractères, affiché à l'écran et saisi sur le PC du garage. */
export function generatePairingCode(): string {
  return randomString(PAIRING_ALPHABET, PAIRING_CODE_LENGTH);
}

/** Saisie tolérante : minuscules, espaces et tirets acceptés (« abcd-1234 »). */
export function normalizePairingCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

export function pairingExpiresAt(now: Date): Date {
  return new Date(now.getTime() + PAIRING_VALIDITY_MS);
}

/** Jeton de l'agent (scope `sync:push`) ; seul son sha256 est stocké. */
export function generateAgentToken(): string {
  return `sa_live_${randomString(TOKEN_ALPHABET, 32)}`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hashAgentToken(token: string): Promise<string> {
  return sha256Hex(token);
}

/** Statut affiché : un agent ONLINE sans battement depuis 15 min est hors ligne. */
export function effectiveAgentStatus(
  agent: { status: string; lastSeenAt: Date | null },
  now: Date,
): AgentStatus {
  if (agent.status === "REVOKED" || agent.status === "PAIRING") return agent.status;
  if (!agent.lastSeenAt || now.getTime() - agent.lastSeenAt.getTime() > AGENT_OFFLINE_AFTER_MS) {
    return "OFFLINE";
  }
  return "ONLINE";
}

export function isClockSkewed(agentTime: Date, serverNow: Date): boolean {
  return Math.abs(agentTime.getTime() - serverNow.getTime()) > AGENT_CLOCK_SKEW_WARNING_MS;
}

export function chunkRows<T>(rows: readonly T[], size = SYNC_BATCH_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

/** Empreinte d'une ligne source (cache local de l'agent : n'envoyer que les lignes changées). */
export function hashSourceRow(columns: readonly string[], row: readonly string[]): Promise<string> {
  return sha256Hex(canonicalize(Object.fromEntries(columns.map((c, i) => [c, row[i] ?? ""]))));
}

/** RG-M13-28 : `Idempotency-Key = sha256(lot)`. */
export function batchIdempotencyKey(batch: {
  entity: string;
  columns: readonly string[];
  rows: readonly (readonly string[])[];
}): Promise<string> {
  return sha256Hex(JSON.stringify([batch.entity, batch.columns, batch.rows]));
}
