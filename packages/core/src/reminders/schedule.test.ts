import { describe, expect, it } from "vitest";
import {
  approvalExpiry,
  dedupeKey,
  manualDedupeKey,
  nextSendSlot,
  pickStep,
  promiseBrokenDedupeKey,
  sequenceKey,
  targetDate,
  type AnchorDates,
  type StepHistoryEntry,
} from "./schedule";
import type { ReminderStep, SendWindow } from "./types";

const TZ = "Africa/Abidjan";
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function step(partial: Partial<ReminderStep> & { key: string; offsetDays: number }): ReminderStep {
  return {
    label: partial.key,
    templateKey: "tpl",
    autoSend: true,
    channels: ["WHATSAPP"],
    ...partial,
  };
}

const VT_STEPS: ReminderStep[] = [
  step({ key: "J-30", offsetDays: -30 }),
  step({ key: "J-7", offsetDays: -7 }),
  step({ key: "J0", offsetDays: 0 }),
  step({ key: "J+7", offsetDays: 7 }),
];

describe("sequenceKey / dedupeKey (RG-M10-05)", () => {
  it("construit la clé de séquence US-M10-01", () => {
    expect(sequenceKey("INSPECTION", "veh_8k2", d("2026-11-02"), TZ)).toBe(
      "INSPECTION:veh_8k2:2026-11-02",
    );
  });

  it("construit la clé de dédoublonnage US-M10-01", () => {
    const seq = sequenceKey("INSPECTION", "veh_8k2", d("2026-11-02"), TZ);
    expect(dedupeKey(seq, "J-30")).toBe("INSPECTION:veh_8k2:2026-11-02:J-30");
  });

  it("promesse rompue : clé hors séquence (RG-M10-05)", () => {
    expect(promiseBrokenDedupeKey("case_3f", d("2026-09-10"), "promise_1", TZ)).toBe(
      "RECEIVABLE:case_3f:2026-09-10:PROMISE_BROKEN:promise_1",
    );
  });

  it("relance manuelle : clé horodatée à la minute", () => {
    const seq = sequenceKey("INSPECTION", "veh_1", d("2026-11-02"), TZ);
    expect(manualDedupeKey(seq, new Date("2026-10-18T09:03:00Z"), TZ)).toBe(
      "INSPECTION:veh_1:2026-11-02:MANUAL:202610180903",
    );
  });
});

describe("targetDate", () => {
  it("applique l'offset à l'ancre par défaut", () => {
    const anchors: AnchorDates = { default: d("2026-11-02") };
    expect(
      targetDate(anchors, step({ key: "J-30", offsetDays: -30 }))
        .toISOString()
        .slice(0, 10),
    ).toBe("2026-10-03");
  });

  it("utilise l'ancre sentAt/validUntil si précisée par le palier", () => {
    const anchors: AnchorDates = {
      default: d("2026-11-02"),
      sentAt: d("2026-10-01"),
      validUntil: d("2026-11-20"),
    };
    expect(
      targetDate(anchors, step({ key: "J+2", offsetDays: 2, anchor: "sentAt" }))
        .toISOString()
        .slice(0, 10),
    ).toBe("2026-10-03");
    expect(
      targetDate(anchors, step({ key: "EXPIRE", offsetDays: -1, anchor: "validUntil" }))
        .toISOString()
        .slice(0, 10),
    ).toBe("2026-11-19");
  });
});

