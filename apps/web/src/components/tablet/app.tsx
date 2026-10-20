"use client";

// M06 §7 — PWA tablette du mécanicien. Une seule application cliente (navigation interne par
// l'historique du navigateur) pour rester utilisable hors-ligne : accueil (arrivée / départ),
// mes tâches (démarrer, pause avec motif, reprendre, terminer), détail (doléance, pièces,
// remarques, photos, demande de pièce) et inspection multipoints. Cibles tactiles ≥ 44 px.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  CircleDot,
  Clock,
  CloudOff,
  LogIn,
  LogOut,
  Pause,
  Play,
  RefreshCw,
  Wifi,
  XCircle,
} from "lucide-react";
import { PlateBadge, StatusBadge } from "@atelieros/ui";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { formatDuration, formatTime, tt, tw } from "@/components/workshop/i18n";
import type { TechSnapshot, TechTask } from "@/components/workshop/types";
import { liveMinutes } from "./local";
import { compressPhoto } from "./photo";
import { isQuotaError } from "./store";
import { useTablet, type Tablet } from "./useTablet";
import { trpc } from "@/trpc/react";

export type TabletView =
  | { name: "home" }
  | { name: "tasks" }
  | { name: "task"; lineId: string }
  | { name: "inspection"; inspectionId: string };

function pathOf(view: TabletView): string {
  switch (view.name) {
    case "home":
      return "/tablette";
    case "tasks":
      return "/tablette/taches";
    case "task":
      return `/tablette/taches/${view.lineId}`;
    case "inspection":
      return `/tablette/inspection/${view.inspectionId}`;
  }
}

function viewOf(pathname: string): TabletView {
  const task = /^\/tablette\/taches\/([^/]+)/.exec(pathname);
  if (task) return { name: "task", lineId: task[1]! };
  const insp = /^\/tablette\/inspection\/([^/]+)/.exec(pathname);
  if (insp) return { name: "inspection", inspectionId: insp[1]! };
  if (pathname.startsWith("/tablette/taches")) return { name: "tasks" };
  return { name: "home" };
}

