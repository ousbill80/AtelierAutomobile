"use client";

// M06 RG-M06-13/14 — moteur hors-ligne de la tablette : instantané en cache, file d'opérations
// avec `clientOpId` (UUID v4), synchronisation au retour du réseau, à l'ouverture et toutes les
// 60 s si en ligne ; lots de 200 dans l'ordre `seq` ; rejets conservés avec leur motif.
import { useCallback, useEffect, useRef, useState } from "react";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "@/trpc/react";
import { getDeviceId } from "@/trpc/device-id";
import type { TechSnapshot } from "@/components/workshop/types";
import { applyLocalOp, replayPending } from "./local";
import {
  addOp,
  addPhoto as storePhoto,
  listOps,
  listPhotos,
  loadMeta,
  loadSnapshot,
  removeOps,
  removePhoto,
  saveMeta,
  saveSnapshot,
  type OutboxOp,
  type PendingPhoto,
  type SyncRejection,
  type TabletMeta,
} from "./store";

const SYNC_INTERVAL_MS = 60_000;
const BATCH = 200;

export type NewOp = { type: string } & Record<string, unknown>;

function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (error instanceof TRPCClientError) return !error.data;
  return error instanceof TypeError;
}

export function useTablet() {
  const utils = trpc.useUtils();
  const [snapshot, setSnapshot] = useState<TechSnapshot | null>(null);
  const [meta, setMeta] = useState<TabletMeta | null>(null);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const syncing = useRef(false);
  const snapshotRef = useRef<TechSnapshot | null>(null);
  const metaRef = useRef<TabletMeta | null>(null);

  const publish = useCallback((snap: TechSnapshot | null) => {
    snapshotRef.current = snap;
    setSnapshot(snap);
  }, []);

  const writeMeta = useCallback(async (next: TabletMeta) => {
    metaRef.current = next;
    setMeta(next);
    await saveMeta(next);
  }, []);

  const syncNow = useCallback(async () => {
    if (syncing.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    syncing.current = true;
    const current = metaRef.current ?? (await loadMeta());
    const rejections: SyncRejection[] = [...current.rejections];
    let offsetMs = current.serverOffsetMs;
    try {
      // 1. Photos en attente (US-M06-06) : idempotentes par clientOpId.
      for (const photo of await listPhotos()) {
        try {
          await utils.client.tech.uploadPhoto.mutate({
            clientOpId: photo.clientOpId,
            lineId: photo.lineId,
            mimeType: photo.mimeType,
            dataBase64: photo.dataBase64,
          });
          await removePhoto(photo.clientOpId);
        } catch (error) {
          if (isNetworkError(error)) throw error;
          rejections.push({
            clientOpId: photo.clientOpId,
            type: "photo.attach",
            error: error instanceof Error ? error.message : String(error),
          });
          await removePhoto(photo.clientOpId);
        }
      }
      // 2. Opérations, par lots ordonnés.
      let ops = await listOps();
      const total = ops.length;
      let done = 0;
      if (total > 0) setProgress({ done, total });
      while (ops.length > 0) {
        const batch = ops.slice(0, BATCH);
        const result = await utils.client.tech.sync.mutate({
          deviceId: getDeviceId(),
          deviceNow: new Date(),
          previousOffsetMs: offsetMs,
          ops: batch.map(({ seq, ...rest }) => ({ ...rest, seq })) as never,
        });
        offsetMs = result.serverOffsetMs;
        const handled: number[] = [];
        for (const r of result.results) {
          const op = batch.find((o) => o.clientOpId === r.clientOpId);
          if (!op || r.retry) continue;
          handled.push(op.seq);
          if (r.status === "rejected") {
            rejections.push({ clientOpId: op.clientOpId, type: op.type, error: r.error ?? "" });
          }
        }
        await removeOps(handled);
        done += handled.length;
        setProgress({ done, total });
        if (handled.length === 0) break;
        ops = await listOps();
      }
      // 3. Instantané à jour + ré-application des opérations restantes.
      const fresh = await utils.client.tech.bootstrap.query({});
      await saveSnapshot(fresh);
      publish(replayPending(fresh, await listOps()));
      setLoadError(false);
      await writeMeta({ ...current, lastSyncAt: new Date(), serverOffsetMs: offsetMs, rejections });
    } catch (error) {
      if (!isNetworkError(error)) {
        setLoadError(!snapshotRef.current);
      }
      await writeMeta({ ...current, serverOffsetMs: offsetMs, rejections });
    } finally {
      setPending((await listOps()).length + (await listPhotos()).length);
      setProgress(null);
      syncing.current = false;
    }
  }, [publish, utils, writeMeta]);

  // Ouverture : cache local d'abord, puis synchro si en ligne.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [cached, storedMeta, ops, photos] = await Promise.all([
        loadSnapshot(),
        loadMeta(),
        listOps(),
        listPhotos(),
      ]);
      if (cancelled) return;
      metaRef.current = storedMeta;
      setMeta(storedMeta);
      setPending(ops.length + photos.length);
      if (cached) publish(replayPending(cached, ops));
      setOnline(navigator.onLine);
      setLoaded(true);
      await syncNow();
    })();
    return () => {
      cancelled = true;
    };
  }, [publish, syncNow]);

  useEffect(() => {
    const up = () => {
      setOnline(true);
      void syncNow();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const timer = window.setInterval(() => {
      if (navigator.onLine) void syncNow();
    }, SYNC_INTERVAL_MS);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      window.clearInterval(timer);
    };
  }, [syncNow]);

  /** Met une opération en file, l'applique localement et tente l'envoi si en ligne. */
  const enqueue = useCallback(
    async (op: NewOp) => {
      const snap = snapshotRef.current;
      if (!snap) return;
      const current = metaRef.current ?? (await loadMeta());
      const seq = Math.max(current.seq + 1, Date.now());
      // Réservé tout de suite : deux appuis rapprochés n'obtiennent jamais le même `seq`.
      metaRef.current = { ...current, seq };
      const full: OutboxOp = {
        ...op,
        seq,
        clientOpId: crypto.randomUUID(),
        at: new Date(),
        actorMembershipId: snap.membershipId,
        offline: !navigator.onLine,
      };
      await addOp(full);
      await writeMeta(metaRef.current);
      publish(applyLocalOp(snap, full));
      setPending((p) => p + 1);
      if (navigator.onLine) void syncNow();
    },
    [publish, syncNow, writeMeta],
  );

  /** Photo compressée stockée localement puis envoyée à la synchro (US-M06-06). */
  const addPhoto = useCallback(
    async (photo: Omit<PendingPhoto, "clientOpId" | "createdAt">) => {
      await storePhoto({ ...photo, clientOpId: crypto.randomUUID(), createdAt: new Date() });
      const snap = snapshotRef.current;
      if (snap) {
        publish({
          ...snap,
          tasks: snap.tasks.map((t) =>
            t.id === photo.lineId ? { ...t, photoCount: t.photoCount + 1 } : t,
          ),
        });
      }
      setPending((p) => p + 1);
      if (navigator.onLine) void syncNow();
    },
    [publish, syncNow],
  );

  const dismissRejections = useCallback(async () => {
    const current = metaRef.current ?? (await loadMeta());
    await writeMeta({ ...current, rejections: [] });
  }, [writeMeta]);

  return {
    snapshot,
    meta,
    pending,
    online,
    progress,
    loaded,
    loadError,
    syncNow,
    enqueue,
    addPhoto,
    dismissRejections,
  };
}

export type Tablet = ReturnType<typeof useTablet>;
