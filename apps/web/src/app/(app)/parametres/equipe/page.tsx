"use client";

// M01 — /parametres/equipe : membres (actifs / désactivés) et invitations en attente.
// Les actions sont filtrées selon les permissions de `me.get` ; le serveur revérifie tout
// (permission, hiérarchie des rôles RG-M01-12, dernier gérant RG-M01-11, auto-désactivation).
import { useState } from "react";
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import {
  Button,
  CheckboxRow,
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
  Textarea,
} from "@atelieros/ui";
import { PIN_ELIGIBLE_ROLES } from "@atelieros/core/auth/pin";
import type { AppRouter } from "@/server/routers/_app";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

type Member = inferRouterOutputs<AppRouter>["member"]["list"][number];
type Invitation = inferRouterOutputs<AppRouter>["member"]["listInvitations"][number];
type Role = Member["role"];

const ALL_ROLES = [
  "OWNER",
  "MANAGER",
  "ADVISOR",
  "MECHANIC",
  "STOREKEEPER",
  "CASHIER",
  "ACCOUNTANT",
] as const satisfies readonly Role[];
const CHANNELS = ["WHATSAPP", "SMS", "EMAIL"] as const;
type MemberStatus = "ACTIVE" | "INACTIVE";

// Miroir de `canInviteRole` (core/auth/permissions, RG-M01-12) pour n'afficher que les actions
// permises ; la règle fait foi côté serveur.
const MANAGER_MANAGEABLE: ReadonlySet<Role> = new Set([
  "MECHANIC",
  "STOREKEEPER",
  "CASHIER",
  "ADVISOR",
]);
function canManageRole(actor: Role | undefined, target: Role): boolean {
  if (actor === "OWNER") return true;
  if (actor === "MANAGER") return MANAGER_MANAGEABLE.has(target);
  return false;
}

function inviteNotice(result: { delivered: boolean; reason?: "channel" | "queue" }): string {
  if (result.delivered) return t("settings.team.queued");
  if (result.reason === "queue") return t("settings.team.sendUnavailable");
  return t("settings.team.channelInactive");
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("fr-FR");
}

/** Zod met parfois la liste des erreurs en JSON dans `message`. On n'affiche que la phrase. */
function readableError(message: string): string {
  const raw = message.trim();
  if (!raw.startsWith("[")) return raw;
  try {
    const issues = JSON.parse(raw) as { message?: string }[];
    const text = issues
      .map((issue) => issue.message)
      .filter((item): item is string => Boolean(item));
    return text.length > 0 ? text.join(" ") : raw;
  } catch {
    return raw;
  }
}

type ActionError = { message: string; planLimit: boolean };
function toActionError(err: { message: string; data?: { domainCode?: string | null } | null }) {
  const planLimit = err.data?.domainCode === "PLAN_LIMIT_REACHED";
  return {
    message: planLimit
      ? `${t("settings.team.planLimitError")} ${readableError(err.message)}`
      : readableError(err.message),
    planLimit,
  } satisfies ActionError;
}

function ErrorBox({ error }: { error: ActionError }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2">
      <p className="error">{error.message}</p>
      {error.planLimit ? (
        <Link className="btn btn-secondary min-h-11" href="/parametres/abonnement">
          {t("settings.team.seePlans")}
        </Link>
      ) : null}
    </div>
  );
}

