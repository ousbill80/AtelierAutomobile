// Adaptateur Orange SMS API Côte d'Ivoire — M11 §4.4, RG-M11-04.
//
// Note (même esprit que fne/provider.ts pour la DGI) : le contrat exact des accusés de
// livraison (en-tête de signature ou jeton) doit être confirmé auprès d'Orange CI à
// l'intégration réelle. En attendant, `verifyWebhook` applique une vérification HMAC
// pragmatique contre `clientSecret` ; à ajuster une fois la documentation Orange obtenue.

import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  HealthStatus,
  MessagingProvider,
  OutboundMessage,
  ProviderEvent,
  SendResult,
} from "../types";

export interface OrangeSmsCredentials {
  clientId: string;
  clientSecret: string;
  senderName: string;
}

export type ProviderErrorCategory =
  "TEMPORARY" | "PERMANENT_RECIPIENT" | "PERMANENT_TEMPLATE" | "PERMANENT_CONFIG" | "RATE_LIMIT";

export function classifyOrangeSmsError(status: number): ProviderErrorCategory {
  if (status === 429) return "RATE_LIMIT";
  if (status === 401 || status === 403) return "PERMANENT_CONFIG";
  if (status >= 400 && status < 500) return "PERMANENT_RECIPIENT";
  return "TEMPORARY";
}

const TOKEN_URL = "https://api.orange.com/oauth/v3/token";
const SMS_BASE_URL = "https://api.orange.com/smsmessaging/v1/outbound";

interface OrangeTokenResponse {
  access_token: string;
  expires_in?: number;
}

interface OrangeSendResponse {
  outboundSMSMessageRequest?: { resourceReference?: { resourceURL?: string } };
}

interface OrangeDeliveryWebhookPayload {
  deliveryInfoNotification?: {
    deliveryInfo?: { address: string; deliveryStatus: string };
  };
}

interface OrangeSmsDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function createOrangeSmsProvider(
  credentials: OrangeSmsCredentials,
  deps: OrangeSmsDeps = {},
): MessagingProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => Date.now());

  let cachedToken: { accessToken: string; expiresAt: number } | undefined;

  async function getAccessToken(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt > now()) {
      return cachedToken.accessToken;
    }
    const basicAuth = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString(
      "base64",
    );
    const response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!response.ok) {
      const error = new Error(
        `Orange SMS : impossible d'obtenir un jeton OAuth2 (HTTP ${response.status})`,
      );
      (error as Error & { category: ProviderErrorCategory }).category = classifyOrangeSmsError(
        response.status,
      );
      throw error;
    }
    const payload = (await response.json()) as OrangeTokenResponse;
    cachedToken = {
      accessToken: payload.access_token,
      expiresAt: now() + Number(payload.expires_in ?? 3600) * 1000 - 5000,
    };
    return cachedToken.accessToken;
  }

  const senderAddress = `tel:${credentials.senderName}`;

  return {
    channel: "SMS",

    async send(msg: OutboundMessage): Promise<SendResult> {
      const accessToken = await getAccessToken();
      const response = await fetchImpl(
        `${SMS_BASE_URL}/${encodeURIComponent(senderAddress)}/requests`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            outboundSMSMessageRequest: {
              address: `tel:${msg.to}`,
              senderAddress,
              outboundSMSTextMessage: { message: msg.body },
            },
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as OrangeSendResponse;
      if (!response.ok) {
        const error = new Error(`Orange SMS a répondu ${response.status}`);
        (error as Error & { category: ProviderErrorCategory }).category = classifyOrangeSmsError(
          response.status,
        );
        throw error;
      }
      const resourceUrl = payload.outboundSMSMessageRequest?.resourceReference?.resourceURL;
      return { providerMessageId: resourceUrl?.split("/").pop() ?? "" };
    },

    /** Vérification best-effort ; à confirmer avec la documentation Orange CI (cf. en-tête du fichier). */
    async verifyWebhook(req: Request): Promise<boolean> {
      const signatureHeader = req.headers.get("x-orange-signature");
      if (!signatureHeader) return false;
      const rawBody = await req.clone().text();
      const expected = createHmac("sha256", credentials.clientSecret).update(rawBody).digest("hex");
      const expectedBuf = Buffer.from(expected, "hex");
      const providedBuf = Buffer.from(signatureHeader, "hex");
      if (expectedBuf.length !== providedBuf.length) return false;
      return timingSafeEqual(expectedBuf, providedBuf);
    },

    async parseWebhook(req: Request): Promise<ProviderEvent[]> {
      const payload = (await req
        .clone()
        .json()
        .catch(() => null)) as OrangeDeliveryWebhookPayload | null;
      const report = payload?.deliveryInfoNotification?.deliveryInfo;
      if (!report) return [];
      const statusMap: Record<string, ProviderEvent["status"]> = {
        DeliveredToTerminal: "DELIVERED",
        DeliveryUncertain: "SENT",
        DeliveryImpossible: "FAILED",
      };
      return [
        {
          kind: "status",
          providerMessageId: report.address,
          status: statusMap[report.deliveryStatus] ?? "SENT",
          occurredAt: new Date(),
        },
      ];
    },

    async healthCheck(): Promise<HealthStatus> {
      try {
        await getAccessToken();
        return { ok: true };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : "Erreur inconnue" };
      }
    },
  };
}
