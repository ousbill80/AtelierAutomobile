import { describe, expect, it, vi } from "vitest";
import type { Transporter } from "nodemailer";
import { classifySmtpError, createSmtpProvider } from "./smtp";

const credentials = {
  host: "smtp.garage.ci",
  port: 587,
  secure: false,
  username: "no-reply@garage.ci",
  password: "secret",
  fromEmail: "no-reply@garage.ci",
  fromName: "Garage Excellence Auto",
};

function fakeTransporter(overrides: Partial<Transporter> = {}): Transporter {
  return {
    sendMail: vi.fn().mockResolvedValue({ messageId: "msg_123" }),
    verify: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as Transporter;
}

describe("createSmtpProvider.send", () => {
  it("envoie un email via le transporteur et renvoie le messageId", async () => {
    const transporter = fakeTransporter();
    const provider = createSmtpProvider(credentials, { transporter });

    const result = await provider.send({
      organizationId: "org_1",
      to: "client@example.com",
      channel: "EMAIL",
      body: "<p>Bonjour</p>",
      idempotencyKey: "inv:1",
      subject: "Votre facture",
    } as never);

    expect(result).toEqual({ providerMessageId: "msg_123" });
    expect(transporter.sendMail).toHaveBeenCalledWith({
      from: "Garage Excellence Auto <no-reply@garage.ci>",
      to: "client@example.com",
      subject: "Votre facture",
      html: "<p>Bonjour</p>",
    });
  });

  it("classe l'erreur et la relance avec une catégorie", async () => {
    const error = Object.assign(new Error("550 No such user"), { responseCode: 550 });
    const transporter = fakeTransporter({ sendMail: vi.fn().mockRejectedValue(error) });
    const provider = createSmtpProvider(credentials, { transporter });

    await expect(
      provider.send({
        organizationId: "org_1",
        to: "inconnu@example.com",
        channel: "EMAIL",
        body: "x",
        idempotencyKey: "inv:2",
      }),
    ).rejects.toMatchObject({ category: "PERMANENT_RECIPIENT" });
  });
});

describe("classifySmtpError", () => {
  it.each([
    ["535", "PERMANENT_CONFIG"],
    ["534", "PERMANENT_CONFIG"],
    ["550", "PERMANENT_RECIPIENT"],
    ["5.1.1", "PERMANENT_RECIPIENT"],
    ["421", "RATE_LIMIT"],
    ["450", "RATE_LIMIT"],
    ["421", "RATE_LIMIT"],
  ])("classe %s en %s", (code, expected) => {
    expect(classifySmtpError(code)).toBe(expected);
  });
});

describe("createSmtpProvider.healthCheck", () => {
  it("vérifie la connexion via transporter.verify", async () => {
    const transporter = fakeTransporter();
    const provider = createSmtpProvider(credentials, { transporter });
    expect(await provider.healthCheck()).toEqual({ ok: true });
  });

  it("renvoie ok=false si la vérification échoue", async () => {
    const transporter = fakeTransporter({
      verify: vi.fn().mockRejectedValue(new Error("Connexion refusée")),
    });
    const provider = createSmtpProvider(credentials, { transporter });
    expect(await provider.healthCheck()).toEqual({ ok: false, detail: "Connexion refusée" });
  });
});

describe("createSmtpProvider webhooks", () => {
  it("n'a pas de webhook (SMTP brut)", async () => {
    const provider = createSmtpProvider(credentials, { transporter: fakeTransporter() });
    expect(await provider.verifyWebhook(new Request("https://example.com"))).toBe(false);
    expect(await provider.parseWebhook(new Request("https://example.com"))).toEqual([]);
  });
});
