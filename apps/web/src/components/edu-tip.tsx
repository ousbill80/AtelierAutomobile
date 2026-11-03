"use client";

// Info-bulle pédagogique : ce que le chiffre mesure, puis un exemple concret.
// Survol à la souris, clic ou focus au clavier et au toucher (cible ≥ 44 px).
// Le bouton se place hors du lien ou du bouton de la carte pour ne pas le déclencher.
import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";
import fr from "../../messages/fr.json";

const labels = fr.eduTip;

export function EduTip({ text, example }: { text: string; example?: string }) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const pointer = useRef("mouse");
  const closeTimer = useRef<number | null>(null);
  const id = useId();

  function place() {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(288, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left, window.innerWidth - 12 - width));
    const estimated = example ? 176 : 104;
    const below = r.bottom + 6;
    const top =
      below + estimated > window.innerHeight - 12 && r.top > estimated + 16
        ? Math.max(12, r.top - 6 - estimated)
        : below;
    setBox((prev) =>
      prev && prev.top === top && prev.left === left && prev.width === width
        ? prev
        : { top, left, width },
    );
  }

  const placeRef = useRef(place);
  useEffect(() => {
    placeRef.current = place;
  });

  function show() {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    place();
    setOpen(true);
  }

  function hideSoon() {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 160);
  }

  useEffect(() => {
    if (!open) return;
    function onScroll() {
      placeRef.current();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onDoc(e: PointerEvent) {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || tipRef.current?.contains(target)) return;
      setOpen(false);
    }
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDoc);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDoc);
    };
  }, [open]);

  return (
    <span className="inline-flex">
      <button
        ref={btnRef}
        type="button"
        className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
        aria-expanded={open}
        aria-label={labels.how}
        aria-describedby={open ? id : undefined}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") show();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") hideSoon();
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          pointer.current = e.pointerType;
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (pointer.current === "mouse") show();
          else setOpen((v) => !v);
        }}
        onFocus={show}
        onBlur={(e) => {
          if (tipRef.current?.contains(e.relatedTarget as Node)) return;
          hideSoon();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <Info size={15} aria-hidden />
      </button>
      {open && box && (
        <span
          ref={tipRef}
          id={id}
          role="tooltip"
          style={{ top: box.top, left: box.left, width: box.width }}
          className="fixed z-50 rounded-lg border border-border bg-surface p-3 text-left shadow-lg"
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse") show();
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") hideSoon();
          }}
        >
          <span className="block text-xs font-normal leading-relaxed text-fg">{text}</span>
          {example && (
            <span className="mt-2 block border-l-2 border-accent pl-2.5">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-accent">
                {labels.exampleLabel}
              </span>
              <span className="mt-0.5 block text-xs font-normal leading-relaxed text-fg">
                {example}
              </span>
            </span>
          )}
        </span>
      )}
    </span>
  );
}
