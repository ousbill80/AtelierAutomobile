import { describe, expect, it } from "vitest";
import {
  REDACTED,
  scrubBreadcrumb,
  scrubErrorEvent,
  scrubText,
  scrubUrl,
  scrubValue,
} from "./sentryScrub";

describe("scrubText", () => {
  it("masque e-mails et numéros de téléphone ivoiriens ou internationaux", () => {
    expect(scrubText("Envoi à kouassi.jm@example.ci échoué")).toBe(`Envoi à ${REDACTED} échoué`);
    expect(scrubText("tel +2250747218890")).toBe(`tel ${REDACTED}`);
    expect(scrubText("tel +225 07 47 21 88 90.")).toBe(`tel ${REDACTED}.`);
    expect(scrubText("appel 07 47 21 88 90 ok")).toBe(`appel ${REDACTED} ok`);
    expect(scrubText("appel 0747218890")).toBe(`appel ${REDACTED}`);
  });

  it("garde les numéros de documents, montants et identifiants cuid2", () => {
    expect(scrubText("FAC-2026-000123 : 185000 FCFA")).toBe("FAC-2026-000123 : 185000 FCFA");
    expect(scrubText("Facture clx8a1b2c3d4e5f6g7h8i9j0k introuvable")).toBe(
      "Facture clx8a1b2c3d4e5f6g7h8i9j0k introuvable",
    );
  });

  it("masque jetons, clés et JWT", () => {
    expect(scrubText("token=dGhpcy1pcy1hLXNlY3JldC10b2tlbg_xyz")).toBe(`token=${REDACTED}`);
    expect(scrubText(`clé ${"a1".repeat(32)}`)).toBe(`clé ${REDACTED}`);
    expect(scrubText("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlLXZhbHVl")).toBe(
      `Bearer ${REDACTED}`,
    );
  });
});

describe("scrubUrl", () => {
  it("retire la chaîne de requête et le jeton du portail", () => {
    expect(scrubUrl("https://app.example.ci/p/AbCdEf123/devis?x=1#y")).toBe(
      `https://app.example.ci/p/${REDACTED}/devis`,
    );
    expect(scrubUrl("/l/K7P2QX")).toBe(`/l/${REDACTED}`);
    expect(scrubUrl("/invitation/abc")).toBe(`/invitation/${REDACTED}`);
    expect(scrubUrl("/ordres/clx8a1b2c3d4e5f6g7h8i9j0k")).toBe("/ordres/clx8a1b2c3d4e5f6g7h8i9j0k");
  });
});

describe("scrubValue", () => {
  it("masque les clés sensibles et parcourt objets et tableaux", () => {
    expect(
      scrubValue({
        password: "x",
        apiKey: "y",
        customerPhone: "+2250747218890",
        nested: [{ note: "écrire à a@b.ci" }, 3, null],
        count: 2,
      }),
    ).toEqual({
      password: REDACTED,
      apiKey: REDACTED,
      customerPhone: REDACTED,
      nested: [{ note: `écrire à ${REDACTED}` }, 3, null],
      count: 2,
    });
  });

  it("borne la profondeur", () => {
    let deep: Record<string, unknown> = { leaf: "ok" };
    for (let i = 0; i < 12; i++) deep = { child: deep };
    expect(JSON.stringify(scrubValue(deep))).toContain(REDACTED);
  });
});

describe("scrubErrorEvent", () => {
  it("supprime utilisateur, cookies, en-têtes, corps et chaîne de requête", () => {
    const event = scrubErrorEvent({
      message: "Échec pour +2250747218890",
      user: { id: "u1", email: "a@b.ci", ip_address: "1.2.3.4" },
      server_name: "web-1",
      request: {
        method: "POST",
        url: "https://app.example.ci/p/secretToken123/facture?phone=0747218890",
        headers: { cookie: "session=abc", authorization: "Bearer x" },
        cookies: { session: "abc" },
        data: { password: "x" },
        query_string: "phone=0747218890",
      },
      exception: { values: [{ type: "DomainError", value: "Client a@b.ci introuvable" }] },
      breadcrumbs: [{ category: "fetch", data: { url: "https://api.x/y?token=abc", status: 500 } }],
      extra: { body: { phone: "+2250747218890" } },
      tags: { org: "clx8a1b2c3d4e5f6g7h8i9j0k" },
    });
    expect(event.user).toBeUndefined();
    expect(event.server_name).toBeUndefined();
    expect(event.request).toEqual({
      method: "POST",
      url: `https://app.example.ci/p/${REDACTED}/facture`,
    });
    expect(event.message).toBe(`Échec pour ${REDACTED}`);
    expect(event.exception?.values?.[0]).toEqual({
      type: "DomainError",
      value: `Client ${REDACTED} introuvable`,
    });
    expect(event.breadcrumbs?.[0]?.data).toEqual({ url: "https://api.x/y", status: 500 });
    expect(event.extra).toEqual({ body: { phone: REDACTED } });
    expect(event.tags).toEqual({ org: "clx8a1b2c3d4e5f6g7h8i9j0k" });
  });

  it("ne modifie pas l'événement d'origine", () => {
    const original = { message: "a@b.ci", user: { id: "1" } };
    scrubErrorEvent(original);
    expect(original).toEqual({ message: "a@b.ci", user: { id: "1" } });
  });
});

describe("scrubBreadcrumb", () => {
  it("masque message et données", () => {
    expect(scrubBreadcrumb({ message: "SMS à 0747218890", data: { otp: "123456" } })).toEqual({
      message: `SMS à ${REDACTED}`,
      data: { otp: REDACTED },
    });
  });
});
