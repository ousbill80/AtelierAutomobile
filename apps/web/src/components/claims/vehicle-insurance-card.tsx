"use client";

// M16 — bloc « Assurance » de la fiche véhicule : compagnie, n° de police, validité, et
// ouverture d'un dossier sinistre prérempli (US-M16-01). Modification : `vehicle.setInsurance`.
import { useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Button, Field, Input, Select, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { formatDay } from "@/components/repair-orders/i18n";
import { t } from "./i18n";

const DAY = 86_400_000;

type VehicleInsurance = {
  id: string;
  insuranceCompany: { id: string; name: string } | null;
  insurancePolicyNumber: string | null;
  insuranceExpiryDate: Date | string | null;
};

/** Validité de la police à aujourd'hui : expirée, expire sous 30 j, valable ou inconnue. */
function expiryBadge(expiry: Date | string | null) {
  if (!expiry) return { tone: "off" as const, label: t("vehicleInsurance.unknownExpiry") };
  const date = formatDay(expiry, "UTC");
  const left = new Date(expiry).getTime() - Date.now();
  if (left < -DAY)
    return { tone: "bad" as const, label: `✕ ${t("vehicleInsurance.expiredOn", { date })}` };
  if (left < 30 * DAY) {
    return { tone: "warn" as const, label: `⚠ ${t("vehicleInsurance.expiresSoon", { date })}` };
  }
  return { tone: "ok" as const, label: `✓ ${t("vehicleInsurance.validUntil", { date })}` };
}

export function VehicleInsuranceCard({ vehicle }: { vehicle: VehicleInsurance }) {
  const me = trpc.me.get.useQuery();
  const perms = new Set(me.data?.permissions ?? []);
  const canEdit = perms.has("vehicle:update");
  const canRead = perms.has("insurance:read");
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const hasInsurance = Boolean(vehicle.insuranceCompany || vehicle.insurancePolicyNumber);
  const badge = expiryBadge(vehicle.insuranceExpiryDate);

  return (
    <section
      className="rounded-lg border border-border bg-surface p-4"
      aria-labelledby="vehicle-insurance"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="vehicle-insurance" className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-4 text-accent" aria-hidden />
          {t("vehicleInsurance.title")}
        </h2>
        {canEdit && !editing && (
          <Button variant="secondary" className="min-h-11" onClick={() => setEditing(true)}>
            {t("vehicleInsurance.edit")}
          </Button>
        )}
      </div>

      {editing ? (
        <InsuranceForm
          vehicle={vehicle}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            setNotice(t("vehicleInsurance.saved"));
            await utils.vehicle.get.invalidate({ id: vehicle.id });
          }}
        />
      ) : hasInsurance ? (
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t("vehicleInsurance.insurer")}</dt>
            <dd className="text-right font-medium">
              {vehicle.insuranceCompany ? (
                canRead ? (
                  <Link
                    href={`/assurances/compagnies/${vehicle.insuranceCompany.id}`}
                    className="underline"
                  >
                    {vehicle.insuranceCompany.name}
                  </Link>
                ) : (
                  vehicle.insuranceCompany.name
                )
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t("vehicleInsurance.policyNumber")}</dt>
            <dd className="text-right font-mono font-medium">
              {vehicle.insurancePolicyNumber ?? "—"}
            </dd>
          </div>
          <dd className="mt-1">
            <StatusBadge tone={badge.tone} label={badge.label} />
          </dd>
        </dl>
      ) : (
        <p className="text-sm text-muted">{t("vehicleInsurance.none")}</p>
      )}

      {notice && !editing && (
        <p role="status" className="mt-2 text-sm text-status-ok">
          ✓ {notice}
        </p>
      )}
      {perms.has("insurance:manage") && !editing && (
        <Link
          href={`/assurances/sinistres/nouveau?vehicule=${vehicle.id}`}
          className="btn btn-secondary mt-3 min-h-11 w-full"
        >
          {t("actions.openClaim")}
        </Link>
      )}
    </section>
  );
}

function InsuranceForm({
  vehicle,
  onCancel,
  onSaved,
}: {
  vehicle: VehicleInsurance;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const insurers = trpc.insurer.list.useQuery();
  const [insurerId, setInsurerId] = useState(vehicle.insuranceCompany?.id ?? "");
  const [policyNumber, setPolicyNumber] = useState(vehicle.insurancePolicyNumber ?? "");
  const [expiry, setExpiry] = useState(
    vehicle.insuranceExpiryDate
      ? new Date(vehicle.insuranceExpiryDate).toISOString().slice(0, 10)
      : "",
  );
  const [error, setError] = useState<string | null>(null);
  const save = trpc.vehicle.setInsurance.useMutation({
    onSuccess: onSaved,
    onError: (e) => setError(e.message),
  });

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        save.mutate({
          vehicleId: vehicle.id,
          insuranceCompanyId: insurerId || null,
          policyNumber: policyNumber.trim() || null,
          expiryDate: expiry || null,
        });
      }}
    >
      <Field label={t("vehicleInsurance.insurer")}>
        <Select value={insurerId} onChange={(e) => setInsurerId(e.target.value)}>
          <option value="">{t("vehicleInsurance.noInsurer")}</option>
          {insurers.data?.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
          {/* Compagnie désactivée depuis : reste affichée pour ne pas la perdre à l'enregistrement. */}
          {vehicle.insuranceCompany &&
            insurers.data &&
            !insurers.data.some((i) => i.id === vehicle.insuranceCompany!.id) && (
              <option value={vehicle.insuranceCompany.id}>{vehicle.insuranceCompany.name}</option>
            )}
        </Select>
      </Field>
      {insurers.data?.length === 0 && (
        <p className="text-sm text-muted">
          {t("vehicleInsurance.noInsurers")}{" "}
          <Link href="/assurances/compagnies" className="underline">
            {t("vehicleInsurance.manageInsurers")}
          </Link>
        </p>
      )}
      <Input
        label={t("vehicleInsurance.policyNumber")}
        value={policyNumber}
        onChange={(e) => setPolicyNumber(e.target.value)}
      />
      <Input
        type="date"
        label={t("vehicleInsurance.expiryDate")}
        value={expiry}
        onChange={(e) => setExpiry(e.target.value)}
      />
      {error && (
        <p role="alert" className="text-sm text-status-bad">
          ⚠ {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" className="min-h-11 flex-1" loading={save.isPending}>
          {t("save")}
        </Button>
        <Button type="button" variant="secondary" className="min-h-11" onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
