// Stockage local de l'agent (dossier de données, droits 0600) : configuration, état,
// cache des empreintes de lignes et file des lots en attente (RG-M13-28 : « file locale si
// internet coupé, renvoi au retour du réseau, rétention 7 jours »).
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { ExternalDbConfig } from "@atelieros/integrations";
import type { SyncBatchPayload } from "./api";

export interface LocalConfig {
  serverUrl: string;
  /** Jeton sync:push. Écart RG-M13-28 : fichier 0600, pas encore chiffré par DPAPI Windows. */
  token: string | null;
  /** Connexion à la base locale : ne quitte jamais le PC du garage. */
  db: ExternalDbConfig;
}

export interface AgentState {
  lastSuccessAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
}

export interface QueuedBatch {
  key: string;
  createdAt: string;
  batch: SyncBatchPayload;
}

function writePrivate(file: string, content: string) {
  writeFileSync(file, content, { encoding: "utf8", mode: 0o600 });
  chmodSync(file, 0o600);
}

export class LocalStore {
  constructor(readonly dir: string) {
    mkdirSync(path.join(dir, "queue"), { recursive: true, mode: 0o700 });
    mkdirSync(path.join(dir, "cache"), { recursive: true, mode: 0o700 });
  }

  private readJson<T>(file: string, fallback: T): T {
    const p = path.join(this.dir, file);
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : fallback;
  }

  loadConfig(): LocalConfig | null {
    return this.readJson<LocalConfig | null>("agent.config.json", null);
  }

  saveConfig(config: LocalConfig) {
    writePrivate(path.join(this.dir, "agent.config.json"), JSON.stringify(config, null, 2));
  }

  loadState(): AgentState {
    return this.readJson<AgentState>("state.json", {
      lastSuccessAt: null,
      lastRunAt: null,
      lastError: null,
    });
  }

  saveState(state: AgentState) {
    writePrivate(path.join(this.dir, "state.json"), JSON.stringify(state));
  }

  /** Empreintes des lignes déjà envoyées, par entité. */
  loadHashes(entity: string): Set<string> {
    return new Set(this.readJson<string[]>(path.join("cache", `${entity}.json`), []));
  }

  saveHashes(entity: string, hashes: Set<string>) {
    writePrivate(path.join(this.dir, "cache", `${entity}.json`), JSON.stringify([...hashes]));
  }

  private sequence = 0;

  /**
   * Nom = horodatage + séquence : l'ordre d'envoi suit l'ordre de mise en file (clients avant
   * véhicules avant factures, RG-M13-17), même pour des lots créés dans la même milliseconde.
   */
  enqueue(item: QueuedBatch) {
    const seq = String(this.sequence++).padStart(9, "0");
    const name = `${item.createdAt.replace(/[:.]/g, "-")}_${seq}_${item.key.slice(0, 16)}.json`;
    writePrivate(path.join(this.dir, "queue", name), JSON.stringify(item));
  }

  /** Lots en attente, du plus ancien au plus récent. */
  pending(): { file: string; item: QueuedBatch }[] {
    const dir = path.join(this.dir, "queue");
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => ({
        file: path.join(dir, f),
        item: JSON.parse(readFileSync(path.join(dir, f), "utf8")) as QueuedBatch,
      }));
  }

  remove(file: string) {
    rmSync(file, { force: true });
  }
}
