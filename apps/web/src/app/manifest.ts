import type { MetadataRoute } from "next";

// PWA — AtelierOS installable sur téléphone, tablette et ordinateur (écran d'accueil,
// plein écran, notifications push). La tablette d'atelier (M06 §13) a son propre manifeste :
// public/manifest-tablette.webmanifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AtelierOS — Gestion d'atelier",
    short_name: "AtelierOS",
    description:
      "Rendez-vous, ordres de réparation, factures, créances et relances automatiques de votre garage.",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait-primary",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    lang: "fr",
    dir: "ltr",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Relances du jour",
        short_name: "Relances",
        url: "/relances?source=pwa",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Créances",
        short_name: "Créances",
        url: "/creances?source=pwa",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Rendez-vous du jour",
        short_name: "RDV",
        url: "/rendez-vous/aujourdhui?source=pwa",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Notifications",
        short_name: "Alertes",
        url: "/notifications?source=pwa",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
