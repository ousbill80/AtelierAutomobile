// RG-M13-28 — configuration téléchargée par l'agent local (requêtes, planning).
import { handleConfig } from "@/server/sync/agent";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handleConfig(req);
}
