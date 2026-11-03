import { describe, expect, it } from "vitest";
import { isTrivialPin } from "./pin";

describe("isTrivialPin — RG-M01-14", () => {
  it("rejette les chiffres identiques", () => {
    expect(isTrivialPin("000000")).toBe(true);
    expect(isTrivialPin("111111")).toBe(true);
    expect(isTrivialPin("999999")).toBe(true);
  });

  it("rejette les suites ascendantes", () => {
    expect(isTrivialPin("123456")).toBe(true);
    expect(isTrivialPin("012345")).toBe(true);
    expect(isTrivialPin("456789")).toBe(true);
  });

  it("rejette les suites descendantes", () => {
    expect(isTrivialPin("654321")).toBe(true);
    expect(isTrivialPin("987654")).toBe(true);
  });

  it("accepte un PIN non trivial", () => {
    expect(isTrivialPin("704281")).toBe(false);
    expect(isTrivialPin("202604")).toBe(false);
  });

  it("rejette un format invalide", () => {
    expect(() => isTrivialPin("12345")).toThrow("Le code PIN doit comporter 6 chiffres.");
    expect(() => isTrivialPin("7042")).toThrow("Le code PIN doit comporter 6 chiffres.");
    expect(() => isTrivialPin("12a456")).toThrow();
  });
});
