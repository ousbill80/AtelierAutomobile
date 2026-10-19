"use client";

// M04 US-M04-01..05 — assistant de réception en 6 étapes (Véhicule → Compteur → État des
// lieux → Objets → Doléances → Signature), pensé tablette. Saisie conservée dans IndexedDB
// (hors-ligne), photos compressées envoyées au fil de l'eau, réception idempotente.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatFCFA } from "@atelieros/core/money";
import { CHECK_IN_ITEM_KEYS, WARNING_LIGHTS, lineAmounts } from "@atelieros/core/repairOrders";
import {
  BodyDiagram,
  Button,
  FuelGauge,
  Input,
  MoneyInput,
  PhotoCapture,
  PlateBadge,
  Select,
  SignaturePad,
  Stepper,
  Textarea,
  type BodyType,
  type BodyView,
  type CompressedImage,
  type PhotoStatus,
} from "@atelieros/ui";
import type { LineInput } from "@atelieros/validators";
import { CreditAlert } from "@/components/credit-alert";
import { LineForm } from "@/components/repair-orders/line-form";
import { fromLocalInput, t } from "@/components/repair-orders/i18n";
import { clearDraft, loadDraft, saveDraft } from "@/components/repair-orders/offline-store";
import type { ReceptionHit } from "@/components/repair-orders/types";
import { trpc } from "@/trpc/react";

const STEPS = ["vehicle", "meter", "condition", "items", "complaint", "signature"] as const;
const PHOTO_SLOTS = ["front", "rear", "left", "right"] as const;
const DAMAGE_TYPES = [
  "SCRATCH",
  "DENT",
  "CRACK",
  "BROKEN",
  "RUST",
  "PAINT",
  "MISSING",
  "OTHER",
] as const;
const SEVERITIES = ["LIGHT", "MEDIUM", "HEAVY"] as const;
const BODY_TYPES: BodyType[] = ["SEDAN", "HATCHBACK", "SUV", "PICKUP", "VAN", "MINIBUS", "TRUCK"];
const QUICK_OPS = ["oil", "brakes", "ac", "diagnostic", "preInspection"] as const;
const VIEWS: BodyView[] = ["TOP", "FRONT", "REAR", "LEFT", "RIGHT"];

interface Photo {
  slot: string;
  dataUrl: string;
  base64: string;
  mimeType: CompressedImage["mimeType"];
  attachmentId?: string;
  status: PhotoStatus;
}

interface Damage {
  n: number;
  view: BodyView;
  x: number;
  y: number;
  zone: string;
  type: (typeof DAMAGE_TYPES)[number];
  severity: (typeof SEVERITIES)[number];
}

type SignatureMode = "SIGNED" | "REMOTE" | "REFUSED";

interface Draft {
  clientRequestId: string;
  step: number;
  hit: ReceptionHit | null;
  appointmentId?: string;
  comebackOfId?: string;
  mileage: string;
  odometerUnreadable: boolean;
  odometerReason: string;
  confirmMileage: boolean;
  fuel: number | null;
  warningLights: string[];
  photos: Photo[];
  bodyType: BodyType;
  damages: Damage[];
  noDamage: boolean;
  items: Record<string, boolean>;
  keysCount: string;
  belongings: string;
  returnOldParts: boolean;
  dropOffBy: "OWNER" | "DRIVER" | "TOW" | "OTHER";
  dropOffName: string;
  dropOffPhone: string;
  complaint: string;
  lines: LineInput[];
  ceiling: number | null;
  promisedAt: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  signatureMode: SignatureMode;
  signature: string | null;
  signerName: string;
  cashOnly: boolean;
  creditOverrideReason: string;
}

function newDraft(): Draft {
  return {
    clientRequestId: `rcp-${crypto.randomUUID()}`,
    step: 0,
    hit: null,
    mileage: "",
    odometerUnreadable: false,
    odometerReason: "",
    confirmMileage: false,
    fuel: null,
    warningLights: [],
    photos: [],
    bodyType: "SEDAN",
    damages: [],
    noDamage: false,
    items: {},
    keysCount: "1",
    belongings: "",
    returnOldParts: false,
    dropOffBy: "OWNER",
    dropOffName: "",
    dropOffPhone: "",
    complaint: "",
    lines: [],
    ceiling: null,
    promisedAt: "",
    priority: "NORMAL",
    signatureMode: "SIGNED",
    signature: null,
    signerName: "",
    cashOnly: false,
    creditOverrideReason: "",
  };
}

