"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface Toast {
  id: number;
  kind: "ok" | "err";
  text: string;
}

const ToastContext = createContext<{ push: (kind: Toast["kind"], text: string) => void } | null>(
  null,
);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, kind, text }]);
    setTimeout(() => setToasts((list) => list.filter((toast) => toast.id !== id)), 5000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`} role="status">
            <span className="ic">{toast.kind === "ok" ? "✔" : "⚠"}</span>
            <span>{toast.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  return ctx ?? { push: () => undefined };
}

/** Extrait le code métier structuré (M03 §8) d'une erreur tRPC. */
export function domainCodeOf(
  error: unknown,
): { code: string; details: Record<string, unknown> | null } | null {
  const data = (
    error as {
      data?: { domain?: { code: string; details: Record<string, unknown> | null } };
    } | null
  )?.data;
  return data?.domain ?? null;
}
