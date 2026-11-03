import { PIN_LENGTH } from "@atelieros/core";
import { signInWithPin } from "@/server/auth/pin-session";
import { browserOrigin, redirectTo } from "@/server/request-origin";
import { WORKSHOP_DEVICE_COOKIE_NAME } from "@/server/session-cookie-name";

function redirectWith(req: Request, code: string) {
  const url = new URL("/tablette/connexion", browserOrigin(req));
  url.searchParams.set("e", code);
  return redirectTo(req, `${url.pathname}${url.search}`);
}

function errorCode(message: string): string {
  if (message.includes("Trop de tentatives")) return "rate";
  if (message.includes("enregistr")) return "device";
  if (message.includes("bloqué")) return "locked";
  if (message.includes("incorrect")) return "pin";
  if (message.includes("Aucun code")) return "none";
  return "member";
}

/** Connexion PIN par formulaire, même si la page n'a pas encore activé le JavaScript. */
export async function POST(req: Request) {
  const form = await req.formData();
  const membershipId = String(form.get("membershipId") ?? "").trim();
  const pin = String(form.get("pin") ?? "")
    .replace(/\D/g, "")
    .slice(0, PIN_LENGTH);
  const deviceId = req.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${WORKSHOP_DEVICE_COOKIE_NAME}=`))
    ?.slice(WORKSHOP_DEVICE_COOKIE_NAME.length + 1);

  if (!membershipId || pin.length !== PIN_LENGTH) return redirectWith(req, "incomplete");
  if (!deviceId) return redirectWith(req, "device");

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "0.0.0.0";
  try {
    const { setCookie } = await signInWithPin(
      { deviceId: decodeURIComponent(deviceId), membershipId, pin },
      { ip, userAgent: req.headers.get("user-agent") },
      { registerMissingDevice: process.env.NODE_ENV === "development" },
    );
    const response = redirectTo(req, "/tablette/taches");
    response.headers.append("set-cookie", setCookie);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return redirectWith(req, errorCode(message));
  }
}
