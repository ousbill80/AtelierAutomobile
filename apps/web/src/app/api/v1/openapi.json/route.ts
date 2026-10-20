// RG-M13-37 — spécification OpenAPI 3.1 de l'API publique (sans authentification).
import { appUrl } from "@/server/appointments/service";
import { buildOpenApiDocument } from "@/server/publicApi/openapi";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(buildOpenApiDocument(appUrl()), {
    headers: { "cache-control": "public, max-age=300" },
  });
}
