"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  CheckCircle2,
  Database,
  LayoutGrid,
  MessageSquare,
  Settings2,
  Users,
  Wrench,
  MapPin,
  Phone,
  FileText,
  Sparkles,
  Bell,
} from "lucide-react";
import { Button, Card, Field, Input, PhoneInput, Select, Stepper, Switch } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

const STEP_KEYS = ["garage", "workshop", "mode", "team", "channels", "data", "done"] as const;
type StepKey = (typeof STEP_KEYS)[number];
const STEP_NUMBER: Record<StepKey, number> = {
  garage: 2,
  workshop: 3,
  mode: 4,
  team: 5,
  channels: 6,
  data: 7,
  done: 8,
};
const ROLES = ["MANAGER", "ADVISOR", "MECHANIC", "STOREKEEPER", "CASHIER", "ACCOUNTANT"] as const;
const CHANNELS = ["WHATSAPP", "SMS", "EMAIL"] as const;

interface TeamInvite {
  name: string;
  phone: string;
  email: string;
  role: (typeof ROLES)[number];
  channel: (typeof CHANNELS)[number];
}

export default function BienvenuePage() {
  const onboarding = trpc.onboarding.get.useQuery();

  if (onboarding.isLoading || !onboarding.data) {
    return <p>{t("common.loading")}</p>;
  }

  return <Wizard initialStep={onboarding.data.step} />;
}

function Wizard({ initialStep }: { initialStep: number }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const initialIndex = Math.max(
    STEP_KEYS.findIndex((key) => STEP_NUMBER[key] === initialStep),
    0,
  );
  const [stepIndex, setStepIndex] = useState(initialIndex);
  const [doneKeys, setDoneKeys] = useState<StepKey[]>(
    STEP_KEYS.filter((key) => STEP_NUMBER[key] < initialStep),
  );
  const [error, setError] = useState<string | null>(null);

  const saveStep = trpc.onboarding.saveStep.useMutation({
    onSuccess(result) {
      setError(null);
      const currentKey = STEP_KEYS[stepIndex];
      setDoneKeys((prev) => (prev.includes(currentKey) ? prev : [...prev, currentKey]));
      utils.me.get.invalidate();
      if (result.nextStep === 8 && currentKey === "done") {
        router.push("/");
        router.refresh();
        return;
      }
      const nextIdx = STEP_KEYS.findIndex((key) => STEP_NUMBER[key] === result.nextStep);
      setStepIndex(nextIdx >= 0 ? nextIdx : stepIndex + 1);
    },
    onError(err) {
      setError(err.message);
    },
  });

  const currentKey = STEP_KEYS[stepIndex];
  const steps = STEP_KEYS.map((key) => ({ key, label: t(`onboarding.steps.${key}`) }));

  return (
    <Card>
      <div className="onboarding-header">
        <div className="onboarding-logo">A</div>
        <h1>{t("onboarding.title")}</h1>
        <p className="sub">{t("onboarding.subtitle")}</p>
      </div>
      <Stepper steps={steps} currentKey={currentKey} doneKeys={doneKeys} />
      {error ? <p className="error">{error}</p> : null}
      {currentKey === "garage" ? (
        <GarageStep
          loading={saveStep.isPending}
          onSubmit={(data) => saveStep.mutate({ step: 2, data })}
        />
      ) : null}
      {currentKey === "workshop" ? (
        <WorkshopStep
          loading={saveStep.isPending}
          onSubmit={(data) => saveStep.mutate({ step: 3, data })}
        />
      ) : null}
      {currentKey === "mode" ? (
        <ModeStep
          loading={saveStep.isPending}
          onSubmit={(data) => saveStep.mutate({ step: 4, data })}
        />
      ) : null}
      {currentKey === "team" ? (
        <TeamStep
          loading={saveStep.isPending}
          onSubmit={(data) => saveStep.mutate({ step: 5, data })}
          onSkip={() => saveStep.mutate({ step: 5, data: undefined })}
        />
      ) : null}
      {currentKey === "channels" ? (
        <ChannelsStep
          loading={saveStep.isPending}
          onSubmit={(data) => saveStep.mutate({ step: 6, data })}
          onSkip={() => saveStep.mutate({ step: 6, data: undefined })}
        />
      ) : null}
      {currentKey === "data" ? (
        <DataStep
          loading={saveStep.isPending}
          onDemo={() => saveStep.mutate({ step: 7, data: { choice: "demo" } })}
          onSkip={() => saveStep.mutate({ step: 7, data: { choice: "skip" } })}
        />
      ) : null}
      {currentKey === "done" ? (
        <DoneStep
          loading={saveStep.isPending}
          onFinish={() => saveStep.mutate({ step: 8, data: {} })}
        />
      ) : null}
    </Card>
  );
}

