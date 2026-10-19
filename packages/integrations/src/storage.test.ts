import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { assertUploadable, S3ObjectStorage } from "./storage";

describe("assertUploadable", () => {
  it("accepte un type MIME supporté sous la limite de taille", () => {
    expect(() =>
      assertUploadable({ key: "photo.jpg", body: new Uint8Array(100), contentType: "image/jpeg" }),
    ).not.toThrow();
  });

  it("refuse un type MIME non supporté", () => {
    expect(() =>
      assertUploadable({
        key: "script.sh",
        body: new Uint8Array(10),
        contentType: "application/x-sh",
      }),
    ).toThrow(/non supporté/);
  });

  it("refuse un fichier au-delà de la limite (par défaut ou personnalisée)", () => {
    expect(() =>
      assertUploadable({
        key: "big.pdf",
        body: new Uint8Array(1000),
        contentType: "application/pdf",
        maxBytes: 500,
      }),
    ).toThrow(/volumineux/);
  });
});

describe("S3ObjectStorage.upload", () => {
  it("valide le fichier avant d'appeler le client S3", async () => {
    const send = vi.fn().mockResolvedValue({});
    const fakeClient = { send } as unknown as S3Client;
    const storage = new S3ObjectStorage(fakeClient, "atelieros-dev");

    const result = await storage.upload({
      key: "sites/yop/photo.jpg",
      body: new Uint8Array(10),
      contentType: "image/jpeg",
    });

    expect(result).toEqual({ key: "sites/yop/photo.jpg" });
    expect(send).toHaveBeenCalledOnce();
  });

  it("n'appelle jamais le client S3 pour un fichier invalide", async () => {
    const send = vi.fn();
    const fakeClient = { send } as unknown as S3Client;
    const storage = new S3ObjectStorage(fakeClient, "atelieros-dev");

    await expect(
      storage.upload({
        key: "x.exe",
        body: new Uint8Array(10),
        contentType: "application/x-msdownload",
      }),
    ).rejects.toThrow(/non supporté/);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("S3ObjectStorage.getSignedDownloadUrl", () => {
  it("produit une URL signée sans appel réseau (calcul SigV4 local)", async () => {
    const client = new S3Client({
      region: "us-east-1",
      endpoint: "http://localhost:9000",
      forcePathStyle: true,
      credentials: { accessKeyId: "atelieros", secretAccessKey: "atelieros123" },
    });
    const storage = new S3ObjectStorage(client, "atelieros-dev");

    const url = await storage.getSignedDownloadUrl("sites/yop/photo.jpg", 120);

    expect(url).toContain("atelieros-dev");
    expect(url).toContain("X-Amz-Signature");
    expect(url).toContain("X-Amz-Expires=120");
  });
});
