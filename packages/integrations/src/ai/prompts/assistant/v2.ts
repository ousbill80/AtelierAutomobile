// M17 RG-M17-05/20 — prompt de l'assistant, v2 : l'outil `get_kpi` couvre les indicateurs M12
// (`dashboard.kpi` : CA HT/TTC, marges, panier moyen, encaissements, créances, récupéré par
// relances, acceptation des devis), avec comparaison à la période précédente. Le système et
// les autres outils sont ceux de la v1.
import type { AiToolDef } from "../../types";
import { ASSISTANT_TOOLS as V1_TOOLS } from "./v1";

export {
  ASSISTANT_DENIED_TEXT,
  ASSISTANT_MAX_TOOL_CALLS,
  ASSISTANT_NOT_FOUND_CUSTOMER_TEXT,
  assistantSystemPrompt,
} from "./v1";

export const ASSISTANT_PROMPT_VERSION = "v2";

const KPI_TOOL: AiToolDef = {
  name: "get_kpi",
  description:
    "Indicateur du tableau de bord (mêmes chiffres que les écrans) : revenue_ht / revenue_ttc (chiffre d'affaires facturé), parts_margin, labor_margin, gross_margin (marges), avg_ticket (panier moyen), collected (encaissements), receivables (créances à ce jour), recovered_by_reminders (encaissé grâce aux relances), quote_acceptance (taux d'acceptation des devis). compare = true ajoute la période précédente.",
  inputSchema: {
    type: "object",
    properties: {
      metric: {
        type: "string",
        enum: [
          "revenue_ht",
          "revenue_ttc",
          "parts_margin",
          "labor_margin",
          "gross_margin",
          "avg_ticket",
          "collected",
          "receivables",
          "recovered_by_reminders",
          "quote_acceptance",
        ],
      },
      period: {
        type: "string",
        enum: ["today", "yesterday", "7d", "month", "prev_month", "30d"],
        description: "Période (défaut : month = mois en cours).",
      },
      siteId: { type: "string" },
      compare: { type: "boolean" },
    },
    required: ["metric"],
    additionalProperties: false,
  },
};

export const ASSISTANT_TOOLS: AiToolDef[] = V1_TOOLS.map((tool) =>
  tool.name === "get_kpi" ? KPI_TOOL : tool,
);
