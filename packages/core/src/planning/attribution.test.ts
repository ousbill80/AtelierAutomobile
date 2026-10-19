import { describe, expect, it } from "vitest";
import { attributeReminder } from "./attribution";

const createdAt = new Date("2026-10-24T09:00:00Z");
const days = (n: number) => new Date(createdAt.getTime() - n * 86_400_000);

describe("attributeReminder (RG-M03-12)", () => {
  it("renvoie le reminderId explicite", () => {
    expect(
      attributeReminder({
        customerId: "c1",
        vehicleId: "v1",
        createdAt,
        reminderId: "r-explicit",
        sentReminders: [],
      }),
    ).toBe("r-explicit");
  });

  it("attribue la relance VT la plus récente du même véhicule dans les 14 jours", () => {
    const id = attributeReminder({
      customerId: "c1",
      vehicleId: "v1",
      createdAt,
      sentReminders: [
        { id: "old", customerId: "c1", vehicleId: "v1", type: "INSPECTION", sentAt: days(20) },
        { id: "j30", customerId: "c1", vehicleId: "v1", type: "INSPECTION", sentAt: days(10) },
        { id: "j7", customerId: "c1", vehicleId: "v1", type: "INSPECTION", sentAt: days(3) },
        {
          id: "other-vehicle",
          customerId: "c1",
          vehicleId: "v2",
          type: "SERVICE",
          sentAt: days(1),
        },
        {
          id: "other-customer",
          customerId: "c2",
          vehicleId: "v1",
          type: "SERVICE",
          sentAt: days(1),
        },
        {
          id: "receivable",
          customerId: "c1",
          vehicleId: "v1",
          type: "RECEIVABLE",
          sentAt: days(1),
        },
        { id: "not-sent", customerId: "c1", vehicleId: "v1", type: "INSPECTION", sentAt: null },
      ],
    });
    expect(id).toBe("j7");
  });

  it("renvoie null hors fenêtre ou sans relance", () => {
    expect(
      attributeReminder({
        customerId: "c1",
        vehicleId: "v1",
        createdAt,
        sentReminders: [
          { id: "x", customerId: "c1", vehicleId: "v1", type: "SERVICE", sentAt: days(15) },
        ],
      }),
    ).toBeNull();
    expect(
      attributeReminder({ customerId: "c1", vehicleId: "v1", createdAt, sentReminders: [] }),
    ).toBeNull();
  });
});
