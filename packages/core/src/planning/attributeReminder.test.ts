import { describe, expect, it } from "vitest";
import { attributeReminder } from "./attributeReminder";

describe("attributeReminder (RG-M03-12)", () => {
  it("garde l'identifiant explicite s'il est fourni", () => {
    const result = attributeReminder({
      explicitReminderId: "rem_explicit",
      customerId: "cust_1",
      vehicleId: "veh_1",
      createdAt: new Date("2026-10-19T00:00:00Z"),
      recentReminders: [],
    });
    expect(result).toBe("rem_explicit");
  });

  it("attribue la relance VT envoyée 10 jours plus tôt sur le même véhicule", () => {
    const result = attributeReminder({
      customerId: "cust_1",
      vehicleId: "veh_1",
      createdAt: new Date("2026-10-19T00:00:00Z"),
      recentReminders: [
        {
          id: "rem_1",
          vehicleId: "veh_1",
          customerId: "cust_1",
          type: "INSPECTION",
          sentAt: new Date("2026-10-09T00:00:00Z"),
        },
      ],
    });
    expect(result).toBe("rem_1");
  });

  it("n'attribue rien au-delà de la fenêtre de 14 jours", () => {
    const result = attributeReminder({
      customerId: "cust_1",
      vehicleId: "veh_1",
      createdAt: new Date("2026-10-19T00:00:00Z"),
      recentReminders: [
        {
          id: "rem_1",
          vehicleId: "veh_1",
          customerId: "cust_1",
          type: "INSPECTION",
          sentAt: new Date("2026-10-04T00:00:00Z"), // 15 jours avant
        },
      ],
    });
    expect(result).toBeNull();
  });

  it("n'attribue pas une relance d'un autre véhicule", () => {
    const result = attributeReminder({
      customerId: "cust_1",
      vehicleId: "veh_1",
      createdAt: new Date("2026-10-19T00:00:00Z"),
      recentReminders: [
        {
          id: "rem_1",
          vehicleId: "veh_2",
          customerId: "cust_1",
          type: "INSPECTION",
          sentAt: new Date("2026-10-09T00:00:00Z"),
        },
      ],
    });
    expect(result).toBeNull();
  });

  it("ignore les types de relance non éligibles (ex. créances)", () => {
    const result = attributeReminder({
      customerId: "cust_1",
      vehicleId: "veh_1",
      createdAt: new Date("2026-10-19T00:00:00Z"),
      recentReminders: [
        {
          id: "rem_1",
          vehicleId: "veh_1",
          customerId: "cust_1",
          type: "RECEIVABLE",
          sentAt: new Date("2026-10-09T00:00:00Z"),
        },
      ],
    });
    expect(result).toBeNull();
  });

  it("attribue la relance la plus récente si plusieurs sont éligibles", () => {
    const result = attributeReminder({
      customerId: "cust_1",
      vehicleId: "veh_1",
      createdAt: new Date("2026-10-19T00:00:00Z"),
      recentReminders: [
        {
          id: "rem_old",
          vehicleId: "veh_1",
          customerId: "cust_1",
          type: "INSPECTION",
          sentAt: new Date("2026-10-06T00:00:00Z"),
        },
        {
          id: "rem_recent",
          vehicleId: "veh_1",
          customerId: "cust_1",
          type: "SERVICE",
          sentAt: new Date("2026-10-12T00:00:00Z"),
        },
      ],
    });
    expect(result).toBe("rem_recent");
  });
});
