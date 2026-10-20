"use client";

// M06 US-M06-02 — /atelier/ponts : une colonne par pont actif, zone « Parking / sans pont ».
// Glisser un OR sur un pont (ou choisir le pont dans la liste) ; pont occupé → confirmation
// avant d'envoyer l'occupant au parking (RG-M06-03).
import { useMemo, useState } from "react";
import { Car, CheckCircle2, CircleDot, Gauge, Wrench } from "lucide-react";
import { Button, EmptyState, Modal, PageHead, Select } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { OrderCard } from "@/components/workshop/card";
import { tw } from "@/components/workshop/i18n";
import type { WorkshopCard } from "@/components/workshop/types";

export default function WorkshopBaysPage() {
  const utils = trpc.useUtils();
  const bays = trpc.workshop.bays.useQuery({}, { refetchInterval: 30_000 });
  const me = trpc.me.get.useQuery(undefined, { staleTime: 60_000 });
  const canMove = new Set(me.data?.permissions ?? []).has("repair_order:update");
  const [conflict, setConflict] = useState<{
    message: string;
    repairOrderId: string;
    bayId: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const assign = trpc.workshop.assignBay.useMutation({
    onSuccess() {
      setConflict(null);
      setError(null);
      void utils.workshop.bays.invalidate();
      void utils.workshop.board.invalidate();
    },
    onError(err, variables) {
      if (err.data?.code === "CONFLICT" && variables.bayId) {
        setConflict({
          message: err.message,
          repairOrderId: variables.repairOrderId,
          bayId: variables.bayId,
        });
        return;
      }
      setError(err.message);
    },
  });

  const place = (repairOrderId: string, bayId: string | null) => {
    setDragging(null);
    assign.mutate({ repairOrderId, bayId });
  };

  const data = bays.data;
  const allBays = useMemo(() => data?.bays ?? [], [data?.bays]);

  // Statistiques ponts
  const stats = useMemo(() => {
    const totalBays = allBays.length;
    const occupied = allBays.filter((b) => b.repairOrder !== null).length;
    const free = totalBays - occupied;
    const occupancyRate = totalBays > 0 ? Math.round((occupied / totalBays) * 100) : 0;
    const parkingCount = data?.parking.length ?? 0;
    return { totalBays, occupied, free, occupancyRate, parkingCount };
  }, [allBays, data?.parking]);

  const bayPicker = (card: WorkshopCard) =>
    canMove ? (
      <Select
        aria-label={tw("bays.assignTo")}
        value={card.bay?.id ?? ""}
        onChange={(e) => place(card.id, e.target.value || null)}
      >
        <option value="">{tw("bays.toParking")}</option>
        {allBays.map((b) => (
          <option key={b.bay.id} value={b.bay.id}>
            {b.bay.name}
          </option>
        ))}
      </Select>
    ) : null;

  const dropZone = (bayId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (canMove && dragging) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain") || dragging;
      if (id) place(id, bayId);
    },
  });

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHead title={tw("tabs.bays")} description={tw("bays.description")} />

      {/* KPI Cards / Synthèse Ponts */}
      {allBays.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
            <div className="flex items-center justify-between text-muted">
              <span className="text-xs font-medium uppercase tracking-wider">{tw("kpis.baysOccupied")}</span>
              <Wrench className="size-4 text-accent" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight">
              {stats.occupied} / {stats.totalBays}
            </span>
            <span className="text-xs text-muted">{stats.free} pont(s) libre(s)</span>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
            <div className="flex items-center justify-between text-status-ok">
              <span className="text-xs font-medium uppercase tracking-wider">{tw("kpis.occupancyRate")}</span>
              <Gauge className="size-4 text-status-ok" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight text-status-ok">
              {stats.occupancyRate} %
            </span>
            <span className="text-xs text-muted">Charge actuelle</span>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
            <div className="flex items-center justify-between text-muted">
              <span className="text-xs font-medium uppercase tracking-wider">{tw("bays.free")}</span>
              <CheckCircle2 className="size-4 text-status-ok" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight">{stats.free}</span>
            <span className="text-xs text-muted">Prêts à accueillir</span>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
            <div className="flex items-center justify-between text-status-warn">
              <span className="text-xs font-medium uppercase tracking-wider">{tw("kpis.parkingVehicles")}</span>
              <Car className="size-4 text-status-warn" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight text-status-warn">
              {stats.parkingCount}
            </span>
            <span className="text-xs text-muted">En attente d&apos;affectation</span>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-status-bad">
          {error}
        </p>
      ) : null}

      {bays.isLoading ? (
        <ListSkeleton rows={3} />
      ) : bays.isError || !data ? (
        <ErrorBox message={tw("loadError")} onRetry={() => void bays.refetch()} />
      ) : (
        <>
          {allBays.length === 0 ? <EmptyState title={tw("bays.noBays")} /> : null}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {allBays.map(({ bay, repairOrder }) => (
              <section
                key={bay.id}
                aria-label={bay.name}
                {...dropZone(bay.id)}
                className={`flex min-h-48 flex-col gap-2.5 rounded-xl border p-3 transition-colors ${
                  repairOrder
                    ? "border-accent/40 bg-surface shadow-sm"
                    : "border-dashed border-border bg-surface-2/40 hover:bg-surface-2/70"
                }`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                    <CircleDot className={`size-3 ${repairOrder ? "text-accent fill-accent" : "text-status-ok"}`} />
                    {bay.name}
                  </h3>
                  {repairOrder ? (
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">
                      Occupé
                    </span>
                  ) : (
                    <span className="rounded-full bg-status-ok/15 px-2 py-0.5 text-[11px] font-semibold text-status-ok">
                      {tw("bays.free")}
                    </span>
                  )}
                </div>

                {repairOrder ? (
                  <OrderCard
                    card={repairOrder}
                    timeZone={data.timeZone}
                    draggable={canMove}
                    onDragStart={() => setDragging(repairOrder.id)}
                    onDragEnd={() => setDragging(null)}
                    footer={
                      <div className="flex flex-col gap-1.5">
                        {repairOrder.activeMechanics.length > 0 ? (
                          <p className="text-xs text-muted">
                            {tw("bays.active", {
                              names: repairOrder.activeMechanics.map((m) => m.name).join(", "),
                            })}
                          </p>
                        ) : null}
                        {bayPicker(repairOrder)}
                      </div>
                    }
                  />
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
                    <p className="text-xs text-muted">
                      {canMove ? "Glissez un véhicule ici pour l'installer sur le pont" : tw("bays.free")}
                    </p>
                  </div>
                )}
              </section>
            ))}
          </div>

          {/* Section Parking */}
          <section
            aria-label={tw("bays.parking")}
            {...dropZone(null)}
            className="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-surface-2/20 p-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Car className="size-4 text-muted" aria-hidden />
                <span>{tw("bays.parking")}</span>
                <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs text-muted">
                  {data.parking.length}
                </span>
              </h3>
            </div>

            {data.parking.length === 0 ? (
              <p className="text-sm text-muted py-2">{tw("bays.emptyParking")}</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {data.parking.map((card) => (
                  <OrderCard
                    key={card.id}
                    card={card}
                    timeZone={data.timeZone}
                    draggable={canMove}
                    onDragStart={() => setDragging(card.id)}
                    onDragEnd={() => setDragging(null)}
                    footer={bayPicker(card)}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <Modal
        open={!!conflict}
        title={tw("bays.occupiedTitle")}
        onClose={() => setConflict(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConflict(null)}>
              {tw("cancel")}
            </Button>
            <Button
              onClick={() =>
                conflict &&
                assign.mutate({
                  repairOrderId: conflict.repairOrderId,
                  bayId: conflict.bayId,
                  force: true,
                })
              }
            >
              {tw("bays.forceConfirm")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{conflict?.message}</p>
      </Modal>
    </div>
  );
}
