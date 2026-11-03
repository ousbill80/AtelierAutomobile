import { describe, expect, it } from "vitest";
import {
  buildPushContent,
  PUSH_MAX_FAILURES,
  safeInternalLink,
  subscriptionAfterAttempt,
  unreadBadge,
} from "./push";

describe("buildPushContent", () => {
  it("reprend titre, corps et lien de la notification", () => {
    expect(
      buildPushContent({
        id: "n1",
        type: "reminder.escalated",
        title: "Créance à traiter",
        body: "SOTRA Logistique : 450 000 FCFA impayés depuis 45 jours",
        link: "/creances/c1",
      }),
    ).toEqual({
      title: "Créance à traiter",
      body: "SOTRA Logistique : 450 000 FCFA impayés depuis 45 jours",
      link: "/creances/c1",
      tag: "notification:n1",
    });
  });

  it("tronque les textes trop longs et normalise les espaces", () => {
    const content = buildPushContent({
      id: "n2",
      type: "x",
      title: "T".repeat(200),
      body: "a  \n b ".repeat(100),
    });
    expect(content.title).toHaveLength(80);
    expect(content.title.endsWith("…")).toBe(true);
    expect(content.body!.length).toBeLessThanOrEqual(180);
    expect(content.body).not.toMatch(/\s{2}/);
  });

  it("sans titre ni lien : valeurs par défaut", () => {
    const content = buildPushContent({ id: "n3", type: "x", title: "", body: null, link: null });
    expect(content.title).toBe("AtelierOS");
    expect(content.body).toBeNull();
    expect(content.link).toBe("/notifications");
  });
});

describe("safeInternalLink", () => {
  it.each([
    ["/devis/q1", "/devis/q1"],
    ["https://evil.example", "/notifications"],
    ["//evil.example", "/notifications"],
    ["javascript:alert(1)", "/notifications"],
    [undefined, "/notifications"],
  ])("%s → %s", (input, expected) => {
    expect(safeInternalLink(input)).toBe(expected);
  });
});

describe("subscriptionAfterAttempt", () => {
  it("envoi réussi : compteur d'échecs remis à zéro", () => {
    expect(subscriptionAfterAttempt("sent", 3)).toEqual({ action: "keep", failureCount: 0 });
  });
  it("abonnement expiré (404/410) : supprimé", () => {
    expect(subscriptionAfterAttempt("gone", 0)).toEqual({ action: "delete" });
  });
  it("échec : conservé jusqu'au 5e échec consécutif", () => {
    expect(subscriptionAfterAttempt("failed", 0)).toEqual({ action: "keep", failureCount: 1 });
    expect(subscriptionAfterAttempt("failed", PUSH_MAX_FAILURES - 2)).toEqual({
      action: "keep",
      failureCount: PUSH_MAX_FAILURES - 1,
    });
    expect(subscriptionAfterAttempt("failed", PUSH_MAX_FAILURES - 1)).toEqual({ action: "delete" });
  });
});

describe("unreadBadge", () => {
  it.each([
    [0, null],
    [1, "1"],
    [99, "99"],
    [100, "99+"],
  ])("%i → %s", (count, badge) => {
    expect(unreadBadge(count)).toBe(badge);
  });
});
