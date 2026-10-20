"use client";

// M02 / M17 US-M17-06 — ajout d'un véhicule ; « Photographier un document » (carte grise,
// vignette VT) pré-remplit les champs (surlignés, confiance, « À vérifier »). Rien n'est
// enregistré avant « Enregistrer » : la décision est ensuite tracée sur la suggestion IA.
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Calendar, Car, ShieldCheck } from "lucide-react";
import {
  Field,
  FormActions,
  FormCard,
  FormGrid,
  FormSection,
  Input,
  PlateInput,
  Select,
  StatusBadge,
  VinInput,
} from "@atelieros/ui";
import {
  DocumentCapture,
  ExtractedHint,
  extractedClass,
  type ExtractedFields,
} from "@/components/ai/document-capture";
import { VehicleMakeModelSelect } from "@/components/vehicle-make-model-select";
import { t } from "@/lib/i18n";
import { trpc } from "@/trpc/react";

const FUELS = ["PETROL", "DIESEL", "HYBRID", "ELECTRIC", "LPG", "OTHER"] as const;
type Fuel = (typeof FUELS)[number];

function NewVehicleForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const customerId = searchParams.get("customerId") ?? "";
  const [plate, setPlate] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [vin, setVin] = useState("");
  const [firstRegistrationDate, setFirstRegistrationDate] = useState("");
  const [fuel, setFuel] = useState<Fuel | "">("");
  const [inspectionExpiryDate, setInspectionExpiryDate] = useState("");
  const [extracted, setExtracted] = useState<ExtractedFields>({});
  const [suggestionIds, setSuggestionIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const recordInspection = trpc.vehicle.recordInspection.useMutation();
  const acceptSuggestion = trpc.ai.suggestion.accept.useMutation();
  const createVehicle = trpc.vehicle.create.useMutation({
    onError: (err) => setError(err.message),
  });

  if (!customerId) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-status-bad/50 bg-status-bad-bg p-4 text-sm text-status-bad">
        {t("aiExtraction.vehicle.pickCustomer")}
      </div>
    );
  }

  function applyExtraction(fields: ExtractedFields, suggestionId: string | null) {
    const text = (name: string) => {
      const value = fields[name]?.value;
      return value === undefined ? undefined : String(value);
    };
    if (text("plate")) setPlate(text("plate")!);
    if (text("make")) setMake(text("make")!);
    if (text("model")) setModel(text("model")!);
    if (text("vin")) setVin(text("vin")!);
    if (text("firstRegistrationDate")) setFirstRegistrationDate(text("firstRegistrationDate")!);
    if (text("fuel") && (FUELS as readonly string[]).includes(text("fuel")!)) {
      setFuel(text("fuel") as Fuel);
    }
    if (text("inspectionExpiryDate")) setInspectionExpiryDate(text("inspectionExpiryDate")!);
    setExtracted((prev) => ({ ...prev, ...fields }));
    if (suggestionId) setSuggestionIds((prev) => [...prev, suggestionId]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const vehicle = await createVehicle
      .mutateAsync({
        customerId,
        plate,
        make,
        model,
        vin: vin || undefined,
        firstRegistrationDate: firstRegistrationDate
          ? new Date(`${firstRegistrationDate}T00:00:00Z`)
          : undefined,
        fuel: fuel || undefined,
      })
      .catch(() => null);
    if (!vehicle) return;
    if (inspectionExpiryDate) {
      // Date de visite inconnue sur la vignette : on retient l'échéance lue, visite = J-365.
      const expiry = new Date(`${inspectionExpiryDate}T00:00:00Z`);
      await recordInspection
        .mutateAsync({
          vehicleId: vehicle.id,
          date: new Date(expiry.getTime() - 365 * 24 * 60 * 60 * 1000),
          expiryDate: expiry,
        })
        .catch(() => null);
    }
    // Trace la décision humaine (accepté / corrigé) sur chaque suggestion utilisée.
    const finalFields = {
      plate,
      make,
      model,
      vin,
      firstRegistrationDate,
      fuel,
      inspectionExpiryDate,
    };
    for (const suggestionId of suggestionIds) {
      await acceptSuggestion
        .mutateAsync({ suggestionId, editedPayload: { fields: finalFields } })
        .catch(() => null);
    }
    router.push(`/vehicules/${vehicle.id}`);
  }

  const busy = createVehicle.isPending || recordInspection.isPending;

  return (
    <FormCard
      title={t("aiExtraction.vehicle.title")}
      description="Ajoutez un véhicule avec masque d'immatriculation ivoirienne et numéro de châssis"
      icon={<Car size={22} strokeWidth={2.2} />}
      badge={<StatusBadge tone="ok">Nouveau véhicule</StatusBadge>}
      backHref={`/clients/${customerId}`}
      backLabel="Retour à la fiche client"
      maxWidth="xl"
    >
      <div className="flex flex-col gap-5">
        {/* Module de capture intelligente IA */}
        <DocumentCapture
          kinds={["VEHICLE_REGISTRATION", "INSPECTION_STICKER"]}
          onExtracted={(result) => applyExtraction(result.fields, result.suggestionId)}
        />

        {extracted.ownerName && (
          <div className="flex items-center gap-2 rounded-lg bg-surface-2/60 px-3 py-2 text-xs text-muted">
            <span>
              {t("aiExtraction.ownerName", { name: String(extracted.ownerName.value) })}
            </span>
            <ExtractedHint field={extracted.ownerName} />
          </div>
        )}

        <form onSubmit={submit} className="flex flex-col gap-5">
          {/* Section 1 : Immatriculation & Châssis */}
          <FormSection
            title="Immatriculation & Châssis"
            icon={<ShieldCheck size={18} />}
            description="Identifiants légaux du véhicule avec masques normés"
          >
            <FormGrid cols={2}>
              <div className={extractedClass(extracted.plate)}>
                <PlateInput
                  label={t("aiExtraction.vehicle.plate")}
                  required
                  value={plate}
                  onChange={setPlate}
                />
                <ExtractedHint field={extracted.plate} />
              </div>

              <div className={extractedClass(extracted.vin)}>
                <VinInput
                  label={t("aiExtraction.vehicle.vin")}
                  value={vin}
                  onChange={setVin}
                  optional
                />
                <ExtractedHint field={extracted.vin} />
              </div>
            </FormGrid>
          </FormSection>

          {/* Section 2 : Marque & Modèle */}
          <FormSection
            title="Marque & Modèle"
            icon={<Car size={18} />}
            description="Suggestions riches adaptées au marché ivoirien avec auto-création"
          >
            <FormGrid cols={2}>
              <VehicleMakeModelSelect
                make={make}
                model={model}
                onMakeChange={setMake}
                onModelChange={setModel}
                required
                makeLabel={t("aiExtraction.vehicle.make")}
                modelLabel={t("aiExtraction.vehicle.model")}
              />
            </FormGrid>
          </FormSection>

          {/* Section 3 : Caractéristiques & Échéances */}
          <FormSection
            title="Énergie & Dates réglementaires"
            icon={<Calendar size={18} />}
            description="Informations pour le suivi d'entretien et les alertes de visite technique"
          >
            <FormGrid cols={3}>
              <div className={extractedClass(extracted.fuel)}>
                <Field label={t("aiExtraction.vehicle.fuel")}>
                  <Select value={fuel} onChange={(e) => setFuel(e.target.value as Fuel | "")}>
                    <option value="">{t("aiExtraction.vehicle.fuelNone")}</option>
                    {FUELS.map((f) => (
                      <option key={f} value={f}>
                        {t(`aiExtraction.vehicle.fuels.${f}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <ExtractedHint field={extracted.fuel} />
              </div>

              <div className={extractedClass(extracted.firstRegistrationDate)}>
                <Input
                  type="date"
                  label={t("aiExtraction.vehicle.firstRegistrationDate")}
                  value={firstRegistrationDate}
                  onChange={(e) => setFirstRegistrationDate(e.target.value)}
                />
                <ExtractedHint field={extracted.firstRegistrationDate} />
              </div>

              <div className={extractedClass(extracted.inspectionExpiryDate)}>
                <Input
                  type="date"
                  label={t("aiExtraction.vehicle.inspectionExpiryDate")}
                  value={inspectionExpiryDate}
                  onChange={(e) => setInspectionExpiryDate(e.target.value)}
                />
                <ExtractedHint field={extracted.inspectionExpiryDate} />
              </div>
            </FormGrid>
          </FormSection>

          {error && (
            <div className="rounded-lg border border-status-bad/50 bg-status-bad-bg p-3 text-xs text-status-bad">
              {error}
            </div>
          )}

          <FormActions
            submitLabel={busy ? t("aiExtraction.vehicle.saving") : t("aiExtraction.vehicle.save")}
            loading={busy}
            cancelHref={`/clients/${customerId}`}
            cancelLabel="Annuler"
          />
        </form>
      </div>
    </FormCard>
  );
}

export default function NewVehiclePage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">{t("aiExtraction.vehicle.loading")}</p>}>
      <NewVehicleForm />
    </Suspense>
  );
}
