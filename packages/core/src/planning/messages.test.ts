import { describe, expect, it } from "vitest";
import {
  customerGreeting,
  renderAppointmentConfirmation,
  renderAppointmentMoved,
  renderGroupConfirmation,
} from "./messages";

const TZ = "Africa/Abidjan";

describe("messages RDV (US-M03-01, US-M03-03, RG-M03-14)", () => {
  it("rend la confirmation exacte du PRD", () => {
    expect(
      renderAppointmentConfirmation({
        customerGreeting: "M. Kouassi",
        garageName: "Garage Excellence Auto",
        startsAt: new Date("2026-10-24T09:00:00Z"),
        timeZone: TZ,
        type: "SERVICE",
        vehicleLabel: "Toyota Corolla (2547 GH 01)",
      }),
    ).toBe(
      "Bonjour M. Kouassi, votre RDV chez Garage Excellence Auto est confirmé le samedi 24/10/2026 à 09:00 pour la révision de votre Toyota Corolla (2547 GH 01). Répondez 1 pour confirmer, 2 pour déplacer.",
    );
  });

  it("rend le message de déplacement", () => {
    expect(
      renderAppointmentMoved({
        customerGreeting: "M. Koné",
        garageName: "Garage X",
        startsAt: new Date("2026-10-24T11:00:00Z"),
        timeZone: TZ,
        type: "REPAIR",
        vehicleLabel: null,
      }),
    ).toContain("a été déplacé au samedi 24/10/2026 à 11:00 pour la réparation.");
  });

  it("une seule confirmation pour un groupe flotte", () => {
    const body = renderGroupConfirmation({
      contactGreeting: "SOTRA Logistique",
      garageName: "Garage X",
      timeZone: TZ,
      items: [
        { plate: "AB 123 CI", startsAt: new Date("2026-11-03T09:00:00Z") },
        { plate: "CD 456 CI", startsAt: new Date("2026-11-03T08:00:00Z") },
      ],
    });
    expect(body).toContain("vos 2 RDV chez Garage X sont confirmés le mardi 03/11/2026");
    expect(body.indexOf("CD 456 CI à 08:00")).toBeLessThan(body.indexOf("AB 123 CI à 09:00"));
  });

  it("customerGreeting : civilité + nom, sinon nom affiché", () => {
    expect(
      customerGreeting({ civility: "M", lastName: "Kouassi", displayName: "Kouassi Jean-Marc" }),
    ).toBe("M. Kouassi");
    expect(
      customerGreeting({ civility: "MME", lastName: "Bamba", displayName: "Bamba Aminata" }),
    ).toBe("Mme Bamba");
    expect(
      customerGreeting({ civility: null, lastName: null, displayName: "SOTRA Logistique" }),
    ).toBe("SOTRA Logistique");
  });
});
