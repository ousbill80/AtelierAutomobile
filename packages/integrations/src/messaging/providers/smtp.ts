// Adaptateur email SMTP générique — M11 §4.5, RG-M11-04, RG-M11-17.
// Aucune norme de webhook en SMTP brut (pas de rebonds/accusés sans service tiers,
// hors périmètre de cet adaptateur) : `parseWebhook`/`verifyWebhook` sont des no-op.

import nodemailer, { type Transporter } from "nodemailer";
import type {
  HealthStatus,
  MessagingProvider,
  OutboundMessage,
  ProviderEvent,
  SendResult,
} from "../types";

export interface SmtpCredentials {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
}

export type ProviderErrorCategory =
  "TEMPORARY" | "PERMANENT_RECIPIENT" | "PERMANENT_TEMPLATE" | "PERMANENT_CONFIG" | "RATE_LIMIT";

/** RG-M11-07 : classement par code de réponse SMTP (RFC 5321 §4.2). */
export function classifySmtpError(responseCode: string): ProviderErrorCategory {
  if (responseCode === "535" || responseCode === "534") return "PERMANENT_CONFIG";
  if (
    /^5\.[17]\./.test(responseCode) ||
    responseCode.startsWith("550") ||
    responseCode.startsWith("551")
  ) {
    return "PERMANENT_RECIPIENT";
  }
  if (responseCode.startsWith("45") || responseCode === "421") return "RATE_LIMIT";
  if (responseCode.startsWith("4")) return "TEMPORARY";
  return "TEMPORARY";
}

interface SmtpDeps {
  transporter?: Transporter;
}

export function createSmtpProvider(
  credentials: SmtpCredentials,
  deps: SmtpDeps = {},
): MessagingProvider {
  const transporter =
    deps.transporter ??
    nodemailer.createTransport({
      host: credentials.host,
      port: credentials.port,
      secure: credentials.secure,
      auth: { user: credentials.username, pass: credentials.password },
    });

  return {
    channel: "EMAIL",

    async send(msg: OutboundMessage): Promise<SendResult> {
      try {
        const info = await transporter.sendMail({
          from: `${credentials.fromName} <${credentials.fromEmail}>`,
          to: msg.to,
          subject: (msg as OutboundMessage & { subject?: string }).subject ?? "AtelierOS",
          html: msg.body,
        });
        return { providerMessageId: info.messageId };
      } catch (error) {
        const responseCode = String((error as { responseCode?: number }).responseCode ?? "");
        const wrapped = new Error(error instanceof Error ? error.message : "Échec d'envoi SMTP");
        (wrapped as Error & { category: ProviderErrorCategory }).category =
          classifySmtpError(responseCode);
        throw wrapped;
      }
    },

    async verifyWebhook(): Promise<boolean> {
      return false;
    },

    async parseWebhook(): Promise<ProviderEvent[]> {
      return [];
    },

    async healthCheck(): Promise<HealthStatus> {
      try {
        await transporter.verify();
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          detail: error instanceof Error ? error.message : "Connexion SMTP impossible",
        };
      }
    },
  };
}
