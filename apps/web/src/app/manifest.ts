import type { MetadataRoute } from "next";

// M06 §13 — PWA tablette installable (écran d'accueil de la tablette d'atelier).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AtelierOS — Tablette atelier",
    short_name: "Atelier",
    description: "Tâches, pointage et inspection du mécanicien, même sans réseau.",
    start_url: "/tablette",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#0f172a",
    lang: "fr",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
