"use client";

import { useEffect, useRef, type PointerEvent } from "react";

export interface SignaturePadProps {
  /** Appelé avec une image PNG (data URL) après chaque trait, `null` après effacement. */
  onChange: (dataUrl: string | null) => void;
  label: string;
  clearLabel: string;
}

/** M04 US-M04-04 — signature au doigt (pointer events), exportée en PNG. */
export function SignaturePad({ onChange, label, clearLabel }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111";
  }, []);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const p = point(event);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = point(event);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    hasInk.current = true;
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (hasInk.current && canvasRef.current) onChange(canvasRef.current.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    hasInk.current = false;
    onChange(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        aria-label={label}
        data-testid="signature-pad"
        className="h-40 w-full touch-none rounded-md border-2 border-dashed border-border bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <button type="button" className="btn btn-ghost btn-sm self-start" onClick={clear}>
        {clearLabel}
      </button>
    </div>
  );
}