/** Bouton tablette : 48 px de haut minimum. */
function Big({
  children,
  tone = "primary",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "secondary" | "danger" }) {
  const toneClass =
    tone === "primary"
      ? "bg-accent text-accent-foreground"
      : tone === "danger"
        ? "bg-status-bad text-white"
        : "border border-border bg-surface";
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 text-base font-semibold disabled:opacity-50 ${toneClass} ${rest.className ?? ""}`}
    >
      {children}
    </button>
  );
}

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function TabletApp({ initialPath }: { initialPath: string }) {
  const tablet = useTablet();
  const [view, setView] = useState<TabletView>(() => viewOf(initialPath));

  const go = useCallback((next: TabletView) => {
    window.history.pushState(null, "", pathOf(next));
    setView(next);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const onPop = () => setView(viewOf(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // PWA (§13) : service worker qui garde l'application disponible sans réseau.
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  const snap = tablet.snapshot;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <SyncBar tablet={tablet} />
      {!snap ? (
        tablet.loadError || (tablet.loaded && !tablet.online) ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-lg border border-status-bad bg-status-bad-bg p-4"
          >
            <p className="text-status-bad">{tt("loadError")}</p>
            <Big onClick={() => void tablet.syncNow()}>{tt("retry")}</Big>
          </div>
        ) : (
          <div className="flex flex-col gap-3" aria-busy="true">
            <p className="text-sm text-muted">{tt("loading")}</p>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-lg bg-surface-2" />
            ))}
          </div>
        )
      ) : view.name === "home" ? (
        <HomeView snap={snap} tablet={tablet} go={go} />
      ) : view.name === "tasks" ? (
        <TasksView snap={snap} tablet={tablet} go={go} />
      ) : view.name === "task" ? (
        <TaskDetailView snap={snap} tablet={tablet} go={go} lineId={view.lineId} />
      ) : (
        <InspectionView snap={snap} tablet={tablet} go={go} inspectionId={view.inspectionId} />
      )}
    </div>
  );
}

function SyncBar({ tablet }: { tablet: Tablet }) {
  const last = tablet.meta?.lastSyncAt ?? null;
  const rejections = tablet.meta?.rejections ?? [];
  return (
    <div className="flex flex-col gap-2">
      {!tablet.online ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg bg-status-warn-bg px-3 py-2 text-sm font-medium text-status-warn"
        >
          <CloudOff className="size-4" aria-hidden />
          {last ? tt("offlineBanner", { time: formatTime(last) }) : tt("offlineNever")}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge tone={tablet.online ? "ok" : "warn"}>
          {tablet.online ? (
            <Wifi className="size-3" aria-hidden />
          ) : (
            <CloudOff className="size-3" aria-hidden />
          )}
          {tablet.online ? tt("online") : tt("offline")}
        </StatusBadge>
        {tablet.progress ? (
          <span>{tt("syncing", { done: tablet.progress.done, total: tablet.progress.total })}</span>
        ) : tablet.pending > 0 ? (
          <span data-testid="pending-count">{tt("pending", { count: tablet.pending })}</span>
        ) : last ? (
          <span className="text-muted">{tt("lastSync", { time: formatTime(last) })}</span>
        ) : null}
        <button
          type="button"
          onClick={() => void tablet.syncNow()}
          disabled={!tablet.online}
          className="ml-auto inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-sm font-medium disabled:opacity-50"
        >
          <RefreshCw className="size-4" aria-hidden />
          {tt("syncNow")}
        </button>
      </div>
      {rejections.length > 0 ? (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-lg border border-status-warn bg-status-warn-bg p-3 text-sm"
        >
          <p className="font-semibold">{tt("syncErrors", { count: rejections.length })}</p>
          <ul className="list-disc pl-5">
            {rejections.map((r) => (
              <li key={r.clientOpId}>
                {tt("syncErrorItem", { action: tt(`actions.${r.type}`), error: r.error })}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="min-h-11 self-start font-medium underline"
            onClick={() => void tablet.dismissRejections()}
          >
            {tt("dismissErrors")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function HomeView({
  snap,
  tablet,
  go,
}: {
  snap: TechSnapshot;
  tablet: Tablet;
  go: (v: TabletView) => void;
}) {
  const me = trpc.me.get.useQuery(undefined, { staleTime: 5 * 60_000, retry: false });
  const att = snap.attendance;
  const present = !!att?.clockIn && !att.clockOut;
  const open = snap.tasks.filter(
    (t) => t.status === "PENDING" || t.status === "IN_PROGRESS",
  ).length;
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{tt("hello", { name: me.data?.user?.name ?? "" })}</h1>
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <p className="text-sm">
          {att?.clockIn
            ? tt("arrivedAt", { time: formatTime(att.clockIn, snap.timeZone) })
            : tt("notClockedIn")}
          {att?.clockOut
            ? ` · ${tt("leftAt", { time: formatTime(att.clockOut, snap.timeZone) })}`
            : ""}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Big disabled={present} onClick={() => void tablet.enqueue({ type: "attendance.in" })}>
            <LogIn className="size-5" aria-hidden />
            {tt("arrival")}
          </Big>
          <Big
            tone="secondary"
            disabled={!present}
            onClick={() => void tablet.enqueue({ type: "attendance.out" })}
          >
            <LogOut className="size-5" aria-hidden />
            {tt("departure")}
          </Big>
        </div>
      </div>
      <Big onClick={() => go({ name: "tasks" })}>
        {tt("myTasks")} ({open})
      </Big>
      {snap.inspections.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="font-semibold">{tt("inspections")}</h2>
          {snap.inspections.map((i) => (
            <Big
              key={i.id}
              tone="secondary"
              onClick={() => go({ name: "inspection", inspectionId: i.id })}
            >
              {tt("inspection", { number: i.number })} · {i.plate}
            </Big>
          ))}
        </div>
      ) : null}
      <Link href="/" className="inline-flex min-h-11 items-center text-sm text-muted underline">
        {tt("office")}
      </Link>
    </section>
  );
}

function TaskStatus({ task }: { task: TechTask }) {
  if (task.status === "CANCELLED")
    return (
      <StatusBadge tone="bad">
        <XCircle className="size-3" aria-hidden />
        {tt("status.CANCELLED")}
      </StatusBadge>
    );
  if (task.status === "DONE")
    return (
      <StatusBadge tone="ok">
        <CheckCircle2 className="size-3" aria-hidden />
        {tt("status.DONE")}
      </StatusBadge>
    );
  if (task.entry?.pausedAt)
    return (
      <StatusBadge tone="warn">
        <Pause className="size-3" aria-hidden />
        {tt("status.PAUSED")}
      </StatusBadge>
    );
  if (task.entry)
    return (
      <StatusBadge tone="ok">
        <Play className="size-3" aria-hidden />
        {tt("status.IN_PROGRESS")}
      </StatusBadge>
    );
  return (
    <StatusBadge tone="off">
      <CircleDot className="size-3" aria-hidden />
      {tt("status.PENDING")}
    </StatusBadge>
  );
}

const WORKABLE = ["APPROVED", "IN_PROGRESS", "WAITING_PARTS"];

function TaskActions({ task, tablet }: { task: TechTask; tablet: Tablet }) {
  const [pausing, setPausing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [note, setNote] = useState("");
  if (task.status === "DONE") return null;
  if (task.status === "CANCELLED") {
    return (
      <p
        role="alert"
        className="rounded-md bg-status-bad-bg p-2 text-sm font-medium text-status-bad"
      >
        {tt("cancelledByOffice")}
      </p>
    );
  }
  if (!WORKABLE.includes(task.order.status) && !task.entry) {
    return <p className="text-sm text-muted">{tt("orderNotStarted")}</p>;
  }
  const lineId = task.id;
  return (
    <div className="flex flex-col gap-2">
      {pausing ? (
        <div className="grid grid-cols-2 gap-2" role="group" aria-label={tt("pauseTitle")}>
          {(["parts", "lunch", "approval", "other"] as const).map((reason) => (
            <Big
              key={reason}
              tone="secondary"
              onClick={() => {
                setPausing(false);
                void tablet.enqueue({ type: "task.pause", lineId, reason });
              }}
            >
              {tt(`pauseReasons.${reason}`)}
            </Big>
          ))}
        </div>
      ) : completing ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm">
            {tt("completeNote")}
            <textarea
              className="textarea min-h-20"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Big tone="secondary" onClick={() => setCompleting(false)}>
              {tt("back")}
            </Big>
            <Big
              onClick={() => {
                setCompleting(false);
                void tablet.enqueue({
                  type: "task.complete",
                  lineId,
                  note: note.trim() || undefined,
                });
              }}
            >
              <CheckCircle2 className="size-5" aria-hidden />
              {tt("complete")}
            </Big>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {!task.entry ? (
            <Big onClick={() => void tablet.enqueue({ type: "task.start", lineId })}>
              <Play className="size-5" aria-hidden />
              {tt("start")}
            </Big>
          ) : task.entry.pausedAt ? (
            <Big onClick={() => void tablet.enqueue({ type: "task.resume", lineId })}>
              <Play className="size-5" aria-hidden />
              {tt("resume")}
            </Big>
          ) : (
            <Big tone="secondary" onClick={() => setPausing(true)}>
              <Pause className="size-5" aria-hidden />
              {tt("pause")}
            </Big>
          )}
          <Big tone="secondary" onClick={() => setCompleting(true)}>
            <CheckCircle2 className="size-5" aria-hidden />
            {tt("complete")}
          </Big>
        </div>
      )}
    </div>
  );
}

function Timer({ task }: { task: TechTask }) {
  const now = useNow(15_000);
  if (!task.entry) return null;
  return (
    <span className="inline-flex items-center gap-1 text-sm font-medium">
      <Clock className="size-4" aria-hidden />
      {tt("timer", { time: formatDuration(liveMinutes(task.entry, now)) })}
    </span>
  );
}

function TaskCard({
  task,
  tablet,
  go,
}: {
  task: TechTask;
  tablet: Tablet;
  go: (v: TabletView) => void;
}) {
  return (
    <article
      data-testid={`task-${task.description}`}
      className={`flex flex-col gap-3 rounded-lg border bg-surface p-4 ${
        task.status === "CANCELLED" ? "border-status-bad" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{task.description}</h2>
        <TaskStatus task={task} />
      </div>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <PlateBadge plate={task.order.vehicle.plate} />
        {task.order.vehicle.make} {task.order.vehicle.model} · {task.order.number}
      </p>
      {task.standardHours !== null ? (
        <p className="text-sm text-muted">{tt("standardHours", { hours: task.standardHours })}</p>
      ) : null}
      {task.order.complaint ? (
        <p className="text-sm">
          <span className="font-medium">{tt("complaint")} : </span>
          {task.order.complaint}
        </p>
      ) : null}
      <Timer task={task} />
      <TaskActions task={task} tablet={tablet} />
      <button
        type="button"
        onClick={() => go({ name: "task", lineId: task.id })}
        className="min-h-11 self-start text-sm font-medium underline"
      >
        {tt("details")}
      </button>
    </article>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {tt("back")}
    </button>
  );
}

