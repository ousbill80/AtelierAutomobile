// RG-M04-16 / RG-M04-17 / US-M04-06 — inspection multipoints.
import type { InspectionResult, RepairOrderStatus } from "./types";

const SEVERITY: Record<InspectionResult, number> = {
  NOT_CHECKED: 0,
  OK: 1,
  WATCH: 2,
  URGENT: 3,
};

/** Résultat global d'une catégorie = pire résultat de ses items (URGENT > WATCH > OK). */
export function worstResult(results: readonly InspectionResult[]): InspectionResult {
  return results.reduce<InspectionResult>(
    (worst, r) => (SEVERITY[r] > SEVERITY[worst] ? r : worst),
    "NOT_CHECKED",
  );
}

export interface InspectionItemLike {
  category: string;
  result: InspectionResult;
  recommendedProductIds: readonly string[];
  recommendedLaborIds: readonly string[];
}

export interface InspectionSummary {
  urgent: number;
  watch: number;
  ok: number;
  notChecked: number;
  /** Items URGENT/WATCH sans recommandation (signalés, non bloquants). */
  withoutRecommendation: number;
  /** Items URGENT/WATCH avec recommandations (alimentent le devis). */
  withRecommendation: number;
}

function hasRecommendation(item: InspectionItemLike): boolean {
  return item.recommendedProductIds.length > 0 || item.recommendedLaborIds.length > 0;
}

export function summarizeInspection(items: readonly InspectionItemLike[]): InspectionSummary {
  const summary: InspectionSummary = {
    urgent: 0,
    watch: 0,
    ok: 0,
    notChecked: 0,
    withoutRecommendation: 0,
    withRecommendation: 0,
  };
  for (const item of items) {
    if (item.result === "URGENT") summary.urgent += 1;
    else if (item.result === "WATCH") summary.watch += 1;
    else if (item.result === "OK") summary.ok += 1;
    else summary.notChecked += 1;
    if (item.result === "URGENT" || item.result === "WATCH") {
      if (hasRecommendation(item)) summary.withRecommendation += 1;
      else summary.withoutRecommendation += 1;
    }
  }
  return summary;
}

/** Résultat global par catégorie, dans l'ordre d'apparition. */
export function categoryResults(
  items: readonly Pick<InspectionItemLike, "category" | "result">[],
): { category: string; result: InspectionResult }[] {
  const order: string[] = [];
  const byCategory = new Map<string, InspectionResult[]>();
  for (const item of items) {
    if (!byCategory.has(item.category)) {
      order.push(item.category);
      byCategory.set(item.category, []);
    }
    byCategory.get(item.category)!.push(item.result);
  }
  return order.map((category) => ({ category, result: worstResult(byCategory.get(category)!) }));
}

/**
 * US-M04-06 : à la clôture, l'OR passe DIAGNOSING → AWAITING_APPROVAL si au moins un item
 * URGENT/WATCH a des recommandations ; sinon il reste dans son statut.
 */
export function statusAfterInspection(
  status: RepairOrderStatus,
  summary: InspectionSummary,
): RepairOrderStatus {
  if ((status === "DIAGNOSING" || status === "CHECKED_IN") && summary.withRecommendation > 0) {
    return "AWAITING_APPROVAL";
  }
  return status;
}

/** Message de notification au réceptionnaire. */
export function inspectionCompletedMessage(number: string, summary: InspectionSummary): string {
  return `Inspection terminée — ${number} : ${summary.urgent} urgent${summary.urgent > 1 ? "s" : ""}, ${summary.watch} à surveiller`;
}

export interface InspectionTemplateItem {
  category: string;
  label: string;
  measurementUnit?: string;
  recommendedLaborCode?: string;
  recommendedProductCategory?: string;
}

/** RG-M04-16 — modèles semés (en plus de « Inspection 30 points » de l'onboarding). */
export function extraInspectionTemplates(): { name: string; items: InspectionTemplateItem[] }[] {
  return [
    {
      name: "Pré-visite technique",
      items: [
        { category: "Freinage", label: "Efficacité du freinage" },
        { category: "Freinage", label: "Frein de stationnement" },
        { category: "Éclairage", label: "Feux de croisement et de route" },
        { category: "Éclairage", label: "Feux stop et clignotants" },
        { category: "Pneumatiques", label: "Usure des pneus", measurementUnit: "mm" },
        { category: "Direction / Suspension", label: "Jeu de direction" },
        { category: "Direction / Suspension", label: "Amortisseurs" },
        { category: "Carrosserie", label: "Pare-brise et essuie-glaces" },
        { category: "Carrosserie", label: "Rétroviseurs" },
        { category: "Échappement", label: "Fuites et fixation" },
        { category: "Échappement", label: "Opacité / émissions" },
        { category: "Divers", label: "Avertisseur sonore" },
        { category: "Divers", label: "Ceintures de sécurité" },
        { category: "Divers", label: "Triangle, gilet et extincteur" },
      ],
    },
    {
      name: "Inspection achat véhicule d'occasion",
      items: [
        { category: "Moteur", label: "Démarrage à froid" },
        { category: "Moteur", label: "Fuites d'huile" },
        { category: "Moteur", label: "Courroie de distribution" },
        { category: "Transmission", label: "Embrayage" },
        { category: "Transmission", label: "Boîte de vitesses" },
        { category: "Freinage", label: "Disques et plaquettes" },
        { category: "Direction / Suspension", label: "Trains roulants" },
        { category: "Carrosserie", label: "Traces de choc ou de mastic" },
        { category: "Carrosserie", label: "Corrosion" },
        { category: "Électricité", label: "Voyants au tableau de bord" },
        { category: "Électricité", label: "Climatisation" },
        { category: "Divers", label: "Concordance carte grise / numéro de série" },
      ],
    },
  ];
}
