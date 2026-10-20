"use client";

// M05 US-M05-02 — nouveau devis libre : client existant (recherche) ou prospect (nom +
// téléphone), véhicule facultatif ; les lignes s'ajoutent ensuite dans l'éditeur.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input, PhoneInput, Select } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { t } from "@/components/quotes/i18n";

export default function NewQuotePage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [customer, setCustomer] = useState<{ id: string; displayName: string } | null>(null);
  const [vehicleId, setVehicleId] = useState("");
  const [prospect, setProspect] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const search = trpc.customer.list.useQuery(
    { q: q.trim(), limit: 8 },
    { enabled: q.trim().length >= 2 && !customer },
  );
  const detail = trpc.customer.get.useQuery({ id: customer?.id ?? "" }, { enabled: !!customer });
  const create = trpc.quote.create.useMutation({
    onSuccess: (res) => router.push(`/devis/${res.id}`),
  });

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <Link href="/devis" className="text-sm text-accent">
        ← {t("back")}
      </Link>
      <h1 className="text-xl font-semibold">{t("newTitle")}</h1>
      {!prospect ? (
        customer ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{customer.displayName}</span>
              <Button variant="secondary" size="sm" onClick={() => setCustomer(null)}>
                {t("create.change")}
              </Button>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              {t("fields.vehicle")}
              <Select
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
                className="min-h-11"
              >
                <option value="">{t("create.noVehicle")}</option>
                {(detail.data?.vehicles ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.plate} — {v.make} {v.model}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Input
              label={t("create.searchCustomer")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("create.searchPlaceholder")}
            />
            <ul className="flex flex-col gap-1">
              {(search.data?.items ?? []).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="min-h-11 w-full rounded-md border border-border bg-surface p-2 text-left text-sm hover:border-accent"
                    onClick={() => setCustomer({ id: c.id, displayName: c.displayName })}
                  >
                    {c.displayName} {c.phone ? `· ${c.phone}` : ""}
                  </button>
                </li>
              ))}
            </ul>
            <Button variant="secondary" onClick={() => setProspect(true)}>
              + {t("create.prospect")}
            </Button>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
          <Input
            label={t("create.prospectName")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <PhoneInput label={t("create.prospectPhone")} value={phone} onChange={setPhone} />
          <Button variant="secondary" size="sm" onClick={() => setProspect(false)}>
            {t("create.existing")}
          </Button>
        </div>
      )}
      {create.error && (
        <p role="alert" className="text-sm text-status-bad">
          ⚠ {create.error.message}
        </p>
      )}
      <Button
        disabled={prospect ? !name.trim() || !phone.trim() : !customer}
        loading={create.isPending}
        onClick={() =>
          create.mutate(
            prospect
              ? { newCustomer: { name, phone }, origin: "STANDALONE" }
              : {
                  customerId: customer!.id,
                  vehicleId: vehicleId || undefined,
                  origin: "STANDALONE",
                },
          )
        }
      >
        {t("create.submit")}
      </Button>
    </div>
  );
}
