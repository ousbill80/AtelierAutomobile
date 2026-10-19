"use client";

// US-M07-14 — lecture des codes-barres : caméra arrière via l'API `BarcodeDetector`
// (EAN-13, EAN-8, Code 128, QR), bip + vibration à la détection ; repli sur la saisie
// manuelle si l'API ou la caméra est indisponible. `useScannerWedge` capte les douchettes
// USB (saisie clavier rapide terminée par Entrée, < 50 ms entre touches).
import { useEffect, useRef, useState } from "react";
import { isScannerBurst } from "@atelieros/core/inventory";
import { Button } from "./Button";
import { Input } from "./Field";
import { Modal } from "./Modal";

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

export interface BarcodeScannerLabels {
  title: string;
  manualLabel: string;
  manualSubmit: string;
  permissionDenied: string;
  unsupported: string;
  starting: string;
}

export interface BarcodeScannerProps {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
  labels: BarcodeScannerLabels;
}

const FORMATS = ["ean_13", "ean_8", "code_128", "qr_code", "upc_a", "upc_e"];

/** Bip court (WebAudio) et vibration, si disponibles. */
export function scanFeedback(): void {
  try {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      osc.frequency.value = 1200;
      osc.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    }
  } catch {
    // Pas de son disponible : ignoré.
  }
  navigator.vibrate?.(80);
}

export function BarcodeScanner({ open, onClose, onDetected, labels }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "denied" | "unsupported">(
    "starting",
  );
  const [manual, setManual] = useState("");

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const Detector = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
      .BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }
    const detector = new Detector({ formats: FORMATS });
    setStatus("starting");
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then(async (s) => {
        stream = s;
        if (stopped || !videoRef.current) return;
        videoRef.current.srcObject = s;
        await videoRef.current.play().catch(() => undefined);
        setStatus("scanning");
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const code = codes[0]?.rawValue?.trim();
            if (code) {
              scanFeedback();
              onDetected(code);
              return;
            }
          } catch {
            // Image pas encore prête : nouvel essai.
          }
          timer = setTimeout(tick, 250);
        };
        void tick();
      })
      .catch(() => setStatus("denied"));
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, onDetected]);

  return (
    <Modal open={open} title={labels.title} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {status === "starting" || status === "scanning" ? (
          <video
            ref={videoRef}
            className="aspect-video w-full rounded-md bg-black object-cover"
            muted
            playsInline
          />
        ) : (
          <p className="text-sm text-muted" role="status">
            {status === "denied" ? labels.permissionDenied : labels.unsupported}
          </p>
        )}
        {status === "starting" ? <p className="text-sm text-muted">{labels.starting}</p> : null}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim()) {
              onDetected(manual.trim());
              setManual("");
            }
          }}
        >
          <Input
            aria-label={labels.manualLabel}
            placeholder={labels.manualLabel}
            inputMode="numeric"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
          <Button type="submit" variant="secondary">
            {labels.manualSubmit}
          </Button>
        </form>
      </div>
    </Modal>
  );
}

/**
 * Douchette USB : capte une rafale de touches (< 50 ms d'écart) terminée par Entrée hors
 * champ de saisie, et la transmet comme code lu. Les frappes humaines sont ignorées.
 */
export function useScannerWedge(onScan: (code: string) => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    let buffer = "";
    let stamps: number[] = [];
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) return;
      const now = performance.now();
      if (stamps.length > 0 && now - stamps[stamps.length - 1]! >= 50) {
        buffer = "";
        stamps = [];
      }
      if (e.key === "Enter") {
        if (isScannerBurst(stamps) && buffer.length >= 6) {
          scanFeedback();
          onScan(buffer);
        }
        buffer = "";
        stamps = [];
        return;
      }
      if (e.key.length === 1) {
        buffer += e.key;
        stamps.push(now);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onScan, enabled]);
}
