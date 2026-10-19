"use client";

// US-M05-02 — nouveau devis : client existant (recherche) ou prospect (nom + téléphone),
// véhicule facultatif, OR lié (depuis la fiche OR), validité. Crée un brouillon puis ouvre
// l'éditeur. `?repairOrderId=` : devis complémentaire ; `?inspectionId=` : depuis l'inspection.
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input, Select } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox } from "@/components/quotes/error-box";
import { t } from "@/components/quotes/i18n";

export default function NewQuotePage() {
  return (
    <Suspense fallback={null}>
      <NewQuoteForm />
    </Suspense>
  );
}

function NewQuoteForm() {
  const router = useRouter();
  const params = useSearchParams();
  const repairOrderId = params.get("repairOrderId") ?? undefined;
  const inspectionId = params.get("inspectionId") ?? undefined;
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(params.get("customerId"));
  const [vehicleId, setVehicleId] = useState<string>(params.get("vehicleId") ?? "");
  const [newCustomer, setNewCustomer] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  const customers = trpc.customer.list.useQuery({ q: debounced || undefined, limit: 8 }, { enabled: debounced.length >= 2 });
  const vehicles = trpc.vehicle.list.useQuery({ customerId: customerId ?? undefined, limit: 20 }, { enabled: !!customerId });
  const create = trpc.quote.create.useMutation({
    onSuccess: (quote) => router.push(`/devis/${quote.id}`),
    onError: (e) => setError(e.message),
  });
  const fromInspection = trpc.quote.createFromInspection.useMutation({
    onSuccess: ({ quote }) => router.push(`/devis/${quote.id}`),
    onError: (e) => setError(e.message),
  });
  const fromOrder = trpc.quote.createFromRepairOrderPending.useMutation({
    onSuccess: (quote) => router.push(`/devis/${quote.id}`),
    onError: (e) => setError(e.message),
  });

  useEffect(() => {
    if (inspectionId && !fromInspection.isPending && !fromInspection.isError && !fromInspection.isSuccess) {
      fromInspection.mutate({ inspectionId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectionId]);

  const selected = customers.data?.items.find((c) => c.id === customerId);

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("new")}</h1>
      {error && <ErrorBox message={error} />}
      {repairOrderId ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
          <p>{t("form.repairOrder")}</p>
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" loading={fromOrder.isPending} onClick={() => fromOrder.mutate({ repairOrderId })}>
              {t("form.create")} — lignes en attente d&apos;accord
            </Button>
            <Button
              variant="secondary"
              className="min-h-11"
              loading={create.isPending}
              onClick={() => create.mutate({ repairOrderId, origin: "REPAIR_ORDER" })}
            >
              {t("form.create")} — vide
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            create.mutate({
              customerId: newCustomer ? undefined : (customerId ?? undefined),
              newCustomer: newCustomer ? { name, phone } : undefined,
              vehicleId: vehicleId || undefined,
              validUntil: validUntil || undefined,
              origin: "STANDALONE",
            });
          }}
        >
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={newCustomer} onChange={(e) => setNewCustomer(e.target.checked)} />
            {t("form.newCustomer")}
          </label>
          {newCustomer ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={t("form.customerName")} value={name} onChange={(e) => setName(e.target.value)} required />
              <Input label={t("form.customerPhone")} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            </div>
          ) : (
            <>
              <Input
                label={t("form.customer")}
                placeholder={t("form.customerSearch")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {customers.data && debounced.length >= 2 && (
                <ul className="flex flex-col gap-1 text-sm" aria-label={t("form.customer")}>
                  {customers.data.items.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        aria-pressed={customerId === c.id}
                        onClick={() => {
                          setCustomerId(c.id);
                          setVehicleId("");
                        }}
                        className={`flex min-h-11 w-full items-center justify-between rounded-md border px-3 text-left ${customerId === c.id ? "border-accent bg-surface-2" : "border-border"}`}
                      >
                        <span>{c.displayName}</span>
                        <span className="text-xs text-muted">{c.phone ?? ""}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {selected && <p className="text-sm text-status-ok">✓ {selected.displayName}</p>}
              {customerId && (
                <label className="flex flex-col gap-1 text-sm">
                  <span>{t("form.vehicle")}</span>
                  <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                    <option value="">{t("form.noVehicle")}</option>
                    {vehicles.data?.items.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.make} {v.model} · {v.plate}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
            </>
          )}
          <Input label={t("form.validUntil")} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          <Button type="submit" className="min-h-11 self-start" loading={create.isPending} disabled={!newCustomer && !customerId}>
            {t("form.create")}
          </Button>
        </form>
      )}
    </div>
  );
}
