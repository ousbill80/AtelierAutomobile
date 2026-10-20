// RG-M17-04 — minimisation des données personnelles : téléphones et emails remplacés par
// des jetons (`[TEL_1]`, `[EMAIL_1]`) avant l'envoi au modèle, réinjectés après réponse.

export interface Redaction {
  text: string;
  /** jeton → valeur d'origine */
  tokens: Record<string, string>;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// +225 0701020304, 00225…, 07 01 02 03 04, 07.01.02.03.04, 0701020304 (≥ 8 chiffres).
const PHONE_RE = /(?:\+|00)?\d(?:[\s.-]?\d){7,13}/g;

/**
 * Masque les emails et les numéros de téléphone. Une même valeur reçoit toujours le même
 * jeton ; `previous` permet de partager la numérotation entre plusieurs champs d'un prompt.
 */
export function redactPii(text: string, previous?: Redaction): Redaction {
  const tokens: Record<string, string> = { ...(previous?.tokens ?? {}) };
  const reverse = new Map(Object.entries(tokens).map(([k, v]) => [v, k]));
  const counters = { TEL: 0, EMAIL: 0 };
  for (const key of Object.keys(tokens)) {
    const match = /^\[(TEL|EMAIL)_(\d+)\]$/.exec(key);
    if (match) {
      const kind = match[1] as "TEL" | "EMAIL";
      counters[kind] = Math.max(counters[kind], Number(match[2]));
    }
  }
  const tokenFor = (kind: "TEL" | "EMAIL", value: string) => {
    const existing = reverse.get(value);
    if (existing) return existing;
    counters[kind] += 1;
    const token = `[${kind}_${counters[kind]}]`;
    tokens[token] = value;
    reverse.set(value, token);
    return token;
  };
  let out = text.replace(EMAIL_RE, (m) => tokenFor("EMAIL", m));
  out = out.replace(PHONE_RE, (m) => {
    const digits = m.replace(/\D/g, "");
    // Les montants (« 185000 ») et années ne sont pas des téléphones : ≥ 8 chiffres sans
    // séparateur de milliers, et pas un nombre « rond » de montant.
    if (digits.length < 8) return m;
    return tokenFor("TEL", m.trim());
  });
  return { text: out, tokens };
}

/** Réinjecte les valeurs d'origine à la place des jetons présents dans la réponse. */
export function restorePii(text: string, tokens: Record<string, string>): string {
  return text.replace(/\[(?:TEL|EMAIL)_\d+\]/g, (token) => tokens[token] ?? token);
}

/** Applique `restorePii` à toutes les chaînes d'une valeur JSON. */
export function restorePiiDeep<T>(value: T, tokens: Record<string, string>): T {
  if (typeof value === "string") return restorePii(value, tokens) as T;
  if (Array.isArray(value)) return value.map((v) => restorePiiDeep(v, tokens)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        restorePiiDeep(v, tokens),
      ]),
    ) as T;
  }
  return value;
}

/**
 * RG-M17-09 — contenu client placé dans des balises de données. Les chevrons sont neutralisés
 * pour qu'un message ne puisse pas fermer la balise et injecter des consignes.
 */
export function wrapUntrusted(tag: string, content: string): string {
  const safe = content.replace(/</g, "‹").replace(/>/g, "›");
  return `<${tag}>\n${safe}\n</${tag}>`;
}
