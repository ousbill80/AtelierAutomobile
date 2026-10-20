import { describe, expect, it } from "vitest";
import { learnSendPreference, optimizeSendTime, type OutboundStat } from "./sendTime";

const TZ = "Africa/Abidjan";
const NOW = new Date("2026-10-20T08:00:00Z");
const at = (iso: string) => new Date(iso);

describe("RG-M17-16 — meilleur moment et canal", () => {
  it("US-M17-09 — Koné lit ses WhatsApp entre 19 h et 21 h, jamais ses SMS", () => {
    const stats: OutboundStat[] = [
      { channel: "WHATSAPP", sentAt: at("2026-09-01T19:10:00Z"), positive: true },
      { channel: "WHATSAPP", sentAt: at("2026-09-08T20:05:00Z"), positive: true },
      { channel: "WHATSAPP", sentAt: at("2026-09-15T19:40:00Z"), positive: true },
      { channel: "WHATSAPP", sentAt: at("2026-09-22T20:30:00Z"), positive: true },
      { channel: "WHATSAPP", sentAt: at("2026-09-29T09:00:00Z"), positive: false },
      { channel: "SMS", sentAt: at("2026-08-01T09:00:00Z"), positive: false },
      { channel: "SMS", sentAt: at("2026-08-08T09:00:00Z"), positive: false },
      { channel: "SMS", sentAt: at("2026-08-15T10:00:00Z"), positive: false },
    ];
    expect(learnSendPreference(stats, TZ, NOW)).toEqual({ bestHour: 19, bestChannel: "WHATSAPP" });
  });

  it("moins de 5 messages : pas de créneau ; < 3 envois sur un canal : pas de canal", () => {
    const stats: OutboundStat[] = [
      { channel: "WHATSAPP", sentAt: at("2026-09-01T19:10:00Z"), positive: true },
      { channel: "WHATSAPP", sentAt: at("2026-09-08T20:05:00Z"), positive: true },
      { channel: "SMS", sentAt: at("2026-09-08T08:05:00Z"), positive: false },
      { channel: "SMS", sentAt: at("2026-09-09T08:05:00Z"), positive: true },
    ];
    expect(learnSendPreference(stats, TZ, NOW)).toEqual({ bestHour: null, bestChannel: null });
  });

  it("aucun créneau ≥ 1,5 × la moyenne : pas de préférence horaire ; > 12 mois ignorés", () => {
    const flat: OutboundStat[] = Array.from({ length: 6 }, (_, i) => ({
      channel: "SMS" as const,
      sentAt: at(`2026-09-0${i + 1}T${String(8 + i * 2).padStart(2, "0")}:00:00Z`),
      positive: true,
    }));
    expect(learnSendPreference(flat, TZ, NOW).bestHour).toBeNull();
    const old = flat.map((s) => ({ ...s, sentAt: at("2025-01-01T19:00:00Z") }));
    expect(learnSendPreference(old, TZ, NOW)).toEqual({ bestHour: null, bestChannel: null });
  });

  it("US-M17-09 — 09:00 décalé à 19:00 dans la fenêtre 08:00-20:00", () => {
    expect(
      optimizeSendTime({
        scheduledFor: at("2026-10-21T09:00:00Z"),
        bestHour: 19,
        timeZone: TZ,
        sendWindow: { from: "08:00", to: "20:00" },
      })?.toISOString(),
    ).toBe("2026-10-21T19:00:00.000Z");
  });

  it("jamais hors fenêtre, jamais plus de 12 h, jamais en avance", () => {
    const base = { timeZone: TZ, sendWindow: { from: "08:00", to: "19:00" } };
    expect(
      optimizeSendTime({ ...base, scheduledFor: at("2026-10-21T09:00:00Z"), bestHour: 19 }),
    ).toBeNull();
    expect(
      optimizeSendTime({
        ...base,
        sendWindow: { from: "06:00", to: "23:00" },
        scheduledFor: at("2026-10-21T07:00:00Z"),
        bestHour: 20,
      }),
    ).toBeNull();
    expect(
      optimizeSendTime({ ...base, scheduledFor: at("2026-10-21T15:00:00Z"), bestHour: 9 }),
    ).toBeNull();
  });
});
