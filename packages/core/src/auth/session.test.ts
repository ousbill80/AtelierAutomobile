import { describe, expect, it } from "vitest";
import {
  computeSessionAbsoluteExpiry,
  isSessionExpired,
  PIN_SESSION_DURATION_HOURS,
  SESSION_ABSOLUTE_DAYS,
  SESSION_INACTIVITY_DAYS,
} from "./session";

describe("computeSessionAbsoluteExpiry", () => {
  it("fixe une expiration à 30 jours pour une session web", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const expiry = computeSessionAbsoluteExpiry(now, false);
    expect(expiry).toEqual(new Date(now.getTime() + SESSION_ABSOLUTE_DAYS * 24 * 60 * 60 * 1000));
  });

  it("fixe une expiration à 12h pour une session PIN", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const expiry = computeSessionAbsoluteExpiry(now, true);
    expect(expiry).toEqual(new Date(now.getTime() + PIN_SESSION_DURATION_HOURS * 60 * 60 * 1000));
  });
});

describe("isSessionExpired", () => {
  const createdAt = new Date("2026-01-01T00:00:00Z");

  it("session web active récemment n'est pas périmée", () => {
    const now = new Date("2026-01-05T00:00:00Z");
    expect(isSessionExpired({ createdAt, lastActiveAt: now, isPinSession: false }, now)).toBe(
      false,
    );
  });

  it("session web périmée après 7 jours d'inactivité", () => {
    const lastActiveAt = new Date("2026-01-02T00:00:00Z");
    const now = new Date(
      lastActiveAt.getTime() + SESSION_INACTIVITY_DAYS * 24 * 60 * 60 * 1000 + 1,
    );
    expect(isSessionExpired({ createdAt, lastActiveAt, isPinSession: false }, now)).toBe(true);
  });

  it("session web périmée après 30 jours même avec activité récente", () => {
    const now = new Date(createdAt.getTime() + SESSION_ABSOLUTE_DAYS * 24 * 60 * 60 * 1000 + 1);
    const lastActiveAt = new Date(now.getTime() - 1000);
    expect(isSessionExpired({ createdAt, lastActiveAt, isPinSession: false }, now)).toBe(true);
  });

  it("session PIN périmée après 12h, indépendamment de l'activité", () => {
    const lastActiveAt = new Date(createdAt.getTime() + 1000);
    const now = new Date(createdAt.getTime() + PIN_SESSION_DURATION_HOURS * 60 * 60 * 1000 + 1);
    expect(isSessionExpired({ createdAt, lastActiveAt, isPinSession: true }, now)).toBe(true);
  });

  it("session PIN encore valide avant 12h", () => {
    const now = new Date(createdAt.getTime() + 1000);
    expect(isSessionExpired({ createdAt, lastActiveAt: now, isPinSession: true }, now)).toBe(false);
  });
});
