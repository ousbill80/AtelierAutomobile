import { describe, expect, it } from "vitest";
import { isTrivialPin } from "./pin";

describe("isTrivialPin — RG-M01-14", () => {
  it("rejette les chiffres identiques", () => {
    expect(isTrivialPin("0000")).toBe(true);
    expect(isTrivialPin("1111")).toBe(true);
    expect(isTrivialPin("9999")).toBe(true);
  });

  it("rejette les suites ascendantes", () => {
    expect(isTrivialPin("1234")).toBe(true);
    expect(isTrivialPin("0123")).toBe(true);
    expect(isTrivialPin("6789")).toBe(true);
  });

  it("rejette les suites descendantes", () => {
    expect(isTrivialPin("4321")).toBe(true);
    expect(isTrivialPin("9876")).toBe(true);
  });

  it("accepte un PIN non trivial", () => {
    expect(isTrivialPin("7042")).toBe(false);
    expect(isTrivialPin("2026")).toBe(false);
  });

  it("rejette un format invalide", () => {
    expect(() => isTrivialPin("123")).toThrow("Le code PIN doit comporter 4 chiffres.");
    expect(() => isTrivialPin("12a4")).toThrow();
  });
});
