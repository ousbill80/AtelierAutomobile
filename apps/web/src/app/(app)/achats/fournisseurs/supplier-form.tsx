"use client";

// Création / modification d'un fournisseur (coordonnées +225, délai de paiement, conditions).
import { useState } from "react";
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
      <div className="flex flex-col gap-3">
        <Input
          label={t("suppliers.name")}
          value={v.name}
          onChange={(e) => setV({ ...v, name: e.target.value })}
        />
        <Field label={t("suppliers.whatsappPhone")}>
          <PhoneInput
            value={v.whatsappPhone}
            onChange={(value) => setV({ ...v, whatsappPhone: value })}
          />
        </Field>
        <Field label={t("suppliers.phone")}>
          <PhoneInput value={v.phone} onChange={(value) => setV({ ...v, phone: value })} />
        </Field>
        <Input
          label={t("suppliers.email")}
          type="email"
          value={v.email}
          onChange={(e) => setV({ ...v, email: e.target.value })}
        />
        <Input
          label={t("suppliers.address")}
          value={v.address}
          onChange={(e) => setV({ ...v, address: e.target.value })}
        />
        <Input
          label={t("suppliers.paymentTermsDays")}
          type="number"
          min={0}
          value={v.paymentTermsDays}
          onChange={(e) =>
            setV({ ...v, paymentTermsDays: Math.max(0, Math.round(Number(e.target.value) || 0)) })
          }
        />
        <Field label={t("suppliers.notes")}>
          <Textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </Field>
        <InlineError message={error ? errorMessage(error) : null} />
      </div>
    </Modal>
  );
}
