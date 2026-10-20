// Libellés des rapports (M12 §7), lus depuis messages/fr.json.
import fr from "../../../../messages/fr.json";

export const R = fr.reports;
export { fmt } from "../tableau-de-bord/labels";

export const columnLabel = (key: string) => (R.columns as Record<string, string>)[key] ?? key;
export const reportText = (slug: string) =>
  (R.list as Record<string, { title: string; description: string }>)[slug] ?? {
    title: slug,
    description: "",
  };
