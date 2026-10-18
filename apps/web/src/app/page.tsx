export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-bg p-8 text-center text-foreground">
      <h1 className="text-3xl font-semibold">AtelierOS</h1>
      <p className="max-w-md text-balance text-muted">
        Gestion d&apos;atelier automobile : rendez-vous, ordres de réparation, devis, facturation et
        relances automatiques.
      </p>
    </main>
  );
}
