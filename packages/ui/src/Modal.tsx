"use client";

import { useEffect, useState, type ReactNode } from "react";

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  size?: "md" | "lg";
  children: ReactNode;
  footer?: ReactNode;
}

// Durée de l'animation de sortie (motion.css : --dur-base).
const EXIT_MS = 200;

export function Modal({ open, title, onClose, size = "md", children, footer }: ModalProps) {
  // La modale reste montée le temps de son animation de sortie.
  const [rendered, setRendered] = useState(open);
  if (open && !rendered) setRendered(true);
  const closing = rendered && !open;

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setRendered(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [closing]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!rendered) return null;
  return (
    <div
      className={["modal-backdrop", closing ? "closing" : ""].filter(Boolean).join(" ")}
      onClick={closing ? undefined : onClose}
      aria-hidden={closing || undefined}
    >
      <div
        className={["modal", size === "lg" ? "modal-lg" : ""].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" aria-label="Fermer" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}
