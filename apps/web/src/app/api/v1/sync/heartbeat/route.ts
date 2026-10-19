// RG-M13-28 — battement de vie de l'agent local (toutes les 5 min).
import { handleHeartbeat } from "@/server/sync/agent";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handleHeartbeat(req);
}
