// M14 §12 — filtrage des DTO publics : seules les clés listées ici peuvent sortir vers le
// portail (test par instantané des clés autorisées). Aucune clé interne (prix d'achat, notes
// internes, mécanicien, identifiants d'organisation/client) n'y figure.

export const PORTAL_TRACKING_KEYS = [
  "garage",
  "number",
  "vehicle",
  "status",
  "statusLabel",
  "cancelled",
  "timelineIndex",
  "steps",
  "promisedAt",
  "complaint",
  "signaturePending",
  "findings",
  "lines",
  "pendingLines",
  "total",
  "photos",
  "notes",
  "documents",
  "version",
  "ready",
] as const;

export const PORTAL_VEHICLE_KEYS = ["garage", "vehicle", "deadlines", "visits"] as const;

/** Clés interdites partout dans un DTO public, à n'importe quelle profondeur. */
export const PORTAL_FORBIDDEN_KEYS = [
  "organizationId",
  "customerId",
  "costPrice",
  "purchasePrice",
  "unitCost",
  "margin",
  "internalNote",
  "internalNotes",
  "technicianId",
  "assignedToId",
  "mechanicId",
  "authorId",
  "createdById",
  "tokenHash",
  "phone2",
  "email",
] as const;

/** Liste les clés interdites trouvées (chemin pointé) dans une valeur JSON. */
export function findForbiddenKeys(value: unknown, path = ""): string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => found.push(...findForbiddenKeys(v, `${path}[${i}]`)));
  } else if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      if ((PORTAL_FORBIDDEN_KEYS as readonly string[]).includes(k)) found.push(p);
      found.push(...findForbiddenKeys(v, p));
    }
  }
  return found;
}

/** Garde : ne garde que les clés autorisées au premier niveau. */
export function pickAllowed<T extends Record<string, unknown>>(
  value: T,
  allowed: readonly string[],
): Partial<T> {
  const out: Partial<T> = {};
  for (const key of allowed) {
    if (key in value) (out as Record<string, unknown>)[key] = value[key];
  }
  return out;
}

/** Message de renvoi de lien (US « Recevoir un nouveau lien ») : jamais d'autre donnée client. */
export function newLinkMessage(garageName: string, url: string): string {
  return `${garageName} : voici votre nouveau lien : ${url}`;
}