function SitesPicker({
  sites,
  value,
  onChange,
  label,
}: {
  sites: { id: string; name: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  label: string;
}) {
  if (sites.length <= 1) {
    return (
      <p className="invite-site-line">
        <span>{t("settings.team.table.sites")}</span>
        <strong>{sites[0]?.name ?? t("common.allSites")}</strong>
      </p>
    );
  }
  return (
    <div className="invite-sites">
      <span className="invite-sites-label">{label}</span>
      <div className="invite-sites-list">
        {sites.map((site) => (
          <CheckboxRow
            key={site.id}
            label={site.name}
            checked={value.includes(site.id)}
            onChange={(e) =>
              onChange(
                e.target.checked ? [...value, site.id] : value.filter((id) => id !== site.id),
              )
            }
          />
        ))}
      </div>
      {value.length === 0 ? (
        <span className="hint">{t("settings.team.inviteModal.allSitesHint")}</span>
      ) : null}
    </div>
  );
}

export default function TeamPage() {
  const [tab, setTab] = useState<"members" | "invitations">("members");
  const [status, setStatus] = useState<MemberStatus>("ACTIVE");
  const [modalOpen, setModalOpen] = useState(false);
  const [pinMember, setPinMember] = useState<{ id: string; name: string } | null>(null);
  const [pinValue, setPinValue] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pageError, setPageError] = useState<ActionError | null>(null);

  const [editing, setEditing] = useState<Member | null>(null);
  const [editRole, setEditRole] = useState<Role>("ADVISOR");
  const [editSites, setEditSites] = useState<string[]>([]);
  const [editError, setEditError] = useState<ActionError | null>(null);

  const [toDeactivate, setToDeactivate] = useState<Member | null>(null);
  const [reason, setReason] = useState("");
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const [toDisconnect, setToDisconnect] = useState<Member | null>(null);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const [toRevoke, setToRevoke] = useState<Invitation | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const me = trpc.me.get.useQuery();
  const permissions = new Set(me.data?.permissions ?? []);
  const canInvite = permissions.has("member:invite");
  const canUpdate = permissions.has("member:update");
  const canDeactivate = permissions.has("member:deactivate");
  const myRole = me.data?.membership?.role as Role | undefined;
  const myMembershipId = me.data?.membership?.id;

  const members = trpc.member.list.useQuery({ status });
  const activeTab = canInvite ? tab : "members";
  const invitations = trpc.member.listInvitations.useQuery(undefined, {
    enabled: canInvite && activeTab === "invitations",
  });

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("ADVISOR");
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("WHATSAPP");
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [error, setError] = useState<ActionError | null>(null);

  const invitableRoles = ALL_ROLES.filter((r) => r !== "OWNER" && canManageRole(myRole, r));

  function closeInvite() {
    setModalOpen(false);
    setError(null);
  }

  const invite = trpc.member.invite.useMutation({
    onSuccess(result) {
      setModalOpen(false);
      setName("");
      setPhone("");
      setEmail("");
      setSiteIds([]);
      setError(null);
      setNotice(inviteNotice(result));
      setTab("invitations");
      void utils.member.listInvitations.invalidate();
    },
    onError(err) {
      setError(toActionError(err));
    },
  });

  const resend = trpc.member.resendInvitation.useMutation({
    onSuccess(result) {
      setPageError(null);
      setNotice(inviteNotice(result));
      void utils.member.listInvitations.invalidate();
    },
    onError(err) {
      setNotice(null);
      setPageError(toActionError(err));
    },
  });
  const revoke = trpc.member.revokeInvitation.useMutation({
    onSuccess() {
      setToRevoke(null);
      setRevokeError(null);
      setPageError(null);
      setNotice(t("settings.team.revokeModal.success"));
      void utils.member.listInvitations.invalidate();
    },
    onError(err) {
      setRevokeError(readableError(err.message));
    },
  });
  const setPin = trpc.member.setPin.useMutation({
    onSuccess() {
      setPinMember(null);
      setPinValue("");
      setPinError(null);
      setNotice(t("settings.team.pinModal.success"));
      void utils.member.list.invalidate();
    },
    onError(err) {
      setPinError(readableError(err.message));
    },
  });
  const update = trpc.member.update.useMutation({
    onSuccess() {
      setEditing(null);
      setEditError(null);
      setPageError(null);
      setNotice(t("settings.team.editModal.success"));
      void utils.member.list.invalidate();
    },
    onError(err) {
      setEditError(toActionError(err));
    },
  });
  const deactivate = trpc.member.deactivate.useMutation({
    onSuccess(_data, variables) {
      const target = toDeactivate?.id === variables.membershipId ? toDeactivate : null;
      setToDeactivate(null);
      setReason("");
      setDeactivateError(null);
      setPageError(null);
      setNotice(t("settings.team.deactivateModal.success", { name: target?.user.name ?? "" }));
      void utils.member.list.invalidate();
    },
    onError(err) {
      setDeactivateError(readableError(err.message));
    },
  });
  const reactivate = trpc.member.reactivate.useMutation({
    onSuccess(data) {
      setPageError(null);
      const target = members.data?.find((m) => m.id === data.id);
      setNotice(t("settings.team.reactivated", { name: target?.user.name ?? "" }));
      void utils.member.list.invalidate();
    },
    onError(err) {
      setNotice(null);
      setPageError(toActionError(err));
    },
  });
  const revokeSessions = trpc.member.revokeAllSessions.useMutation({
    onSuccess(result) {
      const target = toDisconnect;
      setToDisconnect(null);
      setDisconnectError(null);
      setPageError(null);
      setNotice(
        t("settings.team.revokeSessionsModal.success", {
          name: target?.user.name ?? "",
          count: result.revokedCount,
        }),
      );
    },
    onError(err) {
      setDisconnectError(readableError(err.message));
    },
  });

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    const trimmedPhone = phone.trim();
    const trimmedEmail = email.trim();
    if (channel === "EMAIL" && !trimmedEmail) {
      setError({ message: t("settings.team.inviteModal.needEmail"), planLimit: false });
      return;
    }
    if (channel !== "EMAIL" && !trimmedPhone) {
      setError({ message: t("settings.team.inviteModal.needPhone"), planLimit: false });
      return;
    }
    setError(null);
    invite.mutate({
      name,
      phone: trimmedPhone || undefined,
      email: trimmedEmail || undefined,
      role,
      siteIds,
      channel,
    });
  }

  function handleSetPin(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = pinValue.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setPinError(t("settings.team.pinModal.formatError"));
      return;
    }
    if (!pinMember) return;
    setPinError(null);
    setPin.mutate({ membershipId: pinMember.id, pin: trimmed });
  }

  function openEdit(member: Member) {
    setEditing(member);
    setEditRole(member.role);
    setEditSites([...member.siteIds]);
    setEditError(null);
    setNotice(null);
  }

  function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditError(null);
    update.mutate({
      membershipId: editing.id,
      role: editRole !== editing.role ? editRole : undefined,
      siteIds: editSites,
    });
  }

  function handleDeactivate(e: React.FormEvent) {
    e.preventDefault();
    if (!toDeactivate) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setDeactivateError(t("settings.team.deactivateModal.reasonRequired"));
      return;
    }
    setDeactivateError(null);
    deactivate.mutate({ membershipId: toDeactivate.id, reason: trimmed });
  }

  const allowedSites = me.data?.allowedSites ?? [];
  const editRoleOptions = editing
    ? ALL_ROLES.filter((r) => r === editing.role || canManageRole(myRole, r))
    : [];

  const memberColumns = [
    {
      key: "name",
      header: t("settings.team.table.name"),
      primary: true,
      render: (row: Member) =>
        row.id === myMembershipId ? `${row.user.name} ${t("settings.team.you")}` : row.user.name,
    },
    {
      key: "role",
      header: t("settings.team.table.role"),
      render: (row: Member) => t(`common.roles.${row.role}`),
    },
    {
      key: "sites",
      header: t("settings.team.table.sites"),
      render: (row: Member) =>
        row.siteIds.length === 0
          ? t("common.allSites")
          : row.siteIds
              .map((id: string) => allowedSites.find((s) => s.id === id)?.name ?? id)
              .join(", "),
    },
    {
      key: "phone",
      header: t("settings.team.table.phone"),
      render: (row: Member) => row.user.phone ?? "—",
    },
    {
      key: "lastActive",
      header: t("settings.team.table.lastActive"),
      render: (row: Member) => formatDate(row.user.lastLoginAt),
    },
    {
      key: "status",
      header: t("settings.team.table.status"),
      render: (row: Member) => (
        <StatusBadge
          tone={row.isActive ? "ok" : "off"}
          label={
            row.isActive
              ? `✓ ${t("settings.team.statusActive")}`
              : `⏸ ${t("settings.team.statusInactive")}`
          }
        />
      ),
    },
    {
      key: "actions",
      header: "",
      render: (row: Member) => {
        const isSelf = row.id === myMembershipId;
        const manageable = isSelf || canManageRole(myRole, row.role);
        const showPin = canUpdate && row.isActive && PIN_ELIGIBLE_ROLES.includes(row.role);
        const showEdit = canUpdate && row.isActive && manageable;
        const showDisconnect = canUpdate && row.isActive && manageable;
        const showDeactivate = canDeactivate && row.isActive && manageable && !isSelf;
        const showReactivate = canDeactivate && !row.isActive && manageable;
        return (
          <div className="row-actions flex flex-wrap gap-2">
            {showPin ? (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11"
                onClick={() => {
                  setPinMember({ id: row.id, name: row.user.name });
                  setPinValue("");
                  setPinError(null);
                }}
              >
                {row.hasPin ? t("settings.team.pinSet") : t("settings.team.setPin")}
              </Button>
            ) : null}
            {showEdit ? (
              <Button
                variant="secondary"
                size="sm"
                className="min-h-11"
                onClick={() => openEdit(row)}
              >
                {t("settings.team.actions.edit")}
              </Button>
            ) : null}
            {showDisconnect ? (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11"
                onClick={() => {
                  setToDisconnect(row);
                  setDisconnectError(null);
                }}
              >
                {t("settings.team.actions.revokeSessions")}
              </Button>
            ) : null}
            {showDeactivate ? (
              <Button
                variant="danger"
                size="sm"
                className="min-h-11"
                onClick={() => {
                  setToDeactivate(row);
                  setReason("");
                  setDeactivateError(null);
                }}
              >
                {t("settings.team.actions.deactivate")}
              </Button>
            ) : null}
            {showReactivate ? (
              <Button
                variant="secondary"
                size="sm"
                className="min-h-11"
                loading={reactivate.isPending && reactivate.variables?.membershipId === row.id}
                onClick={() => {
                  setNotice(null);
                  reactivate.mutate({ membershipId: row.id });
                }}
              >
                {t("settings.team.actions.reactivate")}
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHead
        title={t("settings.team.title")}
        description={t("settings.team.description")}
        actions={
          canInvite ? (
            <Button
              className="min-h-11"
              onClick={() => {
                setNotice(null);
                setError(null);
                setModalOpen(true);
              }}
            >
              {t("settings.team.inviteAction")}
            </Button>
          ) : null
        }
      />
      {canInvite ? (
        <Tabs
          items={[
            { key: "members", label: t("settings.team.tabs.members") },
            { key: "invitations", label: t("settings.team.tabs.invitations") },
          ]}
          activeKey={activeTab}
          onChange={(key) => setTab(key as "members" | "invitations")}
        />
      ) : null}
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}
      {pageError ? <ErrorBox error={pageError} /> : null}
      {activeTab === "members" ? (
        <>
          <div
            className="mb-3 flex flex-wrap items-center gap-2"
            role="group"
            aria-label={t("settings.team.filter.label")}
          >
            {(["ACTIVE", "INACTIVE"] as const).map((value) => (
              <Button
                key={value}
                variant={status === value ? "primary" : "secondary"}
                size="sm"
                className="min-h-11"
                aria-pressed={status === value}
                onClick={() => setStatus(value)}
              >
                {value === "ACTIVE"
                  ? t("settings.team.filter.active")
                  : t("settings.team.filter.inactive")}
              </Button>
            ))}
          </div>
          {members.isError ? (
            <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border p-4">
              <p className="text-sm text-status-bad">{t("settings.team.loadError")}</p>
              <Button variant="secondary" className="min-h-11" onClick={() => members.refetch()}>
                {t("settings.team.retry")}
              </Button>
            </div>
          ) : members.isLoading ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-2" />
              ))}
            </div>
          ) : (
            <DataTable
              columns={memberColumns}
              rows={members.data ?? []}
              rowKey={(row) => row.id}
              empty={
                <EmptyState
                  title={
                    status === "ACTIVE"
                      ? t("settings.team.emptyMembers")
                      : t("settings.team.emptyInactive")
                  }
                />
              }
            />
          )}
        </>
      ) : invitations.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border p-4">
          <p className="text-sm text-status-bad">{t("settings.team.loadError")}</p>
          <Button variant="secondary" className="min-h-11" onClick={() => invitations.refetch()}>
            {t("settings.team.retry")}
          </Button>
        </div>
      ) : invitations.isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
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
              key: "contact",
              header: t("settings.team.table.contact"),
              render: (row) => row.email ?? row.phone ?? "—",
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
                <div className="row-actions flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-11"
                    loading={resend.isPending && resend.variables?.invitationId === row.id}
                    onClick={() => {
                      setNotice(null);
                      resend.mutate({ invitationId: row.id });
                    }}
                  >
                    {t("common.resend")}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    className="min-h-11"
                    onClick={() => {
                      setToRevoke(row);
                      setRevokeError(null);
                    }}
                  >
                    {t("common.revoke")}
                  </Button>
                </div>
              ),
            },
          ]}
          rows={invitations.data ?? []}
          rowKey={(row) => row.id}
          empty={<EmptyState title={t("settings.team.emptyInvitations")} />}
        />
      )}

      <Modal
        open={modalOpen}
        title={t("settings.team.inviteModal.title")}
        onClose={closeInvite}
        footer={
          <Button type="submit" form="invite-member" block loading={invite.isPending}>
            {t("settings.team.inviteModal.submit")}
          </Button>
        }
      >
        <form id="invite-member" onSubmit={handleInvite} className="invite-form">
          <Field label={t("settings.team.inviteModal.nameLabel")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
          </Field>
          <div className="invite-grid">
            <Field
              label={
                channel === "EMAIL"
                  ? `${t("settings.team.inviteModal.phoneLabel")} ${t("common.optional")}`
                  : t("settings.team.inviteModal.phoneLabel")
              }
            >
              <PhoneInput value={phone} onChange={setPhone} />
            </Field>
            <Field
              label={
                channel === "EMAIL"
                  ? t("settings.team.inviteModal.emailLabel")
                  : `${t("settings.team.inviteModal.emailLabel")} ${t("common.optional")}`
              }
            >
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          </div>
          <div className="invite-grid">
            <Field label={t("settings.team.inviteModal.roleLabel")}>
              <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {invitableRoles.map((r) => (
                  <option key={r} value={r}>
                    {t(`common.roles.${r}`)}
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
          </div>
          <SitesPicker
            sites={allowedSites}
            value={siteIds}
            onChange={setSiteIds}
            label={t("settings.team.inviteModal.sitesLabel")}
          />
          {error ? <ErrorBox error={error} /> : null}
        </form>
      </Modal>

      <Modal
        open={editing !== null}
        title={t("settings.team.editModal.title", { name: editing?.user.name ?? "" })}
        onClose={() => {
          setEditing(null);
          setEditError(null);
        }}
        footer={
          <Button type="submit" form="edit-member" block loading={update.isPending}>
            {t("settings.team.editModal.submit")}
          </Button>
        }
      >
        <form id="edit-member" onSubmit={handleUpdate} className="invite-form">
          <Field label={t("settings.team.editModal.roleLabel")}>
            <Select value={editRole} onChange={(e) => setEditRole(e.target.value as Role)}>
              {editRoleOptions.map((r) => (
                <option key={r} value={r}>
                  {t(`common.roles.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
          <SitesPicker
            sites={allowedSites}
            value={editSites}
            onChange={setEditSites}
            label={t("settings.team.editModal.sitesLabel")}
          />
          {editError ? <ErrorBox error={editError} /> : null}
        </form>
      </Modal>

      <Modal
        open={toDeactivate !== null}
        title={t("settings.team.deactivateModal.title", { name: toDeactivate?.user.name ?? "" })}
        onClose={() => {
          setToDeactivate(null);
          setDeactivateError(null);
        }}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              className="min-h-11"
              onClick={() => {
                setToDeactivate(null);
                setDeactivateError(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              form="deactivate-member"
              variant="danger"
              className="min-h-11"
              loading={deactivate.isPending}
            >
              {t("settings.team.deactivateModal.submit")}
            </Button>
          </div>
        }
      >
        <form id="deactivate-member" onSubmit={handleDeactivate} className="invite-form">
          <p className="text-sm">
            {t("settings.team.deactivateModal.description", {
              name: toDeactivate?.user.name ?? "",
            })}
          </p>
          <Field label={t("settings.team.deactivateModal.reasonLabel")}>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("settings.team.deactivateModal.reasonPlaceholder")}
              required
              rows={3}
            />
          </Field>
          {deactivateError ? (
            <p className="error" role="alert">
              {deactivateError}
            </p>
          ) : null}
        </form>
      </Modal>

      <Modal
        open={toDisconnect !== null}
        title={t("settings.team.revokeSessionsModal.title", {
          name: toDisconnect?.user.name ?? "",
        })}
        onClose={() => {
          setToDisconnect(null);
          setDisconnectError(null);
        }}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              className="min-h-11"
              onClick={() => {
                setToDisconnect(null);
                setDisconnectError(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              className="min-h-11"
              loading={revokeSessions.isPending}
              onClick={() =>
                toDisconnect && revokeSessions.mutate({ membershipId: toDisconnect.id })
              }
            >
              {t("settings.team.revokeSessionsModal.submit")}
            </Button>
          </div>
        }
      >
        <p className="text-sm">
          {t("settings.team.revokeSessionsModal.description", {
            name: toDisconnect?.user.name ?? "",
          })}
        </p>
        {disconnectError ? (
          <p className="error mt-2" role="alert">
            {disconnectError}
          </p>
        ) : null}
      </Modal>

      <Modal
        open={toRevoke !== null}
        title={t("settings.team.revokeModal.title")}
        onClose={() => {
          setToRevoke(null);
          setRevokeError(null);
        }}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              className="min-h-11"
              onClick={() => {
                setToRevoke(null);
                setRevokeError(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              className="min-h-11"
              loading={revoke.isPending}
              onClick={() => toRevoke && revoke.mutate({ invitationId: toRevoke.id })}
            >
              {t("settings.team.revokeModal.submit")}
            </Button>
          </div>
        }
      >
        <p className="text-sm">
          {t("settings.team.revokeModal.description", { name: toRevoke?.name ?? "" })}
        </p>
        {revokeError ? (
          <p className="error mt-2" role="alert">
            {revokeError}
          </p>
        ) : null}
      </Modal>

      <Modal
        open={pinMember !== null}
        title={t("settings.team.pinModal.title")}
        onClose={() => setPinMember(null)}
        footer={
          <Button type="submit" form="set-pin" block loading={setPin.isPending}>
            {t("settings.team.pinModal.submit")}
          </Button>
        }
      >
        <form id="set-pin" onSubmit={handleSetPin}>
          <p className="pin-description">
            {t("settings.team.pinModal.description", { name: pinMember?.name ?? "" })}
          </p>
          <Field label={t("settings.team.pinModal.pinLabel")}>
            <Input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoComplete="off"
              value={pinValue}
              onChange={(e) => setPinValue(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
            />
          </Field>
          {pinError ? (
            <p className="error" role="alert">
              {pinError}
            </p>
          ) : null}
        </form>
      </Modal>
    </>
  );
}
