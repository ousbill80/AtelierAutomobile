"use client";

// M02 / M17 US-M17-06 — ajout d'un véhicule ; « Photographier un document » (carte grise,
// vignette VT) pré-remplit les champs (surlignés, confiance, « À vérifier »). Rien n'est
// enregistré avant « Enregistrer » : la décision est ensuite tracée sur la suggestion IA.
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Field, Input, PlateInput, Select } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { t } from "@/lib/i18n";
import {
  DocumentCapture,
  ExtractedHint,
  extractedClass,
  type ExtractedFields,
} from "@/components/ai/document-capture";

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
    return <p className="text-sm text-status-bad">{t("aiExtraction.vehicle.pickCustomer")}</p>;
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
    <div className="flex w-full min-w-0 flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("aiExtraction.vehicle.title")}</h1>
      <DocumentCapture
        kinds={["VEHICLE_REGISTRATION", "INSPECTION_STICKER"]}
        onExtracted={(result) => applyExtraction(result.fields, result.suggestionId)}
      />
      {extracted.ownerName && (
        <p className="text-sm text-muted">
          {t("aiExtraction.ownerName", { name: String(extracted.ownerName.value) })}{" "}
          <ExtractedHint field={extracted.ownerName} />
        </p>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className={extractedClass(extracted.plate)}>
          <PlateInput
            label={t("aiExtraction.vehicle.plate")}
            required
            value={plate}
            onChange={setPlate}
          />
          <ExtractedHint field={extracted.plate} />
        </div>
        <div className={extractedClass(extracted.make)}>
          <Input
            label={t("aiExtraction.vehicle.make")}
            required
            value={make}
            onChange={(e) => setMake(e.target.value)}
          />
          <ExtractedHint field={extracted.make} />
        </div>
        <div className={extractedClass(extracted.model)}>
          <Input
            label={t("aiExtraction.vehicle.model")}
            required
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
          <ExtractedHint field={extracted.model} />
        </div>
        <div className={extractedClass(extracted.vin)}>
          <Input
            label={t("aiExtraction.vehicle.vin")}
            value={vin}
            onChange={(e) => setVin(e.target.value)}
          />
          <ExtractedHint field={extracted.vin} />
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
        <div className={extractedClass(extracted.inspectionExpiryDate)}>
          <Input
            type="date"
            label={t("aiExtraction.vehicle.inspectionExpiryDate")}
            value={inspectionExpiryDate}
            onChange={(e) => setInspectionExpiryDate(e.target.value)}
          />
          <ExtractedHint field={extracted.inspectionExpiryDate} />
        </div>
        {error && <p className="text-sm text-status-bad">{error}</p>}
        <Button type="submit" disabled={busy} className="min-h-11">
          {busy ? t("aiExtraction.vehicle.saving") : t("aiExtraction.vehicle.save")}
        </Button>
      </form>
    </div>
  );
}

export default function NewVehiclePage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">{t("aiExtraction.vehicle.loading")}</p>}>
      <NewVehicleForm />
    </Suspense>
  );
}
