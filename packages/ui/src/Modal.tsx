import type { ReactNode } from "react";

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  size?: "md" | "lg";
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, title, onClose, size = "md", children, footer }: ModalProps) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
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
