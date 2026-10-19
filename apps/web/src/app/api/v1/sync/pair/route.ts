// RG-M13-28 — appairage de l'agent local (code à 8 caractères → jeton sync:push).
import { handlePair } from "@/server/sync/agent";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handlePair(req);
}
