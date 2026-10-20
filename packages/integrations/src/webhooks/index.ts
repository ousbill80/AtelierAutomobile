// M13 §4.8 — envoi des webhooks sortants derrière une interface : `http` (production : DNS
// résolu et adresses privées refusées, sans suivre les redirections, délai 10 s) et `fake`
// (local, tests, démo : aucune requête réseau, livraisons enregistrées en mémoire).
// Signature HMAC-SHA256 `t=…,v1=…` (RG-M13-39) et secrets `whsec_…` / clés `ak_…`.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import {
  formatApiKey,
  isPrivateAddress,
  webhookSignatureHeader,
  webhookSignedPayload,
  type ApiEnvironment,
} from "@atelieros/core";

export interface WebhookRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

export interface WebhookResponse {
  /** Code HTTP, null si aucune réponse (réseau, délai, adresse refusée). */
  status: number | null;
  body: string | null;
  error: string | null;
}

export interface WebhookSender {
  readonly name: string;
  send(request: WebhookRequest): Promise<WebhookResponse>;
}

export type HostResolver = (hostname: string) => Promise<string[]>;

const defaultResolver: HostResolver = async (hostname) =>
  (await lookup(hostname, { all: true })).map((a) => a.address);

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Envoi HTTP réel : résolution DNS vérifiée juste avant l'appel (anti-SSRF, rebinding compris). */
export class HttpWebhookSender implements WebhookSender {
  readonly name = "http";

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly resolve: HostResolver = defaultResolver,
  ) {}

  async send(request: WebhookRequest): Promise<WebhookResponse> {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return { status: null, body: null, error: "URL invalide." };
    }
    if (url.protocol !== "https:") return { status: null, body: null, error: "https obligatoire." };
    try {
      const addresses = await this.resolve(url.hostname);
      if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a))) {
        return { status: null, body: null, error: "Adresse interne refusée." };
      }
    } catch {
      return { status: null, body: null, error: "Nom de domaine introuvable." };
    }
    try {
      const response = await this.fetchImpl(url.toString(), {
        method: "POST",
        headers: request.headers,
        body: request.body,
        redirect: "manual",
        signal: AbortSignal.timeout(request.timeoutMs),
      });
      const text = await response.text().catch(() => "");
      return { status: response.status, body: text, error: null };
    } catch (error) {
      const timeout = error instanceof Error && error.name === "TimeoutError";
      return {
        status: null,
        body: null,
        error: timeout ? "Délai de 10 s dépassé." : "Destinataire injoignable.",
      };
    }
  }
}

export interface FakeWebhookRecord extends WebhookRequest {
  at: Date;
  response: WebhookResponse;
}

export type FakeResponder = (request: WebhookRequest) => WebhookResponse;

const STORE_KEY = Symbol.for("atelieros.fakeWebhookSender");

interface FakeStore {
  records: FakeWebhookRecord[];
  responder: FakeResponder;
}

function store(): FakeStore {
  const g = globalThis as unknown as Record<symbol, FakeStore | undefined>;
  g[STORE_KEY] ??= {
    records: [],
    responder: () => ({ status: 200, body: "ok", error: null }),
  };
  return g[STORE_KEY];
}

/** Envoi simulé : réponse 200 par défaut (configurable), livraisons conservées (200 dernières). */
export class FakeWebhookSender implements WebhookSender {
  readonly name = "fake";

  constructor(private readonly clock: () => Date = () => new Date()) {}

  async send(request: WebhookRequest): Promise<WebhookResponse> {
    const s = store();
    const response = s.responder(request);
    s.records.push({ ...request, at: this.clock(), response });
    if (s.records.length > 200) s.records.splice(0, s.records.length - 200);
    return response;
  }

  static records(): readonly FakeWebhookRecord[] {
    return store().records;
  }

  static respondWith(responder: FakeResponder | null): void {
    store().responder = responder ?? (() => ({ status: 200, body: "ok", error: null }));
  }

  static reset(): void {
    store().records = [];
    FakeWebhookSender.respondWith(null);
  }
}

/** `WEBHOOK_SENDER=http|fake` ; défaut : `http` en production, `fake` ailleurs. */
export function resolveWebhookSender(
  env: Record<string, string | undefined> = process.env,
): WebhookSender {
  const choice = env.WEBHOOK_SENDER ?? (env.APP_ENV === "production" ? "http" : "fake");
  if (choice === "fake" && env.APP_ENV === "production") {
    throw new Error("Le simulateur de webhooks est interdit en production.");
  }
  return choice === "fake" ? new FakeWebhookSender() : new HttpWebhookSender();
}

/** En-tête `X-AtelierOS-Signature` : une signature par secret actif (rotation 24 h). */
export function signWebhook(secrets: readonly string[], body: string, now: Date): string {
  const t = Math.floor(now.getTime() / 1000);
  const payload = webhookSignedPayload(t, body);
  return webhookSignatureHeader(
    t,
    secrets.map((s) => createHmac("sha256", s).update(payload).digest("hex")),
  );
}

export function webhookHmac(secret: string, timestampSeconds: number, body: string): string {
  return createHmac("sha256", secret)
    .update(webhookSignedPayload(timestampSeconds, body))
    .digest("hex");
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

export function generateApiKey(environment: ApiEnvironment): string {
  return formatApiKey(environment, randomBytes(32));
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Empreinte stable d'une requête (méthode, chemin, corps) pour l'idempotence. */
export function requestFingerprint(method: string, path: string, body: string): string {
  return sha256Hex(`${method.toUpperCase()} ${path}\n${body}`);
}
