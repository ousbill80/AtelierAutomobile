import { describe, expect, it } from "vitest";
import {
  buildQuoteDraftLines,
  fallbackQuoteDraftLines,
  isUnpricedPlaceholder,
  selectQuoteCandidates,
  type DraftCatalogLabor,
  type DraftCatalogProduct,
  type DraftNeed,
} from "./quoteDraft";

// US-M17-03 — OR-YOP-2026-00042 : bruit au freinage ; plaquettes AV URGENT 2 mm, disques AV
// WATCH, vidange dépassée.
const needs: DraftNeed[] = [
  {
    key: "insp:i1",
    label: "Plaquettes avant",
    priority: "URGENT",
    measurement: "2 mm",
    inspectionItemId: "i1",
    category: "Freinage",
  },
  {
    key: "insp:i2",
    label: "Disques avant",
    priority: "WATCH",
    inspectionItemId: "i2",
    category: "Freinage",
  },
  {
    key: "insp:i3",
    label: "Vidange",
    priority: "URGENT",
    inspectionItemId: "i3",
    comment: "dépassée de 1 200 km",
  },
  { key: "complaint", label: "bruit au freinage", priority: null },
];
const products: DraftCatalogProduct[] = [
  {
    id: "p_plaq",
    name: "Plaquettes AV Corolla 2014-2019",
    category: "Freinage",
    compatibleWith: ["TOYOTA|COROLLA|2014-2019"],
  },
  {
    id: "p_plaq_kia",
    name: "Plaquettes AV Kia Picanto",
    category: "Freinage",
    compatibleWith: ["KIA|PICANTO|*"],
  },
  { id: "p_huile", name: "Huile 5W30", category: "Lubrifiants", compatibleWith: [] },
  { id: "p_filtre", name: "Filtre à huile", category: "Filtration", compatibleWith: [] },
  { id: "p_essuie", name: "Balai essuie-glace", category: "Visibilité", compatibleWith: [] },
];
const labor: DraftCatalogLabor[] = [
  { id: "l_plaq", name: "Remplacement plaquettes AV", category: "Freinage", standardHours: 0.8 },
  { id: "l_vid", name: "Vidange + filtre", category: "Entretien", standardHours: 0.5 },
];
const vehicle = { make: "Toyota", model: "Corolla", year: 2018 };

describe("RG-M17-13 — candidats du catalogue", () => {
  it("garde les articles pertinents et compatibles, exclut les autres véhicules", () => {
    const { candidates, compatibilityChecked } = selectQuoteCandidates({
      needs,
      complaint: "bruit au freinage",
      vehicle,
      products,
      labor,
    });
    const ids = candidates.map((c) => c.catalogId);
    expect(compatibilityChecked).toBe(true);
    expect(ids).toEqual(
      expect.arrayContaining(["p_plaq", "p_huile", "p_filtre", "l_plaq", "l_vid"]),
    );
    expect(ids).not.toContain("p_plaq_kia");
    expect(ids).not.toContain("p_essuie");
    expect(candidates.find((c) => c.catalogId === "l_plaq")!.standardHours).toBe(0.8);
  });

  it("véhicule sans marque/modèle : pas de filtre de compatibilité", () => {
    const r = selectQuoteCandidates({ needs, vehicle: {}, products, labor });
    expect(r.compatibilityChecked).toBe(false);
    expect(r.candidates.map((c) => c.catalogId)).toContain("p_plaq_kia");
  });

  it("plafonne à 80 candidats, recommandations d'abord", () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      id: `f${i}`,
      name: `Plaquettes ${i}`,
      compatibleWith: [],
    }));
    const r = selectQuoteCandidates({
      needs: [{ ...needs[0]!, recommendedProductIds: ["f119"] }],
      vehicle,
      products: many,
      labor: [],
    });
    expect(r.candidates).toHaveLength(80);
    expect(r.candidates[0]!.catalogId).toBe("f119");
  });
});

