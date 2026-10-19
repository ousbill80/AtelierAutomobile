import { describe, expect, it } from "vitest";
import { clientNamespace, garageNamespace, vehicleNamespace } from "./context";

describe("clientNamespace", () => {
  it("compose la salutation à partir de la civilité et du nom", () => {
    expect(
      clientNamespace({ civility: "M", lastName: "Kouassi", displayName: "Kouassi Jean-Marc" }),
    ).toEqual({
      salutation: "M. Kouassi",
      nomComplet: "Kouassi Jean-Marc",
    });
    expect(
      clientNamespace({ civility: "MME", lastName: "Bamba", displayName: "Bamba Aminata" })
        .salutation,
    ).toBe("Mme Bamba");
  });

  it("sans civilité, retombe sur le nom complet", () => {
    expect(clientNamespace({ displayName: "SOTRA Logistique SARL" }).salutation).toBe(
      "SOTRA Logistique SARL",
    );
  });
});

describe("vehicleNamespace", () => {
  it("formate les champs d'un véhicule", () => {
    expect(
      vehicleNamespace({
        make: "Toyota",
        model: "Corolla",
        plate: "2547 GH 01",
        estimatedMileage: 48200,
      }),
    ).toEqual({
      marque: "Toyota",
      modele: "Corolla",
      plaque: "2547 GH 01",
      kmEstime: "48200 km",
    });
  });

  it("sans véhicule, renvoie des champs vides", () => {
    expect(vehicleNamespace(null)).toEqual({ marque: "", modele: "", plaque: "", kmEstime: "" });
  });
});

describe("garageNamespace", () => {
  it("compose l'adresse et retombe sur des valeurs par défaut", () => {
    expect(
      garageNamespace({
        name: "Garage Yopougon",
        phone: "+2250700000000",
        address: "Rue 12",
        city: "Abidjan",
      }),
    ).toEqual({
      nom: "Garage Yopougon",
      telephone: "+2250700000000",
      adresse: "Rue 12, Abidjan",
      horaires: "Lun-Sam 08h00-19h00",
    });
  });

  it("sans organisation, utilise des valeurs par défaut", () => {
    expect(garageNamespace({})).toEqual({
      nom: "Notre garage",
      telephone: "",
      adresse: "",
      horaires: "Lun-Sam 08h00-19h00",
    });
  });
});
