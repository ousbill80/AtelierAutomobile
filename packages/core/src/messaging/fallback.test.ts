import { describe, expect, it } from "vitest";
import { fallbackDecision, whatsappFallbackDelayMinutes } from "./fallback";

describe("fallbackDecision", () => {
  it("erreur définitive → repli immédiat", () => {
    expect(fallbackDecision({ situation: "PERMANENT_ERROR" })).toEqual({
      shouldFallback: true,
      immediate: true,
    });
  });

  it("retries épuisés → repli immédiat", () => {
    expect(fallbackDecision({ situation: "TEMPORARY_EXHAUSTED" })).toEqual({
      shouldFallback: true,
      immediate: true,
    });
  });

  it("WhatsApp SENT non délivré après délai → repli une seule fois", () => {
    expect(
      fallbackDecision({ situation: "WHATSAPP_UNDELIVERED_TIMEOUT", alreadyFallenBack: false }),
    ).toEqual({ shouldFallback: true, immediate: false });
    expect(
      fallbackDecision({ situation: "WHATSAPP_UNDELIVERED_TIMEOUT", alreadyFallenBack: true }),
    ).toEqual({ shouldFallback: false, immediate: false });
  });

  it("SMS sans accusé de livraison → jamais de repli", () => {
    expect(fallbackDecision({ situation: "SMS_NO_ACK" })).toEqual({
      shouldFallback: false,
      immediate: false,
    });
  });

  it("délivré ou lu → jamais de repli", () => {
    expect(fallbackDecision({ situation: "DELIVERED_OR_READ" })).toEqual({
      shouldFallback: false,
      immediate: false,
    });
  });
});

describe("whatsappFallbackDelayMinutes", () => {
  it("360 minutes par défaut", () => {
    expect(whatsappFallbackDelayMinutes("RECEIVABLE")).toBe(360);
    expect(whatsappFallbackDelayMinutes(null)).toBe(360);
  });

  it("30 minutes pour véhicule prêt et RDV", () => {
    expect(whatsappFallbackDelayMinutes("VEHICLE_READY")).toBe(30);
    expect(whatsappFallbackDelayMinutes("APPOINTMENT")).toBe(30);
  });

  it("respecte le délai configuré par l'organisation pour les autres types", () => {
    expect(whatsappFallbackDelayMinutes("INSPECTION", 120)).toBe(120);
  });
});
