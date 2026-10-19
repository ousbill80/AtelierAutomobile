import { describe, expect, it } from "vitest";
import { validateOpeningHours } from "./opening-hours";

describe("validateOpeningHours (RG-M15-07)", () => {
  it("accepte des horaires valides (US-M15-03 : lun-ven 07:30–18:00, sam 08:00–14:00)", () => {
    expect(() =>
      validateOpeningHours({
        mon: [["07:30", "18:00"]],
        tue: [["07:30", "18:00"]],
        wed: [["07:30", "18:00"]],
        thu: [["07:30", "18:00"]],
        fri: [["07:30", "18:00"]],
        sat: [["08:00", "14:00"]],
        sun: [],
      }),
    ).not.toThrow();
  });

  it("accepte une pause déjeuner (deux plages non chevauchantes le même jour)", () => {
    expect(() =>
      validateOpeningHours({
        mon: [
          ["07:30", "12:00"],
          ["13:00", "18:00"],
        ],
      }),
    ).not.toThrow();
  });

  it("refuse un jour inconnu", () => {
    expect(() => validateOpeningHours({ foo: [["08:00", "18:00"]] } as never)).toThrow(
      /Jour inconnu/,
    );
  });

  it("refuse une heure de fin avant ou égale à l'heure de début", () => {
    expect(() => validateOpeningHours({ mon: [["18:00", "08:00"]] })).toThrow(/après l'heure/);
    expect(() => validateOpeningHours({ mon: [["08:00", "08:00"]] })).toThrow(/après l'heure/);
  });

  it("refuse un pas inférieur à 15 minutes", () => {
    expect(() => validateOpeningHours({ mon: [["08:00", "08:10"]] })).toThrow(
      /multiple de 15 minutes/,
    );
  });

  it("refuse des plages qui se chevauchent", () => {
    expect(() =>
      validateOpeningHours({
        mon: [
          ["07:30", "13:00"],
          ["12:00", "18:00"],
        ],
      }),
    ).toThrow(/se chevauchent/);
  });

  it("refuse un format d'heure invalide", () => {
    expect(() => validateOpeningHours({ mon: [["7:30", "18:00"]] })).toThrow(/Horaire invalide/);
    expect(() => validateOpeningHours({ mon: [["25:00", "18:00"]] })).toThrow(/Horaire invalide/);
  });

  it("accepte un site fermé toute la semaine ({} ou tableaux vides)", () => {
    expect(() => validateOpeningHours({})).not.toThrow();
    expect(() => validateOpeningHours({ mon: [], sun: [] })).not.toThrow();
  });
});
