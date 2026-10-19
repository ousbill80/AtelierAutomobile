"use client";

// M04 US-M04-04 — signature à distance du bon de réception (lien envoyé par WhatsApp).
import { useState } from "react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, Input, SignaturePad } from "@atelieros/ui";
import { t } from "@/components/repair-orders/i18n";
import { trpc } from "@/trpc/react";

export function SignView({ token }: { token: string }) {
  const query = trpc.portal.repairOrder.reception.useQuery({ token }, { retry: false });
  const [name, setName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const sign = trpc.portal.repairOrder.signReception.useMutation({
    onSuccess: () => void query.refetch(),
  });
  if (query.isLoading)
    return <div className="mx-auto h-64 w-full max-w-lg animate-pulse rounded-lg bg-surface-2" />;
  if (query.isError || !query.data)
    return (
      <p role="alert" className="p-6 text-center text-status-bad">
        {t("portal.invalid")}
      </p>
    );
  const d = query.data;
  const damages = d.damages as { n: number; zone: string; type: string; severity: string }[];
  const items = d.items as { key: string; present: boolean }[];
  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-3 p-4 text-sm">
      <h1 className="text-xl font-semibold">{t("portal.receptionTitle", { number: d.number })}</h1>
      <span>
        {d.vehicle.make} {d.vehicle.model} · {d.vehicle.plate}
      </span>
      <span>
        {t("reception.summaryMileage", {
          value: d.mileageIn != null ? `${d.mileageIn.toLocaleString("fr-FR")} km` : "—",
        })}
      </span>
      <span>{t("reception.summaryFuel", { value: d.fuelLevel ?? "—" })}</span>
      <span>
        {d.noDamage
          ? t("reception.noDamage")
          : damages
              .map((x) =>
                t("reception.damageListItem", {
                  n: x.n,
                  zone: x.zone,
                  type: t(`reception.damageTypes.${x.type}`).toLowerCase(),
                  severity: t(`reception.severities.${x.severity}`).toLowerCase(),
                }),
              )
              .join(" · ")}
      </span>
      <span>
        {items
          .filter((i) => i.present)
          .map((i) => t(`checkInItems.${i.key}`))
          .join(", ")}
      </span>
      <p className="italic">{d.complaint}</p>
      <p className="rounded-md bg-surface-2 p-3">
        {t("reception.consent", { amount: formatFCFA(d.authorizationCeiling) })}
      </p>
      {!d.signaturePending ? (
        <p role="status" className="rounded-md bg-status-ok-bg p-3 text-status-ok">
          ✓ {sign.isSuccess ? t("portal.receptionSigned") : t("portal.alreadySigned")}
        </p>
      ) : (
        <>
          <Input
            label={t("reception.signerName")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <SignaturePad
            label={t("reception.signHere")}
            clearLabel={t("reception.clearSignature")}
            onChange={setSignature}
          />
          {sign.error && (
            <p role="alert" className="text-status-bad">
              ⚠ {sign.error.message}
            </p>
          )}
          <Button
            disabled={!name.trim() || !signature}
            loading={sign.isPending}
            onClick={() =>
              signature && sign.mutate({ token, signerName: name, signatureDataUrl: signature })
            }
          >
            {t("portal.sign")}
          </Button>
        </>
      )}
    </main>
  );
}
