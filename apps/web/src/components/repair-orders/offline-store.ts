// US-M04-01 — réception hors-ligne : la saisie (photos comprises, en data URL compressées) est
// conservée dans IndexedDB et renvoyée au retour du réseau (idempotence `clientRequestId`).
const DB_NAME = "atelieros-reception";
const STORE = "drafts";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const request = fn(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export interface StoredDraft<T> {
  key: string;
  savedAt: string;
  /** "draft" = saisie en cours ; "pending" = validée, envoi en attente du réseau. */
  state: "draft" | "pending";
  data: T;
}

export async function saveDraft<T>(draft: StoredDraft<T>): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    await run("readwrite", (s) => s.put(draft, "current"));
  } catch {
    // Stockage indisponible (navigation privée) : la saisie reste en mémoire.
  }
}

export async function loadDraft<T>(): Promise<StoredDraft<T> | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    return ((await run("readonly", (s) => s.get("current"))) as StoredDraft<T> | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function clearDraft(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    await run("readwrite", (s) => s.delete("current"));
  } catch {
    // ignoré
  }
}
