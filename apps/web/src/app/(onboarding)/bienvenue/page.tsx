"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  Database,
  FolderOpen,
  LayoutGrid,
  Trash2,
  UserPlus,
  Users,
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
    return (
      <Card className="wizard" aria-busy="true">
        <div className="skeleton" style={{ height: 28, width: "45%" }} />
        <div className="skeleton" style={{ height: 16, width: "70%", marginTop: 12 }} />
        <div className="skeleton" style={{ height: 6, marginTop: 24 }} />
        <div className="skeleton" style={{ height: 44, marginTop: 32 }} />
        <div className="skeleton" style={{ height: 44, marginTop: 16 }} />
        <div className="skeleton" style={{ height: 44, marginTop: 16 }} />
      </Card>
    );
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
      window.scrollTo({ top: 0 });
    },
    onError(err) {
      setError(err.message);
    },
  });

  const currentKey = STEP_KEYS[stepIndex];
  const steps = STEP_KEYS.map((key) => ({ key, label: t(`onboarding.steps.${key}`) }));
  const progress = Math.round((stepIndex / (STEP_KEYS.length - 1)) * 100);

  return (
    <Card className="wizard">
      <div className="wizard-head">
        <h1>{t("onboarding.title")}</h1>
        {stepIndex === 0 ? <p className="wizard-intro">{t("onboarding.intro")}</p> : null}
      </div>
      <div className="wizard-progress" aria-hidden="true">
        <div className="wizard-progress-bar" style={{ width: `${progress}%` }} />
      </div>
      <p className="wizard-step-of">
        {t("onboarding.stepOf", { current: stepIndex + 1, total: STEP_KEYS.length })} ·{" "}
        <strong>{t(`onboarding.steps.${currentKey}`)}</strong>
      </p>
      <div className="wizard-stepper">
        <Stepper steps={steps} currentKey={currentKey} doneKeys={doneKeys} />
      </div>
      {error ? (
        <div className="alert alert-bad" role="alert" style={{ marginBottom: 16 }}>
          <AlertCircle size={18} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}
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

function StepHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="wizard-step-head">
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </div>
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
      name: name.trim(),
      legalName: legalName.trim() || undefined,
      commune: commune.trim() || undefined,
      address: address.trim() || undefined,
      phone: phone.trim() || undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="stack">
      <StepHeading
        title={t("onboarding.garage.title")}
        description={t("onboarding.garage.description")}
      />
      <Field label={t("onboarding.garage.nameLabel")} hint={t("onboarding.garage.nameHint")}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("onboarding.garage.namePlaceholder")}
          autoFocus
          required
          minLength={1}
        />
      </Field>
      <Field label={`${t("onboarding.garage.legalNameLabel")} ${t("common.optional")}`}>
        <Input
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
          placeholder={t("onboarding.garage.legalNamePlaceholder")}
        />
      </Field>
      <div className="grid-2">
        <Field label={`${t("onboarding.garage.communeLabel")} ${t("common.optional")}`}>
          <Input
            value={commune}
            onChange={(e) => setCommune(e.target.value)}
            placeholder={t("onboarding.garage.communePlaceholder")}
          />
        </Field>
        <Field
          label={`${t("onboarding.garage.phoneLabel")} ${t("common.optional")}`}
          hint={t("onboarding.garage.phoneHint")}
        >
          <PhoneInput value={phone} onChange={setPhone} />
        </Field>
      </div>
      <Field label={`${t("onboarding.garage.addressLabel")} ${t("common.optional")}`}>
        <Input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder={t("onboarding.garage.addressPlaceholder")}
        />
      </Field>
      <div className="wizard-actions">
        <Button type="submit" loading={loading}>
          {t("common.next")}
        </Button>
      </div>
    </form>
  );
}

