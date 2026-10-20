import { describe, expect, it } from "vitest";
import {
  getCiPopularMakes,
  getCiVehicleMakes,
  getCiVehicleModels,
  searchCiCatalog,
} from "./ci-catalog";

describe("CI Vehicle Catalog", () => {
  it("contient les marques majeures de Côte d'Ivoire", () => {
    const makes = getCiVehicleMakes();
    expect(makes).toContain("Toyota");
    expect(makes).toContain("Peugeot");
    expect(makes).toContain("Hyundai");
    expect(makes).toContain("Kia");
    expect(makes).toContain("Nissan");
    expect(makes).toContain("Mitsubishi");
    expect(makes).toContain("Suzuki");
    expect(makes).toContain("Renault");
    expect(makes).toContain("Mercedes-Benz");
    expect(makes).toContain("Changan");
    expect(makes).toContain("Great Wall / Haval");
  });

  it("identifie les marques les plus populaires", () => {
    const popular = getCiPopularMakes();
    expect(popular).toContain("Toyota");
    expect(popular).toContain("Peugeot");
    expect(popular).toContain("Hyundai");
  });

  it("renvoie les modèles pour Toyota", () => {
    const models = getCiVehicleModels("Toyota");
    expect(models).toContain("Hilux");
    expect(models).toContain("Land Cruiser");
    expect(models).toContain("RAV4");
    expect(models).toContain("Corolla");
  });

  it("recherche des modèles avec casse mixte", () => {
    const models = getCiVehicleModels("toyota");
    expect(models).toContain("Hilux");
  });

  it("recherche des véhicules dans le catalogue", () => {
    const results = searchCiCatalog("hilux");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.make).toBe("Toyota");
    expect(results[0]?.model).toBe("Hilux");
  });
});
