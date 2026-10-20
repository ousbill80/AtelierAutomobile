import { describe, expect, it } from "vitest";
import {
  anonymizedCustomerName,
  assertCanCancelDeletion,
  isDueForPurge,
  isMutationAllowedInLifecycle,
  isSupportAccessActive,
  planDeletion,
  supportAccessUntil,
} from "./lifecycle";

const NOW = new Date("2026-10-20T10:00:00.000Z");

describe("planDeletion (RG-M15-22, US-M15-09)", () => {
  const base = {
    status: "ACTIVE" as const,
    organizationName: "Garage Excellence Auto",
    confirmName: "garage  excellence auto ",
    pendingFneInvoices: 0,
    now: NOW,
  };

  it("programme la purge à J+30", () => {
    expect(planDeletion(base).scheduledFor.toISOString()).toBe("2026-11-19T10:00:00.000Z");
  });

  it("tolère casse, espaces et accents mais exige le bon nom", () => {
    expect(() => planDeletion({ ...base, confirmName: "Garage Excellénce Auto" })).not.toThrow();
    expect(() => planDeletion({ ...base, confirmName: "Garage Excellence" })).toThrowError(
      expect.objectContaining({ code: "org.deletion_name_mismatch" }),
    );
  });

  it("refuse si des factures FNE sont en attente ou si déjà programmée", () => {
    expect(() => planDeletion({ ...base, pendingFneInvoices: 2 })).toThrowError(
      expect.objectContaining({ code: "org.deletion_fne_pending" }),
    );
    expect(() => planDeletion({ ...base, status: "DELETION_SCHEDULED" })).toThrowError(
      expect.objectContaining({ code: "org.deletion_not_allowed" }),
    );
  });

  it("annulation possible seulement si programmée", () => {
    expect(() => assertCanCancelDeletion("DELETION_SCHEDULED")).not.toThrow();
    expect(() => assertCanCancelDeletion("ACTIVE")).toThrow();
  });
});

describe("lecture seule et purge", () => {
  it("bloque les mutations sauf annulation/export", () => {
    expect(isMutationAllowedInLifecycle("ACTIVE", "site.create")).toBe(true);
    expect(isMutationAllowedInLifecycle("DELETION_SCHEDULED", "site.create")).toBe(false);
    expect(isMutationAllowedInLifecycle("DELETION_SCHEDULED", "org.cancelDeletion")).toBe(true);
    expect(isMutationAllowedInLifecycle("DELETION_SCHEDULED", "dataExport.request")).toBe(true);
    expect(isMutationAllowedInLifecycle("SUSPENDED", "invoice.issue")).toBe(false);
    expect(isMutationAllowedInLifecycle("PURGED", "org.cancelDeletion")).toBe(false);
  });

  it("purge à l'échéance seulement", () => {
    const scheduledFor = new Date("2026-11-19T10:00:00.000Z");
    expect(
      isDueForPurge(
        { lifecycleStatus: "DELETION_SCHEDULED", deletionScheduledFor: scheduledFor },
        NOW,
      ),
    ).toBe(false);
    expect(
      isDueForPurge(
        { lifecycleStatus: "DELETION_SCHEDULED", deletionScheduledFor: scheduledFor },
        new Date("2026-11-19T10:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isDueForPurge(
        { lifecycleStatus: "ACTIVE", deletionScheduledFor: scheduledFor },
        scheduledFor,
      ),
    ).toBe(false);
  });

  it("anonymise de façon stable", () => {
    const name = anonymizedCustomerName("cust_123");
    expect(name).toMatch(/^Client supprimé #[0-9a-f]{8}$/);
    expect(anonymizedCustomerName("cust_123")).toBe(name);
    expect(anonymizedCustomerName("cust_124")).not.toBe(name);
  });
});

describe("accès support (RG-M15-27)", () => {
  it("borne l'accès à 24 h", () => {
    expect(supportAccessUntil(NOW, 24).toISOString()).toBe("2026-10-21T10:00:00.000Z");
    expect(() => supportAccessUntil(NOW, 48)).toThrow();
    expect(isSupportAccessActive(new Date("2026-10-21T10:00:00.000Z"), NOW)).toBe(true);
    expect(isSupportAccessActive(null, NOW)).toBe(false);
  });
});
