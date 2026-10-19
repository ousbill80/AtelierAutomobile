import { redirect } from "next/navigation";

// L'accueil de l'espace applicatif est le tableau de bord (M12).
export default function HomePage() {
  redirect("/tableau-de-bord");
}
