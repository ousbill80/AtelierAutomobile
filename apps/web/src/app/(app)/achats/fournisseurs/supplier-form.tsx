"use client";

// Création / modification d'un fournisseur (coordonnées +225, délai de paiement, conditions).
import { useState } from "react";
import {
  Building2,
  Calendar,
  FileText,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
} from "lucide-react";
import { Button, Field, Input, Modal, PhoneInput, Textarea } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { InlineError } from "../../stock/_lib/components";
import { errorMessage, t } from "../../stock/_lib/i18n";

export interface SupplierValues {
  id?: string;
  name: string;
  phone: string;
  whatsappPhone: string;
  email: string;
  address: string;
  paymentTermsDays: number;
  notes: string;
}

const PAYMENT_PRESETS = [
  { days: 0, label: "Comptant (0 j)" },
  { days: 15, label: "15 jours" },
  { days: 30, label: "30 jours net" },
  { days: 60, label: "60 jours" },
];

export function SupplierFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: SupplierValues;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const utils = trpc.useUtils();
  const [v, setV] = useState<SupplierValues>(
    initial ?? {
      name: "",
      phone: "",
      whatsappPhone: "",
      email: "",
      address: "",
      paymentTermsDays: 0,
      notes: "",
    },
  );

  const create = trpc.supplier.create.useMutation();
  const update = trpc.supplier.update.useMutation();
  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  async function submit() {
    const payload = {
      name: v.name.trim(),
      phone: v.phone || null,
      whatsappPhone: v.whatsappPhone || null,
      email: v.email || null,
      address: v.address || null,
      paymentTermsDays: v.paymentTermsDays,
      notes: v.notes || null,
    };
    const saved = v.id
      ? await update.mutateAsync({ id: v.id, ...payload })
      : await create.mutateAsync(payload);
    await utils.supplier.invalidate();
    onSaved(saved.id);
  }

  return (
    <Modal
      open
      title={v.id ? t("common.edit") : t("suppliers.new")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={pending}
            disabled={v.name.trim().length < 2 || pending}
            onClick={() => void submit().catch(() => undefined)}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 py-1">
        {/* Section 1 : Entreprise */}
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2/40 p-3.5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
            <Building2 className="size-4 text-accent" aria-hidden />
            {t("suppliers.sections.identity")}
          </div>

          <Field label={t("suppliers.name")}>
            <Input
              value={v.name}
              placeholder="ex. CFAO Motors, SIVITA, Autodistribution…"
              onChange={(e) => setV({ ...v, name: e.target.value })}
              required
            />
          </Field>
        </div>

        {/* Section 2 : Canaux de contact & WhatsApp */}
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2/40 p-3.5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
            <MessageCircle className="size-4 text-status-ok" aria-hidden />
            {t("suppliers.sections.contact")}
          </div>

          <Field
            label={
              <span className="flex items-center gap-2">
                <span>{t("suppliers.whatsappPhone")}</span>
                <span className="rounded bg-status-ok/15 px-1.5 py-0.5 text-[10px] font-bold text-status-ok">
                  {t("suppliers.whatsappBadge")}
                </span>
              </span>
            }
            hint={t("suppliers.whatsappHint")}
          >
            <PhoneInput
              value={v.whatsappPhone}
              onChange={(value) => setV({ ...v, whatsappPhone: value })}
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label={
                <span className="flex items-center gap-1.5">
                  <Phone className="size-3.5 text-muted" aria-hidden />
                  <span>{t("suppliers.phone")}</span>
                </span>
              }
            >
              <PhoneInput
                value={v.phone}
                onChange={(value) => setV({ ...v, phone: value })}
              />
            </Field>

            <Field
              label={
                <span className="flex items-center gap-1.5">
                  <Mail className="size-3.5 text-muted" aria-hidden />
                  <span>{t("suppliers.email")}</span>
                </span>
              }
            >
              <Input
                type="email"
                placeholder="commandes@fournisseur.ci"
                value={v.email}
                onChange={(e) => setV({ ...v, email: e.target.value })}
              />
            </Field>
          </div>
        </div>

        {/* Section 3 : Localisation */}
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2/40 p-3.5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
            <MapPin className="size-4 text-accent" aria-hidden />
            {t("suppliers.sections.address")}
          </div>

          <Field label={t("suppliers.address")}>
            <Input
              placeholder="ex. Zone Industrielle Yopougon, Rue des Carrossiers, Abidjan"
              value={v.address}
              onChange={(e) => setV({ ...v, address: e.target.value })}
            />
          </Field>
        </div>

        {/* Section 4 : Conditions de règlement & Notes */}
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2/40 p-3.5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
            <Calendar className="size-4 text-accent" aria-hidden />
            {t("suppliers.sections.terms")}
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-foreground">
              {t("suppliers.paymentTermsDays")}
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {PAYMENT_PRESETS.map((p) => {
                const selected = v.paymentTermsDays === p.days;
                return (
                  <button
                    key={p.days}
                    type="button"
                    onClick={() => setV({ ...v, paymentTermsDays: p.days })}
                    className={`inline-flex min-h-8 items-center rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                      selected
                        ? "border-foreground bg-foreground text-background font-semibold"
                        : "border-border bg-surface text-muted hover:bg-surface-3 hover:text-foreground"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-1 max-w-[200px]">
              <Input
                type="number"
                min={0}
                value={v.paymentTermsDays}
                aria-label={t("suppliers.paymentTermsDays")}
                onChange={(e) =>
                  setV({
                    ...v,
                    paymentTermsDays: Math.max(0, Math.round(Number(e.target.value) || 0)),
                  })
                }
              />
            </div>
          </div>

          <Field
            label={
              <span className="flex items-center gap-1.5">
                <FileText className="size-3.5 text-muted" aria-hidden />
                <span>{t("suppliers.notes")}</span>
              </span>
            }
            hint="Franco de port, remises accordées, coordonnées du commercial référent…"
          >
            <Textarea
              rows={3}
              placeholder="Spécialités de pièces, conditions de retour et garanties, contact direct…"
              value={v.notes}
              onChange={(e) => setV({ ...v, notes: e.target.value })}
            />
          </Field>
        </div>

        <InlineError message={error ? errorMessage(error) : null} />
      </div>
    </Modal>
  );
}
