// RG-M13-28 — lots de lignes changées envoyés par l'agent local (≤ 500, idempotents).
import { handleBatch } from "@/server/sync/agent";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handleBatch(req);
}
