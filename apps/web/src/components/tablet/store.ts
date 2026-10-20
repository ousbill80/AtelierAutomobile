// M06 §6 / RG-M06-13 — stockage local de la tablette (IndexedDB natif, base `atelieros-tech`,
// même découpage que le schéma Dexie du PRD) : instantané des tâches et inspections, file
// d'opérations (`outbox`, une entrée par `clientOpId`), photos en attente (`blobs`), méta
// (dernière synchro, décalage d'horloge, compteur de séquence).
import type { TechSnapshot } from "@/components/workshop/types";

const DB_NAME = "atelieros-tech";
const VERSION = 1;

export interface OutboxOp {
  seq: number;
  clientOpId: string;
  type: string;
  at: Date;
  actorMembershipId: string;
  offline: boolean;
  [key: string]: unknown;
}

export interface PendingPhoto {
  clientOpId: string;
  lineId: string;
  mimeType: "image/webp" | "image/jpeg" | "image/png";
  dataBase64: string;
  createdAt: Date;
}

export interface SyncRejection {
  clientOpId: string;
  type: string;
  error: string;
}

export interface TabletMeta {
  lastSyncAt: Date | null;
  serverOffsetMs: number | null;
  seq: number;
  rejections: SyncRejection[];
}

const DEFAULT_META: TabletMeta = { lastSyncAt: null, serverOffsetMs: null, seq: 0, rejections: [] };

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("snapshot");
      db.createObjectStore("outbox", { keyPath: "seq" }).createIndex("clientOpId", "clientOpId", {
        unique: true,
      });
      db.createObjectStore("blobs", { keyPath: "clientOpId" });
      db.createObjectStore("meta");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

async function run<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error ?? request.error);
    tx.onabort = () => reject(tx.error ?? request.error);
  });
}

export function storageAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

export async function loadSnapshot(): Promise<TechSnapshot | null> {
  if (!storageAvailable()) return null;
  try {
    return ((await run("snapshot", "readonly", (s) => s.get("current"))) as TechSnapshot) ?? null;
  } catch {
    return null;
  }
}

export async function saveSnapshot(snapshot: TechSnapshot): Promise<void> {
  if (!storageAvailable()) return;
  await run("snapshot", "readwrite", (s) => s.put(snapshot, "current"));
}

export async function loadMeta(): Promise<TabletMeta> {
  if (!storageAvailable()) return { ...DEFAULT_META };
  try {
    const meta = (await run("meta", "readonly", (s) => s.get("meta"))) as TabletMeta | undefined;
    return { ...DEFAULT_META, ...meta };
  } catch {
    return { ...DEFAULT_META };
  }
}

export async function saveMeta(meta: TabletMeta): Promise<void> {
  if (!storageAvailable()) return;
  await run("meta", "readwrite", (s) => s.put(meta, "meta"));
}

export async function addOp(op: OutboxOp): Promise<void> {
  await run("outbox", "readwrite", (s) => s.put(op));
}

export async function listOps(): Promise<OutboxOp[]> {
  if (!storageAvailable()) return [];
  const ops = (await run("outbox", "readonly", (s) => s.getAll())) as OutboxOp[];
  return ops.sort((a, b) => a.seq - b.seq);
}

export async function removeOps(seqs: number[]): Promise<void> {
  if (seqs.length === 0) return;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("outbox", "readwrite");
    for (const seq of seqs) tx.objectStore("outbox").delete(seq);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function addPhoto(photo: PendingPhoto): Promise<void> {
  await run("blobs", "readwrite", (s) => s.put(photo));
}

export async function listPhotos(): Promise<PendingPhoto[]> {
  if (!storageAvailable()) return [];
  return (await run("blobs", "readonly", (s) => s.getAll())) as PendingPhoto[];
}

export async function removePhoto(clientOpId: string): Promise<void> {
  await run("blobs", "readwrite", (s) => s.delete(clientOpId));
}

/** Quota IndexedDB dépassé (§11 : « Mémoire pleine »). */
export function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}
