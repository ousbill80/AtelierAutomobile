"use client";

// M04 US-M04-13 / RG-M04-14 — restitution : solde et facture, objets de la réception à
// vérifier, km et carburant de sortie, anciennes pièces, qui récupère, signature, forçage.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatFCFA } from "@atelieros/core/money";
import { Button, FuelGauge, Input, SignaturePad, Textarea } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { t } from "@/components/repair-orders/i18n";

export function DeliveryView({ id }: { id: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const me = trpc.me.get.useQuery();
  const order = trpc.repairOrder.get.useQuery({ id });
  const [mileage, setMileage] = useState("");
  const [fuel, setFuel] = useState<number | null>(null);
  const [itemsConfirmed, setItemsConfirmed] = useState(false);
  const [oldPartsReturned, setOldPartsReturned] = useState(false);
  const [collectedBy, setCollectedBy] = useState("");
  const [collectedPhone, setCollectedPhone] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [forceReason, setForceReason] = useState("");
  const [skipQcReason, setSkipQcReason] = useState("");
  const deliver = trpc.repairOrder.deliver.useMutation({
    onSuccess: () => {
      void utils.repairOrder.get.invalidate({ id });
      router.push(`/ordres/${id}`);
    },
  });

  if (order.isLoading) return <ListSkeleton rows={4} />;
  if (order.isError || !order.data) return <ErrorBox onRetry={() => order.refetch()} />;
  const o = order.data;
  const perms = new Set(me.data?.permissions ?? []);
  const checkIn = o.checkIn as {
    items?: { key: string; present: boolean }[];
    returnOldParts?: boolean;
    keysCount?: number;
    belongings?: string;
  };
  const delivery = o.delivery;
  const blocked = delivery?.check && !delivery.check.ok;
  const name = collectedBy || o.customer.displayName;

  return (
    <div className="flex min-w-0 flex-col gap-4 pb-8">
      <Link href={`/ordres/${id}`} className="text-sm text-accent">
        ← {o.number}
      </Link>
      <h1 className="text-xl font-semibold">{t("delivery.title", { number: o.number })}</h1>

      {delivery && (
        <section
          className={`flex flex-col gap-1 rounded-lg border p-3 text-sm ${blocked ? "border-status-bad bg-status-bad-bg" : "border-border bg-surface"}`}
        >
          <span className="text-xs text-muted">
            {delivery.invoiceIssued ? t("delivery.invoiceIssued") : t("delivery.noInvoice")}
          </span>
          <span className="text-lg font-semibold">
            {t("delivery.balance")} : {formatFCFA(delivery.customerBalance)}
          </span>
          {delivery.paymentTermsDays > 0 && (
            <span>{t("delivery.credit", { days: delivery.paymentTermsDays })}</span>
          )}
          {delivery.check && !delivery.check.ok && (
            <span role="alert" className="font-medium text-status-bad">
              ⛔ {delivery.check.message}
            </span>
          )}
          <span className="text-xs text-muted">{t("delivery.collectHint")}</span>
        </section>
      )}

      <section className="flex flex-col gap-2 text-sm">
        <h2 className="font-semibold">{t("delivery.items")}</h2>
        <p>
          {(checkIn.items ?? [])
            .filter((i) => i.present)
            .map((i) => t(`checkInItems.${i.key}`))
            .join(", ") || "—"}
          {checkIn.keysCount ? ` · ${t("receptionTab.keys", { count: checkIn.keysCount })}` : ""}
          {checkIn.belongings ? ` · ${checkIn.belongings}` : ""}
        </p>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={itemsConfirmed}
            onChange={(e) => setItemsConfirmed(e.target.checked)}
          />
          {t("delivery.itemsConfirmed")}
        </label>
        {checkIn.returnOldParts && (
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={oldPartsReturned}
              onChange={(e) => setOldPartsReturned(e.target.checked)}
            />
            {t("delivery.oldPartsReturned")}
          </label>
        )}
      </section>

      <Input
        label={t("delivery.mileageOut")}
        inputMode="numeric"
        value={mileage}
        onChange={(e) => setMileage(e.target.value.replace(/\D/g, ""))}
      />
      <div className="flex flex-col gap-2 text-sm">
        <span className="font-medium">{t("delivery.fuelOut")}</span>
        <FuelGauge
          label={t("delivery.fuelOut")}
          value={fuel ?? o.fuelLevel}
          onChange={setFuel}
          levelLabel={(level) => t("reception.fuelValue", { level })}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          label={t("delivery.collectedBy")}
          placeholder={o.customer.displayName}
          value={collectedBy}
          onChange={(e) => setCollectedBy(e.target.value)}
        />
        <Input
          label={t("delivery.collectedPhone")}
          inputMode="tel"
          value={collectedPhone}
          onChange={(e) => setCollectedPhone(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2 text-sm">
        <span>{t("reception.signHere")}</span>
        <SignaturePad
          label={t("reception.signHere")}
          clearLabel={t("reception.clearSignature")}
          onChange={setSignature}
        />
      </div>

      {o.status === "QUALITY_CHECK" && perms.has("repair_order:qc") && (
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("delivery.skipQc")}</span>
          <Textarea value={skipQcReason} onChange={(e) => setSkipQcReason(e.target.value)} />
        </label>
      )}
      {blocked && perms.has("repair_order:deliver_unpaid") && (
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("delivery.forceUnpaid")}</span>
          <Textarea value={forceReason} onChange={(e) => setForceReason(e.target.value)} />
        </label>
      )}
      {deliver.error && <ErrorBox message={deliver.error.message} />}
      <Button
        loading={deliver.isPending}
        disabled={!itemsConfirmed}
        onClick={() =>
          deliver.mutate({
            id,
            checkOut: {
              mileage: mileage ? Number(mileage) : null,
              fuelLevel: fuel ?? o.fuelLevel ?? 0,
              itemsConfirmed,
              oldPartsReturned,
              collectedBy: { name, phone: collectedPhone || undefined },
            },
            signature: signature ? { dataUrl: signature, signerName: name } : undefined,
            forceUnpaidReason: forceReason || undefined,
            skipQcReason: skipQcReason || undefined,
          })
        }
      >
        {t("delivery.submit")}
      </Button>
    </div>
  );
}
