// Polices de l'interface servies depuis le dépôt (next/font/local) : `next build` ne dépend plus
// de Google Fonts (CI hors réseau). Fichiers woff2 variables de Fontsource (@fontsource-variable,
// v5.3.0), sous-ensembles latin et latin-ext, licence SIL OFL 1.1 (OFL.txt dans chaque dossier).
//
// next/font/local n'accepte pas d'unicode-range par fichier : chaque sous-ensemble est une
// famille à part (avec sa plage), et la variable CSS empile les deux familles — le navigateur ne
// télécharge que celle dont il a besoin, comme avec next/font/google.
import localFont from "next/font/local";

// Plages unicode des sous-ensembles Google Fonts « latin » et « latin-ext », écrites en clair :
// next/font exige des littéraux dans ses options (pas de constantes).

const soraLatin = localFont({
  src: "./sora/sora-latin-wght-normal.woff2",
  weight: "100 800",
  display: "swap",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    },
  ],
});
const soraLatinExt = localFont({
  src: "./sora/sora-latin-ext-wght-normal.woff2",
  weight: "100 800",
  display: "swap",
  preload: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
    },
  ],
});

const interLatin = localFont({
  src: "./inter/inter-latin-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    },
  ],
});
const interLatinExt = localFont({
  src: "./inter/inter-latin-ext-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  preload: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
    },
  ],
});

const monoLatin = localFont({
  src: "./jetbrains-mono/jetbrains-mono-latin-wght-normal.woff2",
  weight: "100 800",
  display: "swap",
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    },
  ],
});
const monoLatinExt = localFont({
  src: "./jetbrains-mono/jetbrains-mono-latin-ext-wght-normal.woff2",
  weight: "100 800",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
    },
  ],
});

/**
 * Pile « latin, latin-ext, puis police de secours ajustée » : la police de secours (sans
 * unicode-range) ne doit pas passer avant la famille latin-ext, sinon elle capterait ses glyphes.
 */
function stack(latin: { style: { fontFamily: string } }, ext: { style: { fontFamily: string } }) {
  const [primary, ...fallback] = latin.style.fontFamily.split(", ");
  const [extended] = ext.style.fontFamily.split(", ");
  return [primary, extended, ...fallback].join(", ");
}

/** Mêmes variables qu'avec next/font/google, consommées par globals.css (--font-display…). */
export const fontVariables = {
  "--font-sora": stack(soraLatin, soraLatinExt),
  "--font-inter": stack(interLatin, interLatinExt),
  "--font-jetbrains-mono": stack(monoLatin, monoLatinExt),
} as Record<string, string>;
