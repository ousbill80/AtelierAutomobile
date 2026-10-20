import { portalLabels } from "../_components/labels";
import { AccountView } from "./account-view";

// M14 US-M14-08 / US-M14-09 — « Mon espace » (session portail, cookie httpOnly 30 jours).
export default function PortalAccountPage() {
  return <AccountView labels={portalLabels} />;
}
