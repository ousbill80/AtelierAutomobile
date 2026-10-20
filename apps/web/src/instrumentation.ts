// Étape 7.2 — Sentry côté serveur (Node), facultatif : rien n'est chargé sans SENTRY_DSN.
// Pas de SDK navigateur (poids des pages) ni de plugin de build : les erreurs serveur (pages,
// routes, actions, tRPC) suffisent et passent par `onRequestError`.
import type { Instrumentation } from "next";

const enabled = () => process.env.NEXT_RUNTIME === "nodejs" && Boolean(process.env.SENTRY_DSN);

export async function register(): Promise<void> {
  if (!enabled()) return;
  const { initServerSentry } = await import("./server/sentry");
  await initServerSentry();
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!enabled()) return;
  const { captureRequestError } = await import("@sentry/nextjs");
  captureRequestError(...args);
};