function GarageStep({
  loading,
  onSubmit,
}: {
  loading: boolean;
  onSubmit: (data: {
    name: string;
    legalName?: string;
    commune?: string;
    address?: string;
    phone?: string;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [commune, setCommune] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      name,
      legalName: legalName.trim() || undefined,
      commune: commune.trim() || undefined,
      address: address.trim() || undefined,
      phone: phone.trim() || undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="stack">
      <div>
        <h2 className="onboarding-step-title">
          <span className="icon">
            <Building2 size={18} />
          </span>
          {t("onboarding.garage.title")}
        </h2>
        <p className="onboarding-step-desc">{t("onboarding.garage.description")}</p>
      </div>
      <Field label={t("onboarding.garage.nameLabel")}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={1}
          placeholder="Ex: Garage Central Abidjan"
          leftIcon={<Building2 size={16} />}
        />
      </Field>
      <Field label={`${t("onboarding.garage.legalNameLabel")} ${t("common.optional")}`}>
        <Input
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
          placeholder="Ex: SARL Garage Central"
          leftIcon={<FileText size={16} />}
        />
      </Field>
      <div className="grid-2">
        <Field label={`${t("onboarding.garage.communeLabel")} ${t("common.optional")}`}>
          <Input
            value={commune}
            onChange={(e) => setCommune(e.target.value)}
            placeholder="Ex: Cocody"
            leftIcon={<MapPin size={16} />}
          />
        </Field>
        <Field label={`${t("onboarding.garage.phoneLabel")} ${t("common.optional")}`}>
          <PhoneInput value={phone} onChange={setPhone} />
        </Field>
      </div>
      <Field label={`${t("onboarding.garage.addressLabel")} ${t("common.optional")}`}>
        <Input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Ex: Boulevard Lagunaire, Lot 45"
          leftIcon={<MapPin size={16} />}
        />
      </Field>
      <Button type="submit" block loading={loading}>
        {t("common.next")}
      </Button>
    </form>
  );
}

function WorkshopStep({
  loading,
  onSubmit,
}: {
  loading: boolean;
  onSubmit: (data: { name: string; code: string }) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({ name, code: code.trim().toUpperCase() });
  }

  return (
    <form onSubmit={handleSubmit} className="stack">
      <div>
        <h2 className="onboarding-step-title">
          <span className="icon">
            <Wrench size={18} />
          </span>
          {t("onboarding.workshop.title")}
        </h2>
        <p className="onboarding-step-desc">{t("onboarding.workshop.description")}</p>
      </div>
      <Field label={t("onboarding.workshop.nameLabel")}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={1}
          placeholder="Ex: Atelier Principal"
          leftIcon={<Wrench size={16} />}
        />
      </Field>
      <Field label={t("onboarding.workshop.codeLabel")} hint={t("onboarding.workshop.codeHint")}>
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          required
          minLength={2}
          maxLength={10}
          pattern="[A-Z0-9]+"
          placeholder="Ex: ATL01"
          leftIcon={<Settings2 size={16} />}
        />
      </Field>
      <Button type="submit" block loading={loading}>
        {t("common.next")}
      </Button>
    </form>
  );
}

function ModeStep({
  loading,
  onSubmit,
}: {
  loading: boolean;
  onSubmit: (data: { operatingMode: "FULL" | "REMINDERS_ONLY" }) => void;
}) {
  return (
    <div className="stack">
      <div>
        <h2 className="onboarding-step-title">
          <span className="icon">
            <LayoutGrid size={18} />
          </span>
          {t("onboarding.mode.title")}
        </h2>
        <p className="onboarding-step-desc">{t("onboarding.mode.description")}</p>
      </div>
      <button
        type="button"
        className="onboarding-mode-card"
        disabled={loading}
        onClick={() => onSubmit({ operatingMode: "FULL" })}
      >
        <div className="onboarding-mode-icon">
          <Sparkles size={20} />
        </div>
        <div className="onboarding-mode-body">
          <div className="onboarding-mode-title">{t("onboarding.mode.full")}</div>
          <div className="onboarding-mode-desc">{t("onboarding.mode.fullDescription")}</div>
        </div>
      </button>
      <button
        type="button"
        className="onboarding-mode-card"
        disabled={loading}
        onClick={() => onSubmit({ operatingMode: "REMINDERS_ONLY" })}
      >
        <div className="onboarding-mode-icon">
          <Bell size={20} />
        </div>
        <div className="onboarding-mode-body">
          <div className="onboarding-mode-title">{t("onboarding.mode.remindersOnly")}</div>
          <div className="onboarding-mode-desc">{t("onboarding.mode.remindersOnlyDescription")}</div>
        </div>
      </button>
    </div>
  );
}

function TeamStep({
  loading,
  onSubmit,
  onSkip,
}: {
  loading: boolean;
  onSubmit: (data: { invitations: TeamInvite[] }) => void;
  onSkip: () => void;
}) {
  const [invitations, setInvitations] = useState<TeamInvite[]>([]);

  function addInvite() {
    setInvitations((prev) => [
      ...prev,
      { name: "", phone: "", email: "", role: "ADVISOR", channel: "WHATSAPP" },
    ]);
  }

  function updateInvite(index: number, patch: Partial<TeamInvite>) {
    setInvitations((prev) => prev.map((inv, i) => (i === index ? { ...inv, ...patch } : inv)));
  }

  function removeInvite(index: number) {
    setInvitations((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      invitations: invitations.map((inv) => ({
        name: inv.name,
        phone: inv.phone.trim() || undefined,
        email: inv.email.trim() || undefined,
        role: inv.role,
        channel: inv.channel,
      })) as TeamInvite[],
    });
  }

  return (
    <form onSubmit={handleSubmit} className="stack">
      <div>
        <h2 className="onboarding-step-title">
          <span className="icon">
            <Users size={18} />
          </span>
          {t("onboarding.team.title")}
        </h2>
        <p className="onboarding-step-desc">{t("onboarding.team.description")}</p>
      </div>
      {invitations.map((inv, i) => (
        <Card key={i}>
          <Field label={t("onboarding.team.nameLabel")}>
            <Input
              value={inv.name}
              onChange={(e) => updateInvite(i, { name: e.target.value })}
              required
              minLength={2}
            />
          </Field>
          <Field label={`${t("auth.signUp.phoneLabel")} ${t("common.optional")}`}>
            <PhoneInput value={inv.phone} onChange={(value) => updateInvite(i, { phone: value })} />
          </Field>
          <Field label={`${t("auth.signUp.emailLabel")} ${t("common.optional")}`}>
            <Input
              type="email"
              value={inv.email}
              onChange={(e) => updateInvite(i, { email: e.target.value })}
            />
          </Field>
          <Field label={t("onboarding.team.roleLabel")}>
            <Select
              value={inv.role}
              onChange={(e) => updateInvite(i, { role: e.target.value as TeamInvite["role"] })}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`common.roles.${role}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("onboarding.team.channelLabel")}>
            <Select
              value={inv.channel}
              onChange={(e) =>
                updateInvite(i, { channel: e.target.value as TeamInvite["channel"] })
              }
            >
              {CHANNELS.map((channel) => (
                <option key={channel} value={channel}>
                  {t(`common.channels.${channel}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="button" variant="ghost" size="sm" onClick={() => removeInvite(i)}>
            {t("common.delete")}
          </Button>
        </Card>
      ))}
      <Button type="button" variant="secondary" onClick={addInvite}>
        {t("onboarding.team.addAction")}
      </Button>
      <Button type="submit" block loading={loading} disabled={invitations.length === 0}>
        {t("onboarding.team.submit")}
      </Button>
      <Button type="button" variant="ghost" block onClick={onSkip} disabled={loading}>
        {t("onboarding.later")}
      </Button>
    </form>
  );
}

function ChannelsStep({
  loading,
  onSubmit,
  onSkip,
}: {
  loading: boolean;
  onSubmit: (data: { smsEnabled: boolean; emailEnabled: boolean; sendTestTo?: string }) => void;
  onSkip: () => void;
}) {
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [sendTestTo, setSendTestTo] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({ smsEnabled, emailEnabled, sendTestTo: sendTestTo.trim() || undefined });
  }

  return (
    <form onSubmit={handleSubmit} className="stack">
      <div>
        <h2 className="onboarding-step-title">
          <span className="icon">
            <MessageSquare size={18} />
          </span>
          {t("onboarding.channels.title")}
        </h2>
        <p className="onboarding-step-desc">{t("onboarding.channels.description")}</p>
      </div>
      <Switch
        label={t("onboarding.channels.smsEnabled")}
        showLabel
        checked={smsEnabled}
        onChange={(e) => setSmsEnabled(e.target.checked)}
      />
      <Switch
        label={t("onboarding.channels.emailEnabled")}
        showLabel
        checked={emailEnabled}
        onChange={(e) => setEmailEnabled(e.target.checked)}
      />
      <Field label={`${t("onboarding.channels.sendTestLabel")} ${t("common.optional")}`}>
        <PhoneInput value={sendTestTo} onChange={setSendTestTo} />
      </Field>
      <Button type="submit" block loading={loading}>
        {t("onboarding.channels.submit")}
      </Button>
      <Button type="button" variant="ghost" block onClick={onSkip} disabled={loading}>
        {t("onboarding.later")}
      </Button>
    </form>
  );
}

function DataStep({
  loading,
  onDemo,
  onSkip,
}: {
  loading: boolean;
  onDemo: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="stack">
      <div>
        <h2 className="onboarding-step-title">
          <span className="icon">
            <Database size={18} />
          </span>
          {t("onboarding.data.title")}
        </h2>
        <p className="onboarding-step-desc">{t("onboarding.data.description")}</p>
      </div>
      <button
        type="button"
        className="onboarding-mode-card"
        disabled={loading}
        onClick={onDemo}
      >
        <div className="onboarding-mode-icon">
          <Sparkles size={20} />
        </div>
        <div className="onboarding-mode-body">
          <div className="onboarding-mode-title">{t("onboarding.data.demo")}</div>
          <div className="onboarding-mode-desc">{t("onboarding.data.demoDescription")}</div>
        </div>
      </button>
      <Button variant="ghost" block onClick={onSkip} disabled={loading}>
        {t("onboarding.data.skip")}
      </Button>
    </div>
  );
}

function DoneStep({ loading, onFinish }: { loading: boolean; onFinish: () => void }) {
  return (
    <div className="stack" style={{ textAlign: "center" }}>
      <div className="onboarding-done-icon">
        <CheckCircle2 size={48} />
      </div>
      <div>
        <h2 className="onboarding-step-title" style={{ justifyContent: "center" }}>
          {t("onboarding.done.title")}
        </h2>
        <p className="onboarding-step-desc" style={{ marginBottom: 0 }}>
          {t("onboarding.done.description")}
        </p>
      </div>
      <Button block loading={loading} onClick={onFinish}>
        {t("onboarding.finish")}
      </Button>
    </div>
  );
}
