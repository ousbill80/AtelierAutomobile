"use client";

import { useRef, type ChangeEvent } from "react";

export interface CompressedImage {
  /** Contenu base64 sans préfixe data:. */
  base64: string;
  mimeType: "image/webp" | "image/jpeg";
  /** Data URL pour l'aperçu local (et la file hors-ligne). */
  dataUrl: string;
}

/** RG-M04-04 — compression côté client : 1600 px max, WebP (repli JPEG si non supporté). */
export async function compressImage(
  file: Blob,
  maxSize = 1600,
  quality = 0.8,
): Promise<CompressedImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let dataUrl = canvas.toDataURL("image/webp", quality);
  let mimeType: CompressedImage["mimeType"] = "image/webp";
  if (!dataUrl.startsWith("data:image/webp")) {
    dataUrl = canvas.toDataURL("image/jpeg", quality);
    mimeType = "image/jpeg";
  }
  return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mimeType, dataUrl };
}

export type PhotoStatus = "empty" | "uploading" | "done" | "error";

export interface PhotoCaptureProps {
  label: string;
  previewUrl?: string | null;
  status: PhotoStatus;
  takeLabel: string;
  retakeLabel: string;
  errorLabel: string;
  uploadingLabel: string;
  onCapture: (image: CompressedImage) => void;
  onRetry?: () => void;
}

/** M04 — prise de photo guidée (appareil photo arrière), avec état d'envoi et réessai. */
export function PhotoCapture({
  label,
  previewUrl,
  status,
  takeLabel,
  retakeLabel,
  errorLabel,
  uploadingLabel,
  onCapture,
  onRetry,
}: PhotoCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onCapture(await compressImage(file));
  };
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-surface p-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded bg-surface-2">
        {previewUrl ? (
          <img src={previewUrl} alt={label} className="h-full w-full object-cover" />
        ) : (
          <span aria-hidden className="text-3xl text-muted">
            📷
          </span>
        )}
        {status === "uploading" && (
          <span className="absolute inset-x-0 bottom-0 bg-black/60 p-1 text-center text-xs text-white">
            {uploadingLabel}
          </span>
        )}
      </div>
      {status === "error" ? (
        <button type="button" className="btn btn-danger btn-sm" onClick={onRetry}>
          ↻ {errorLabel}
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-secondary btn-sm min-h-11"
          onClick={() => inputRef.current?.click()}
        >
          {previewUrl ? retakeLabel : takeLabel}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-label={label}
        onChange={onFile}
      />
    </div>
  );
}
