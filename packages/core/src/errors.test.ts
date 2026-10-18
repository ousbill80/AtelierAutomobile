import { describe, expect, it } from "vitest";
import { DomainError, isDomainError } from "./errors";

describe("DomainError", () => {
  it("porte un code, un message FR et des détails optionnels", () => {
    const error = new DomainError("invoice.already_issued", "Cette facture est déjà émise.", {
      invoiceId: "inv_1",
    });
    expect(error.code).toBe("invoice.already_issued");
    expect(error.message).toBe("Cette facture est déjà émise.");
    expect(error.details).toEqual({ invoiceId: "inv_1" });
    expect(error.name).toBe("DomainError");
    expect(error).toBeInstanceOf(Error);
  });

  it("isDomainError distingue une DomainError d'une erreur générique", () => {
    expect(isDomainError(new DomainError("x", "y"))).toBe(true);
    expect(isDomainError(new Error("plain"))).toBe(false);
    expect(isDomainError("not an error")).toBe(false);
  });
});
