// Étape 7.2 — `GET /api/health` : sonde du healthcheck Docker, de la bascule du script de mise à
// jour et de la supervision externe. Publique et sans permission (exception assumée à la règle
// des endpoints REST) : la réponse ne contient aucune donnée, seulement l'état de chaque
// dépendance et sa latence. 200 si tout répond, 503 sinon.
import { checkHealth } from "@/server/health";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const report = await checkHealth();
  // Version déployée (tag d'image) : le script de mise à jour vérifie la bascule avec.
  return Response.json(
    { ...report, version: process.env.ATELIEROS_VERSION ?? "dev" },
    {
      status: report.status === "ok" ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
