// Agent local AtelierOS (RG-M13-28) — ligne de commande.
//   pair  --server https://app.atelieros.ci --code ABCD2345 --db-type mssql --host … --database … --user … --password …
//         [--watch-dir D:\Exports]  (dossier surveillé, RG-M13-29)
//   once  : une synchronisation immédiate
//   start : service (battement toutes les 5 min, synchro selon le planning, renvoi de la file)
// Dossier de données : ATELIEROS_AGENT_DIR, sinon %ProgramData%\AtelierOS\agent, sinon ~/.atelieros-agent.
import { hostname, homedir } from "node:os";
import path from "node:path";
import { AGENT_HEARTBEAT_INTERVAL_MS, isSyncDue, localDay, type WatchRule } from "@atelieros/core";
import { createExternalDatabase, type ExternalDbType } from "@atelieros/integrations";
import { AgentApi, AgentApiError } from "./api";
import { LocalStore } from "./store";
import { flushQueue, runSync } from "./sync";
import { scanWatchFolder } from "./watch";

export const AGENT_VERSION = "0.1.0";

function dataDir(): string {
  if (process.env.ATELIEROS_AGENT_DIR) return process.env.ATELIEROS_AGENT_DIR;
  if (process.env.ProgramData) return path.join(process.env.ProgramData, "AtelierOS", "agent");
  return path.join(homedir(), ".atelieros-agent");
}

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function log(message: string) {
  process.stdout.write(`[${new Date().toISOString()}] ${message}\n`);
}

async function pair(store: LocalStore, args: string[]) {
  const server = arg(args, "server");
  const code = arg(args, "code");
  const dbType = arg(args, "db-type") as ExternalDbType | undefined;
  if (!server || !code || !dbType) {
    throw new Error(
      "Usage : pair --server URL --code CODE --db-type mssql|mysql|postgres --host … --database … --user … --password …",
    );
  }
  const api = new AgentApi(server, null);
  const result = await api.pair(code, { hostname: hostname(), version: AGENT_VERSION });
  store.saveConfig({
    serverUrl: server,
    token: result.token,
    db: {
      dbType,
      host: arg(args, "host"),
      port: arg(args, "port") ? Number(arg(args, "port")) : undefined,
      database: arg(args, "database"),
      user: arg(args, "user"),
      password: arg(args, "password"),
      ssl: args.includes("--ssl"),
    },
    watchDir: arg(args, "watch-dir"),
  });
  log(`Agent appairé au garage « ${result.organization_name} ».`);
}

function connect(store: LocalStore) {
  const config = store.loadConfig();
  if (!config?.token) throw new Error("Agent non appairé : lancez d'abord la commande « pair ».");
  return { config, api: new AgentApi(config.serverUrl, config.token) };
}

async function heartbeat(store: LocalStore, api: AgentApi) {
  const res = await api.heartbeat({
    version: AGENT_VERSION,
    hostname: hostname(),
    last_error: store.loadState().lastError,
    agent_time: new Date().toISOString(),
  });
  if (res.clock_skew) log("Attention : l'horloge de ce PC est décalée de plus de 5 minutes.");
}

async function once(store: LocalStore) {
  const { config, api } = connect(store);
  const result = await runSync({
    api,
    store,
    db: createExternalDatabase(config.db),
    now: new Date(),
  });
  log(
    `Synchronisation : ${JSON.stringify(result.queued)} ligne(s) changée(s), ${result.flush.sent} lot(s) envoyé(s), ${result.flush.remaining} en attente.`,
  );
  await heartbeat(store, api);
}

async function start(store: LocalStore) {
  const { config, api } = connect(store);
  let lastHeartbeat = 0;
  log("Agent AtelierOS démarré.");
  for (;;) {
    const now = new Date();
    try {
      if (now.getTime() - lastHeartbeat >= AGENT_HEARTBEAT_INTERVAL_MS) {
        await heartbeat(store, api);
        lastHeartbeat = now.getTime();
      }
      const remote = await api.getConfig();
      const state = store.loadState();
      const reference = state.lastRunAt ? new Date(state.lastRunAt) : new Date(0);
      if (remote.active && isSyncDue(remote.schedule, reference, now, remote.timezone)) {
        await once(store);
      } else if (store.pending().length > 0) {
        await flushQueue(api, store, now);
      }
      if (config.watchDir && remote.active && remote.watch_rules.length > 0) {
        const scan = await scanWatchFolder({
          api,
          store,
          watchDir: config.watchDir,
          rules: remote.watch_rules as WatchRule[],
          now,
          localDay: localDay(now, remote.timezone),
        });
        for (const failed of scan.failed)
          log(`Fichier rangé dans erreurs/ : ${failed.file} (${failed.error})`);
        if (scan.processed.length > 0) log(`Fichiers traités : ${scan.processed.join(", ")}`);
      }
    } catch (error) {
      if (error instanceof AgentApiError && error.status === 401) {
        log("Agent révoqué depuis AtelierOS : arrêt.");
        return;
      }
      log(`Erreur : ${(error as Error).message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const store = new LocalStore(dataDir());
  switch (command) {
    case "pair":
      return pair(store, args);
    case "once":
      return once(store);
    case "start":
      return start(store);
    default:
      log("Commandes : pair | once | start");
  }
}

// Exécuté seulement en ligne de commande (pas à l'import dans les tests).
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((error: unknown) => {
    log(`Erreur : ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
