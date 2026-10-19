// RG-M05-10 — contenu signé d'un devis : chaîne stable (lignes + prix + total) dont le SHA-256
// est stocké dans `decisionHash`. Le hachage lui-même est fait côté serveur (node:crypto).
import type { QuoteLineLike } from "./types";

export interface ContentLine
  extends Pick<QuoteLineLike, "id" | "type" | "quantity" | "unitPrice" | "discountRate" | "vatRate"> {
  description: string;
  payer: QuoteLineLike["payer"];
}

/** Représentation canonique : lignes triées par id, champs de prix uniquement, total TTC. */
export function quoteContentPayload(lines: readonly ContentLine[], total: number): string {
  const sorted = [...lines].sort((a, b) => (a.id ?? "").localeCompare(b.id ?? ""));
  const parts = sorted.map((l) =>
    [
      l.id ?? "",
      l.type,
      l.description.trim(),
      String(l.quantity),
      String(l.unitPrice),
      String(l.discountRate),
      String(l.vatRate),
      l.payer,
    ].join("|"),
  );
  return `${parts.join("\n")}\n#total=${total}`;
}

/** Robots d'aperçu de lien (WhatsApp, Facebook, Telegram…) : jamais comptés comme « vu ». */
const PREVIEW_BOT_PATTERNS = [
  /whatsapp/i,
  /facebookexternalhit/i,
  /facebot/i,
  /twitterbot/i,
  /telegrambot/i,
  /linkedinbot/i,
  /slackbot/i,
  /discordbot/i,
  /googlebot/i,
  /bingbot/i,
  /skypeuripreview/i,
];

export function isPreviewBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return PREVIEW_BOT_PATTERNS.some((p) => p.test(userAgent));
}