describe("pickStep (RG-M10-06/RG-M10-07)", () => {
  const anchors: AnchorDates = { default: d("2026-11-02") }; // VT de M. Kouassi

  it("US-M10-01 : à J-30 exact, choisit J-30", () => {
    const today = d("2026-10-03");
    const result = pickStep(VT_STEPS, anchors, today, []);
    expect(result?.step.key).toBe("J-30");
    expect(result?.catchUp).toBe(false);
  });

  it("ne recrée jamais un palier déjà présent dans l'historique (dédoublonnage)", () => {
    const today = d("2026-10-03");
    const history: StepHistoryEntry[] = [{ stepKey: "J-30", status: "PLANNED" }];
    expect(pickStep(VT_STEPS, anchors, today, history)).toBeNull();
  });

  it("RG-M10-06 — exemple Kouassi : J-30 dû, importé le 18/10, rattrapage dans la fenêtre [03/10 ; 22/10]", () => {
    const today = d("2026-10-18");
    const result = pickStep(VT_STEPS, anchors, today, [], { minGapDays: 3 });
    expect(result?.step.key).toBe("J-30");
    expect(result?.catchUp).toBe(true);
  });

  it("RG-M10-06 — exemple Yao : VT expirée le 12/10 (J0 dû), import le 18/10 hors fenêtre [12/10 ; 15/10] → rien aujourd'hui", () => {
    const yaoAnchors: AnchorDates = { default: d("2026-10-12") };
    const today = d("2026-10-18");
    const result = pickStep(VT_STEPS, yaoAnchors, today, [], { minGapDays: 3 });
    expect(result).toBeNull();
  });

  it("RG-M10-06 — exemple Yao : le 19/10, J+7 (cible 19/10) devient dû et part", () => {
    const yaoAnchors: AnchorDates = { default: d("2026-10-12") };
    const today = d("2026-10-19");
    const result = pickStep(VT_STEPS, yaoAnchors, today, [], { minGapDays: 3 });
    expect(result?.step.key).toBe("J+7");
  });

  it("RG-M10-07 : jamais de palier ≤ à un palier déjà SENT", () => {
    const today = d("2026-11-02"); // J0 serait dû
    const history: StepHistoryEntry[] = [
      { stepKey: "J-7", status: "SENT", sentAt: d("2026-10-26") },
    ];
    // J0 vient après J-7 dans la séquence triée, donc il peut toujours être créé...
    const result = pickStep(VT_STEPS, anchors, today, history, { minGapDays: 3 });
    expect(result?.step.key).toBe("J0");
  });

  it("RG-M10-07 : un palier déjà envoyé plus récent bloque tout palier antérieur ou égal", () => {
    const today = d("2026-10-26"); // J-7 serait dû
    const history: StepHistoryEntry[] = [
      { stepKey: "J0", status: "SENT", sentAt: d("2026-11-02") }, // envoyé en avance via relance manuelle
    ];
    const result = pickStep(VT_STEPS, anchors, today, history, { minGapDays: 3 });
    expect(result).toBeNull();
  });

  it("RG-M10-07 : minGapDays repousse notBefore si le palier est dû moins de 3 j après le dernier envoi", () => {
    const today = d("2026-10-27");
    const history: StepHistoryEntry[] = [
      { stepKey: "J-30", status: "SENT", sentAt: d("2026-10-26") },
    ];
    const result = pickStep(VT_STEPS, anchors, today, history, { minGapDays: 3 });
    expect(result?.step.key).toBe("J-7"); // dû au 26/10, seul palier dû restant
    expect(result?.notBefore?.toISOString().slice(0, 10)).toBe("2026-10-29"); // 26/10 + 3j
  });

  it("dernier palier d'une séquence : rattrapage borné par catchUpDays (défaut 7 j)", () => {
    const today = d("2026-11-16"); // J+7 (cible 09/11) + 7j = 16/11 → encore dans la fenêtre
    const result = pickStep(VT_STEPS, anchors, today, [], { minGapDays: 3, catchUpDays: 7 });
    expect(result?.step.key).toBe("J+7");
  });

  it("dernier palier d'une séquence : hors fenêtre de rattrapage, plus aucun palier n'est créé", () => {
    const today = d("2026-11-17"); // J+7 cible 09/11 + 7j = 16/11 → 17/11 est hors fenêtre
    const result = pickStep(VT_STEPS, anchors, today, [], { minGapDays: 3, catchUpDays: 7 });
    expect(result).toBeNull();
  });
});

