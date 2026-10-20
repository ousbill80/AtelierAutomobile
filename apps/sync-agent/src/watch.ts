// Dossier surveillé (RG-M13-29) : l'ancien logiciel y dépose ses exports (CSV, Excel).
// L'agent lit chaque fichier stable depuis 60 s sur le PC même (lecteur du pipeline
// d'import : encodage, séparateur, en-tête), n'envoie que les lignes changées par le canal
// des lots, puis range le fichier dans `traites/AAAA-MM-JJ/` (ou `erreurs/`).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import {
  batchIdempotencyKey,
  chunkRows,
  ERROR_FOLDER,
  hashSourceRow,
  isFileStable,
  processedFolder,
  ruleForFile,
  type WatchRule,
} from "@atelieros/core";
import { parseImportFile } from "@atelieros/import/pipeline";
import type { AgentApi } from "./api";
import type { LocalStore } from "./store";
import { flushQueue, type FlushResult } from "./sync";

export interface WatchScanResult {
  processed: string[];
  skipped: string[];
  failed: { file: string; error: string }[];
  flush: FlushResult;
}

function moveTo(watchDir: string, subdir: string, fileName: string) {
  const target = path.join(watchDir, subdir);
  mkdirSync(target, { recursive: true });
  let destination = path.join(target, fileName);
  if (existsSync(destination)) destination = path.join(target, `${Date.now()}_${fileName}`);
  renameSync(path.join(watchDir, fileName), destination);
}

export async function scanWatchFolder(input: {
  api: AgentApi;
  store: LocalStore;
  watchDir: string;
  rules: readonly WatchRule[];
  now: Date;
  /** Jour local du garage (`aaaa-mm-jj`) pour le dossier de rangement. */
  localDay: string;
}): Promise<WatchScanResult> {
  const { api, store, watchDir, rules, now, localDay } = input;
  const result: WatchScanResult = {
    processed: [],
    skipped: [],
    failed: [],
    flush: { sent: 0, dropped: 0, remaining: 0, error: null },
  };
  const files = readdirSync(watchDir, { withFileTypes: true }).filter((e) => e.isFile());
  for (const { name } of files) {
    const rule = ruleForFile(name, rules);
    if (!rule) continue;
    const full = path.join(watchDir, name);
    if (!isFileStable(statSync(full).mtime, now)) {
      result.skipped.push(name); // encore en cours d'écriture
      continue;
    }
    const bytes = readFileSync(full);
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (store.isFileProcessed(sha)) {
      moveTo(watchDir, processedFolder(localDay), name);
      result.skipped.push(name);
      continue;
    }
    try {
      const parsed = await parseImportFile(new Uint8Array(bytes), { fileName: name });
      const known = store.loadHashes(rule.entity);
      const changed: string[][] = [];
      for (const row of parsed.rows) {
        const hash = await hashSourceRow(parsed.headers, row);
        if (!known.has(hash)) {
          changed.push(row);
          known.add(hash);
        }
      }
      for (const rows of chunkRows(changed)) {
        const batch = { entity: rule.entity, columns: parsed.headers, rows };
        store.enqueue({
          key: await batchIdempotencyKey(batch),
          createdAt: now.toISOString(),
          batch,
        });
      }
      store.saveHashes(rule.entity, known);
      store.markFileProcessed(sha);
      moveTo(watchDir, processedFolder(localDay), name);
      result.processed.push(name);
    } catch (error) {
      moveTo(watchDir, ERROR_FOLDER, name);
      result.failed.push({ file: name, error: (error as Error).message });
    }
  }
  result.flush = await flushQueue(api, store, now);
  return result;
}
