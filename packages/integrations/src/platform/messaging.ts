// RG-M01-04 — canaux de messagerie de la PLATEFORME (pas ceux d'un garage) : ils servent aux
// codes OTP d'authentification, envoyés avant que l'utilisateur ait une organisation. Ils sont
// configurés une fois par l'administrateur du serveur, dans les variables d'environnement
// (M01 §14). Les secrets ne sortent jamais de ce module : aucune erreur ne les recopie.
import { DomainError } from "@atelieros/core";
import type { MessageChannel, MessagingProvider, OutboundMessage } from "../messaging/types";
import { createHttpSmsProvider, type HttpSmsCredentials } from "../messaging/providers/http-sms";
import {
  createOrangeSmsProvider,
  type OrangeSmsCredentials,
} from "../messaging/providers/orange-sms";
import { createResendProvider } from "../messaging/providers/resend";
import { createSmtpProvider } from "../messaging/providers/smtp";
import { createTwilioProvider, type TwilioCredentials } from "../messaging/providers/twilio";
import {
  createWhatsappCloudProvider,
  type WhatsappCloudSendInput,
} from "../messaging/providers/whatsapp-cloud";

export type PlatformSmsProvider = "twilio" | "orange_sms" | "http_sms";
export type PlatformEmailProvider = "resend" | "smtp";

export interface PlatformMessagingConfig {
  whatsapp?: {
    phoneNumberId: string;
    accessToken: string;
    /** Modèle Meta de catégorie « authentification », approuvé, avec le code en {{1}}. */
    otpTemplate: string;
    otpTemplateLanguage: string;
  };
  sms?: { provider: PlatformSmsProvider; credentials: Record<string, unknown> };
  email?: {
    provider: PlatformEmailProvider;
    credentials: Record<string, unknown>;
    fromEmail: string;
    fromName: string;
  };
}

type Env = Record<string, string | undefined>;

const SMS_PROVIDERS: readonly PlatformSmsProvider[] = ["twilio", "orange_sms", "http_sms"];
const EMAIL_PROVIDERS: readonly PlatformEmailProvider[] = ["resend", "smtp"];

function value(env: Env, name: string): string | undefined {
  const raw = env[name]?.trim();
  return raw ? raw : undefined;
}

function invalid(variable: string, detail: string): DomainError {
  return new DomainError("platform_messaging.invalid_config", `${variable} : ${detail}`, {
    variable,
  });
}

