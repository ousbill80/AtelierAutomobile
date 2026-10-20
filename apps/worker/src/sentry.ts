// Étape 7.2 — initialisation de Sentry pour le worker Node, sans données personnelles :
// `sendDefaultPii: false`, puis nettoyage systématique par `scrubErrorEvent` et `scrubBreadcrumb`.
import { scrubBreadcrumb, scrubErrorEvent } from "@atelieros/core/observability";

export async function initWorkerSentry(): Promise<void> {
  const Sentry = await import("@sentry/node");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.APP_ENV || "development",
    release: process.env.ATELIEROS_VERSION,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubErrorEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  });
}
