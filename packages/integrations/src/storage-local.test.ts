import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalObjectStorage } from "./storage-local";

describe("LocalObjectStorage", () => {
  it("écrit puis relit un objet ; refuse un MIME non autorisé et une clé hors racine", async () => {
    const storage = new LocalObjectStorage(await mkdtemp(path.join(tmpdir(), "atelieros-")));
    const body = new Uint8Array([1, 2, 3]);
    await storage.upload({ key: "org/ro/photo.webp", body, contentType: "image/webp" });
    expect(Array.from(await storage.getObjectBytes("org/ro/photo.webp"))).toEqual([1, 2, 3]);
    await expect(
      storage.upload({ key: "x.exe", body, contentType: "application/x-msdownload" }),
    ).rejects.toThrow(/non supporté/);
    await expect(storage.getObjectBytes("../../etc/passwd")).rejects.toThrow(/invalide/);
    await expect(storage.getObjectBytes("absent.webp")).rejects.toThrow(/introuvable/);
  });
});