function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const message = error instanceof Error ? error.message : "";
  return /fetch|network|Failed to fetch|NetworkError|Load failed/i.test(message);
}

export function ReceptionWizard({
  initialVehicleId,
  appointmentId,
}: {
  initialVehicleId?: string;
  appointmentId?: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => ({ ...newDraft(), appointmentId }));
  const [restored, setRestored] = useState(false);
  const [pendingSync, setPendingSync] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const settings = trpc.repairOrder.settings.useQuery();
  const upload = trpc.repairOrder.uploadAttachment.useMutation();
  const checkIn = trpc.repairOrder.checkIn.useMutation();

  const update = useCallback((patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch })), []);

  // Restauration d'une saisie conservée sur l'appareil (coupure réseau, onglet fermé).
  useEffect(() => {
    let active = true;
    void loadDraft<Draft>().then((stored) => {
      if (!active) return;
      if (stored && !initialVehicleId) {
        setDraft(stored.data);
        setPendingSync(stored.state === "pending");
      }
      setRestored(true);
    });
    return () => {
      active = false;
    };
  }, [initialVehicleId]);

  // Sauvegarde automatique de la saisie (sans attendre « Enregistrer brouillon »).
  useEffect(() => {
    if (!restored || !draft.hit) return;
    const id = setTimeout(() => {
      void saveDraft({
        key: draft.clientRequestId,
        savedAt: new Date().toISOString(),
        state: pendingSync ? "pending" : "draft",
        data: draft,
      });
    }, 600);
    return () => clearTimeout(id);
  }, [draft, restored, pendingSync]);

  const uploadPhoto = useCallback(
    async (photo: Photo): Promise<Photo> => {
      try {
        const res = await upload.mutateAsync({
          draftKey: draft.clientRequestId,
          kind: photo.slot.startsWith("damage") ? "photo_damage" : "photo_checkin",
          mimeType: photo.mimeType,
          dataBase64: photo.base64,
        });
        return { ...photo, attachmentId: res.attachmentId, status: "done" };
      } catch {
        return { ...photo, status: "error" };
      }
    },
    [upload, draft.clientRequestId],
  );

  const setPhoto = (photo: Photo) =>
    setDraft((d) => ({ ...d, photos: [...d.photos.filter((p) => p.slot !== photo.slot), photo] }));

  const capture = async (slot: string, image: CompressedImage) => {
    const photo: Photo = { slot, ...image, status: "uploading" };
    setPhoto(photo);
    setPhoto(await uploadPhoto(photo));
  };

  const submit = useCallback(async () => {
    if (submittingRef.current || !draft.hit) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      // Photos non envoyées (hors-ligne, échec) : renvoyées avant la réception.
      const photos: Photo[] = [];
      for (const photo of draft.photos) {
        const sent = photo.attachmentId ? photo : await uploadPhoto(photo);
        if (!sent.attachmentId) throw new TypeError("network: photo upload failed");
        photos.push(sent);
      }
      setDraft((d) => ({ ...d, photos }));
      const result = await checkIn.mutateAsync({
        customerId: draft.hit.customer.id,
        vehicleId: draft.hit.vehicle.id,
        appointmentId: draft.appointmentId,
        comebackOfId: draft.comebackOfId,
        mileageIn: draft.odometerUnreadable ? null : Number(draft.mileage) || null,
        confirmMileage: draft.confirmMileage,
        fuelLevel: draft.fuel,
        complaint: draft.complaint,
        promisedAt: fromLocalInput(draft.promisedAt),
        priority: draft.priority,
        initialLines: draft.lines,
        clientRequestId: draft.clientRequestId,
        cashOnly: draft.cashOnly || undefined,
        creditOverrideReason: draft.creditOverrideReason || undefined,
        checkIn: {
          bodyType: draft.bodyType,
          noDamage: draft.noDamage,
          damages: draft.damages.map((d) => ({ ...d, attachmentIds: [] })),
          items: CHECK_IN_ITEM_KEYS.map((key) => ({ key, present: Boolean(draft.items[key]) })),
          keysCount: Number(draft.keysCount) || 0,
          belongings: draft.belongings,
          warningLights: draft.warningLights as never,
          odometerUnreadable: draft.odometerUnreadable,
          odometerReason: draft.odometerReason || undefined,
          authorizationCeiling: draft.ceiling ?? settings.data?.defaultAuthorizationCeiling ?? 0,
          returnOldParts: draft.returnOldParts,
          dropOff: {
            by: draft.dropOffBy,
            name: draft.dropOffName || undefined,
            phone: draft.dropOffPhone || undefined,
          },
          photoAttachmentIds: photos.map((p) => p.attachmentId!),
        },
        signature:
          draft.signatureMode === "REMOTE"
            ? { remote: true }
            : draft.signatureMode === "REFUSED"
              ? { refused: true }
              : draft.signature
                ? { dataUrl: draft.signature, signerName: draft.signerName }
                : undefined,
      });
      await clearDraft();
      setPendingSync(false);
      setNotice(t("reception.created", { number: result.number }));
      router.push(`/ordres/${result.id}`);
    } catch (err) {
      if (isNetworkError(err)) {
        setPendingSync(true);
        await saveDraft({
          key: draft.clientRequestId,
          savedAt: new Date().toISOString(),
          state: "pending",
          data: draft,
        });
      } else {
        setError(err instanceof Error ? err.message : t("errors.generic"));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [draft, checkIn, uploadPhoto, router, settings.data]);

  // Synchronisation au retour du réseau.
  useEffect(() => {
    if (!pendingSync) return;
    const onOnline = () => void submit();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [pendingSync, submit]);

  const step = STEPS[draft.step]!;
  const canNext = draft.step > 0 || Boolean(draft.hit);
  const estimate = useMemo(
    () =>
      draft.lines.reduce(
        (s, l) =>
          s +
          lineAmounts({
            type: l.type,
            quantity: l.quantity,
            unitPrice: l.unitPrice ?? 0,
            discountRate: 0,
            vatRate: l.vatRate ?? 18,
            status: "PENDING",
            approval: "APPROVED",
            payer: "CUSTOMER",
            isCustomerSupplied: l.isCustomerSupplied,
          }).total,
        0,
      ),
    [draft.lines],
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("reception.title")}</h1>
      {pendingSync && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-md border border-status-warn bg-status-warn-bg p-3 text-sm text-status-warn"
        >
          <span>📶 {t("reception.offlineBanner")}</span>
          <Button size="sm" variant="secondary" onClick={() => void submit()} loading={submitting}>
            {t("reception.offlineRetry")}
          </Button>
        </div>
      )}
      <div className="max-w-full overflow-x-auto">
        <Stepper
          steps={STEPS.map((key) => ({ key, label: t(`reception.steps.${key}`) }))}
          currentKey={step}
          doneKeys={STEPS.slice(0, draft.step)}
        />
      </div>

      {step === "vehicle" && (
        <VehicleStep
          draft={draft}
          initialVehicleId={initialVehicleId}
          onSelect={(hit) =>
            update({
              hit,
              comebackOfId: undefined,
              mileage: hit?.vehicle.currentMileage ? String(hit.vehicle.currentMileage) : "",
            })
          }
          onComeback={(id) => update({ comebackOfId: id })}
          estimate={estimate}
        />
      )}

      {step === "meter" && (
        <section className="flex flex-col gap-4">
          <Input
            label={`${t("reception.mileage")} (${t("reception.mileageUnit")})`}
            inputMode="numeric"
            value={draft.mileage}
            disabled={draft.odometerUnreadable}
            onChange={(e) => update({ mileage: e.target.value.replace(/[^\d]/g, "") })}
            className="text-2xl"
          />
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={draft.odometerUnreadable}
              onChange={(e) => update({ odometerUnreadable: e.target.checked })}
            />
            {t("reception.odometerUnreadable")}
          </label>
          {draft.odometerUnreadable && (
            <Input
              label={t("reception.odometerReason")}
              value={draft.odometerReason}
              onChange={(e) => update({ odometerReason: e.target.value })}
            />
          )}
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={draft.confirmMileage}
              onChange={(e) => update({ confirmMileage: e.target.checked })}
            />
            {t("reception.confirmMileage")}
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">
              {t("reception.fuel")}
              {draft.fuel !== null ? ` : ${t("reception.fuelValue", { level: draft.fuel })}` : ""}
            </span>
            <FuelGauge
              label={t("reception.fuel")}
              value={draft.fuel}
              onChange={(fuel) => update({ fuel })}
              levelLabel={(level) => t("reception.fuelValue", { level })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t("reception.warningLights")}</span>
            <div className="flex flex-wrap gap-2">
              {WARNING_LIGHTS.map((light) => {
                const on = draft.warningLights.includes(light);
                return (
                  <button
                    key={light}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      update({
                        warningLights: on
                          ? draft.warningLights.filter((l) => l !== light)
                          : [...draft.warningLights, light],
                      })
                    }
                    className={`min-h-11 rounded-md border px-3 text-sm ${on ? "border-status-bad bg-status-bad-bg text-status-bad" : "border-border bg-surface"}`}
                  >
                    {on ? "⚠ " : ""}
                    {t(`reception.lights.${light}`)}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {step === "condition" && (
        <ConditionStep
          draft={draft}
          minPhotos={settings.data?.minCheckInPhotos ?? 4}
          update={update}
          onCapture={capture}
          onRetry={async (slot) => {
            const photo = draft.photos.find((p) => p.slot === slot);
            if (photo) setPhoto(await uploadPhoto({ ...photo, status: "uploading" }));
          }}
        />
      )}

      {step === "items" && (
        <section className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{t("reception.items")}</legend>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {CHECK_IN_ITEM_KEYS.map((key) => (
                <label
                  key={key}
                  className="flex min-h-11 items-center gap-2 rounded-md bg-surface px-2 text-sm"
                >
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={Boolean(draft.items[key])}
                    onChange={(e) => update({ items: { ...draft.items, [key]: e.target.checked } })}
                  />
                  {t(`checkInItems.${key}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <Input
            label={t("reception.keysCount")}
            inputMode="numeric"
            value={draft.keysCount}
            onChange={(e) => update({ keysCount: e.target.value.replace(/[^\d]/g, "") })}
          />
          <label className="flex flex-col gap-1 text-sm">
            <span>{t("reception.belongings")}</span>
            <Textarea
              value={draft.belongings}
              placeholder={t("reception.belongingsPlaceholder")}
              onChange={(e) => update({ belongings: e.target.value })}
            />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={draft.returnOldParts}
              onChange={(e) => update({ returnOldParts: e.target.checked })}
            />
            {t("reception.returnOldParts")}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>{t("reception.dropOff")}</span>
            <Select
              value={draft.dropOffBy}
              onChange={(e) => update({ dropOffBy: e.target.value as Draft["dropOffBy"] })}
            >
              {(["OWNER", "DRIVER", "TOW", "OTHER"] as const).map((by) => (
                <option key={by} value={by}>
                  {t(`reception.dropOffBy.${by}`)}
                </option>
              ))}
            </Select>
          </label>
          {draft.dropOffBy !== "OWNER" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                label={t("reception.dropOffName")}
                value={draft.dropOffName}
                onChange={(e) => update({ dropOffName: e.target.value })}
              />
              <Input
                label={t("reception.dropOffPhone")}
                inputMode="tel"
                value={draft.dropOffPhone}
                onChange={(e) => update({ dropOffPhone: e.target.value })}
              />
            </div>
          )}
        </section>
      )}

      {step === "complaint" && (
        <ComplaintStep
          draft={draft}
          update={update}
          defaultCeiling={settings.data?.defaultAuthorizationCeiling ?? 0}
        />
      )}

      {step === "signature" && (
        <SignatureStep
          draft={draft}
          update={update}
          estimate={estimate}
          minPhotos={settings.data?.minCheckInPhotos ?? 4}
          defaultCeiling={settings.data?.defaultAuthorizationCeiling ?? 0}
        />
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md border border-status-bad bg-status-bad-bg p-3 text-sm text-status-bad"
        >
          ⚠ {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-status-ok">
          ✓ {notice}
        </p>
      )}

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-bg py-3">
        <Button
          variant="secondary"
          disabled={draft.step === 0}
          onClick={() => update({ step: draft.step - 1 })}
        >
          ← {t("reception.previous")}
        </Button>
        <Button
          variant="ghost"
          disabled={!draft.hit}
          onClick={() => {
            void saveDraft({
              key: draft.clientRequestId,
              savedAt: new Date().toISOString(),
              state: "draft",
              data: draft,
            });
            setNotice(t("reception.draftSaved"));
          }}
        >
          {t("reception.saveDraft")}
        </Button>
        {draft.step < STEPS.length - 1 ? (
          <Button disabled={!canNext} onClick={() => update({ step: draft.step + 1 })}>
            {t("reception.next")} →
          </Button>
        ) : (
          <Button onClick={() => void submit()} loading={submitting}>
            {submitting ? t("reception.submitting") : t("reception.submit")}
          </Button>
        )}
      </div>
    </div>
  );
}

function VehicleStep({
  draft,
  initialVehicleId,
  onSelect,
  onComeback,
  estimate,
}: {
  draft: Draft;
  initialVehicleId?: string;
  onSelect: (hit: ReceptionHit | null) => void;
  onComeback: (id: string | undefined) => void;
  estimate: number;
}) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const preset = trpc.vehicle.get.useQuery(
    { id: initialVehicleId ?? "" },
    { enabled: Boolean(initialVehicleId) && !draft.hit },
  );
  useEffect(() => {
    const id = setTimeout(() => setDebounced((q || preset.data?.plate || "").trim()), 250);
    return () => clearTimeout(id);
  }, [q, preset.data]);
  const lookup = trpc.repairOrder.receptionLookup.useQuery(
    { q: debounced },
    { enabled: debounced.length >= 2 && !draft.hit },
  );
  useEffect(() => {
    if (initialVehicleId && lookup.data && !draft.hit) {
      const match = lookup.data.find((h) => h.vehicle.id === initialVehicleId);
      if (match) onSelect(match);
    }
  }, [initialVehicleId, lookup.data, draft.hit, onSelect]);

  if (draft.hit) {
    const { hit } = draft;
    const comeback = hit.alerts.probableComeback ?? hit.alerts.previousUnderWarranty;
    return (
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent bg-surface p-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("reception.selected")}</span>
            <div className="flex flex-wrap items-center gap-2">
              <PlateBadge plate={hit.vehicle.plate} />
              <span className="font-medium">
                {hit.vehicle.make} {hit.vehicle.model}
              </span>
            </div>
            <span className="text-sm">{hit.customer.displayName}</span>
          </div>
          <Button variant="secondary" onClick={() => onSelect(null)}>
            {t("reception.change")}
          </Button>
        </div>
        <Alerts hit={hit} />
        {comeback && (
          <label className="flex min-h-11 items-center gap-2 rounded-md bg-status-warn-bg p-2 text-sm text-status-warn">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={draft.comebackOfId === comeback.id}
              onChange={(e) => onComeback(e.target.checked ? comeback.id : undefined)}
            />
            ↩ {t("reception.comebackToggle", { number: comeback.number })}
          </label>
        )}
        <CreditAlert customerId={hit.customer.id} additionalAmount={estimate} />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <Input
        label={t("reception.searchLabel")}
        placeholder={t("reception.searchPlaceholder")}
        value={q}
        autoFocus
        onChange={(e) => setQ(e.target.value)}
        hint={t("reception.searchHint")}
        className="text-xl"
      />
      {lookup.isFetching && <div className="h-16 animate-pulse rounded-lg bg-surface-2" />}
      {lookup.data && lookup.data.length === 0 && (
        <div className="flex flex-col items-start gap-2 rounded-md bg-surface p-3 text-sm">
          <span className="text-muted">{t("reception.noResult")}</span>
          <Link href="/clients/nouveau" className="btn btn-secondary btn-sm min-h-11">
            {t("reception.createCustomer")}
          </Link>
        </div>
      )}
      <ul className="flex flex-col gap-2">
        {lookup.data?.map((hit) => (
          <li key={hit.vehicle.id}>
            <button
              type="button"
              onClick={() => onSelect(hit)}
              className="flex w-full flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-left hover:bg-surface-2"
            >
              <span className="flex flex-wrap items-center gap-2">
                <PlateBadge plate={hit.vehicle.plate} />
                <span className="font-medium">
                  {hit.vehicle.make} {hit.vehicle.model}
                </span>
                <span className="text-sm text-muted">· {hit.customer.displayName}</span>
              </span>
              <Alerts hit={hit} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Alerts({ hit }: { hit: ReceptionHit }) {
  const a = hit.alerts;
  const chips: { tone: "warn" | "bad"; text: string }[] = [];
  if (a.inspectionInDays !== null && a.inspectionInDays <= 30) {
    chips.push(
      a.inspectionInDays < 0
        ? {
            tone: "bad",
            text: t("reception.alerts.inspectionExpired", { days: -a.inspectionInDays }),
          }
        : { tone: "warn", text: t("reception.alerts.inspection", { days: a.inspectionInDays }) },
    );
  }
  if (a.serviceDue) chips.push({ tone: "warn", text: t("reception.alerts.serviceDue") });
  if (a.balanceDue > 0)
    chips.push({
      tone: "bad",
      text: t("reception.alerts.balance", { amount: formatFCFA(a.balanceDue) }),
    });
  if (a.noShows > 0)
    chips.push({ tone: "warn", text: t("reception.alerts.noShows", { count: a.noShows }) });
  if (a.openOrder)
    chips.push({
      tone: "bad",
      text: t("reception.alerts.openOrder", { number: a.openOrder.number }),
    });
  if (a.previousUnderWarranty)
    chips.push({
      tone: "warn",
      text: t("reception.alerts.warranty", { number: a.previousUnderWarranty.number }),
    });
  if (a.probableComeback)
    chips.push({
      tone: "warn",
      text: t("reception.alerts.comeback", { number: a.probableComeback.number }),
    });
  if (chips.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <span
          key={c.text}
          className={`rounded px-2 py-0.5 text-xs ${c.tone === "bad" ? "bg-status-bad-bg text-status-bad" : "bg-status-warn-bg text-status-warn"}`}
        >
          ⚠ {c.text}
        </span>
      ))}
    </span>
  );
}

function ConditionStep({
  draft,
  minPhotos,
  update,
  onCapture,
  onRetry,
}: {
  draft: Draft;
  minPhotos: number;
  update: (patch: Partial<Draft>) => void;
  onCapture: (slot: string, image: CompressedImage) => Promise<void>;
  onRetry: (slot: string) => Promise<void>;
}) {
  const [pending, setPending] = useState<{ view: BodyView; x: number; y: number } | null>(null);
  const [zone, setZone] = useState("");
  const [type, setType] = useState<Damage["type"]>("SCRATCH");
  const [severity, setSeverity] = useState<Damage["severity"]>("LIGHT");
  const extraSlots = draft.photos.filter((p) => p.slot.startsWith("extra")).length;
  const slots = [
    ...PHOTO_SLOTS,
    ...Array.from({ length: extraSlots + 1 }, (_, i) => `extra${i + 1}`),
  ];
  const viewLabels = Object.fromEntries(VIEWS.map((v) => [v, t(`reception.views.${v}`)])) as Record<
    BodyView,
    string
  >;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t("reception.photos")}</span>
        <span className="text-xs text-muted">
          {t("reception.photosHint", { count: minPhotos })}
        </span>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {slots.map((slot) => {
            const photo = draft.photos.find((p) => p.slot === slot);
            const key = slot.startsWith("extra") ? "extra" : slot;
            return (
              <PhotoCapture
                key={slot}
                label={t(`reception.photoSlots.${key}`)}
                previewUrl={photo?.dataUrl}
                status={photo?.status ?? "empty"}
                takeLabel={t("reception.takePhoto")}
                retakeLabel={t("reception.retake")}
                errorLabel={t("reception.photoFailed")}
                uploadingLabel={t("reception.photoUploading")}
                onCapture={(image) => void onCapture(slot, image)}
                onRetry={() => void onRetry(slot)}
              />
            );
          })}
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span>{t("reception.bodyType")}</span>
        <Select
          value={draft.bodyType}
          onChange={(e) => update({ bodyType: e.target.value as BodyType })}
        >
          {BODY_TYPES.map((b) => (
            <option key={b} value={b}>
              {t(`reception.bodyTypes.${b}`)}
            </option>
          ))}
        </Select>
      </label>
      <p className="text-xs text-muted">{t("reception.diagramHint")}</p>
      <BodyDiagram
        bodyType={draft.bodyType}
        markers={draft.damages}
        viewLabels={viewLabels}
        onAdd={(view, x, y) => {
          setPending({ view, x, y });
          setZone(viewLabels[view]);
        }}
      />
      {pending && (
        <div className="flex flex-col gap-2 rounded-lg border border-accent bg-surface p-3">
          <span className="text-sm font-medium">
            {t("reception.damage")} {draft.damages.length + 1} — {viewLabels[pending.view]}
          </span>
          <Input
            label={t("reception.damageZone")}
            value={zone}
            onChange={(e) => setZone(e.target.value)}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span>{t("reception.damageType")}</span>
              <Select value={type} onChange={(e) => setType(e.target.value as Damage["type"])}>
                {DAMAGE_TYPES.map((d) => (
                  <option key={d} value={d}>
                    {t(`reception.damageTypes.${d}`)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t("reception.damageSeverity")}</span>
              <Select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Damage["severity"])}
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {t(`reception.severities.${s}`)}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                update({
                  noDamage: false,
                  damages: [
                    ...draft.damages,
                    {
                      n: draft.damages.length + 1,
                      ...pending,
                      zone: zone || viewLabels[pending.view],
                      type,
                      severity,
                    },
                  ],
                });
                setPending(null);
              }}
            >
              {t("reception.damageAdd")}
            </Button>
            <Button variant="ghost" onClick={() => setPending(null)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}
      {draft.damages.length > 0 && (
        <ol className="flex flex-col gap-1" aria-label={t("reception.damage")}>
          {draft.damages.map((d) => (
            <li
              key={d.n}
              className="flex min-h-11 items-center justify-between gap-2 rounded-md bg-surface px-2 text-sm"
            >
              <span>
                {t("reception.damageListItem", {
                  n: d.n,
                  zone: d.zone,
                  type: t(`reception.damageTypes.${d.type}`).toLowerCase(),
                  severity: t(`reception.severities.${d.severity}`).toLowerCase(),
                })}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  update({
                    damages: draft.damages
                      .filter((x) => x.n !== d.n)
                      .map((x, i) => ({ ...x, n: i + 1 })),
                  })
                }
              >
                {t("reception.damageRemove")}
              </Button>
            </li>
          ))}
        </ol>
      )}
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={draft.noDamage}
          disabled={draft.damages.length > 0}
          onChange={(e) => update({ noDamage: e.target.checked })}
        />
        {t("reception.noDamage")}
      </label>
    </section>
  );
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
}

function ComplaintStep({
  draft,
  update,
  defaultCeiling,
}: {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  defaultCeiling: number;
}) {
  const [listening, setListening] = useState(false);
  const Recognition =
    typeof window !== "undefined"
      ? ((
          window as unknown as {
            SpeechRecognition?: new () => SpeechRecognitionLike;
            webkitSpeechRecognition?: new () => SpeechRecognitionLike;
          }
        ).SpeechRecognition ??
        (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike })
          .webkitSpeechRecognition)
      : undefined;
  const dictate = () => {
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = "fr-FR";
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript ?? "";
      update({ complaint: [draft.complaint, text].filter(Boolean).join(" ") });
    };
    recognition.onend = () => setListening(false);
    setListening(true);
    recognition.start();
  };
  const append = (text: string) =>
    update({ complaint: draft.complaint ? `${draft.complaint} + ${text.toLowerCase()}` : text });

  return (
    <section className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span>{t("reception.complaint")}</span>
        <Textarea
          rows={4}
          value={draft.complaint}
          placeholder={t("reception.complaintPlaceholder")}
          onChange={(e) => update({ complaint: e.target.value })}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {Recognition && (
          <Button variant="secondary" onClick={dictate} disabled={listening}>
            🎤 {listening ? t("reception.dictating") : t("reception.dictate")}
          </Button>
        )}
        <span className="self-center text-sm text-muted">{t("reception.quickOps")} :</span>
        {QUICK_OPS.map((op) => (
          <button
            key={op}
            type="button"
            className="min-h-11 rounded-md bg-surface-2 px-3 text-sm"
            onClick={() => append(t(`reception.quickText.${op}`))}
          >
            + {t(`reception.quick.${op}`)}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t("reception.initialLines")}</span>
        {draft.lines.map((line, i) => (
          <div
            key={i}
            className="flex min-h-11 items-center justify-between gap-2 rounded-md bg-surface px-2 text-sm"
          >
            <span>
              {t(`lineType.${line.type}`)} — {line.description} × {line.quantity}
              {line.unitPrice != null ? ` · ${formatFCFA(line.unitPrice)}` : ""}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => update({ lines: draft.lines.filter((_, j) => j !== i) })}
            >
              {t("lines.remove")}
            </Button>
          </div>
        ))}
        <LineForm onSubmit={(line) => update({ lines: [...draft.lines, line] })} />
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span>{t("reception.ceiling")}</span>
        <MoneyInput
          aria-label={t("reception.ceiling")}
          value={draft.ceiling ?? defaultCeiling}
          onChange={(ceiling) => update({ ceiling })}
        />
        <span className="text-xs text-muted">{t("reception.ceilingHint")}</span>
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          type="datetime-local"
          label={t("reception.promise")}
          value={draft.promisedAt}
          onChange={(e) => update({ promisedAt: e.target.value })}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("reception.priority")}</span>
          <Select
            value={draft.priority}
            onChange={(e) => update({ priority: e.target.value as Draft["priority"] })}
          >
            {(["LOW", "NORMAL", "HIGH", "URGENT"] as const).map((p) => (
              <option key={p} value={p}>
                {t(`priority.${p}`)}
              </option>
            ))}
          </Select>
        </label>
      </div>
    </section>
  );
}

function SignatureStep({
  draft,
  update,
  estimate,
  minPhotos,
  defaultCeiling,
}: {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  estimate: number;
  minPhotos: number;
  defaultCeiling: number;
}) {
  const credit = trpc.collections.creditCheck.useQuery(
    { customerId: draft.hit?.customer.id ?? "", additionalAmount: estimate },
    { enabled: Boolean(draft.hit), retry: false },
  );
  const sentPhotos = draft.photos.length;
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3 text-sm">
        <span className="font-semibold">{t("reception.summary")}</span>
        {draft.hit && (
          <span>
            {draft.hit.vehicle.plate} — {draft.hit.vehicle.make} {draft.hit.vehicle.model} ·{" "}
            {draft.hit.customer.displayName}
          </span>
        )}
        <span>
          {t("reception.summaryMileage", {
            value: draft.odometerUnreadable
              ? t("reception.odometerUnreadable")
              : `${draft.mileage || "—"} km`,
          })}
        </span>
        <span>{t("reception.summaryFuel", { value: draft.fuel ?? "—" })}</span>
        <span className={sentPhotos < minPhotos ? "text-status-bad" : ""}>
          {t("reception.summaryPhotos", { count: sentPhotos })}
        </span>
        <span>
          {draft.noDamage
            ? t("reception.noDamage")
            : t("reception.summaryDamages", { count: draft.damages.length })}
        </span>
        <span>
          {t("reception.summaryItems", {
            count: Object.values(draft.items).filter(Boolean).length,
          })}
        </span>
        <span className="mt-1 italic">{draft.complaint || "—"}</span>
      </div>
      <p className="rounded-md bg-surface-2 p-3 text-sm">
        {t("reception.consent", { amount: formatFCFA(draft.ceiling ?? defaultCeiling) })}
      </p>

      {credit.data?.level === "BLOCK" && (
        <div className="flex flex-col gap-2 rounded-md border border-status-bad p-3">
          <CreditAlert customerId={draft.hit!.customer.id} additionalAmount={estimate} />
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={draft.cashOnly}
              onChange={(e) => update({ cashOnly: e.target.checked })}
            />
            {t("reception.cashOnly")}
          </label>
          <Input
            label={t("reception.creditOverride")}
            value={draft.creditOverrideReason}
            onChange={(e) => update({ creditOverrideReason: e.target.value })}
          />
        </div>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t("reception.signatureMode")}</legend>
        {(["SIGNED", "REMOTE", "REFUSED"] as const).map((mode) => (
          <label key={mode} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name="signatureMode"
              className="h-5 w-5"
              checked={draft.signatureMode === mode}
              onChange={() => update({ signatureMode: mode })}
            />
            {t(`reception.signatureModes.${mode}`)}
          </label>
        ))}
      </fieldset>
      {draft.signatureMode === "SIGNED" && (
        <div className="flex flex-col gap-2">
          <Input
            label={t("reception.signerName")}
            value={draft.signerName}
            onChange={(e) => update({ signerName: e.target.value })}
          />
          <span className="text-sm">{t("reception.signHere")}</span>
          <SignaturePad
            label={t("reception.signHere")}
            clearLabel={t("reception.clearSignature")}
            onChange={(signature) => update({ signature })}
          />
        </div>
      )}
    </section>
  );
}
