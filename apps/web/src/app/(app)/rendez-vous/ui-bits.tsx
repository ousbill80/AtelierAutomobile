"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { ta } from "./labels";

/** Panneau latéral (plein écran sur mobile, §7). */
export function SidePanel({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-[2px] transition-opacity" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex h-full w-full flex-col overflow-y-auto bg-surface shadow-2xl border-l border-border md:w-[500px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface/95 backdrop-blur-sm px-5 py-3.5">
          <h2 className="text-base font-bold text-foreground">{title}</h2>
          <button
            type="button"
            aria-label={ta("panel.close")}
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-surface-2 transition"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex flex-col gap-4 p-5">{children}</div>
      </aside>
    </div>
  );
}

export type ToastState = { message: string; tone: "ok" | "bad" } | null;

export function Toast({
  toast,
  onDone,
  onClose,
}: {
  toast: ToastState;
  onDone?: () => void;
  onClose?: () => void;
}) {
  const dismiss = onDone ?? onClose ?? (() => {});
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(dismiss, 5000);
    return () => window.clearTimeout(id);
  }, [toast, dismiss]);
  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-lg border px-4 py-3 text-sm shadow-lg ${
        toast.tone === "bad"
          ? "border-status-bad bg-status-bad-bg text-status-bad"
          : "border-status-ok bg-status-ok-bg text-status-ok"
      }`}
    >
      {toast.message}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-status-bad bg-status-bad-bg p-4">
      <p className="text-sm text-status-bad">{message}</p>
      <button type="button" className="btn btn-secondary btn-sm min-h-11" onClick={onRetry}>
        {ta("retry")}
      </button>
    </div>
  );
}

/** Jauge colorée (vert < 70 %, orange 70-90 %, rouge > 90 %) + texte. */
export function Gauge({
  ratio,
  tone,
  label,
}: {
  ratio: number;
  tone: "ok" | "warn" | "bad";
  label: string;
}) {
  const color =
    tone === "bad" ? "bg-status-bad" : tone === "warn" ? "bg-status-warn" : "bg-status-ok";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
        role="meter"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={`h-full ${color}`}
          style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
        />
      </div>
      <span className="truncate text-xs text-muted">{label}</span>
    </div>
  );
}
