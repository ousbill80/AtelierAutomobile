// Cycle de synchronisation de l'agent (RG-M13-28) : télécharge la configuration, exécute
// les requêtes **localement** (lecture seule), ne garde que les lignes dont l'empreinte a
// changé, les découpe en lots de 500 placés dans une file locale durable, puis vide la file
// vers AtelierOS. Si internet est coupé, les lots attendent (7 jours au plus).
import {
  AGENT_QUEUE_RETENTION_MS,
  assertReadOnlySelect,
  batchIdempotencyKey,
  chunkRows,
  hashSourceRow,
  sinceFor,
  SYNC_ENTITY_ORDER,
} from "@atelieros/core";
import type { ExternalDatabase } from "@atelieros/integrations";
import { AgentApiError, type AgentApi } from "./api";
import type { LocalStore } from "./store";

export interface FlushResult {
  sent: number;
  dropped: number;
  remaining: number;
  error: string | null;
}

/** Envoie les lots en attente, du plus ancien au plus récent ; s'arrête à la 1re coupure. */
export async function flushQueue(
  api: AgentApi,
  store: LocalStore,
  now: Date,
): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, dropped: 0, remaining: 0, error: null };
  const pending = store.pending();
  for (let i = 0; i < pending.length; i++) {
    const { file, item } = pending[i]!;
    if (now.getTime() - new Date(item.createdAt).getTime() > AGENT_QUEUE_RETENTION_MS) {
      store.remove(file);
      result.dropped++;
      continue;
    }
    try {
      await api.sendBatch(item.batch, item.key);
      store.remove(file);
      result.sent++;
    } catch (error) {
      const e = error as AgentApiError;
      result.error = e.message;
      if (e instanceof AgentApiError && e.status === 422) {
        // Lot refusé définitivement : on l'écarte pour ne pas bloquer la file.
        store.remove(file);
        result.dropped++;
        continue;
      }
      result.remaining = pending.length - i;
      if (e instanceof AgentApiError && e.status === 401) throw e; // agent révoqué
      return result;
    }
  }
  return result;
}

export interface RunSyncResult {
  skipped: boolean;
  queued: Record<string, number>;
  flush: FlushResult;
}

export async function runSync(input: {
  api: AgentApi;
  store: LocalStore;
  db: ExternalDatabase;
  now: Date;
}): Promise<RunSyncResult> {
  const { api, store, db, now } = input;
  const state = store.loadState();
  const config = await api.getConfig();
  const queued: Record<string, number> = {};
  if (!config.active) {
    return { skipped: true, queued, flush: await flushQueue(api, store, now) };
  }
  const since = sinceFor(state.lastSuccessAt ? new Date(state.lastSuccessAt) : null);
  try {
    for (const entity of SYNC_ENTITY_ORDER) {
      const sql = config.queries[entity];
      if (!sql) continue;
      assertReadOnlySelect(sql); // double contrôle : le serveur a déjà validé la requête
      const result = await db.query(sql, since);
      const known = store.loadHashes(entity);
      const changed: string[][] = [];
      for (const row of result.rows) {
        const hash = await hashSourceRow(result.columns, row);
        if (!known.has(hash)) {
          changed.push(row);
          known.add(hash);
        }
      }
      for (const rows of chunkRows(changed)) {
        const batch = { entity, columns: result.columns, rows };
        store.enqueue({
          key: await batchIdempotencyKey(batch),
          createdAt: now.toISOString(),
          batch,
        });
      }
      // La file est durable : le cache peut être mis à jour dès la mise en file.
      store.saveHashes(entity, known);
      queued[entity] = changed.length;
    }
  } catch (error) {
    store.saveState({
      ...state,
      lastRunAt: now.toISOString(),
      lastError: (error as Error).message,
    });
    throw error;
  } finally {
    await db.close();
  }
  const flush = await flushQueue(api, store, now);
  store.saveState({
    lastRunAt: now.toISOString(),
    lastSuccessAt: flush.remaining === 0 ? now.toISOString() : state.lastSuccessAt,
    lastError: flush.error,
  });
  return { skipped: false, queued, flush };
}
