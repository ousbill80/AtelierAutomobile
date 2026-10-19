// Adaptateur email Resend — M11 §4.5, RG-M11-04, RG-M11-17.

import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  HealthStatus,
  MessagingProvider,
  OutboundMessage,
  ProviderEvent,
  SendResult,
} from "../types";

export interface ResendCredentials {
  apiKey: string;
  fromEmail: string;
  fromName: string;
  /** Secret de signature Svix (tableau de bord Resend). Sans lui, les webhooks sont refusés. */
  webhookSecret?: string;
}

export type ProviderErrorCategory =
  "TEMPORARY" | "PERMANENT_RECIPIENT" | "PERMANENT_TEMPLATE" | "PERMANENT_CONFIG" | "RATE_LIMIT";

export function classifyResendError(status: number, message?: string): ProviderErrorCategory {
  if (status === 401 || status === 403) return "PERMANENT_CONFIG";
  if (status === 429) return "RATE_LIMIT";
  if (status === 422) {
    const lower = (message ?? "").toLowerCase();
    if (lower.includes("bounce") || lower.includes("invalid") || lower.includes("recipient")) {
      return "PERMANENT_RECIPIENT";
    }
  }
  return "TEMPORARY";
}

interface ResendDeps {
  fetchImpl?: typeof fetch;
}

interface ResendSendResponse {
  id?: string;
  message?: string;
}

interface ResendWebhookPayload {
  type?: string;
  data?: { email_id?: string };
  created_at?: string;
}

export function createResendProvider(
  credentials: ResendCredentials,
  deps: ResendDeps = {},
): MessagingProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;

  return {
    channel: "EMAIL",

    async send(msg: OutboundMessage): Promise<SendResult> {
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${credentials.fromName} <${credentials.fromEmail}>`,
          to: msg.to,
          subject: (msg as OutboundMessage & { subject?: string }).subject ?? "AtelierOS",
          html: msg.body,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as ResendSendResponse;
      if (!response.ok) {
        const message = payload.message ?? `Resend a répondu ${response.status}`;
        const error = new Error(message);
        (error as Error & { category: ProviderErrorCategory }).category = classifyResendError(
          response.status,
          message,
        );
        throw error;
      }
      return { providerMessageId: payload.id ?? "" };
    },

    /** Resend signe via Svix : HMAC-SHA256("{svix-id}.{svix-timestamp}.{body}") en base64. */
    async verifyWebhook(req: Request): Promise<boolean> {
      if (!credentials.webhookSecret) return false;
      const svixId = req.headers.get("svix-id");
      const svixTimestamp = req.headers.get("svix-timestamp");
      const svixSignature = req.headers.get("svix-signature");
      if (!svixId || !svixTimestamp || !svixSignature) return false;
      const rawBody = await req.clone().text();
      const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
      const secretBytes = Buffer.from(credentials.webhookSecret.split("_").pop() ?? "", "base64");
      const expected = createHmac("sha256", secretBytes).update(signedContent).digest("base64");
      return svixSignature
        .split(" ")
        .map((part) => part.split(",")[1])
        .some((candidate) => {
          if (!candidate) return false;
          const expectedBuf = Buffer.from(expected, "base64");
          const candidateBuf = Buffer.from(candidate, "base64");
          return (
            expectedBuf.length === candidateBuf.length && timingSafeEqual(expectedBuf, candidateBuf)
          );
        });
    },

    /** Resend inbound email (P1) n'est pas supporté ici : seuls les statuts sont traités. */
    async parseWebhook(req: Request): Promise<ProviderEvent[]> {
      const payload = (await req
        .clone()
        .json()
        .catch(() => null)) as ResendWebhookPayload | null;
      const statusMap: Record<string, ProviderEvent["status"]> = {
        "email.delivered": "DELIVERED",
        "email.bounced": "FAILED",
        "email.complained": "FAILED",
      };
      const status = payload?.type ? statusMap[payload.type] : undefined;
      if (!status) return [];
      return [
        {
          kind: "status",
          providerMessageId: payload?.data?.email_id,
          status,
          occurredAt: new Date(payload?.created_at ?? Date.now()),
        },
      ];
    },

    async healthCheck(): Promise<HealthStatus> {
      const response = await fetchImpl("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${credentials.apiKey}` },
      });
      return response.ok
        ? { ok: true }
        : { ok: false, detail: `Resend a répondu ${response.status}` };
    },
  };
}
