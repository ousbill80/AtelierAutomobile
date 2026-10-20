import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { portalPathFor } from "@atelieros/core";
import { PortalScope, resolvePortalToken } from "@atelieros/db";
import { portalNow } from "@/server/portal/access";
import { checkPortalRequest, recordInvalidPortalToken } from "@/server/portal/rateLimit";
import { portalLabels } from "../_components/labels";
import { PortalLinkState, type LinkProblem } from "../_components/link-state";
import { PortalFrame } from "../_components/portal-frame";

export const dynamic = "force-dynamic";

// M14 §7 — `/p/{token}` : aiguillage selon la portée du jeton vers la page cible ; sinon état
// du lien (expiré → « Recevoir un nouveau lien », révoqué, introuvable).
export default async function PortalEntryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "0.0.0.0";
  const now = portalNow();
  let problem: LinkProblem;
  const rate = await checkPortalRequest(ip, now);
  if (!rate.allowed) {
    problem = "RATE_LIMITED";
  } else {
    const resolved = await resolvePortalToken(token, Object.values(PortalScope), now, {
      count: false,
    });
    if (resolved.status === "ACTIVE") redirect(`/p/${token}/${portalPathFor(resolved.row.scope)}`);
    if (resolved.status === "NOT_FOUND") await recordInvalidPortalToken(ip, now);
    problem =
      resolved.status === "EXPIRED"
        ? "EXPIRED"
        : resolved.status === "REVOKED"
          ? resolved.row.revokeReason === "invoice_voided"
            ? "VOIDED"
            : "REVOKED"
          : "NOT_FOUND";
  }
  return (
    <PortalFrame labels={portalLabels}>
      <PortalLinkState problem={problem} token={token} labels={portalLabels} />
    </PortalFrame>
  );
}
