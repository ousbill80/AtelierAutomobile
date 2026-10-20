"use client";

// M14 §7 « États » — lien expiré (avec « Recevoir un nouveau lien », RG-M14-03), révoqué,
// facture annulée, introuvable, trop de tentatives, erreur réseau (bouton Réessayer).
import { useState } from "react";
import { trpc } from "@/trpc/react";
import type { PortalLabels } from "./labels";

export type LinkProblem =
  "EXPIRED" | "REVOKED" | "VOIDED" | "NOT_FOUND" | "RATE_LIMITED" | "NETWORK";

/** Classe une erreur tRPC du portail selon les préfixes posés côté serveur (server/portal/access). */
export function linkProblemOf(
  error: { message?: string; data?: { code?: string } | null } | null | undefined,
): LinkProblem {
  const message = error?.message ?? "";
  if (message.startsWith("LINK_EXPIRED") || message.includes("LINK_EXPIRED")) return "EXPIRED";
  if (message.startsWith("LINK_REVOKED")) {
    return message.includes("annulée") ? "VOIDED" : "REVOKED";
  }
  if (message.startsWith("RATE_LIMITED") || error?.data?.code === "TOO_MANY_REQUESTS") {
    return "RATE_LIMITED";
  }
  if (error?.data?.code === "NOT_FOUND" || error?.data?.code === "FORBIDDEN") return "NOT_FOUND";
  return error?.data ? "NOT_FOUND" : "NETWORK";
}

export function PortalLinkState({
  problem,
  token,
  labels,
  onRetry,
}: {
  problem: LinkProblem;
  token?: string;
  labels: Pick<PortalLabels, "link" | "retry" | "networkError">;
  onRetry?: () => void;
}) {
  const l = labels.link;
  const [sent, setSent] = useState(false);
  const request = trpc.portal.requestNewLink.useMutation({ onSuccess: () => setSent(true) });
  const copy: Record<LinkProblem, [string, string]> = {
    EXPIRED: [l.expiredTitle, l.expiredBody],
    REVOKED: [l.revokedTitle, l.revokedBody],
    VOIDED: [l.voidedTitle, l.voidedBody],
    NOT_FOUND: [l.notFoundTitle, l.notFoundBody],
    RATE_LIMITED: [l.rateLimitedTitle, l.rateLimitedBody],
    NETWORK: [labels.networkError, ""],
  };
  const [title, body] = copy[problem];
  return (
    <section
      role="alert"
      className="flex flex-col items-center gap-3 rounded-lg bg-surface p-6 text-center"
    >
      <span aria-hidden className="text-3xl">
        {problem === "EXPIRED" ? "⏳" : problem === "NETWORK" ? "📶" : "🔒"}
      </span>
      <h1 className="text-lg font-semibold">{title}</h1>
      {body && <p className="text-muted">{body}</p>}
      {problem === "EXPIRED" && token && !sent && (
        <button
          type="button"
          className="btn btn-primary min-h-12 w-full"
          disabled={request.isPending}
          onClick={() => request.mutate({ token })}
        >
          {request.isPending ? l.requestSending : l.requestNew}
        </button>
      )}
      {sent && (
        <p role="status" className="rounded-md bg-status-ok-bg p-3 text-status-ok">
          ✓ {l.requestSent}
        </p>
      )}
      {request.isError && <p className="text-status-bad">{l.requestError}</p>}
      {problem === "NETWORK" && onRetry && (
        <button type="button" className="btn btn-secondary min-h-12 w-full" onClick={onRetry}>
          {labels.retry}
        </button>
      )}
    </section>
  );
}