function parseCredentials(env: Env, variable: string): Record<string, unknown> {
  const raw = value(env, variable);
  if (!raw) throw invalid(variable, "variable manquante (objet JSON attendu).");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Pas de recopie de la valeur : elle contient des secrets.
    throw invalid(variable, "JSON illisible.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw invalid(variable, "objet JSON attendu.");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Lit la configuration des canaux plateforme. Un canal sans aucune variable renseignée est
 * simplement absent ; un canal à moitié renseigné lève une erreur, pour que l'administrateur
 * voie sa faute au lieu d'un envoi qui échoue en silence.
 */
export function readPlatformMessagingConfig(env: Env): PlatformMessagingConfig {
  const config: PlatformMessagingConfig = {};

  const phoneNumberId = value(env, "PLATFORM_WHATSAPP_PHONE_ID");
  const accessToken = value(env, "PLATFORM_WHATSAPP_TOKEN");
  const otpTemplate = value(env, "PLATFORM_WHATSAPP_OTP_TEMPLATE");
  if (phoneNumberId || accessToken || otpTemplate) {
    if (!phoneNumberId) throw invalid("PLATFORM_WHATSAPP_PHONE_ID", "variable manquante.");
    if (!accessToken) throw invalid("PLATFORM_WHATSAPP_TOKEN", "variable manquante.");
    if (!otpTemplate) throw invalid("PLATFORM_WHATSAPP_OTP_TEMPLATE", "variable manquante.");
    config.whatsapp = {
      phoneNumberId,
      accessToken,
      otpTemplate,
      otpTemplateLanguage: value(env, "PLATFORM_WHATSAPP_OTP_LANGUAGE") ?? "fr",
    };
  }

  const smsProvider = value(env, "PLATFORM_SMS_PROVIDER");
  if (smsProvider) {
    if (!SMS_PROVIDERS.includes(smsProvider as PlatformSmsProvider)) {
      throw invalid("PLATFORM_SMS_PROVIDER", `valeur attendue : ${SMS_PROVIDERS.join(", ")}.`);
    }
    config.sms = {
      provider: smsProvider as PlatformSmsProvider,
      credentials: parseCredentials(env, "PLATFORM_SMS_CREDENTIALS"),
    };
  }

  const emailProvider = value(env, "PLATFORM_EMAIL_PROVIDER");
  if (emailProvider) {
    if (!EMAIL_PROVIDERS.includes(emailProvider as PlatformEmailProvider)) {
      throw invalid("PLATFORM_EMAIL_PROVIDER", `valeur attendue : ${EMAIL_PROVIDERS.join(", ")}.`);
    }
    const fromEmail = value(env, "PLATFORM_EMAIL_FROM");
    if (!fromEmail) throw invalid("PLATFORM_EMAIL_FROM", "variable manquante.");
    config.email = {
      provider: emailProvider as PlatformEmailProvider,
      credentials: parseCredentials(env, "PLATFORM_EMAIL_CREDENTIALS"),
      fromEmail,
      fromName: value(env, "PLATFORM_EMAIL_FROM_NAME") ?? "AtelierOS",
    };
  }

  return config;
}

/**
 * Ordre d'essai des canaux plateforme pour un OTP (RG-M01-04 : WhatsApp → SMS). Un code
 * demandé par email ne part que par email. Seuls les canaux configurés sont renvoyés.
 */
export function platformOtpChannels(
  config: PlatformMessagingConfig,
  requested: MessageChannel,
): MessageChannel[] {
  const order: MessageChannel[] =
    requested === "EMAIL" ? ["EMAIL"] : requested === "SMS" ? ["SMS"] : ["WHATSAPP", "SMS"];
  return order.filter((channel) =>
    channel === "WHATSAPP" ? !!config.whatsapp : channel === "SMS" ? !!config.sms : !!config.email,
  );
}

export interface PlatformProviderDeps {
  fetchImpl?: typeof fetch;
}

/** Fournisseur réel d'un canal plateforme, ou `null` si ce canal n'est pas configuré. */
export function createPlatformMessagingProvider(
  config: PlatformMessagingConfig,
  channel: MessageChannel,
  deps: PlatformProviderDeps = {},
): MessagingProvider | null {
  const fetchDeps = deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {};
  if (channel === "WHATSAPP") {
    if (!config.whatsapp) return null;
    // Envoi seul : la signature des webhooks (appSecret/verifyToken) ne concerne pas l'OTP.
    return createWhatsappCloudProvider(
      {
        phoneNumberId: config.whatsapp.phoneNumberId,
        accessToken: config.whatsapp.accessToken,
        wabaId: "",
        appSecret: "",
        verifyToken: "",
      },
      fetchDeps,
    );
  }
  if (channel === "SMS") {
    if (!config.sms) return null;
    const credentials = config.sms.credentials;
    switch (config.sms.provider) {
      case "twilio":
        return createTwilioProvider(credentials as unknown as TwilioCredentials, fetchDeps);
      case "orange_sms":
        return createOrangeSmsProvider(credentials as unknown as OrangeSmsCredentials, fetchDeps);
      case "http_sms":
        return createHttpSmsProvider(credentials as unknown as HttpSmsCredentials, fetchDeps);
    }
  }
  if (!config.email) return null;
  const { credentials, fromEmail, fromName } = config.email;
  if (config.email.provider === "resend") {
    return createResendProvider(
      {
        apiKey: String(credentials.apiKey ?? ""),
        fromEmail,
        fromName,
      },
      fetchDeps,
    );
  }
  return createSmtpProvider({
    host: String(credentials.host ?? ""),
    port: Number(credentials.port ?? 587),
    secure: credentials.secure === true,
    username: String(credentials.username ?? ""),
    password: String(credentials.password ?? ""),
    fromEmail,
    fromName,
  });
}

export class PlatformOtpDeliveryError extends Error {
  constructor(
    /** Canaux essayés, dans l'ordre (vide : aucun canal plateforme configuré). */
    readonly attempted: MessageChannel[],
  ) {
    super("Envoi du code impossible pour le moment. Réessayez dans quelques minutes.");
    this.name = "PlatformOtpDeliveryError";
  }
}

export interface SendPlatformOtpInput {
  to: string;
  requestedChannel: MessageChannel;
  code: string;
  body: string;
  subject: string;
  templateKey: string;
  idempotencyKey: string;
}

/**
 * Envoie un OTP par les canaux plateforme, en passant au suivant quand un envoi échoue
 * (RG-M01-04). Lève {@link PlatformOtpDeliveryError} si aucun canal n'a pu l'envoyer.
 */
export async function sendPlatformOtp(
  config: PlatformMessagingConfig,
  input: SendPlatformOtpInput,
  deps: PlatformProviderDeps = {},
): Promise<{ sentVia: MessageChannel }> {
  const channels = platformOtpChannels(config, input.requestedChannel);
  for (const channel of channels) {
    const provider = createPlatformMessagingProvider(config, channel, deps);
    if (!provider) continue;
    const message: OutboundMessage | WhatsappCloudSendInput = {
      to: input.to,
      channel,
      body: input.body,
      subject: channel === "EMAIL" ? input.subject : undefined,
      templateKey: input.templateKey,
      idempotencyKey: `${input.idempotencyKey}:${channel}`,
      ...(channel === "WHATSAPP" && config.whatsapp
        ? {
            templateName: config.whatsapp.otpTemplate,
            templateLanguage: config.whatsapp.otpTemplateLanguage,
            templateParams: [input.code],
            templateUrlButtonParam: input.code,
          }
        : {}),
    };
    try {
      await provider.send(message);
      return { sentVia: channel };
    } catch {
      // Canal suivant. Le détail fournisseur n'est pas propagé : il peut contenir le numéro.
    }
  }
  throw new PlatformOtpDeliveryError(channels);
}
