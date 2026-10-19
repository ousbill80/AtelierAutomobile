"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, PhoneInput, PlateInput } from "@atelieros/ui";
import { trpc } from "@/trpc/react";

type CustomerType = "INDIVIDUAL" | "COMPANY";

export default function NewCustomerPage() {
  const router = useRouter();
  const [type, setType] = useState<CustomerType>("INDIVIDUAL");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [plate, setPlate] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [duplicateOverrideReason, setDuplicateOverrideReason] = useState("");

  const createCustomer = trpc.customer.create.useMutation({
    onSuccess: ({ customer }) => router.push(`/clients/${customer.id}`),
    onError: (error) => setDuplicateError(error.message),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setDuplicateError(null);
    const vehicle = plate && make && model ? { plate, make, model } : undefined;

    if (type === "INDIVIDUAL") {
      createCustomer.mutate({
        type: "INDIVIDUAL",
        lastName,
        firstName: firstName || undefined,
        phone: phone || undefined,
        vehicle,
        duplicateOverrideReason: duplicateOverrideReason || undefined,
      });
    } else {
      createCustomer.mutate({
        type: "COMPANY",
        companyName,
        phone: phone || undefined,
        vehicle,
        duplicateOverrideReason: duplicateOverrideReason || undefined,
      });
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Nouveau client</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Button
            type="button"
            variant={type === "INDIVIDUAL" ? "primary" : "secondary"}
            onClick={() => setType("INDIVIDUAL")}
          >
            Particulier
          </Button>
          <Button
            type="button"
            variant={type === "COMPANY" ? "primary" : "secondary"}
            onClick={() => setType("COMPANY")}
          >
            Entreprise
          </Button>
        </div>

        {type === "INDIVIDUAL" ? (
          <>
            <Input
              label="Nom"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
            <Input
              label="Prénom(s)"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </>
        ) : (
          <Input
            label="Nom de l'entreprise"
            required
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
        )}

        <PhoneInput
          label="Téléphone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          hint="Saisissez le numéro tel quel, il sera normalisé automatiquement."
        />

        <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium text-muted">Véhicule (facultatif)</legend>
          <PlateInput label="Plaque" value={plate} onChange={(e) => setPlate(e.target.value)} />
          <Input label="Marque" value={make} onChange={(e) => setMake(e.target.value)} />
          <Input label="Modèle" value={model} onChange={(e) => setModel(e.target.value)} />
        </fieldset>

        {duplicateError && (
          <div className="flex flex-col gap-2 rounded-md border border-status-warn bg-status-warn-bg p-3 text-sm text-status-warn">
            <p>{duplicateError}</p>
            <Input
              label="Motif pour créer quand même"
              placeholder="numéro partagé, autre…"
              value={duplicateOverrideReason}
              onChange={(e) => setDuplicateOverrideReason(e.target.value)}
            />
          </div>
        )}

        <Button type="submit" disabled={createCustomer.isPending}>
          {createCustomer.isPending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </form>
    </div>
  );
}
