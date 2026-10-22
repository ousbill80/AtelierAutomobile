"use client";

// M16 §7 — /assurances/sinistres/nouveau (US-M16-01) : depuis un OR (`?or=`) ou en cherchant le
// véhicule par sa plaque ; compagnie, police, accident, franchise prévue. M17 : « Photographier
// un document » lit le constat amiable et pré-remplit le dossier (suggestion à vérifier).
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Button,
  EmptyState,
  Field,
  Input,
  MoneyInput,
  PlateBadge,
  Select,
  Textarea,
} from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { t } from "@/components/claims/i18n";
import {
  DocumentCapture,
  ExtractedHint,
  extractedClass,
  type ExtractedFields,
} from "@/components/ai/document-capture";

function NewClaimForm() {
  const router = useRouter();
  const params = useSearchParams();
  const repairOrderId = params.get("or") ?? undefined;
  const order = trpc.repairOrder.get.useQuery(
    { id: repairOrderId ?? "" },
    { enabled: Boolean(repairOrderId) },
  );
  const insurers = trpc.insurer.list.useQuery();
  const [plate, setPlate] = useState("");
  const vehicles = trpc.vehicle.list.useQuery(
    { q: plate.trim(), limit: 5 },
    { enabled: !repairOrderId && plate.trim().length >= 3 },
  );
  const [vehicleId, setVehicleId] = useState<string | null>(params.get("vehicule"));
  const [insurerId, setInsurerId] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [claimNumber, setClaimNumber] = useState("");
  const [accidentDate, setAccidentDate] = useState("");
  const [accidentPlace, setAccidentPlace] = useState("");
  const [circumstances, setCircumstances] = useState("");
  const [deductible, setDeductible] = useState<number | null>(null);
  const [vatPaidBy, setVatPaidBy] = useState<"INSURANCE" | "CUSTOMER">("INSURANCE");
  const [error, setError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedFields>({});
  const [suggestionId, setSuggestionId] = useState<string | null>(null);
  // Compagnie et police reprises de la fiche du véhicule (US-M16-01), une fois par véhicule.
  const linkedVehicleId = repairOrderId ? order.data?.vehicleId : vehicleId;
  const linked = trpc.vehicle.get.useQuery(
    { id: linkedVehicleId ?? "" },
    { enabled: Boolean(linkedVehicleId) },
  );
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  if (linked.data && prefilledFor !== linked.data.id) {
    setPrefilledFor(linked.data.id);
    const fromVehicle = Boolean(
      linked.data.insuranceCompanyId || linked.data.insurancePolicyNumber,
    );
    if (linked.data.insuranceCompanyId) setInsurerId(linked.data.insuranceCompanyId);
    if (linked.data.insurancePolicyNumber) setPolicyNumber(linked.data.insurancePolicyNumber);
    setPrefilled(fromVehicle);
  }
  const acceptSuggestion = trpc.ai.suggestion.accept.useMutation();
  const create = trpc.claim.create.useMutation({
    onSuccess: async (res) => {
      if (suggestionId) {
        await acceptSuggestion
          .mutateAsync({
            suggestionId,
            editedPayload: {
              fields: { policyNumber, accidentDate, accidentPlace, circumstances, plate },
            },
          })
          .catch(() => null);
      }
      router.push(`/assurances/sinistres/${res.claim.id}`);
    },
    onError: (e) => setError(e.message),
  });

  function applyExtraction(fields: ExtractedFields, id: string | null) {
    const text = (name: string) =>
      fields[name] === undefined ? undefined : String(fields[name]!.value);
    if (text("policyNumber")) setPolicyNumber(text("policyNumber")!);
    if (text("accidentDate")) setAccidentDate(text("accidentDate")!);
    if (text("accidentPlace")) setAccidentPlace(text("accidentPlace")!);
    if (text("circumstances")) setCircumstances(text("circumstances")!);
    if (text("plate") && !repairOrderId) setPlate(text("plate")!);
    const insurerName = text("insurerName")?.toLowerCase();
    const insurer = insurerName
      ? insurers.data?.find(
          (i) =>
            insurerName.includes(i.name.toLowerCase()) ||
            i.name.toLowerCase().includes(insurerName.split(" ")[0] ?? insurerName),
        )
      : undefined;
    if (insurer) setInsurerId(insurer.id);
    setExtracted(fields);
    setSuggestionId(id);
  }

  if (insurers.isLoading) return <ListSkeleton rows={3} />;
  if (insurers.isError || !insurers.data) {
    return <ErrorBox onRetry={() => insurers.refetch()} message={t("loadError")} />;
  }
  if (insurers.data.length === 0) {
    return (
      <EmptyState
        title={t("noInsurer")}
        description={t("emptyInsurers.description")}
        action={
          <Link href="/assurances/compagnies" className="btn btn-primary min-h-11">
            {t("addInsurer")}
          </Link>
        }
      />
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!repairOrderId && !vehicleId) {
      setError(t("pickVehicle"));
      return;
    }
    if (!insurerId) {
      setError(t("noInsurer"));
      return;
    }
    create.mutate({
      repairOrderId,
      vehicleId: repairOrderId ? undefined : (vehicleId ?? undefined),
      insuranceCompanyId: insurerId,
      policyNumber: policyNumber || undefined,
      claimNumber: claimNumber || undefined,
      accidentDate: accidentDate || undefined,
      accidentPlace: accidentPlace || undefined,
      circumstances: circumstances || undefined,
      deductible: deductible ?? undefined,
      vatPaidBy,
    });
  }

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-3">
      <h1 className="text-xl font-semibold">{t("new")}</h1>
      <DocumentCapture
        kinds={["CLAIM_REPORT"]}
        onExtracted={(result) => applyExtraction(result.fields, result.suggestionId)}
      />
      {repairOrderId ? (
        <p className="text-sm">
          {t("fields.repairOrder")} : <strong>{order.data?.number ?? "…"}</strong>
        </p>
      ) : (
        <Field label={t("fields.vehicleSearch")}>
          <Input
            value={plate}
            onChange={(e) => setPlate(e.target.value)}
            placeholder="1234 AB 01"
          />
        </Field>
      )}
      {!repairOrderId && vehicles.data && (
        <ul className="flex flex-col gap-1" aria-label={t("fields.vehicle")}>
          {vehicles.data.items.length === 0 && (
            <li className="text-sm text-muted">{t("vehicleNotFound")}</li>
          )}
          {vehicles.data.items.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => setVehicleId(v.id)}
                aria-pressed={vehicleId === v.id}
                className={`flex min-h-11 w-full items-center gap-2 rounded-lg border p-2 text-left text-sm ${
                  vehicleId === v.id ? "border-accent bg-surface-2" : "border-border"
                }`}
              >
                <PlateBadge plate={v.plate} />
                <span>
                  {v.make} {v.model}
                </span>
                {vehicleId === v.id && <span aria-hidden>✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!repairOrderId && linked.data && !vehicles.data && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <PlateBadge plate={linked.data.plate} />
          <span>
            {linked.data.make} {linked.data.model}
          </span>
        </p>
      )}
      {prefilled && (
        <p role="status" className="text-sm text-status-ok">
          ✓ {t("vehicleInsurance.prefilled")}
        </p>
      )}
      <Field label={t("fields.insurer")}>
        <Select value={insurerId} onChange={(e) => setInsurerId(e.target.value)} required>
          <option value="">—</option>
          {insurers.data.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className={extractedClass(extracted.policyNumber)}>
        <Field label={t("fields.policyNumber")}>
          <Input value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} />
        </Field>
        <ExtractedHint field={extracted.policyNumber} />
      </div>
      <Field label={t("fields.claimNumber")}>
        <Input value={claimNumber} onChange={(e) => setClaimNumber(e.target.value)} />
      </Field>
      <div className={extractedClass(extracted.accidentDate)}>
        <Field label={t("fields.accidentDate")}>
          <Input
            type="date"
            value={accidentDate}
            onChange={(e) => setAccidentDate(e.target.value)}
          />
        </Field>
        <ExtractedHint field={extracted.accidentDate} />
      </div>
      <div className={extractedClass(extracted.accidentPlace)}>
        <Field label={t("fields.accidentPlace")}>
          <Input value={accidentPlace} onChange={(e) => setAccidentPlace(e.target.value)} />
        </Field>
        <ExtractedHint field={extracted.accidentPlace} />
      </div>
      <div className={extractedClass(extracted.circumstances)}>
        <Field label={t("fields.circumstances")}>
          <Textarea value={circumstances} onChange={(e) => setCircumstances(e.target.value)} />
        </Field>
        <ExtractedHint field={extracted.circumstances} />
      </div>
      <Field label={t("fields.deductible")}>
        <MoneyInput value={deductible} onChange={setDeductible} />
      </Field>
      <Field label={t("fields.vatPaidBy")}>
        <Select
          value={vatPaidBy}
          onChange={(e) => setVatPaidBy(e.target.value as "INSURANCE" | "CUSTOMER")}
        >
          <option value="INSURANCE">{t("fields.vatInsurance")}</option>
          <option value="CUSTOMER">{t("fields.vatCustomer")}</option>
        </Select>
      </Field>
      {error && (
        <p role="alert" className="text-sm text-status-bad">
          ⚠ {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={create.isPending} className="min-h-11">
          {t("actions.create")}
        </Button>
        <Link href="/assurances/sinistres" className="btn btn-secondary min-h-11">
          {t("cancel")}
        </Link>
      </div>
    </form>
  );
}

export default function NewClaimPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={3} />}>
      <NewClaimForm />
    </Suspense>
  );
}
