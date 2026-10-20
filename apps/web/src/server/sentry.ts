// Étape 7.2 — initialisation de Sentry pour le serveur web, sans données personnelles :
// `sendDefaultPii: false`, puis nettoyage systématique (cookies, en-têtes, corps, jetons du
// portail, e-mails, téléphones) par `scrubErrorEvent` de `@atelieros/core/observability`.
import { scrubBreadcrumb, scrubErrorEvent } from "@atelieros/core/observability";

export async function initServerSentry(): Promise<void> {
  const Sentry = await import("@sentry/nextjs");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.APP_ENV || "development",
    release: process.env.ATELIEROS_VERSION,
    // Erreurs seulement : pas de traces de performance (volume, données de requêtes).
    tracesSampleRate: 0,
    beforeSend: (event) => scrubErrorEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  });
}
