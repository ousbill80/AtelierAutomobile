"use client";

// M05 US-M05-02 — nouveau devis libre : client existant (recherche) ou prospect (nom +
// téléphone), véhicule facultatif ; les lignes s'ajoutent ensuite dans l'éditeur.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, UserCheck, UserPlus, Users } from "lucide-react";
import {
  Button,
  Field,
  FormActions,
  FormCard,
  FormGrid,
  FormSection,
  Input,
  PhoneInput,
  SegmentedControl,
  Select,
} from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { t } from "@/components/quotes/i18n";

export default function NewQuotePage() {
  const router = useRouter();
  const [mode, setMode] = useState<"existing" | "prospect">("existing");
  const [q, setQ] = useState("");
  const [customer, setCustomer] = useState<{ id: string; displayName: string; phone?: string | null } | null>(null);
  const [vehicleId, setVehicleId] = useState("");
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

  const isProspect = mode === "prospect";
  const canSubmit = isProspect
    ? name.trim().length >= 2 && phone.replace(/\s+/g, "").length >= 10
    : Boolean(customer);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    create.mutate(
      isProspect
        ? { newCustomer: { name: name.trim(), phone: phone.trim() }, origin: "STANDALONE" }
        : {
            customerId: customer!.id,
            vehicleId: vehicleId || undefined,
            origin: "STANDALONE",
          },
    );
  }

  return (
    <FormCard
      icon={<FileText className="size-5" />}
      title={t("newTitle")}
      description="Établissez un nouveau devis chiffré pour un client de l'atelier ou un prospect"
      badge="Nouveau devis"
      backHref="/devis"
      backLabel="Retour aux devis"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <SegmentedControl
          label="Type de destinataire"
          value={mode}
          onChange={(val) => {
            setMode(val);
            if (val === "prospect") {
              setCustomer(null);
              setVehicleId("");
            }
          }}
          options={[
            {
              value: "existing",
              label: "Client enregistré",
              icon: <UserCheck className="size-4" />,
            },
            {
              value: "prospect",
              label: "Nouveau prospect rapide",
              icon: <UserPlus className="size-4" />,
            },
          ]}
        />

        {mode === "existing" ? (
          <FormSection
            icon={<Users className="size-4" />}
            title="Sélection du client"
            description="Recherchez un client existant par son nom, son numéro ou sa plaque"
          >
            {customer ? (
              <div className="flex flex-col gap-4 rounded-xl border border-accent/40 bg-accent/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-accent font-bold">
                      {customer.displayName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="font-semibold text-foreground">{customer.displayName}</h4>
                      {customer.phone && (
                        <p className="text-xs text-muted font-mono">{customer.phone}</p>
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setCustomer(null);
                      setVehicleId("");
                    }}
                  >
                    Changer
                  </Button>
                </div>

                <div className="border-t border-border/60 pt-3">
                  <Field
                    label={t("fields.vehicle")}
                    hint="Sélectionnez le véhicule concerné par ce devis (optionnel)"
                  >
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
                  </Field>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <Field
                  label={t("create.searchCustomer")}
                  hint="Tapez au moins 2 lettres ou chiffres"
                >
                  <div className="relative">
                    <Input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder={t("create.searchPlaceholder")}
                      autoFocus
                    />
                  </div>
                </Field>

                {search.isLoading && (
                  <div className="h-14 animate-pulse rounded-lg bg-surface-2" />
                )}

                {search.data && search.data.items.length === 0 && q.trim().length >= 2 && (
                  <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border p-4 text-center">
                    <p className="text-sm text-muted">Aucun client trouvé pour « {q} ».</p>
                    <button
                      type="button"
                      className="text-xs font-semibold text-accent hover:underline"
                      onClick={() => {
                        setMode("prospect");
                        setName(q);
                      }}
                    >
                      + Créer comme nouveau prospect
                    </button>
                  </div>
                )}

                {search.data && search.data.items.length > 0 && (
                  <ul className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
                    {search.data.items.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between rounded-lg border border-border bg-surface p-3 text-left text-sm transition hover:border-accent hover:bg-surface-2"
                          onClick={() => setCustomer({ id: c.id, displayName: c.displayName, phone: c.phone })}
                        >
                          <div className="flex flex-col">
                            <span className="font-semibold text-foreground">{c.displayName}</span>
                            {c.phone && <span className="text-xs font-mono text-muted">{c.phone}</span>}
                          </div>
                          <span className="text-xs font-semibold text-accent">Sélectionner →</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </FormSection>
        ) : (
          <FormSection
            icon={<UserPlus className="size-4" />}
            title="Coordonnées du prospect"
            description="Le prospect sera automatiquement enregistré lors de la validation du devis"
          >
            <FormGrid columns={2}>
              <Field
                label="Nom complet ou Raison sociale"
                required
                hint="Ex: Amadou Kouamé ou Société Ivoire Transport"
              >
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nom ou entreprise"
                  required
                />
              </Field>

              <PhoneInput
                label="Numéro WhatsApp / Téléphone"
                required
                value={phone}
                onChange={setPhone}
                hint="10 chiffres avec indicatif ivoirien +225 pour envoi direct du devis"
              />
            </FormGrid>
          </FormSection>
        )}

        {create.error && (
          <div className="rounded-lg border border-status-bad/50 bg-status-bad-bg p-3 text-xs text-status-bad">
            ⚠ {create.error.message}
          </div>
        )}

        <FormActions
          submitLabel={create.isPending ? "Création du devis…" : t("create.submit")}
          loading={create.isPending}
          disabled={!canSubmit}
          cancelHref="/devis"
          cancelLabel="Annuler"
        />
      </form>
    </FormCard>
  );
}
