"use client";

// Barre de progression fine en haut de l'écran pendant une navigation interne :
// démarre au clic sur un lien, se termine quand le chemin change.
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Phase = "idle" | "loading" | "done";

// Filet de sécurité si la navigation n'aboutit pas (redirection vers la même page, erreur…).
const MAX_LOADING_MS = 10_000;
const DONE_MS = 450;

export function NavigationProgress() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<Phase>("idle");
  const [run, setRun] = useState(0);
  const [lastPathname, setLastPathname] = useState(pathname);

  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    if (phase === "loading") setPhase("done");
  }

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) {
        return;
      }
      setPhase("loading");
      setRun((n) => n + 1);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (phase === "idle") return;
    const timer = setTimeout(
      () => setPhase(phase === "loading" ? "done" : "idle"),
      phase === "loading" ? MAX_LOADING_MS : DONE_MS,
    );
    return () => clearTimeout(timer);
  }, [phase, run]);

  if (phase === "idle") return null;
  return (
    <div
      key={run}
      className={["nav-progress", phase === "done" ? "done" : ""].filter(Boolean).join(" ")}
      aria-hidden="true"
    />
  );
}
