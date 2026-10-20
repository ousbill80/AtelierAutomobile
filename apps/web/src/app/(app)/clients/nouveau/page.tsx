"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  Car,
  Contact2,
  Phone,
  User,
  UserPlus,
} from "lucide-react";
import {
  FormActions,
  FormCard,
  FormGrid,
  FormSection,
  Input,
  PhoneInput,
  PlateInput,
  SegmentedControl,
  StatusBadge,
} from "@atelieros/ui";
import { VehicleMakeModelSelect } from "@/components/vehicle-make-model-select";
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
    <FormCard
      title="Nouveau client"
      description="Créez la fiche d'un client particulier ou entreprise avec son premier véhicule associé"
      icon={<UserPlus size={22} strokeWidth={2.2} />}
      badge={<StatusBadge tone="ok">Nouveau</StatusBadge>}
      backHref="/clients"
      backLabel="Retour aux clients"
      maxWidth="xl"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        {/* Sélecteur de type d'entité : Particulier vs Entreprise */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted">
            Type de profil
          </label>
          <SegmentedControl
            value={type}
            onChange={(val) => setType(val)}
            options={[
              {
                value: "INDIVIDUAL",
                label: "Particulier",
                icon: <User size={16} />,
              },
              {
                value: "COMPANY",
                label: "Entreprise / Société",
                icon: <Building2 size={16} />,
              },
            ]}
          />
        </div>

        {/* Section 1 : Identité */}
        <FormSection
          title={type === "INDIVIDUAL" ? "Identité du particulier" : "Raison sociale de l'entreprise"}
          icon={type === "INDIVIDUAL" ? <Contact2 size={18} /> : <Building2 size={18} />}
          description={
            type === "INDIVIDUAL"
              ? "Informations d'état civil nécessaires à la facturation et aux relances"
              : "Dénomination légale de l'entreprise ou flotte automobile"
          }
        >
          {type === "INDIVIDUAL" ? (
            <FormGrid cols={2}>
              <Input
                label="Nom de famille"
                required
                placeholder="Ex: Koné, Traoré, Kouadio…"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
              <Input
                label="Prénom(s)"
                optional
                placeholder="Ex: Ibrahim, Aya, Yao…"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </FormGrid>
          ) : (
            <Input
              label="Nom de l'entreprise"
              required
              placeholder="Ex: SOTRA, CFAO Motors, Groupe SIFCA…"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          )}
        </FormSection>

        {/* Section 2 : Coordonnées */}
        <FormSection
          title="Coordonnées & Messagerie"
          icon={<Phone size={18} />}
          description="Numéro principal utilisé pour les devis, factures et relances automatiques (WhatsApp / SMS)"
        >
          <PhoneInput
            label="Téléphone principal"
            value={phone}
            onChange={setPhone}
            showOperatorBadge
            hint="Saisissez le numéro tel quel : le masque ivoirien (10 chiffres) et l'indicatif +225 s'appliquent automatiquement."
          />
        </FormSection>

        {/* Section 3 : Véhicule initial (optionnel) */}
        <FormSection
          title="Véhicule associé"
          icon={<Car size={18} />}
          badge={<span className="text-[11px] font-normal text-muted">(Optionnel)</span>}
          description="Vous pouvez enregistrer dès maintenant le premier véhicule de ce client"
        >
          <PlateInput
            label="Plaque d'immatriculation"
            value={plate}
            onChange={setPlate}
            hint="Format ivoirien standard : 4 chiffres + 2 lettres + 2 chiffres (ex: 1234 AB 01)"
          />

          <FormGrid cols={2}>
            <VehicleMakeModelSelect
              make={make}
              model={model}
              onMakeChange={setMake}
              onModelChange={setModel}
              makeLabel="Marque"
              modelLabel="Modèle"
            />
          </FormGrid>
        </FormSection>

        {/* Alerte détection doublon intelligente */}
        {duplicateError && (
          <div className="flex flex-col gap-3 rounded-xl border border-status-warn/60 bg-status-warn-bg/40 p-4 text-sm text-status-warn">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-status-warn" />
              <div className="flex-1">
                <p className="font-semibold">{duplicateError}</p>
                <p className="mt-1 text-xs text-muted">
                  Un client ou contact portant le même numéro de téléphone ou nom existe déjà.
                  Si vous souhaitez quand même créer cette fiche, indiquez le motif ci-dessous.
                </p>
              </div>
            </div>

            <Input
              label="Motif pour créer quand même"
              placeholder="Ex: numéro d'entreprise partagé, homonyme vérifié, autre…"
              value={duplicateOverrideReason}
              onChange={(e) => setDuplicateOverrideReason(e.target.value)}
              className="bg-surface"
            />
          </div>
        )}

        {/* Actions de validation */}
        <FormActions
          submitLabel={createCustomer.isPending ? "Création en cours…" : "Créer le client"}
          loading={createCustomer.isPending}
          cancelHref="/clients"
          cancelLabel="Annuler"
        />
      </form>
    </FormCard>
  );
}
