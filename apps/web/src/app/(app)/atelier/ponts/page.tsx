"use client";

// M06 US-M06-02 — /atelier/ponts : une colonne par pont actif, zone « Parking / sans pont ».
// Glisser un OR sur un pont (ou choisir le pont dans la liste) ; pont occupé → confirmation
// avant d'envoyer l'occupant au parking (RG-M06-03).
import { useState } from "react";
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
  const allBays = data?.bays ?? [];

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
    <div className="flex min-w-0 flex-col gap-4">
      <PageHead title={tw("tabs.bays")} description={tw("bays.description")} />
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {allBays.map(({ bay, repairOrder }) => (
              <section
                key={bay.id}
                aria-label={bay.name}
                {...dropZone(bay.id)}
                className="flex min-h-40 flex-col gap-2 rounded-lg bg-surface-2/60 p-2"
              >
                <h3 className="text-sm font-semibold">{bay.name}</h3>
                {repairOrder ? (
                  <OrderCard
                    card={repairOrder}
                    timeZone={data.timeZone}
                    draggable={canMove}
                    onDragStart={() => setDragging(repairOrder.id)}
                    onDragEnd={() => setDragging(null)}
                    footer={
                      <>
                        {repairOrder.activeMechanics.length > 0 ? (
                          <p className="text-xs">
                            {tw("bays.active", {
                              names: repairOrder.activeMechanics.map((m) => m.name).join(", "),
                            })}
                          </p>
                        ) : null}
                        {bayPicker(repairOrder)}
                      </>
                    }
                  />
                ) : (
                  <p className="text-sm text-muted">{tw("bays.free")}</p>
                )}
              </section>
            ))}
          </div>
          <section
            aria-label={tw("bays.parking")}
            {...dropZone(null)}
            className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-2"
          >
            <h3 className="text-sm font-semibold">{tw("bays.parking")}</h3>
            {data.parking.length === 0 ? (
              <p className="text-sm text-muted">{tw("bays.emptyParking")}</p>
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
        <p>{conflict?.message}</p>
      </Modal>
    </div>
  );
}
