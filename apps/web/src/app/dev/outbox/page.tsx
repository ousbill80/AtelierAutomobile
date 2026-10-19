import { notFound } from "next/navigation";
import { connection } from "next/server";
import { devOutbox } from "@/lib/outbox";

export default async function DevOutboxPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  // Jamais mis en cache ni pré-rendu : la liste doit refléter l'état courant de l'outbox.
  await connection();

  const entries = [...devOutbox.all()].reverse();

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Boîte d&apos;envoi (dev)</h1>
        <p className="text-muted">
          Messages « envoyés » par le fournisseur console — aucun opérateur WhatsApp/SMS/email réel
          n&apos;est contacté en local.
        </p>
      </div>

      {entries.length === 0 ? (
        <p className="text-muted">Aucun message envoyé pour l&apos;instant.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4">Date</th>
              <th className="py-2 pr-4">Canal</th>
              <th className="py-2 pr-4">Destinataire</th>
              <th className="py-2 pr-4">Message</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.providerMessageId} className="border-b">
                <td className="py-2 pr-4">{entry.sentAt.toLocaleString("fr-FR")}</td>
                <td className="py-2 pr-4">{entry.channel}</td>
                <td className="py-2 pr-4">{entry.to}</td>
                <td className="py-2 pr-4">{entry.body}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
