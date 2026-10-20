// Étape 7.2 — rapports d'erreurs (Sentry) sans données personnelles (01 §8, CLAUDE.md « Secrets »).
// Fonctions pures, indépendantes du SDK : web et worker les branchent dans `beforeSend` /
// `beforeBreadcrumb`. On retire tout ce qui identifie une personne ou ouvre un accès (cookies,
// en-têtes, corps de requête, jetons du portail) et on masque dans les textes libres les e-mails,
// numéros de téléphone et longues chaînes ressemblant à des secrets.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Numéros internationaux (+225 07 47 21 88 90, +2250747218890) et ivoiriens à 10 chiffres
// (07 47 21 88 90, 0747218890), espaces/points/tirets tolérés entre les groupes. Les numéros de
// documents (FAC-2026-000123) ne commencent ni par « + » ni par « 0 » : ils restent lisibles.
const PHONE = /\+\d{1,3}(?:[\s.-]?\d){8,12}|(?<!\d)0\d(?:[\s.-]?\d{2}){4}(?!\d)/g;
// Jetons, clés d'API, JWT : longues chaînes base64/base64url/hex (voir `looksLikeSecret`).
const TOKEN = /[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,}){2}|[A-Za-z0-9_-]{24,}/g;
// Segments d'URL portant un jeton public (portail client M14, liens courts, invitations).
const TOKEN_PATH = /\/(p|l|invitation)\/[^/?#\s]+/g;

export const REDACTED = "[filtré]";

/**
 * Les identifiants cuid2 (25 caractères minuscules/chiffres) ne sont pas des données personnelles
 * et servent au diagnostic : on les garde. Un secret a soit 32 caractères ou plus (hex, base64),
 * soit des majuscules, `_`, `-` ou `.` (base64url, JWT).
 */
function looksLikeSecret(candidate: string): boolean {
  return candidate.length >= 32 || /[A-Z_.-]/.test(candidate);
}

/** Masque les données personnelles et les secrets dans un texte libre. */
export function scrubText(text: string): string {
  return text
    .replace(TOKEN_PATH, (_m, prefix: string) => `/${prefix}/${REDACTED}`)
    .replace(EMAIL, REDACTED)
    .replace(TOKEN, (match) => (looksLikeSecret(match) ? REDACTED : match))
    .replace(PHONE, REDACTED);
}

/** Retire la chaîne de requête et les jetons de chemin d'une URL. */
export function scrubUrl(url: string): string {
  const withoutQuery = url.split(/[?#]/, 1)[0] ?? "";
  return scrubText(withoutQuery);
}

const SENSITIVE_KEY =
  /pass|secret|token|key|auth|cookie|session|signature|phone|mail|otp|pinhash|pincode|iban|card/i;

/** Parcourt récursivement une valeur et masque clés sensibles et textes (profondeur bornée). */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED;
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : scrubValue(inner, depth + 1);
    }
    return out;
  }
  return value;
}

/** Forme minimale d'un événement d'erreur (sous-ensemble de l'`Event` Sentry). */
export interface ErrorReportEvent {
  message?: string;
  user?: unknown;
  request?: {
    url?: string;
    method?: string;
    headers?: unknown;
    cookies?: unknown;
    data?: unknown;
    query_string?: unknown;
    env?: unknown;
  };
  exception?: { values?: { type?: string; value?: string }[] };
  breadcrumbs?: ErrorReportBreadcrumb[];
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  transaction?: string;
  server_name?: string;
}

export interface ErrorReportBreadcrumb {
  message?: string;
  data?: Record<string, unknown>;
  category?: string;
}

/** `beforeSend` : renvoie une copie de l'événement sans données personnelles. */
export function scrubErrorEvent<T extends ErrorReportEvent>(event: T): T {
  const copy: T = { ...event };
  delete copy.user;
  // Nom d'hôte du conteneur : sans intérêt et parfois identifiant du client hébergé.
  delete copy.server_name;
  if (copy.request) {
    copy.request = {
      method: copy.request.method,
      url: copy.request.url ? scrubUrl(copy.request.url) : undefined,
    };
  }
  if (copy.message) copy.message = scrubText(copy.message);
  if (copy.transaction) copy.transaction = scrubUrl(copy.transaction);
  if (copy.exception?.values) {
    copy.exception = {
      ...copy.exception,
      values: copy.exception.values.map((entry) => ({
        ...entry,
        value: entry.value ? scrubText(entry.value) : entry.value,
      })),
    };
  }
  if (copy.breadcrumbs) {
    copy.breadcrumbs = copy.breadcrumbs.map((crumb) => scrubBreadcrumb(crumb));
  }
  if (copy.extra) copy.extra = scrubValue(copy.extra) as Record<string, unknown>;
  if (copy.contexts) copy.contexts = scrubValue(copy.contexts) as Record<string, unknown>;
  if (copy.tags) copy.tags = scrubValue(copy.tags) as Record<string, unknown>;
  return copy;
}

/** `beforeBreadcrumb` : URL sans chaîne de requête, textes et données masqués. */
export function scrubBreadcrumb<T extends ErrorReportBreadcrumb>(crumb: T): T {
  const copy: T = { ...crumb };
  if (copy.message) copy.message = scrubText(copy.message);
  if (copy.data) {
    const data: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(copy.data)) {
      if (key === "url" && typeof inner === "string") data[key] = scrubUrl(inner);
      else data[key] = SENSITIVE_KEY.test(key) ? REDACTED : scrubValue(inner);
    }
    copy.data = data;
  }
  return copy;
}
