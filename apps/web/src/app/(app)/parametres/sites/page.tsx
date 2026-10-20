"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHead,
  PhoneInput,
  StatusBadge,
} from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

export default function SitesPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [commune, setCommune] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [error, setError] = useState<string | null>(null);
  // M15 RG-M15-20 : limite de l'offre atteinte → lien vers /parametres/abonnement.
  const [planLimit, setPlanLimit] = useState(false);

  const utils = trpc.useUtils();
  const sites = trpc.site.list.useQuery();

  const createSite = trpc.site.create.useMutation({
    onSuccess() {
      setModalOpen(false);
      setName("");
      setCode("");
      setAddress("");
      setCommune("");
      setPhone("");
      setWhatsapp("");
      setError(null);
      utils.site.list.invalidate();
    },
    onError(err) {
      setError(err.message);
      setPlanLimit(err.data?.domainCode === "PLAN_LIMIT_REACHED");
    },
  });

  const deactivate = trpc.site.deactivate.useMutation({
    onSuccess() {
      utils.site.list.invalidate();
    },
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    createSite.mutate({
      name,
      code: code.trim().toUpperCase(),
      address: address.trim() || undefined,
      commune: commune.trim() || undefined,
      phone: phone.trim() || undefined,
      whatsappNumber: whatsapp.trim() || undefined,
    });
  }

  return (
    <>
      <PageHead
        title={t("settings.sites.title")}
        description={t("settings.sites.description")}
        actions={
          <Button onClick={() => setModalOpen(true)}>{t("settings.sites.createAction")}</Button>
        }
      />
      <DataTable
        columns={[
          {
            key: "name",
            header: t("settings.sites.nameLabel"),
            primary: true,
            render: (row) => row.name,
          },
          { key: "code", header: t("settings.sites.codeLabel"), render: (row) => row.code },
          {
            key: "address",
            header: t("settings.sites.addressLabel"),
            render: (row) => row.address ?? "—",
          },
          {
            key: "city",
            header: t("settings.sites.cityLabel"),
            render: (row) => row.commune ?? "—",
          },
          {
            key: "phone",
            header: t("settings.sites.phoneLabel"),
            render: (row) => row.phone ?? "—",
          },
          {
            key: "status",
            header: t("settings.team.table.status"),
            render: (row) => (
              <StatusBadge
                tone={row.isActive ? "ok" : "off"}
                label={
                  row.isActive ? t("settings.team.statusActive") : t("settings.team.statusInactive")
                }
              />
            ),
          },
          {
            key: "actions",
            header: "",
            render: (row) =>
              row.isActive ? (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => deactivate.mutate({ siteId: row.id })}
                >
                  {t("common.deactivate")}
                </Button>
              ) : null,
          },
        ]}
        rows={sites.data ?? []}
        rowKey={(row) => row.id}
        empty={<EmptyState title={t("common.genericError")} />}
      />

      <Modal
        open={modalOpen}
        title={t("settings.sites.createAction")}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleCreate} className="stack">
          <Field label={t("settings.sites.nameLabel")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required minLength={1} />
          </Field>
          <Field label={t("settings.sites.codeLabel")}>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
              minLength={2}
              maxLength={10}
              pattern="[A-Z0-9]+"
            />
          </Field>
          <Field label={`${t("settings.sites.addressLabel")} ${t("common.optional")}`}>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Field label={`${t("settings.sites.cityLabel")} ${t("common.optional")}`}>
            <Input value={commune} onChange={(e) => setCommune(e.target.value)} />
          </Field>
          <Field label={`${t("settings.sites.phoneLabel")} ${t("common.optional")}`}>
            <PhoneInput value={phone} onChange={setPhone} />
          </Field>
          <Field label={`${t("settings.sites.whatsappLabel")} ${t("common.optional")}`}>
            <PhoneInput value={whatsapp} onChange={setWhatsapp} />
          </Field>
          {error ? <p className="error">{error}</p> : null}
          {planLimit ? (
            <Link className="btn btn-secondary min-h-11" href="/parametres/abonnement">
              {t("settings.sites.seePlans")}
            </Link>
          ) : null}
          <Button type="submit" block loading={createSite.isPending}>
            {t("settings.sites.createAction")}
          </Button>
        </form>
      </Modal>
    </>
  );
}