function TasksView({
  snap,
  tablet,
  go,
}: {
  snap: TechSnapshot;
  tablet: Tablet;
  go: (v: TabletView) => void;
}) {
  return (
    <section className="flex flex-col gap-3" aria-label={tt("myTasks")}>
      <BackButton onClick={() => go({ name: "home" })} />
      <h1 className="text-xl font-semibold">{tt("myTasks")}</h1>
      {snap.tasks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-muted">
          {tt("empty")}
        </p>
      ) : (
        snap.tasks.map((task) => <TaskCard key={task.id} task={task} tablet={tablet} go={go} />)
      )}
    </section>
  );
}

function TaskDetailView({
  snap,
  tablet,
  go,
  lineId,
}: {
  snap: TechSnapshot;
  tablet: Tablet;
  go: (v: TabletView) => void;
  lineId: string;
}) {
  const task = snap.tasks.find((t) => t.id === lineId);
  const [noteBody, setNoteBody] = useState("");
  const [visible, setVisible] = useState(false);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  if (!task) {
    return (
      <section className="flex flex-col gap-3">
        <BackButton onClick={() => go({ name: "tasks" })} />
        <p className="text-muted">{tt("empty")}</p>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-4">
      <BackButton onClick={() => go({ name: "tasks" })} />
      <TaskCard task={task} tablet={tablet} go={go} />
      {task.order.diagnosis ? (
        <p className="text-sm">
          <span className="font-medium">{tt("diagnosis")} : </span>
          {task.order.diagnosis}
        </p>
      ) : null}
      {task.order.promisedAt ? (
        <p className="text-sm text-muted">
          {tt("promised", { date: formatDateTime(task.order.promisedAt, snap.timeZone) })}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <label className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 font-semibold">
          <Camera className="size-5" aria-hidden />
          {tt("photo")}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            aria-label={tt("photo")}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                const compressed = await compressPhoto(file);
                await tablet.addPhoto({ lineId: task.id, ...compressed });
                setPhotoMessage(tt("photoSaved"));
              } catch (error) {
                setPhotoMessage(isQuotaError(error) ? tt("photoQuota") : String(error));
              }
            }}
          />
        </label>
        <p className="text-sm text-muted">
          {tt("photos", { count: task.photoCount })}
          {photoMessage ? ` · ${photoMessage}` : ""}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">{tt("notes")}</h2>
        {task.notes.length === 0 ? <p className="text-sm text-muted">{tt("noNotes")}</p> : null}
        <ul className="flex flex-col gap-1">
          {task.notes.map((n) => (
            <li key={n.id} className="rounded-md bg-surface-2 p-2 text-sm">
              {n.body}
              {n.visibleToCustomer ? ` · ${tt("noteVisible")}` : ""}
            </li>
          ))}
        </ul>
        <label className="flex flex-col gap-1 text-sm">
          {tt("noteBody")}
          <textarea
            className="textarea min-h-20"
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
            maxLength={2000}
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={visible}
            onChange={(e) => setVisible(e.target.checked)}
          />
          {tt("noteVisible")}
        </label>
        <Big
          tone="secondary"
          disabled={!noteBody.trim()}
          onClick={() => {
            void tablet.enqueue({
              type: "note.add",
              lineId: task.id,
              body: noteBody.trim(),
              visibleToCustomer: visible,
            });
            setNoteBody("");
            setVisible(false);
          }}
        >
          {tt("noteAdd")}
        </Big>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">{tt("parts")}</h2>
        {task.order.parts.length === 0 ? (
          <p className="text-sm text-muted">{tt("noParts")}</p>
        ) : null}
        <ul className="flex flex-col gap-1">
          {task.order.parts.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-2 rounded-md bg-surface-2 p-2 text-sm"
            >
              <span>
                {p.description} × {p.quantity}
              </span>
              {p.stockState ? (
                <StatusBadge
                  tone={
                    p.stockState === "missing" ? "bad" : p.stockState === "issued" ? "ok" : "warn"
                  }
                  label={tt(`stockStates.${p.stockState}`)}
                />
              ) : null}
            </li>
          ))}
        </ul>
        {task.order.partRequests.length > 0 ? (
          <>
            <h3 className="text-sm font-semibold">{tt("requests")}</h3>
            <ul className="flex flex-col gap-1">
              {task.order.partRequests.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-md bg-surface-2 p-2 text-sm"
                >
                  <span>
                    {r.label} × {r.quantity}
                  </span>
                  <StatusBadge
                    tone={
                      r.status === "DELIVERED" ? "ok" : r.status === "REJECTED" ? "bad" : "warn"
                    }
                    label={tt(`partStatuses.${r.status}`)}
                  />
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {requesting ? (
          <PartRequestForm task={task} tablet={tablet} onDone={() => setRequesting(false)} />
        ) : (
          <Big tone="secondary" onClick={() => setRequesting(true)}>
            {tt("requestPart")}
          </Big>
        )}
      </div>
    </section>
  );
}

function PartRequestForm({
  task,
  tablet,
  onDone,
}: {
  task: TechTask;
  tablet: Tablet;
  onDone: () => void;
}) {
  const [query, setQuery] = useState("");
  const [productId, setProductId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [freeText, setFreeText] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [urgency, setUrgency] = useState<"NORMAL" | "HIGH" | "URGENT">("NORMAL");
  const products = trpc.tech.products.useQuery(
    { repairOrderId: task.order.id, query },
    { enabled: tablet.online && query.trim().length >= 2, retry: false },
  );
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <h3 className="font-semibold">{tt("requestTitle")}</h3>
      {tablet.online ? (
        <label className="flex flex-col gap-1 text-sm">
          {tt("searchPart")}
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      ) : null}
      {products.data?.length ? (
        <ul className="flex flex-col gap-1">
          {products.data.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  setProductId(p.id);
                  setLabel(p.name);
                }}
                className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-md border px-2 text-left text-sm ${
                  productId === p.id ? "border-accent" : "border-border"
                }`}
              >
                <span>
                  {p.name} <span className="text-muted">({p.sku})</span>
                </span>
                <span className="flex items-center gap-1">
                  {p.compatible ? <StatusBadge tone="ok" label={tt("compatible")} /> : null}
                  <span className="text-xs">{tt("available", { qty: p.available })}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="flex flex-col gap-1 text-sm">
        {tt("freeText")}
        <input
          className="input"
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          maxLength={200}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm">
          {tt("quantity")}
          <input
            className="input"
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {tt("urgency")}
          <select
            className="select"
            value={urgency}
            onChange={(e) => setUrgency(e.target.value as typeof urgency)}
          >
            {(["NORMAL", "HIGH", "URGENT"] as const).map((u) => (
              <option key={u} value={u}>
                {tw(`priorityLabels.${u}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Big tone="secondary" onClick={onDone}>
          {tt("back")}
        </Big>
        <Big
          disabled={(!productId && !freeText.trim()) || !(Number(quantity) > 0)}
          onClick={() => {
            void tablet.enqueue({
              type: "partRequest.create",
              repairOrderId: task.order.id,
              lineId: task.id,
              productId: productId ?? undefined,
              freeText: productId ? undefined : freeText.trim(),
              label: productId ? label : freeText.trim(),
              quantity: Number(quantity),
              urgency,
            });
            onDone();
          }}
        >
          {tt("sendRequest")}
        </Big>
      </div>
    </div>
  );
}

const RESULTS = ["OK", "WATCH", "URGENT", "NOT_CHECKED"] as const;
const RESULT_CLASS: Record<(typeof RESULTS)[number], string> = {
  OK: "border-status-ok bg-status-ok-bg text-status-ok",
  WATCH: "border-status-warn bg-status-warn-bg text-status-warn",
  URGENT: "border-status-bad bg-status-bad-bg text-status-bad",
  NOT_CHECKED: "border-border bg-surface-2",
};

function InspectionView({
  snap,
  tablet,
  go,
  inspectionId,
}: {
  snap: TechSnapshot;
  tablet: Tablet;
  go: (v: TabletView) => void;
  inspectionId: string;
}) {
  const inspection = snap.inspections.find((i) => i.id === inspectionId);
  const [done, setDone] = useState(false);
  if (!inspection) {
    return (
      <section className="flex flex-col gap-3">
        <BackButton onClick={() => go({ name: "home" })} />
        <p className="text-muted">{done ? tt("inspectionDone") : tt("empty")}</p>
      </section>
    );
  }
  const categories = [...new Set(inspection.items.map((i) => i.category))];
  return (
    <section className="flex flex-col gap-4">
      <BackButton onClick={() => go({ name: "home" })} />
      <h1 className="text-xl font-semibold">
        {tt("inspection", { number: inspection.number })} · {inspection.plate}
      </h1>
      {categories.map((category) => (
        <section key={category} aria-label={category} className="flex flex-col gap-3">
          <h2 className="font-semibold">{category}</h2>
          {inspection.items
            .filter((i) => i.category === category)
            .map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
              >
                <span className="font-medium">{item.label}</span>
                <div
                  className="grid grid-cols-2 gap-2 sm:grid-cols-4"
                  role="radiogroup"
                  aria-label={item.label}
                >
                  {RESULTS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={item.result === r}
                      onClick={() =>
                        void tablet.enqueue({
                          type: "inspection.setItem",
                          itemId: item.id,
                          result: r,
                        })
                      }
                      className={`min-h-12 rounded-lg border-2 px-2 text-sm font-semibold ${
                        item.result === r ? RESULT_CLASS[r] : "border-border bg-surface"
                      }`}
                    >
                      {tt(`results.${r}`)}
                    </button>
                  ))}
                </div>
                {item.result === "URGENT" || item.result === "WATCH" ? (
                  <p className="flex items-center gap-1 text-xs text-status-warn">
                    <AlertTriangle className="size-3" aria-hidden />
                    {tt("photoRequired")}
                  </p>
                ) : null}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm">
                    {tt("measurement")}
                    <input
                      className="input"
                      defaultValue={item.measurement ?? ""}
                      maxLength={60}
                      onBlur={(e) =>
                        e.target.value !== (item.measurement ?? "") &&
                        void tablet.enqueue({
                          type: "inspection.setItem",
                          itemId: item.id,
                          result: item.result,
                          measurement: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    {tt("comment")}
                    <input
                      className="input"
                      defaultValue={item.comment ?? ""}
                      maxLength={1000}
                      onBlur={(e) =>
                        e.target.value !== (item.comment ?? "") &&
                        void tablet.enqueue({
                          type: "inspection.setItem",
                          itemId: item.id,
                          result: item.result,
                          comment: e.target.value,
                        })
                      }
                    />
                  </label>
                </div>
              </div>
            ))}
        </section>
      ))}
      <Big
        onClick={() => {
          setDone(true);
          void tablet.enqueue({ type: "inspection.complete", inspectionId });
        }}
      >
        {tt("inspectionComplete")}
      </Big>
    </section>
  );
}
