"use client";

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
  Select,
  StatusBadge,
  Tabs,
} from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

const ROLES = ["MANAGER", "ADVISOR", "MECHANIC", "STOREKEEPER", "CASHIER", "ACCOUNTANT"] as const;
const CHANNELS = ["WHATSAPP", "SMS", "EMAIL"] as const;

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("fr-FR");
}

export default function TeamPage() {
  const [tab, setTab] = useState<"members" | "invitations">("members");
  const [modalOpen, setModalOpen] = useState(false);

  const utils = trpc.useUtils();
  const me = trpc.me.get.useQuery();
  const members = trpc.member.list.useQuery({ status: "ACTIVE" });
  const invitations = trpc.member.listInvitations.useQuery(undefined, {
    enabled: tab === "invitations",
  });

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("ADVISOR");
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("WHATSAPP");
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const invite = trpc.member.invite.useMutation({
    onSuccess() {
      setModalOpen(false);
      setName("");
      setPhone("");
      setEmail("");
      setSiteIds([]);
      setError(null);
      utils.member.listInvitations.invalidate();
    },
    onError(err) {
      setError(err.message);
    },
  });

  const resend = trpc.member.resendInvitation.useMutation({
    onSuccess() {
      utils.member.listInvitations.invalidate();
    },
  });
  const revoke = trpc.member.revokeInvitation.useMutation({
    onSuccess() {
      utils.member.listInvitations.invalidate();
    },
  });

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    invite.mutate({
      name,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      role,
      siteIds,
      channel,
    });
  }

  const allowedSites = me.data?.allowedSites ?? [];

  return (
    <>
      <PageHead
        title={t("settings.team.title")}
        description={t("settings.team.description")}
        actions={
          <Button onClick={() => setModalOpen(true)}>{t("settings.team.inviteAction")}</Button>
        }
      />
      <Tabs
        items={[
          { key: "members", label: t("settings.team.tabs.members") },
          { key: "invitations", label: t("settings.team.tabs.invitations") },
        ]}
        activeKey={tab}
        onChange={(key) => setTab(key as "members" | "invitations")}
      />
      {tab === "members" ? (
        <DataTable
          columns={[
            {
              key: "name",
              header: t("settings.team.table.name"),
              primary: true,
              render: (row) => row.user.name,
            },
            {
              key: "role",
              header: t("settings.team.table.role"),
              render: (row) => t(`common.roles.${row.role}`),
            },
            {
              key: "sites",
              header: t("settings.team.table.sites"),
              render: (row) =>
                row.siteIds.length === 0
                  ? t("common.allSites")
                  : row.siteIds
                      .map((id: string) => allowedSites.find((s) => s.id === id)?.name ?? id)
                      .join(", "),
            },
            {
              key: "phone",
              header: t("settings.team.table.phone"),
              render: (row) => row.user.phone ?? "—",
            },
            {
              key: "lastActive",
              header: t("settings.team.table.lastActive"),
              render: (row) => formatDate(row.user.lastLoginAt),
            },
            {
              key: "status",
              header: t("settings.team.table.status"),
              render: (row) => (
                <StatusBadge
                  tone={row.isActive ? "ok" : "off"}
                  label={
                    row.isActive
                      ? t("settings.team.statusActive")
                      : t("settings.team.statusInactive")
                  }
                />
              ),
            },
          ]}
          rows={members.data ?? []}
          rowKey={(row) => row.id}
          empty={<EmptyState title={t("common.genericError")} />}
        />
      ) : (
        <DataTable
          columns={[
            {
              key: "name",
              header: t("settings.team.table.name"),
              primary: true,
              render: (row) => row.name,
            },
            {
              key: "role",
              header: t("settings.team.table.role"),
              render: (row) => t(`common.roles.${row.role}`),
            },
            {
              key: "channel",
              header: t("settings.team.table.channel"),
              render: (row) => (row.channel ? t(`common.channels.${row.channel}`) : "—"),
            },
            {
              key: "actions",
              header: "",
              render: (row) => (
                <div className="row-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => resend.mutate({ invitationId: row.id })}
                  >
                    {t("common.resend")}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => revoke.mutate({ invitationId: row.id })}
                  >
                    {t("common.revoke")}
                  </Button>
                </div>
              ),
            },
          ]}
          rows={invitations.data ?? []}
          rowKey={(row) => row.id}
          empty={<EmptyState title={t("common.genericError")} />}
        />
      )}

      <Modal
        open={modalOpen}
        title={t("settings.team.inviteModal.title")}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleInvite} className="stack">
          <Field label={t("settings.team.inviteModal.nameLabel")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
          </Field>
          <Field label={`${t("settings.team.inviteModal.phoneLabel")} ${t("common.optional")}`}>
            <PhoneInput value={phone} onChange={setPhone} />
          </Field>
          <Field label={`${t("settings.team.inviteModal.emailLabel")} ${t("common.optional")}`}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t("settings.team.inviteModal.roleLabel")}>
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`common.roles.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("settings.team.inviteModal.sitesLabel")}>
            <Select
              multiple
              value={siteIds}
              onChange={(e) =>
                setSiteIds(Array.from(e.target.selectedOptions).map((opt) => opt.value))
              }
            >
              {allowedSites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("onboarding.team.channelLabel")}>
            <Select
              value={channel}
              onChange={(e) => setChannel(e.target.value as (typeof CHANNELS)[number])}
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {t(`common.channels.${c}`)}
                </option>
              ))}
            </Select>
          </Field>
          {error ? <p className="error">{error}</p> : null}
          <Button type="submit" block loading={invite.isPending}>
            {t("settings.team.inviteModal.submit")}
          </Button>
        </form>
      </Modal>
    </>
  );
}
