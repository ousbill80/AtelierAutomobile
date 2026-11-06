import { describe, expect, it, vi } from "vitest";
import {
  createPlatformMessagingProvider,
  platformOtpChannels,
  PlatformOtpDeliveryError,
  readPlatformMessagingConfig,
  sendPlatformOtp,
} from "./messaging";

const WHATSAPP_ENV = {
  PLATFORM_WHATSAPP_PHONE_ID: "1234567890",
  PLATFORM_WHATSAPP_TOKEN: "wa_token_fictif",
  PLATFORM_WHATSAPP_OTP_TEMPLATE: "atelieros_otp",
};
const SMS_ENV = {
  PLATFORM_SMS_PROVIDER: "twilio",
  PLATFORM_SMS_CREDENTIALS: JSON.stringify({
    accountSid: "AC_fictif",
    authToken: "tw_token_fictif",
    fromNumber: "AtelierOS",
  }),
};
const EMAIL_ENV = {
  PLATFORM_EMAIL_PROVIDER: "resend",
  PLATFORM_EMAIL_CREDENTIALS: JSON.stringify({ apiKey: "re_fictif" }),
  PLATFORM_EMAIL_FROM: "codes@atelieros.ci",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const OTP_INPUT = {
  to: "+2250708123456",
  code: "482913",
  body: "AtelierOS : votre code est 482913.",
  subject: "Votre code AtelierOS",
  templateKey: "otp.verify",
  idempotencyKey: "otp:+2250708123456:VERIFY:1",
};

describe("readPlatformMessagingConfig", () => {
  it("renvoie une configuration vide sans aucune variable", () => {
    expect(readPlatformMessagingConfig({})).toEqual({});
  });

  it("lit les trois canaux, avec langue et nom d'expéditeur par défaut", () => {
    const config = readPlatformMessagingConfig({ ...WHATSAPP_ENV, ...SMS_ENV, ...EMAIL_ENV });
    expect(config.whatsapp).toEqual({
      phoneNumberId: "1234567890",
      accessToken: "wa_token_fictif",
      otpTemplate: "atelieros_otp",
      otpTemplateLanguage: "fr",
    });
    expect(config.sms?.provider).toBe("twilio");
    expect(config.email).toMatchObject({
      provider: "resend",
      fromEmail: "codes@atelieros.ci",
      fromName: "AtelierOS",
    });
  });

  it("refuse un WhatsApp à moitié configuré", () => {
    expect(() =>
      readPlatformMessagingConfig({
        PLATFORM_WHATSAPP_PHONE_ID: "123",
        PLATFORM_WHATSAPP_TOKEN: "t",
      }),
    ).toThrow(/PLATFORM_WHATSAPP_OTP_TEMPLATE/);
  });

  it("refuse un fournisseur SMS inconnu", () => {
    expect(() => readPlatformMessagingConfig({ PLATFORM_SMS_PROVIDER: "pigeon" })).toThrow(
      /PLATFORM_SMS_PROVIDER/,
    );
  });

  it("refuse des identifiants JSON illisibles sans recopier leur contenu", () => {
    try {
      readPlatformMessagingConfig({
        PLATFORM_SMS_PROVIDER: "twilio",
        PLATFORM_SMS_CREDENTIALS: "{secret_tres_prive",
      });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toMatch(/PLATFORM_SMS_CREDENTIALS/);
      expect((error as Error).message).not.toContain("secret_tres_prive");
    }
  });

  it("exige l'adresse d'expédition pour l'email", () => {
    expect(() => readPlatformMessagingConfig({ ...EMAIL_ENV, PLATFORM_EMAIL_FROM: "" })).toThrow(
      /PLATFORM_EMAIL_FROM/,
    );
  });
});

describe("platformOtpChannels", () => {
  const full = readPlatformMessagingConfig({ ...WHATSAPP_ENV, ...SMS_ENV, ...EMAIL_ENV });

  it("essaie WhatsApp puis SMS pour un téléphone (RG-M01-04)", () => {
    expect(platformOtpChannels(full, "WHATSAPP")).toEqual(["WHATSAPP", "SMS"]);
  });

  it("n'envoie que par SMS quand le SMS est demandé", () => {
    expect(platformOtpChannels(full, "SMS")).toEqual(["SMS"]);
  });

  it("n'envoie que par email pour un email", () => {
    expect(platformOtpChannels(full, "EMAIL")).toEqual(["EMAIL"]);
  });

  it("ignore les canaux non configurés", () => {
    const smsOnly = readPlatformMessagingConfig(SMS_ENV);
    expect(platformOtpChannels(smsOnly, "WHATSAPP")).toEqual(["SMS"]);
    expect(platformOtpChannels(smsOnly, "EMAIL")).toEqual([]);
  });
});

describe("createPlatformMessagingProvider", () => {
  it("renvoie null pour un canal non configuré", () => {
    expect(createPlatformMessagingProvider({}, "EMAIL")).toBeNull();
    expect(createPlatformMessagingProvider({}, "SMS")).toBeNull();
    expect(createPlatformMessagingProvider({}, "WHATSAPP")).toBeNull();
  });
});

describe("sendPlatformOtp", () => {
  it("envoie par le modèle d'authentification WhatsApp avec le code", async () => {
    const config = readPlatformMessagingConfig(WHATSAPP_ENV);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ messages: [{ id: "wamid.1" }] }));

    const result = await sendPlatformOtp(
      config,
      { ...OTP_INPUT, requestedChannel: "WHATSAPP" },
      { fetchImpl },
    );

    expect(result).toEqual({ sentVia: "WHATSAPP" });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toContain("/1234567890/messages");
    const payload = JSON.parse(init.body);
    expect(payload.template.name).toBe("atelieros_otp");
    expect(payload.template.components[0].parameters).toEqual([{ type: "text", text: "482913" }]);
  });

  it("passe au SMS quand WhatsApp échoue", async () => {
    const config = readPlatformMessagingConfig({ ...WHATSAPP_ENV, ...SMS_ENV });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 131026, message: "x" } }, 400))
      .mockResolvedValueOnce(jsonResponse({ sid: "SM1" }, 201));

    const result = await sendPlatformOtp(
      config,
      { ...OTP_INPUT, requestedChannel: "WHATSAPP" },
      { fetchImpl },
    );

    expect(result).toEqual({ sentVia: "SMS" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("api.twilio.com");
  });

  it("envoie l'email avec son objet", async () => {
    const config = readPlatformMessagingConfig(EMAIL_ENV);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "re_1" }));

    const result = await sendPlatformOtp(
      config,
      { ...OTP_INPUT, to: "konan@exemple.ci", requestedChannel: "EMAIL" },
      { fetchImpl },
    );

    expect(result).toEqual({ sentVia: "EMAIL" });
    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(JSON.parse(init.body).subject).toBe("Votre code AtelierOS");
  });

  it("lève PlatformOtpDeliveryError sans canal configuré", async () => {
    await expect(
      sendPlatformOtp({}, { ...OTP_INPUT, requestedChannel: "WHATSAPP" }),
    ).rejects.toBeInstanceOf(PlatformOtpDeliveryError);
  });

  it("lève PlatformOtpDeliveryError quand tous les canaux échouent", async () => {
    const config = readPlatformMessagingConfig({ ...WHATSAPP_ENV, ...SMS_ENV });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { code: 1 } }, 500));

    const error = await sendPlatformOtp(
      config,
      { ...OTP_INPUT, requestedChannel: "WHATSAPP" },
      { fetchImpl },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlatformOtpDeliveryError);
    expect((error as PlatformOtpDeliveryError).attempted).toEqual(["WHATSAPP", "SMS"]);
    expect((error as Error).message).toBe(
      "Envoi du code impossible pour le moment. Réessayez dans quelques minutes.",
    );
  });
});
