// Polices de l'interface servies depuis le dépôt (next/font/local) : `next build` ne dépend plus
// de Google Fonts (CI hors réseau). Fichiers woff2 statiques Fontsource (SIL OFL 1.1).
//
// Pas de polices variables ni d'empilement latin + latin-ext : les sous-ensembles variables
// se superposent et rendent le texte illisible (« Tableau de bord » → glyphes doublés).
import localFont from "next/font/local";

const sora = localFont({
  src: [
    { path: "./sora/sora-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./sora/sora-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  adjustFontFallback: false,
  variable: "--font-sora",
});

const inter = localFont({
  src: [
    { path: "./inter/inter-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./inter/inter-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./inter/inter-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./inter/inter-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  adjustFontFallback: false,
  variable: "--font-inter",
});

const mono = localFont({
  src: "./jetbrains-mono/jetbrains-mono-latin-400-normal.woff2",
  weight: "400",
  display: "swap",
  adjustFontFallback: false,
  variable: "--font-jetbrains-mono",
});

export const fontClassName = `${sora.variable} ${inter.variable} ${mono.variable} ${inter.className}`;