describe("RG-M17-13 — lignes du brouillon", () => {
  const { candidates } = selectQuoteCandidates({ needs, vehicle, products, labor });

  it("MO au temps barème, catalogId étranger rejeté, WATCH optionnel, besoin non couvert à chiffrer", () => {
    const result = buildQuoteDraftLines({
      candidates,
      needs,
      aiLines: [
        {
          kind: "LABOR",
          catalogId: "l_plaq",
          quantity: 5,
          reason: "Inspection : plaquettes 2 mm",
          priority: "URGENT",
          optional: false,
          need: "Plaquettes avant",
        },
        {
          kind: "PART",
          catalogId: "p_plaq",
          quantity: 1,
          reason: "Inspection : plaquettes 2 mm",
          priority: "URGENT",
          optional: false,
          need: "Plaquettes avant",
        },
        {
          kind: "PART",
          catalogId: "p_foreign",
          quantity: 1,
          reason: "x",
          priority: null,
          optional: false,
        },
        {
          kind: "PART",
          catalogId: "l_vid",
          quantity: 1,
          reason: "type faux",
          priority: null,
          optional: false,
        },
        {
          kind: "LABOR",
          catalogId: "l_vid",
          quantity: 3,
          reason: "Vidange dépassée",
          priority: "URGENT",
          optional: false,
          need: "Vidange",
        },
        {
          kind: "PART",
          catalogId: "p_huile",
          quantity: 4,
          reason: "Vidange",
          priority: "URGENT",
          optional: false,
          need: "Vidange",
        },
        {
          kind: "PART",
          catalogId: null,
          quantity: 1,
          reason: "Inspection : disques à surveiller",
          priority: "WATCH",
          optional: true,
          need: "Disques avant",
        },
      ],
    });
    expect(result.rejected).toBe(2);
    const plaq = result.lines.find((l) => l.catalogId === "l_plaq")!;
    expect(plaq.quantity).toBe(0.8);
    expect(plaq.groupKey).toBe("insp:i1");
    expect(result.lines.find((l) => l.catalogId === "l_vid")!.quantity).toBe(0.5);
    expect(result.lines.find((l) => l.catalogId === "p_huile")!.quantity).toBe(4);
    const disques = result.lines.find((l) => l.groupKey === "insp:i2")!;
    expect(disques).toMatchObject({
      toPrice: true,
      optional: true,
      catalogId: null,
      description: "À chiffrer : disques avant (non trouvée au catalogue)",
    });
    expect(result.unmatched).toEqual(["Disques avant"]);
  });

  it("un point URGENT oublié par l'IA est ajouté « À chiffrer »", () => {
    const result = buildQuoteDraftLines({ candidates, needs, aiLines: [] });
    expect(result.lines.filter((l) => l.toPrice).map((l) => l.groupLabel)).toEqual([
      "Plaquettes avant",
      "Disques avant",
      "Vidange",
    ]);
  });

  it("repli sans IA : lignes recommandées de l'inspection", () => {
    const result = fallbackQuoteDraftLines({
      needs: [
        { ...needs[0]!, recommendedLaborIds: ["l_plaq"], recommendedProductIds: ["p_plaq"] },
        needs[1]!,
      ],
      products,
      labor,
    });
    expect(result.lines.map((l) => l.catalogId)).toEqual(["l_plaq", "p_plaq", null]);
    expect(result.lines[0]!.quantity).toBe(0.8);
  });

  it("ligne à chiffrer détectée tant que le prix est 0", () => {
    expect(
      isUnpricedPlaceholder({
        description: "À chiffrer : disques avant (non trouvée au catalogue)",
        unitPrice: 0,
      }),
    ).toBe(true);
    expect(
      isUnpricedPlaceholder({ description: "À chiffrer : disques avant", unitPrice: 45000 }),
    ).toBe(false);
    expect(isUnpricedPlaceholder({ description: "Huile", unitPrice: 0 })).toBe(false);
  });
});
