import { describe, expect, it } from "vitest";
import { nextStatus } from "./status";

describe("nextStatus", () => {
  it("avance dans l'ordre QUEUED < SENDING < SENT < DELIVERED < READ", () => {
    expect(nextStatus("QUEUED", "SENDING")).toBe("SENDING");
    expect(nextStatus("SENDING", "SENT")).toBe("SENT");
    expect(nextStatus("SENT", "DELIVERED")).toBe("DELIVERED");
    expect(nextStatus("DELIVERED", "READ")).toBe("READ");
  });

  it("n'écrase jamais un statut plus avancé (webhook désordonné)", () => {
    expect(nextStatus("READ", "DELIVERED")).toBe("READ");
    expect(nextStatus("DELIVERED", "SENT")).toBe("DELIVERED");
    expect(nextStatus("SENT", "QUEUED")).toBe("SENT");
  });

  it("READ avant DELIVERED : le READ est conservé même si DELIVERED arrive après", () => {
    const afterRead = nextStatus("SENT", "READ");
    expect(afterRead).toBe("READ");
    expect(nextStatus(afterRead, "DELIVERED")).toBe("READ");
  });

  it("FAILED n'écrase que QUEUED, SENDING ou SENT", () => {
    expect(nextStatus("QUEUED", "FAILED")).toBe("FAILED");
    expect(nextStatus("SENDING", "FAILED")).toBe("FAILED");
    expect(nextStatus("SENT", "FAILED")).toBe("FAILED");
    expect(nextStatus("DELIVERED", "FAILED")).toBe("DELIVERED");
    expect(nextStatus("READ", "FAILED")).toBe("READ");
  });

  it("un FAILED déjà posé n'est jamais réécrit en place", () => {
    expect(nextStatus("FAILED", "DELIVERED")).toBe("FAILED");
    expect(nextStatus("FAILED", "SENT")).toBe("FAILED");
  });
});
