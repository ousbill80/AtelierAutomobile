import { describe, expect, it } from "vitest";
import { isStartKeyword, isStopKeyword } from "./keywords";

describe("isStopKeyword", () => {
  it.each(["stop", "STOP", "Arrêt !", "arret", "STOP RAPPEL", "Désinscrire", "unsubscribe"])(
    "reconnaît « %s » comme désinscription",
    (text) => {
      expect(isStopKeyword(text)).toBe(true);
    },
  );

  it("« stop j'ai payé hier » (> 3 mots) n'est pas une désinscription automatique", () => {
    expect(isStopKeyword("stop j'ai payé hier")).toBe(false);
  });

  it("« Stop, j'ai déjà payé » n'est pas une désinscription automatique", () => {
    expect(isStopKeyword("Stop, j'ai déjà payé")).toBe(false);
  });

  it("ignore un message sans rapport", () => {
    expect(isStopKeyword("Oui samedi matin")).toBe(false);
  });
});

describe("isStartKeyword", () => {
  it.each(["start", "START", "Reprendre"])("reconnaît « %s » comme réactivation", (text) => {
    expect(isStartKeyword(text)).toBe(true);
  });

  it("ignore un message trop long", () => {
    expect(isStartKeyword("je veux reprendre les rappels svp")).toBe(false);
  });
});
