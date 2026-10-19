// Adaptateur SMS générique pour agrégateur local — M11 §4.4, RG-M11-04 : "URL, méthode,
// gabarit de corps JSON/form, mapping de réponse". Pas de norme de webhook universelle pour
// un agrégateur générique : `verifyWebhook` compare un jeton partagé (`webhookToken`), à
// défaut d'une signature standard.

import type {
  HealthStatus,
  MessagingProvider,
  OutboundMessage,
  ProviderEvent,
  SendResult,
} from "../types";

export interface HttpSmsCredentials {
  url: string;
  method: "GET" | "POST";
  bodyTemplate: string; // "{{to}}" et "{{body}}" substitués avant l'envoi
  contentType: "application/json" | "application/x-www-form-urlencoded";
  responseMessageIdPath: string; // ex. "data.id"
  webhookToken?: string;
}

export type ProviderErrorCategory =
  "TEMPORARY" | "PERMANENT_RECIPIENT" | "PERMANENT_TEMPLATE" | "PERMANENT_CONFIG" | "RATE_LIMIT";

export function classifyHttpSmsError(status: number): ProviderErrorCategory {
  if (status === 429) return "RATE_LIMIT";
  if (status === 401 || status === 403) return "PERMANENT_CONFIG";
  if (status >= 400 && status < 500) return "PERMANENT_RECIPIENT";
  return "TEMPORARY";
}

function getPath(payload: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, payload);
}

function renderBody(template: string, to: string, body: string): string {
  return template.replaceAll("{{to}}", to).replaceAll("{{body}}", body);
}

interface HttpSmsDeps {
  fetchImpl?: typeof fetch;
}

interface HttpSmsWebhookPayload {
  messageId?: string | number;
  status?: string;
}

export function createHttpSmsProvider(
  credentials: HttpSmsCredentials,
  deps: HttpSmsDeps = {},
): MessagingProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;

  return {
    channel: "SMS",

    async send(msg: OutboundMessage): Promise<SendResult> {
      const renderedBody = renderBody(credentials.bodyTemplate, msg.to, msg.body);
      const url =
        credentials.method === "GET" ? `${credentials.url}?${renderedBody}` : credentials.url;
      const response = await fetchImpl(url, {
        method: credentials.method,
        headers:
          credentials.method === "POST" ? { "Content-Type": credentials.contentType } : undefined,
        body: credentials.method === "POST" ? renderedBody : undefined,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(`Agrégateur SMS a répondu ${response.status}`);
        (error as Error & { category: ProviderErrorCategory }).category = classifyHttpSmsError(
          response.status,
        );
        throw error;
      }
      const providerMessageId = getPath(payload, credentials.responseMessageIdPath);
      return { providerMessageId: providerMessageId ? String(providerMessageId) : "" };
    },

    async verifyWebhook(req: Request): Promise<boolean> {
      if (!credentials.webhookToken) return false;
      const url = new URL(req.url);
      const provided = req.headers.get("x-webhook-token") ?? url.searchParams.get("token");
      return provided === credentials.webhookToken;
    },

    /** Pas de norme commune : l'agrégateur paramétré renvoie au mieux un statut générique. */
    async parseWebhook(req: Request): Promise<ProviderEvent[]> {
      const payload = (await req
        .clone()
        .json()
        .catch(() => null)) as HttpSmsWebhookPayload | null;
      if (!payload?.messageId) return [];
      const statusMap: Record<string, ProviderEvent["status"]> = {
        delivered: "DELIVERED",
        failed: "FAILED",
      };
      return [
        {
          kind: "status",
          providerMessageId: String(payload.messageId),
          status: statusMap[String(payload.status).toLowerCase()] ?? "SENT",
          occurredAt: new Date(),
        },
      ];
    },

    async healthCheck(): Promise<HealthStatus> {
      return {
        ok: true,
        detail: "Agrégateur SMS générique : aucune vérification standard disponible",
      };
    },
  };
}
