import { defaultOutbox } from "@atelieros/integrations";

export async function GET() {
  if (process.env.APP_ENV === "production") {
    return new Response("Not Found", { status: 404 });
  }
  return Response.json(defaultOutbox.list());
}
