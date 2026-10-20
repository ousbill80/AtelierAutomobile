// RG-M13-37 — `GET /api/v1/vehicles/{id}`.
import { apiRoute } from "@/server/publicApi/http";
import { getVehicle } from "@/server/publicApi/resources";

export const dynamic = "force-dynamic";
export const GET = apiRoute<{ id: string }>({ scope: "vehicles:read" }, getVehicle);
