// 01-architecture-technique.md §8 & Étape 7.1 — en-têtes HTTP de sécurité et CSP
// Définitions pures et configurables réutilisables dans middleware Next.js ou serveurs web.

export interface SecurityHeadersConfig {
  /** Mode HTTPS strict (HSTS) */
  enableHsts?: boolean;
  /** Durée max HSTS en secondes (défaut 2 ans = 63072000) */
  hstsMaxAgeSeconds?: number;
  /** Inclure les sous-domaines dans HSTS */
  hstsIncludeSubDomains?: boolean;
  /** Autoriser le préchargement HSTS */
  hstsPreload?: boolean;
  /** URL de rapport CSP éventuelle */
  cspReportUri?: string;
  /** Autoriser les connexions API/S3 externes ou locales */
  connectSources?: string[];
}

/**
 * Construit la chaîne Content-Security-Policy (CSP) stricte mais compatible avec Next.js et AtelierOS.
 * - default-src 'self'
 * - script-src 'self' 'unsafe-inline' (nécessaire à Next.js scripts inline & hydratation)
 * - style-src 'self' 'unsafe-inline' (Tailwind et styles dynamiques)
 * - img-src 'self' data: blob: https: (badges, photos d'OR, QR codes FNE, illustrations)
 * - font-src 'self' data:
 * - frame-ancestors 'none' (anti-clickjacking strict)
 * - form-action 'self'
 * - base-uri 'self'
 * - object-src 'none'
 */
export function buildContentSecurityPolicy(config: SecurityHeadersConfig = {}): string {
  const connectSrc = ["'self'", "data:", "blob:"];
  if (config.connectSources && config.connectSources.length > 0) {
    connectSrc.push(...config.connectSources);
  }

  const directives: string[] = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(" ")}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "block-all-mixed-content",
  ];

  if (config.cspReportUri) {
    directives.push(`report-uri ${config.cspReportUri}`);
  }

  return directives.join("; ");
}

/**
 * Retourne le dictionnaire complet d'en-têtes HTTP de sécurité recommandé (OWASP / 01 §8).
 */
export function getSecurityHeaders(config: SecurityHeadersConfig = {}): Record<string, string> {
  const headers: Record<string, string> = {
    // Anti-reniflage de type MIME
    "X-Content-Type-Options": "nosniff",
    // Anti-clickjacking pour les navigateurs anciens (frame-ancestors gère les modernes)
    "X-Frame-Options": "DENY",
    // Protection XSS historique
    "X-XSS-Protection": "1; mode=block",
    // Contrôle strict du référent : ne jamais faire fuiter les chemins d'URL complets
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Désactivation des fonctionnalités sensibles du navigateur non nécessaires
    // Réception / inspection : photo et dictée vocale restent autorisées sur l'origine.
    "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(), payment=()",
    // CSP complet
    "Content-Security-Policy": buildContentSecurityPolicy(config),
  };

  if (config.enableHsts ?? true) {
    const maxAge = config.hstsMaxAgeSeconds ?? 63072000; // 2 ans
    const parts = [`max-age=${maxAge}`];
    if (config.hstsIncludeSubDomains ?? true) parts.push("includeSubDomains");
    if (config.hstsPreload ?? true) parts.push("preload");
    headers["Strict-Transport-Security"] = parts.join("; ");
  }

  return headers;
}
