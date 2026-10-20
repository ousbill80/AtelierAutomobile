// RG-M13-37 — `GET /api/v1/me` : organisation, droits et limite de la clé.
import { apiRoute } from "@/server/publicApi/http";
import { me } from "@/server/publicApi/resources";

export const dynamic = "force-dynamic";
export const GET = apiRoute({ scope: null }, me);
