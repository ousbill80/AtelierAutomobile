import { notFound } from "next/navigation";
import { DevOutboxView } from "./outbox-view";

// RG-M11-26 : accessible uniquement si APP_ENV ≠ production. Vérifié côté serveur (jamais
// NODE_ENV, qui vaut toujours "production" pour un build Next.js, y compris en E2E/CI/staging).
export default function DevOutboxPage() {
  if (process.env.APP_ENV === "production") {
    notFound();
  }
  return <DevOutboxView />;
}