describe("nextSendSlot (RG-M10-09)", () => {
  const vtWindow: SendWindow = {
    days: [1, 2, 3, 4, 5, 6],
    from: "08:00",
    to: "19:00",
    preferredTime: "09:00",
  };
  const toussaint = [{ date: d("2026-11-01"), siteId: null }];

  it("exemple RG-M10-09 : J-7 d'une VT au 08/11/2026 → cible dimanche 01/11 (Toussaint) → samedi 31/10 09:00", () => {
    const result = nextSendSlot({
      targetDate: d("2026-11-01"), // 08/11 - 7j
      offsetSign: "before",
      sendWindow: vtWindow,
      holidays: toussaint,
      timeZone: TZ,
      now: new Date("2026-10-03T06:00:00Z"),
    });
    expect(formatInTz(result)).toBe("2026-10-31 09:00");
  });

  it("palier à J0 ou après tombant un jour non ouvré : on recule au jour ouvré suivant", () => {
    // J0 tombe un dimanche 01/11/2026 → palier "on_or_after" doit avancer au lundi 02/11.
    const result = nextSendSlot({
      targetDate: d("2026-11-01"),
      offsetSign: "on_or_after",
      sendWindow: vtWindow,
      holidays: toussaint,
      timeZone: TZ,
      now: new Date("2026-10-03T06:00:00Z"),
    });
    expect(formatInTz(result)).toBe("2026-11-02 09:00");
  });

  it("jour ouvré normal : utilise l'heure préférée telle quelle", () => {
    const result = nextSendSlot({
      targetDate: d("2026-10-20"), // mardi
      offsetSign: "on_or_after",
      sendWindow: vtWindow,
      holidays: [],
      timeZone: TZ,
      now: new Date("2026-10-03T06:00:00Z"),
    });
    expect(formatInTz(result)).toBe("2026-10-20 09:00");
  });

  it("heure imposée du palier (step.sendAt) prévaut sur preferredTime", () => {
    const result = nextSendSlot({
      targetDate: d("2026-10-20"),
      offsetSign: "on_or_after",
      sendAt: "17:00",
      sendWindow: vtWindow,
      holidays: [],
      timeZone: TZ,
      now: new Date("2026-10-03T06:00:00Z"),
    });
    expect(formatInTz(result)).toBe("2026-10-20 17:00");
  });

  it("palier en rattrapage (cible passée, ex. US-M10-01) : jamais planifié dans le passé, ramené à aujourd'hui à l'heure préférée", () => {
    const now = new Date("2026-10-19T06:00:00Z"); // lundi 06:00 UTC, avant la fenêtre
    const result = nextSendSlot({
      targetDate: d("2026-10-03"), // J-30 déjà passé
      offsetSign: "before",
      sendWindow: vtWindow,
      holidays: [],
      timeZone: TZ,
      now,
    });
    expect(formatInTz(result)).toBe("2026-10-19 09:00");
  });

  it("palier en rattrapage dont l'heure préférée est déjà passée aujourd'hui : planifié pour maintenant", () => {
    const now = new Date("2026-10-19T10:00:00Z"); // lundi 10:00, préférée 09:00 déjà passée, fenêtre ouverte
    const result = nextSendSlot({
      targetDate: d("2026-10-03"),
      offsetSign: "before",
      sendWindow: vtWindow,
      holidays: [],
      timeZone: TZ,
      now,
    });
    expect(result.getTime()).toBe(now.getTime());
  });

  it("heure passée mais fenêtre encore ouverte aujourd'hui : planifié pour maintenant (prochain passage du dispatch)", () => {
    const now = new Date("2026-10-20T10:00:00Z"); // mardi 10:00, préférée 09:00 déjà passée, fenêtre ouverte jusqu'à 19:00
    const result = nextSendSlot({
      targetDate: d("2026-10-20"),
      offsetSign: "on_or_after",
      sendWindow: vtWindow,
      holidays: [],
      timeZone: TZ,
      now,
    });
    expect(result.getTime()).toBe(now.getTime());
  });

  it("fenêtre fermée pour aujourd'hui : repoussé au lendemain ouvré à l'heure préférée", () => {
    const now = new Date("2026-10-20T20:00:00Z"); // mardi 20:00, fenêtre fermée (19:00)
    const result = nextSendSlot({
      targetDate: d("2026-10-20"),
      offsetSign: "on_or_after",
      sendWindow: vtWindow,
      holidays: [],
      timeZone: TZ,
      now,
    });
    expect(formatInTz(result)).toBe("2026-10-21 09:00");
  });

  it("dimanche : jamais de créneau le dimanche même en rattrapage", () => {
    const now = new Date("2026-10-18T09:00:00Z"); // dimanche
    const result = nextSendSlot({
      targetDate: d("2026-10-18"),
      offsetSign: "on_or_after",
      sendWindow: vtWindow, // lun-sam
      holidays: [],
      timeZone: TZ,
      now,
    });
    expect(formatInTz(result)).toBe("2026-10-19 09:00"); // lundi
  });

  it("fenêtre créances (lun-ven) : un samedi est traité comme non ouvré", () => {
    const receivableWindow: SendWindow = {
      days: [1, 2, 3, 4, 5],
      from: "08:30",
      to: "18:00",
      preferredTime: "10:00",
    };
    const now = new Date("2026-10-17T06:00:00Z"); // avant le samedi 24/10
    const result = nextSendSlot({
      targetDate: d("2026-10-24"), // samedi
      offsetSign: "on_or_after",
      sendWindow: receivableWindow,
      holidays: [],
      timeZone: TZ,
      now,
    });
    expect(formatInTz(result)).toBe("2026-10-26 10:00"); // lundi suivant
  });
});

function formatInTz(date: Date): string {
  return date.toISOString().slice(0, 16).replace("T", " ");
}

describe("approvalExpiry (RG-M10-19)", () => {
  const anchors: AnchorDates = { default: d("2026-11-02") };

  it("expire au plus tard 7 j après le palier s'il n'y a pas de palier suivant", () => {
    const expiry = approvalExpiry(VT_STEPS, anchors, VT_STEPS[3]!); // J+7, dernier palier
    expect(expiry.toISOString().slice(0, 10)).toBe("2026-11-16"); // cible 09/11 + 7j
  });

  it("plafonne à +7 j même si le palier suivant est encore loin", () => {
    // J-30 (cible 03/10), suivant J-7 (cible 26/10) : veille = 25/10, mais 03/10+7j = 10/10 est plus tôt.
    const expiry = approvalExpiry(VT_STEPS, anchors, VT_STEPS[0]!);
    expect(expiry.toISOString().slice(0, 10)).toBe("2026-10-10");
  });

  it("expire la veille du palier suivant si c'est plus tôt que +7 j", () => {
    // J0 (cible 02/11), suivant J+7 (cible 09/11) : veille = 08/11, plus tôt que 02/11+7j = 09/11.
    const expiry = approvalExpiry(VT_STEPS, anchors, VT_STEPS[2]!);
    expect(expiry.toISOString().slice(0, 10)).toBe("2026-11-08");
  });
});
