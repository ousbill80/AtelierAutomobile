// Adaptateur WhatsApp Cloud API (Meta) — M11 §4.3, RG-M11-04, RG-M11-11, RG-M11-12.

import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  HealthStatus,
  MessagingProvider,
  OutboundMessage,
  ProviderEvent,
  SendResult,
} from "../types";

export interface WhatsappCloudCredentials {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
}

/** Message WhatsApp sortant : `templateName`/`templateParams` hors fenêtre 24 h (RG-M11-10, RG-M11-12). */
export interface WhatsappCloudSendInput extends OutboundMessage {
  templateName?: string;
  templateLanguage?: string;
  templateParams?: string[];
}

export type ProviderErrorCategory =
  "TEMPORARY" | "PERMANENT_RECIPIENT" | "PERMANENT_TEMPLATE" | "PERMANENT_CONFIG" | "RATE_LIMIT";

/** RG-M11-07 : classement des codes d'erreur Meta Graph API. */
export function classifyWhatsappCloudError(code: number | string): ProviderErrorCategory {
  const numeric = Number(code);
  if (numeric === 131026) return "PERMANENT_RECIPIENT"; // numéro non WhatsApp
  if (numeric === 131047 || numeric === 132001) return "PERMANENT_TEMPLATE"; // modèle non approuvé/suspendu
  if (numeric === 190 || numeric === 401) return "PERMANENT_CONFIG"; // jeton expiré/invalide
  if (numeric === 131048 || numeric === 80007 || numeric === 429) return "RATE_LIMIT";
  return "TEMPORARY";
}

const GRAPH_API_BASE = "https://graph.facebook.com/v20.0";

interface WhatsappSendResponse {
  messages?: { id: string }[];
  error?: { code?: number; message?: string };
}

interface WhatsappWebhookStatus {
  id: string;
  status: string;
  timestamp: string;
}

interface WhatsappWebhookMessage {
  from: string;
  text?: { body: string };
  timestamp: string;
}

interface WhatsappWebhookPayload {
  entry?: {
    changes?: {
      value?: { statuses?: WhatsappWebhookStatus[]; messages?: WhatsappWebhookMessage[] };
    }[];
  }[];
}

interface WhatsappCloudDeps {
  fetchImpl?: typeof fetch;
}

export function createWhatsappCloudProvider(
  credentials: WhatsappCloudCredentials,
  deps: WhatsappCloudDeps = {},
): MessagingProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;

  return {
    channel: "WHATSAPP",

    async send(msg: OutboundMessage): Promise<SendResult> {
      const input = msg as WhatsappCloudSendInput;
      const body = input.templateName
        ? {
            messaging_product: "whatsapp",
            to: input.to,
            type: "template",
            template: {
              name: input.templateName,
              language: { code: input.templateLanguage ?? "fr" },
              components: input.templateParams?.length
                ? [
                    {
                      type: "body",
                      parameters: input.templateParams.map((text) => ({ type: "text", text })),
                    },
                  ]
                : [],
            },
          }
        : {
            messaging_product: "whatsapp",
            to: input.to,
            type: "text",
            text: { body: input.body },
          };

      const response = await fetchImpl(`${GRAPH_API_BASE}/${credentials.phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as WhatsappSendResponse;
      if (!response.ok) {
        const errorCode = payload.error?.code ?? response.status;
        const error = new Error(
          payload.error?.message ?? `Meta Graph API a répondu ${response.status}`,
        );
        (error as Error & { category: ProviderErrorCategory; providerCode: string }).category =
          classifyWhatsappCloudError(errorCode);
        (error as Error & { category: ProviderErrorCategory; providerCode: string }).providerCode =
          String(errorCode);
        throw error;
      }
      return { providerMessageId: payload.messages?.[0]?.id ?? "" };
    },

    /**
     * Vérifie uniquement la signature `X-Hub-Signature-256` du POST (RG-M11-11). La
     * poignée de main `GET` (hub.mode/hub.verify_token/hub.challenge) est un concept de
     * route HTTP, pas de ce contrat — elle est traitée par l'appelant (route webhook).
     */
    async verifyWebhook(req: Request): Promise<boolean> {
      const signatureHeader = req.headers.get("x-hub-signature-256");
      if (!signatureHeader?.startsWith("sha256=")) return false;
      const rawBody = await req.clone().text();
      const expected = createHmac("sha256", credentials.appSecret).update(rawBody).digest("hex");
      const provided = signatureHeader.slice("sha256=".length);
      const expectedBuf = Buffer.from(expected, "hex");
      const providedBuf = Buffer.from(provided, "hex");
      if (expectedBuf.length !== providedBuf.length) return false;
      return timingSafeEqual(expectedBuf, providedBuf);
    },

    async parseWebhook(req: Request): Promise<ProviderEvent[]> {
      const payload = (await req
        .clone()
        .json()
        .catch(() => null)) as WhatsappWebhookPayload | null;
      const events: ProviderEvent[] = [];
      if (!payload?.entry) return events;

      const statusMap: Record<string, ProviderEvent["status"]> = {
        sent: "SENT",
        delivered: "DELIVERED",
        read: "READ",
        failed: "FAILED",
      };

      for (const entry of payload.entry) {
        for (const change of entry.changes ?? []) {
          const value = change.value ?? {};
          for (const status of value.statuses ?? []) {
            events.push({
              kind: "status",
              providerMessageId: status.id,
              status: statusMap[status.status],
              occurredAt: new Date(Number(status.timestamp) * 1000),
            });
          }
          for (const message of value.messages ?? []) {
            events.push({
              kind: "inbound",
              from: message.from,
              body: message.text?.body ?? "",
              occurredAt: new Date(Number(message.timestamp) * 1000),
            });
          }
        }
      }
      return events;
    },

    async healthCheck(): Promise<HealthStatus> {
      const response = await fetchImpl(`${GRAPH_API_BASE}/${credentials.phoneNumberId}?fields=id`, {
        headers: { Authorization: `Bearer ${credentials.accessToken}` },
      });
      return response.ok
        ? { ok: true }
        : { ok: false, detail: `Meta Graph API a répondu ${response.status}` };
    },
  };
}
