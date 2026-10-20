// RG-M13-37 — `GET|POST /api/v1/vehicles`.
import { apiRoute } from "@/server/publicApi/http";
import { createVehicle, listVehicles } from "@/server/publicApi/resources";

export const dynamic = "force-dynamic";
export const GET = apiRoute({ scope: "vehicles:read" }, listVehicles);
export const POST = apiRoute({ scope: "vehicles:write" }, createVehicle);
