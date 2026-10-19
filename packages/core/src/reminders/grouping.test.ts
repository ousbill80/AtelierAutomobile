import { describe, expect, it } from "vitest";
import { groupKey, groupReminders, recipientKey, type GroupableReminder } from "./grouping";

describe("recipientKey (RG-M10-14)", () => {
  it("préfère le téléphone à l'email", () => {
    expect(recipientKey({ phoneE164: "+2250708000000", email: "a@b.ci" })).toBe("+2250708000000");
  });

  it("normalise l'email en minuscules", () => {
    expect(recipientKey({ email: "Awa.K@Garage.CI" })).toBe("awa.k@garage.ci");
  });

  it("retourne null sans aucune adresse", () => {
    expect(recipientKey({})).toBeNull();
  });
});

describe("groupKey (RG-M10-15)", () => {
  it("construit la clé standard recipient:type:step:jour", () => {
    const r: GroupableReminder = {
      id: "r1",
      recipientKey: "+2250708000000",
      type: "INSPECTION",
      stepKey: "J-30",
      scheduledDateKey: "2026-10-03",
    };
    expect(groupKey(r)).toBe("+2250708000000:INSPECTION:J-30:2026-10-03");
  });

  it("RECEIVABLE avec dossier : une clé par dossier, pas par palier/jour", () => {
    const r: GroupableReminder = {
      id: "r1",
      recipientKey: "+2250708000000",
      type: "RECEIVABLE",
      stepKey: "J+15",
      scheduledDateKey: "2026-10-10",
      caseId: "case_koné",
    };
    expect(groupKey(r)).toBe("+2250708000000:RECEIVABLE:case_koné");
  });
});

describe("groupReminders (US-M10-05)", () => {
  it("3 véhicules du même client dus le même jour → un seul groupe multi", () => {
    const reminders: GroupableReminder[] = ["v1", "v2", "v3"].map((vehicleId, i) => ({
      id: `r${i}`,
      recipientKey: "+2250708000000",
      type: "INSPECTION",
      stepKey: "J-30",
      scheduledDateKey: "2026-10-03",
      vehicleId,
    }));
    const groups = groupReminders(reminders);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.templateKind).toBe("multi");
    expect(groups[0]?.reminderIds).toEqual(["r0", "r1", "r2"]);
  });

  it("deux fiches en double avec le même téléphone → un seul groupe (dédoublonnage par recipientKey)", () => {
    const reminders: GroupableReminder[] = [
      {
        id: "r1",
        recipientKey: "+2250708000000",
        type: "INSPECTION",
        stepKey: "J-30",
        scheduledDateKey: "2026-10-03",
        vehicleId: "v1",
      },
      {
        id: "r2",
        recipientKey: "+2250708000000",
        type: "INSPECTION",
        stepKey: "J-30",
        scheduledDateKey: "2026-10-03",
        vehicleId: "v1",
      },
    ];
    const groups = groupReminders(reminders);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.reminderIds).toEqual(["r1", "r2"]);
  });

  it("VT + révision du même véhicule le même jour → groupe combo", () => {
    const reminders: GroupableReminder[] = [
      {
        id: "vt1",
        recipientKey: "+2250708000000",
        type: "INSPECTION",
        stepKey: "J0",
        scheduledDateKey: "2026-10-10",
        vehicleId: "v1",
      },
      {
        id: "rev1",
        recipientKey: "+2250708000000",
        type: "SERVICE",
        stepKey: "J-15",
        scheduledDateKey: "2026-10-10",
        vehicleId: "v1",
      },
    ];
    const groups = groupReminders(reminders);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.templateKind).toBe("combo");
    expect(groups[0]?.reminderIds.slice().sort()).toEqual(["rev1", "vt1"]);
  });

  it("VT et révision de véhicules différents ne sont jamais fusionnées en combo", () => {
    const reminders: GroupableReminder[] = [
      {
        id: "vt1",
        recipientKey: "+2250708000000",
        type: "INSPECTION",
        stepKey: "J0",
        scheduledDateKey: "2026-10-10",
        vehicleId: "v1",
      },
      {
        id: "rev1",
        recipientKey: "+2250708000000",
        type: "SERVICE",
        stepKey: "J-15",
        scheduledDateKey: "2026-10-10",
        vehicleId: "v2",
      },
    ];
    const groups = groupReminders(reminders);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.templateKind)).toEqual(["single", "single"]);
  });

  it("au-delà de 10 véhicules, signale la troncature", () => {
    const reminders: GroupableReminder[] = Array.from({ length: 13 }, (_, i) => ({
      id: `r${i}`,
      recipientKey: "+2250708000000",
      type: "INSPECTION",
      stepKey: "J-30",
      scheduledDateKey: "2026-10-03",
      vehicleId: `v${i}`,
    }));
    const groups = groupReminders(reminders);
    expect(groups[0]?.truncatedVehicleCount).toBe(3);
  });

  it("un seul véhicule → groupe single, pas de troncature", () => {
    const reminders: GroupableReminder[] = [
      {
        id: "r1",
        recipientKey: "+2250708000000",
        type: "INSPECTION",
        stepKey: "J-30",
        scheduledDateKey: "2026-10-03",
        vehicleId: "v1",
      },
    ];
    const groups = groupReminders(reminders);
    expect(groups[0]?.templateKind).toBe("single");
    expect(groups[0]?.truncatedVehicleCount).toBeUndefined();
  });
});
