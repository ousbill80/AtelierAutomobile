// Client HTTP de l'API de l'agent (`/api/v1/sync/*`, RG-M13-28). Connexion sortante
// uniquement (HTTPS 443) ; `fetch` injectable pour les tests.
import { gzipSync } from "node:zlib";

export interface RemoteConfig {
  agent_id: string;
  active: boolean;
  schedule: string;
  /** Fuseau de l'organisation : le planning s'entend en heure locale du garage. */
  timezone: string;
  policy: string;
  queries: Record<string, string | null>;
  server_time: string;
}

export interface SyncBatchPayload {
  entity: string;
  columns: string[];
  rows: string[][];
}

export class AgentApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentApiError";
  }

  /** Erreur définitive (jeton révoqué, lot refusé) : inutile de réessayer le même envoi. */
  get permanent(): boolean {
    return this.status === 401 || this.status === 403 || this.status === 422;
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class AgentApi {
  constructor(
    private readonly serverUrl: string,
    private readonly token: string | null,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.serverUrl.replace(/\/$/, "")}/api/v1/sync/${path}`, {
        ...init,
        headers,
      });
    } catch {
      throw new AgentApiError(
        0,
        "network_error",
        "Serveur AtelierOS injoignable (internet coupé ?).",
      );
    }
    const body = (await res.json().catch(() => ({}))) as {
      error?: { code: string; message: string };
    };
    if (!res.ok) {
      throw new AgentApiError(
        res.status,
        body.error?.code ?? "http_error",
        body.error?.message ?? `Erreur HTTP ${res.status}`,
      );
    }
    return body as T;
  }

  pair(code: string, info: { hostname: string; version: string }) {
    return this.call<{ token: string; agent_id: string; organization_name: string }>("pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, ...info }),
    });
  }

  getConfig() {
    return this.call<RemoteConfig>("config");
  }

  sendBatch(batch: SyncBatchPayload, idempotencyKey: string) {
    return this.call<{ created: number; updated: number; errors: number }>("batches", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
        "idempotency-key": idempotencyKey,
      },
      body: gzipSync(JSON.stringify(batch)),
    });
  }

  heartbeat(info: {
    version: string;
    hostname: string;
    last_error: string | null;
    agent_time: string;
  }) {
    return this.call<{ clock_skew: boolean }>("heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(info),
    });
  }
}
