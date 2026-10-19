import { describe, expect, it } from "vitest";
import {
  customerSalutation,
  describeDueCountdown,
  formatVehicleDueList,
  lateDays,
  receivablesSummary,
} from "./variables";

describe("customerSalutation", () => {
  it("vouvoie un particulier avec civilité connue", () => {
    expect(
      customerSalutation({
        type: "INDIVIDUAL",
        civility: "M",
        firstName: "Jean-Marc",
        lastName: "Kouassi",
        displayName: "Kouassi Jean-Marc",
      }),
    ).toBe("M. Kouassi");
    expect(
      customerSalutation({
        type: "INDIVIDUAL",
        civility: "MME",
        lastName: "Bamba",
        displayName: "Bamba Awa",
      }),
    ).toBe("Mme Bamba");
  });

  it("retombe sur le nom affiché sans civilité", () => {
    expect(customerSalutation({ type: "INDIVIDUAL", displayName: "Kouassi Jean-Marc" })).toBe(
      "Kouassi Jean-Marc",
    );
  });

  it("utilise la raison sociale pour une entreprise", () => {
    expect(
      customerSalutation({
        type: "COMPANY",
        companyName: "SOTRA Logistique SARL",
        displayName: "SOTRA Logistique SARL",
      }),
    ).toBe("SOTRA Logistique SARL");
  });
});

describe("describeDueCountdown", () => {
  it("affiche J-N pour une échéance future", () => {
    expect(
      describeDueCountdown(
        new Date("2026-11-02T00:00:00.000Z"),
        new Date("2026-10-18T00:00:00.000Z"),
      ),
    ).toBe("J-15");
  });

  it("affiche Aujourd'hui le jour J", () => {
    expect(
      describeDueCountdown(
        new Date("2026-10-18T00:00:00.000Z"),
        new Date("2026-10-18T00:00:00.000Z"),
      ),
    ).toBe("Aujourd'hui");
  });

  it("affiche le retard pour une échéance passée", () => {
    expect(
      describeDueCountdown(
        new Date("2026-10-12T00:00:00.000Z"),
        new Date("2026-10-18T00:00:00.000Z"),
      ),
    ).toBe("Expirée depuis 6 j");
  });
});

describe("lateDays", () => {
  it("retourne 0 si non échue", () => {
    expect(
      lateDays(new Date("2026-10-20T00:00:00.000Z"), new Date("2026-10-18T00:00:00.000Z")),
    ).toBe(0);
  });
  it("retourne le nombre de jours de retard", () => {
    expect(
      lateDays(new Date("2026-09-10T00:00:00.000Z"), new Date("2026-10-18T00:00:00.000Z")),
    ).toBe(38);
  });
});

describe("receivablesSummary", () => {
  it("compose le résumé avec retard", () => {
    expect(
      receivablesSummary({
        invoiceCount: 4,
        totalAmount: 412_000,
        oldestDueDate: new Date("2026-09-10T00:00:00.000Z"),
        today: new Date("2026-10-18T00:00:00.000Z"),
      }),
    ).toBe("4 factures — 412 000 FCFA, retard 38 j");
  });

  it("omet le retard si l'échéance la plus ancienne n'est pas passée", () => {
    expect(
      receivablesSummary({
        invoiceCount: 1,
        totalAmount: 50_000,
        oldestDueDate: new Date("2026-10-20T00:00:00.000Z"),
        today: new Date("2026-10-18T00:00:00.000Z"),
      }),
    ).toBe("1 facture — 50 000 FCFA");
  });
});

describe("formatVehicleDueList", () => {
  it("rend une ligne par véhicule", () => {
    expect(
      formatVehicleDueList(
        [
          { label: "Toyota Hilux 3315 KL 01", dueDate: new Date("2026-11-05T00:00:00.000Z") },
          { label: "Toyota Corolla 2547 GH 01", dueDate: new Date("2026-11-10T00:00:00.000Z") },
        ],
        "Africa/Abidjan",
      ),
    ).toBe(
      "• Toyota Hilux 3315 KL 01 : expire le 05/11/2026\n• Toyota Corolla 2547 GH 01 : expire le 10/11/2026",
    );
  });
});
