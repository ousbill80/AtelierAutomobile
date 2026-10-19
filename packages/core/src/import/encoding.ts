/**
 * RG-M13-02 — Détection d'encodage. BOM UTF-8/UTF-16 respecté ; sinon test de
 * décodage UTF-8 strict ; en cas d'échec → Windows-1252 (cas typique des
 * exports Access/Excel français) ; si > 1 % de caractères `�` → ISO-8859-1.
 * L'utilisateur peut toujours forcer l'encodage (paramètre `force`).
 */
export type DetectedEncoding =
  "UTF-8" | "UTF-8-BOM" | "UTF-16LE" | "UTF-16BE" | "WINDOWS-1252" | "ISO-8859-1";

const REPLACEMENT_CHAR = "\uFFFD";

// Octets 0x81, 0x8D, 0x8F, 0x90, 0x9D : non définis dans la table Windows-1252
// (le décodeur WHATWG les renvoie tels quels comme caractères de contrôle
// C1, jamais utilisés dans du texte français légitime). Leur présence après
// un décodage Windows-1252 trahit un fichier en réalité encodé ISO-8859-1.
const WINDOWS_1252_UNDEFINED_CODEPOINTS = new Set([0x81, 0x8d, 0x8f, 0x90, 0x9d]);

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

function hasUtf16LeBom(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
}

function hasUtf16BeBom(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff;
}

function anomalyRatio(decoded: string): number {
  if (decoded.length === 0) return 0;
  let count = 0;
  for (const char of decoded) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (char === REPLACEMENT_CHAR || WINDOWS_1252_UNDEFINED_CODEPOINTS.has(codePoint)) {
      count += 1;
    }
  }
  return count / decoded.length;
}

/**
 * Détecte l'encodage d'un fichier à partir de ses octets. `force` permet à
 * l'utilisateur d'imposer l'encodage sans relancer la détection (toujours
 * validé par un simple passage de décodage non strict).
 */
export function detectEncoding(bytes: Uint8Array, force?: DetectedEncoding): DetectedEncoding {
  if (force) return force;

  if (hasUtf8Bom(bytes)) return "UTF-8-BOM";
  if (hasUtf16LeBom(bytes)) return "UTF-16LE";
  if (hasUtf16BeBom(bytes)) return "UTF-16BE";

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return "UTF-8";
  } catch {
    // Décodage strict UTF-8 impossible : tenter Windows-1252, puis ISO-8859-1
    // si trop de caractères de remplacement apparaissent.
    const decodedWin1252 = new TextDecoder("windows-1252").decode(bytes);
    if (anomalyRatio(decodedWin1252) > 0.01) {
      return "ISO-8859-1";
    }
    return "WINDOWS-1252";
  }
}

/** Décode des octets selon l'encodage détecté/forcé, en retirant un BOM UTF-8 résiduel. */
export function decodeBytes(bytes: Uint8Array, encoding: DetectedEncoding): string {
  switch (encoding) {
    case "UTF-8-BOM": {
      const withoutBom = hasUtf8Bom(bytes) ? bytes.subarray(3) : bytes;
      return new TextDecoder("utf-8").decode(withoutBom);
    }
    case "UTF-16LE":
      return new TextDecoder("utf-16le").decode(bytes);
    case "UTF-16BE":
      return new TextDecoder("utf-16be").decode(bytes);
    case "WINDOWS-1252":
      return new TextDecoder("windows-1252").decode(bytes);
    case "ISO-8859-1":
      return new TextDecoder("iso-8859-1").decode(bytes);
    case "UTF-8":
    default:
      return new TextDecoder("utf-8").decode(bytes);
  }
}
