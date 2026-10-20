import { portalLabels } from "../_components/labels";
import { LoginView } from "./login-view";

// M14 US-M14-08 — `/p/connexion?g={slug}` : accès « Mon espace » par code reçu par WhatsApp/SMS.
export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ g?: string }>;
}) {
  const { g } = await searchParams;
  return <LoginView orgSlug={g ?? null} labels={portalLabels} />;
}
