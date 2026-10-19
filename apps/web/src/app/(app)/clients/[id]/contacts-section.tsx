"use client";

import { useState, type FormEvent } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import {
  Button,
  CheckboxRow,
  EmptyState,
  Field,
  Input,
  Modal,
  PhoneInput,
  StatusBadge,
} from "@atelieros/ui";
import { t } from "@/i18n/t";
import type { AppRouter } from "@/server/routers/_app";
import { trpc } from "@/trpc/react";

type Contact = inferRouterOutputs<AppRouter>["contact"]["list"][number];

interface FormState {
  name: string;
  role: string;
  phone: string;
  phone2: string;
  email: string;
  isPrimary: boolean;
  receivesReminders: boolean;
  receivesInvoices: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  role: "",
  phone: "",
  phone2: "",
  email: "",
  isPrimary: false,
  receivesReminders: false,
  receivesInvoices: false,
};

function toForm(contact: Contact): FormState {
  return {
    name: contact.name,
    role: contact.role ?? "",
    phone: contact.phone ?? "",
    phone2: contact.phone2 ?? "",
    email: contact.email ?? "",
    isPrimary: contact.isPrimary,
    receivesReminders: contact.receivesReminders,
    receivesInvoices: contact.receivesInvoices,
  };
}

/** Champ texte facultatif : chaîne vide → `null` (efface la valeur à la modification). */
function optional(value: string): string | null {
  return value.trim() === "" ? null : value.trim();
}

/** Onglet « Contacts » de la fiche client (PRD M02 §7) : interlocuteurs d'une entreprise. */
export function ContactsSection({ customerId }: { customerId: string }) {
  const utils = trpc.useUtils();
  const contacts = trpc.contact.list.useQuery({ customerId });
  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [toDelete, setToDelete] = useState<Contact | null>(null);

  function refresh() {
    void utils.contact.list.invalidate({ customerId });
    void utils.customer.get.invalidate({ id: customerId });
  }

  const create = trpc.contact.create.useMutation({
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
  });
  const update = trpc.contact.update.useMutation({
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
  });
  const remove = trpc.contact.delete.useMutation({
    onSuccess: () => {
      setToDelete(null);
      refresh();
    },
  });

  function openCreate() {
    create.reset();
    setForm(EMPTY_FORM);
    setEditing("new");
  }

  function openEdit(contact: Contact) {
    update.reset();
    setForm(toForm(contact));
    setEditing(contact);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const fields = {
      name: form.name.trim(),
      role: optional(form.role),
      phone: optional(form.phone),
      phone2: optional(form.phone2),
      email: optional(form.email),
      isPrimary: form.isPrimary,
      receivesReminders: form.receivesReminders,
      receivesInvoices: form.receivesInvoices,
    };
    if (editing === "new") {
      create.mutate({ customerId, ...fields });
    } else if (editing) {
      update.mutate({ id: editing.id, patch: fields });
    }
  }

  const saveError = (editing === "new" ? create.error : update.error)?.message;

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("customers.contacts.title")}</h2>
        <Button variant="secondary" onClick={openCreate}>
          {t("customers.contacts.add")}
        </Button>
      </div>

      {contacts.isLoading ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg border border-border bg-surface-2"
            />
          ))}
        </div>
      ) : contacts.isError ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-status-bad bg-status-bad-bg p-4">
          <p className="text-sm text-status-bad">{t("customers.contacts.loadError")}</p>
          <Button variant="secondary" onClick={() => contacts.refetch()}>
            {t("customers.contacts.retry")}
          </Button>
        </div>
      ) : !contacts.data || contacts.data.length === 0 ? (
        <EmptyState
          title={t("customers.contacts.empty.title")}
          description={t("customers.contacts.empty.description")}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {contacts.data.map((contact) => (
            <li
              key={contact.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3"
            >
              <div className="flex flex-col gap-1">
                <span className="font-medium">
                  {contact.name}
                  {contact.role ? <span className="text-muted"> — {contact.role}</span> : null}
                </span>
                <span className="flex flex-wrap gap-2 text-sm text-muted">
                  {contact.phone && <span>{contact.phone}</span>}
                  {contact.phone2 && <span>{contact.phone2}</span>}
                  {contact.email && <span>{contact.email}</span>}
                </span>
                <span className="flex flex-wrap gap-2">
                  {contact.isPrimary && (
                    <StatusBadge tone="ok" label={t("customers.contacts.badges.primary")} />
                  )}
                  {contact.receivesReminders && (
                    <StatusBadge tone="off" label={t("customers.contacts.badges.reminders")} />
                  )}
                  {contact.receivesInvoices && (
                    <StatusBadge tone="off" label={t("customers.contacts.badges.invoices")} />
                  )}
                </span>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => openEdit(contact)}>
                  {t("common.edit")}
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    remove.reset();
                    setToDelete(contact);
                  }}
                >
                  {t("common.delete")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={editing !== null}
        title={
          editing === "new"
            ? t("customers.contacts.createTitle")
            : t("customers.contacts.editTitle")
        }
        onClose={() => setEditing(null)}
      >
        <form onSubmit={handleSubmit} className="stack">
          <Field label={t("customers.contacts.fields.name")}>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              minLength={1}
            />
          </Field>
          <Field label={`${t("customers.contacts.fields.role")} ${t("common.optional")}`}>
            <Input
              value={form.role}
              placeholder={t("customers.contacts.fields.rolePlaceholder")}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            />
          </Field>
          <Field label={`${t("customers.contacts.fields.phone")} ${t("common.optional")}`}>
            <PhoneInput value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
          </Field>
          <Field label={`${t("customers.contacts.fields.phone2")} ${t("common.optional")}`}>
            <PhoneInput value={form.phone2} onChange={(phone2) => setForm({ ...form, phone2 })} />
          </Field>
          <Field label={`${t("customers.contacts.fields.email")} ${t("common.optional")}`}>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <CheckboxRow
            label={t("customers.contacts.fields.isPrimary")}
            checked={form.isPrimary}
            onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })}
          />
          <CheckboxRow
            label={t("customers.contacts.fields.receivesReminders")}
            checked={form.receivesReminders}
            onChange={(e) => setForm({ ...form, receivesReminders: e.target.checked })}
          />
          <CheckboxRow
            label={t("customers.contacts.fields.receivesInvoices")}
            checked={form.receivesInvoices}
            onChange={(e) => setForm({ ...form, receivesInvoices: e.target.checked })}
          />
          {saveError ? <p className="error">{saveError}</p> : null}
          <Button type="submit" block loading={create.isPending || update.isPending}>
            {t("common.save")}
          </Button>
        </form>
      </Modal>

      <Modal
        open={toDelete !== null}
        title={t("customers.contacts.deleteTitle")}
        onClose={() => setToDelete(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setToDelete(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => toDelete && remove.mutate({ id: toDelete.id })}
            >
              {t("common.delete")}
            </Button>
          </>
        }
      >
        <p>{t("customers.contacts.deleteConfirm", { name: toDelete?.name ?? "" })}</p>
        {remove.error ? <p className="error">{remove.error.message}</p> : null}
      </Modal>
    </section>
  );
}