function suggestSiteCode(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
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
  const [codeTouched, setCodeTouched] = useState(false);

  function handleNameChange(value: string) {
    setName(value);
    if (!codeTouched) setCode(suggestSiteCode(value));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({ name: name.trim(), code: code.trim().toUpperCase() });
  }

  return (
    <form onSubmit={handleSubmit} className="stack">
      <StepHeading
        title={t("onboarding.workshop.title")}
        description={t("onboarding.workshop.description")}
      />
      <Field label={t("onboarding.workshop.nameLabel")}>
        <Input
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder={t("onboarding.workshop.namePlaceholder")}
          autoFocus
          required
          minLength={1}
        />
      </Field>
      <Field label={t("onboarding.workshop.codeLabel")} hint={t("onboarding.workshop.codeHint")}>
        <Input
          value={code}
          onChange={(e) => {
            setCodeTouched(true);
            setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
          }}
          placeholder={t("onboarding.workshop.codePlaceholder")}
          className="font-mono"
          required
          minLength={2}
          maxLength={10}
          pattern="[A-Z0-9]+"
        />
      </Field>
      <div className="wizard-actions">
        <Button type="submit" loading={loading}>
          {t("common.next")}
        </Button>
      </div>
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
      <StepHeading
        title={t("onboarding.mode.title")}
        description={t("onboarding.mode.description")}
      />
      <div className="choice-grid">
        <button
          type="button"
          className="choice-card"
          disabled={loading}
          onClick={() => onSubmit({ operatingMode: "FULL" })}
        >
          <span className="choice-icon" aria-hidden="true">
            <LayoutGrid size={22} />
          </span>
          <span className="choice-body">
            <strong>{t("onboarding.mode.full")}</strong>
            <span className="choice-badge">{t("onboarding.mode.recommended")}</span>
            <p>{t("onboarding.mode.fullDescription")}</p>
          </span>
        </button>
        <button
          type="button"
          className="choice-card"
          disabled={loading}
          onClick={() => onSubmit({ operatingMode: "REMINDERS_ONLY" })}
        >
          <span className="choice-icon" aria-hidden="true">
            <BellRing size={22} />
          </span>
          <span className="choice-body">
            <strong>{t("onboarding.mode.remindersOnly")}</strong>
            <p>{t("onboarding.mode.remindersOnlyDescription")}</p>
          </span>
        </button>
      </div>
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
      <StepHeading
        title={t("onboarding.team.title")}
        description={t("onboarding.team.description")}
      />
      {invitations.length === 0 ? (
        <div className="wizard-empty">
          <Users size={28} aria-hidden="true" />
          <p>{t("onboarding.team.empty")}</p>
        </div>
      ) : null}
      {invitations.map((inv, i) => (
        <Card
          key={i}
          className="invite-card"
          title={t("onboarding.team.member", { n: i + 1 })}
          actions={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={t("onboarding.team.remove")}
              title={t("onboarding.team.remove")}
              onClick={() => removeInvite(i)}
            >
              <Trash2 size={16} />
            </Button>
          }
        >
          <Field label={t("onboarding.team.nameLabel")}>
            <Input
              value={inv.name}
              onChange={(e) => updateInvite(i, { name: e.target.value })}
              required
              minLength={2}
            />
          </Field>
          <div className="grid-2">
            <Field label={`${t("auth.signUp.phoneLabel")} ${t("common.optional")}`}>
              <PhoneInput
                value={inv.phone}
                onChange={(value) => updateInvite(i, { phone: value })}
              />
            </Field>
            <Field label={`${t("auth.signUp.emailLabel")} ${t("common.optional")}`}>
              <Input
                type="email"
                value={inv.email}
                onChange={(e) => updateInvite(i, { email: e.target.value })}
              />
            </Field>
          </div>
          <div className="grid-2">
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
          </div>
        </Card>
      ))}
      <Button type="button" variant="secondary" onClick={addInvite}>
        <UserPlus size={18} aria-hidden="true" />
        {t("onboarding.team.addAction")}
      </Button>
      <div className="wizard-actions">
        <Button type="button" variant="ghost" onClick={onSkip} disabled={loading}>
          {t("onboarding.later")}
        </Button>
        <Button type="submit" loading={loading} disabled={invitations.length === 0 || loading}>
          {t("onboarding.team.submit")}
        </Button>
      </div>
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
      <StepHeading
        title={t("onboarding.channels.title")}
        description={t("onboarding.channels.description")}
      />
      <div className="switch-row">
        <div>
          <strong>{t("onboarding.channels.smsEnabled")}</strong>
          <p>{t("onboarding.channels.smsDescription")}</p>
        </div>
        <Switch
          label={t("onboarding.channels.smsEnabled")}
          checked={smsEnabled}
          onChange={(e) => setSmsEnabled(e.target.checked)}
        />
      </div>
      <div className="switch-row">
        <div>
          <strong>{t("onboarding.channels.emailEnabled")}</strong>
          <p>{t("onboarding.channels.emailDescription")}</p>
        </div>
        <Switch
          label={t("onboarding.channels.emailEnabled")}
          checked={emailEnabled}
          onChange={(e) => setEmailEnabled(e.target.checked)}
        />
      </div>
      <p className="wizard-note">{t("onboarding.channels.whatsappNote")}</p>
      <Field
        label={`${t("onboarding.channels.sendTestLabel")} ${t("common.optional")}`}
        hint={t("onboarding.channels.sendTestHint")}
      >
        <PhoneInput value={sendTestTo} onChange={setSendTestTo} />
      </Field>
      <div className="wizard-actions">
        <Button type="button" variant="ghost" onClick={onSkip} disabled={loading}>
          {t("onboarding.later")}
        </Button>
        <Button type="submit" loading={loading}>
          {t("onboarding.channels.submit")}
        </Button>
      </div>
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
      <StepHeading
        title={t("onboarding.data.title")}
        description={t("onboarding.data.description")}
      />
      <div className="choice-grid">
        <button type="button" className="choice-card" disabled={loading} onClick={onDemo}>
          <span className="choice-icon" aria-hidden="true">
            <Database size={22} />
          </span>
          <span className="choice-body">
            <strong>{t("onboarding.data.demo")}</strong>
            <p>{t("onboarding.data.demoDescription")}</p>
          </span>
        </button>
        <button type="button" className="choice-card" disabled={loading} onClick={onSkip}>
          <span className="choice-icon" aria-hidden="true">
            <FolderOpen size={22} />
          </span>
          <span className="choice-body">
            <strong>{t("onboarding.data.skip")}</strong>
            <p>{t("onboarding.data.skipDescription")}</p>
          </span>
        </button>
      </div>
    </div>
  );
}

function DoneStep({ loading, onFinish }: { loading: boolean; onFinish: () => void }) {
  return (
    <div className="stack wizard-done">
      <div className="wizard-done-icon" aria-hidden="true">
        <CheckCircle2 size={32} />
      </div>
      <StepHeading
        title={t("onboarding.done.title")}
        description={t("onboarding.done.description")}
      />
      <ul className="wizard-next">
        <li>
          <Users size={18} aria-hidden="true" />
          {t("onboarding.done.next1")}
        </li>
        <li>
          <BellRing size={18} aria-hidden="true" />
          {t("onboarding.done.next2")}
        </li>
        <li>
          <UserPlus size={18} aria-hidden="true" />
          {t("onboarding.done.next3")}
        </li>
      </ul>
      <Button block loading={loading} onClick={onFinish}>
        {t("onboarding.finish")}
      </Button>
    </div>
  );
}
