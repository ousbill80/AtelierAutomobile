"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input, PlateInput } from "@atelieros/ui";
import { trpc } from "@/trpc/react";

function NewVehicleForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const customerId = searchParams.get("customerId") ?? "";
  const [plate, setPlate] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createVehicle = trpc.vehicle.create.useMutation({
    onSuccess: (vehicle) => router.push(`/vehicules/${vehicle.id}`),
    onError: (err) => setError(err.message),
  });

  if (!customerId) {
    return <p className="text-sm text-status-bad">Choisissez d&apos;abord un client.</p>;
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Ajouter un véhicule</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          createVehicle.mutate({ customerId, plate, make, model });
        }}
        className="flex flex-col gap-4"
      >
        <PlateInput
          label="Plaque"
          required
          value={plate}
          onChange={(e) => setPlate(e.target.value)}
        />
        <Input label="Marque" required value={make} onChange={(e) => setMake(e.target.value)} />
        <Input label="Modèle" required value={model} onChange={(e) => setModel(e.target.value)} />
        {error && <p className="text-sm text-status-bad">{error}</p>}
        <Button type="submit" disabled={createVehicle.isPending}>
          {createVehicle.isPending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </form>
    </div>
  );
}

export default function NewVehiclePage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Chargement…</p>}>
      <NewVehicleForm />
    </Suspense>
  );
}
