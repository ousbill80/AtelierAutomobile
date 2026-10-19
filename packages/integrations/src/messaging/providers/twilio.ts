// Adaptateur Twilio SMS — M11 §4.4, RG-M11-04.

import { createHmac } from "node:crypto";
import type {
  HealthStatus,
  MessagingProvider,
  OutboundMessage,
  ProviderEvent,
  SendResult,
} from "../types";

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
  senderId: string;
}

export type ProviderErrorCategory =
  "TEMPORARY" | "PERMANENT_RECIPIENT" | "PERMANENT_TEMPLATE" | "PERMANENT_CONFIG" | "RATE_LIMIT";

/** RG-M11-07 : classement des codes d'erreur Twilio (https://www.twilio.com/docs/api/errors). */
export function classifyTwilioError(code: number): ProviderErrorCategory {
  if (code === 21211 || code === 21614 || code === 21610) return "PERMANENT_RECIPIENT";
  if (code === 20003 || code === 20404) return "PERMANENT_CONFIG";
  if (code === 429 || code === 14107) return "RATE_LIMIT";
  return "TEMPORARY";
}

interface TwilioDeps {
  fetchImpl?: typeof fetch;
}

interface TwilioSendResponse {
  sid?: string;
  code?: number;
  message?: string;
}

export function createTwilioProvider(
  credentials: TwilioCredentials,
  deps: TwilioDeps = {},
): MessagingProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const basicAuth = Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString(
    "base64",
  );

  return {
    channel: "SMS",

    async send(msg: OutboundMessage): Promise<SendResult> {
      const body = new URLSearchParams({ To: msg.to, From: credentials.senderId, Body: msg.body });
      const response = await fetchImpl(
        `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as TwilioSendResponse;
      if (!response.ok) {
        const errorCode = Number(payload.code ?? response.status);
        const error = new Error(payload.message ?? `Twilio a répondu ${response.status}`);
        (error as Error & { category: ProviderErrorCategory; providerCode: string }).category =
          classifyTwilioError(errorCode);
        (error as Error & { category: ProviderErrorCategory; providerCode: string }).providerCode =
          String(errorCode);
        throw error;
      }
      return { providerMessageId: payload.sid ?? "" };
    },

    /** https://www.twilio.com/docs/usage/webhooks/webhooks-security : HMAC-SHA1(url + params triés) en base64. */
    async verifyWebhook(req: Request): Promise<boolean> {
      const signatureHeader = req.headers.get("x-twilio-signature");
      if (!signatureHeader) return false;
      const rawBody = await req.clone().text();
      const params = new URLSearchParams(rawBody);
      const sortedKeys = [...params.keys()].sort();
      const data = sortedKeys.reduce((acc, key) => acc + key + params.get(key), req.url);
      const expected = createHmac("sha1", credentials.authToken).update(data).digest("base64");
      return expected === signatureHeader;
    },

    async parseWebhook(req: Request): Promise<ProviderEvent[]> {
      const rawBody = await req.clone().text();
      const params = new URLSearchParams(rawBody);
      const messageSid = params.get("MessageSid") ?? params.get("SmsSid");
      const messageStatus = params.get("MessageStatus");
      if (messageStatus) {
        const statusMap: Record<string, ProviderEvent["status"]> = {
          sent: "SENT",
          delivered: "DELIVERED",
          read: "READ",
          failed: "FAILED",
          undelivered: "FAILED",
        };
        return [
          {
            kind: "status",
            providerMessageId: messageSid ?? undefined,
            status: statusMap[messageStatus],
            occurredAt: new Date(),
          },
        ];
      }
      const from = params.get("From");
      const body = params.get("Body");
      if (from) {
        return [{ kind: "inbound", from, body: body ?? "", occurredAt: new Date() }];
      }
      return [];
    },

    async healthCheck(): Promise<HealthStatus> {
      const response = await fetchImpl(
        `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}.json`,
        { headers: { Authorization: `Basic ${basicAuth}` } },
      );
      return response.ok
        ? { ok: true }
        : { ok: false, detail: `Twilio a répondu ${response.status}` };
    },
  };
}
