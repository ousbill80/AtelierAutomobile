// M17 — agrégation des procédures par lot de fonctions, fusionnées dans `aiRouter`.
// L'import de chaque module enregistre aussi ses gestionnaires d'acceptation (`accept.ts`).
import { assistantProcedures } from "./assistant";
import "./automations";
import { extractionProcedures } from "./extraction";
import { inboxProcedures } from "./inbox";
import { quotesProcedures } from "./quotes";

export const aiFeatureProcedures = {
  ...inboxProcedures,
  ...quotesProcedures,
  ...extractionProcedures,
  ...assistantProcedures,
};
