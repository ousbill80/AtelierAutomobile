import fr from "../../messages/fr.json";

type Vars = Record<string, string | number>;

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
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
