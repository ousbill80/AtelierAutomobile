import fr from "../../messages/fr.json";

type Vars = Record<string, string | number>;

function getPath(obj: unknown, path: string): unknown {
  return resolve(obj, path.split("."));
}

/**
 * Parcourt l'objet segment par segment ; une clé peut elle-même contenir des points
 * (`auditActions["auth.login.failed"]`, `automations.triggers["repair_order.status_changed"]`) :
 * on essaie alors les regroupements de segments, du plus court au plus long.
 */
function resolve(obj: unknown, segments: string[]): unknown {
  if (segments.length === 0) return obj;
  if (!obj || typeof obj !== "object") return undefined;
  const record = obj as Record<string, unknown>;
  for (let i = 1; i <= segments.length; i++) {
    const key = segments.slice(0, i).join(".");
    if (key in record) {
      const found = resolve(record[key], segments.slice(i));
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** Libellé français depuis messages/fr.json : t("auth.signIn.title"). */
export function t(path: string, vars?: Vars): string {
  const raw = getPath(fr, path);
  if (typeof raw !== "string") {
    throw new Error(`Clé de traduction manquante : « ${path} ».`);
  }
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}
