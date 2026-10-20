"use client";

// M06 US-M06-07 — /atelier/pieces : demandes de pièces des tablettes, traitées par le magasin
// (M07, `stock:issue`) : préparer, commander, livrer (ajout à l'OR), refuser avec motif.
import { useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import {
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHead,
  PlateBadge,
  StatusBadge,
} from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { tw } from "@/components/workshop/i18n";

type Status = "REQUESTED" | "PREPARING" | "ORDERED" | "DELIVERED" | "REJECTED" | "CANCELLED";
const TONE: Record<Status, "ok" | "warn" | "bad" | "off"> = {
  REQUESTED: "warn",
  PREPARING: "warn",
  ORDERED: "warn",
  DELIVERED: "ok",
  REJECTED: "bad",
  CANCELLED: "off",
};

export default function PartRequestsPage() {
  const utils = trpc.useUtils();
  const list = trpc.partRequest.list.useQuery({}, { refetchInterval: 30_000 });
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const update = trpc.partRequest.updateStatus.useMutation({
    onSuccess() {
      setRejecting(null);
      setReason("");
      setError(null);
      void utils.partRequest.list.invalidate();
    },
    onError: (err) => setError(err.message),
  });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHead title={tw("tabs.parts")} description={tw("parts.description")} />
      {error ? (
        <p role="alert" className="text-sm text-status-bad">
          {error}
        </p>
      ) : null}
      {list.isLoading ? (
        <ListSkeleton rows={3} />
      ) : list.isError || !list.data ? (
        <ErrorBox message={tw("loadError")} onRetry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState title={tw("parts.empty")} />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.data.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 md:flex-row md:items-center"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-medium">
                  {r.label} × {r.quantity}
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Link href={`/ordres/${r.repairOrder.id}`} className="hover:underline">
                    {r.repairOrder.number}
                  </Link>
                  <PlateBadge plate={r.repairOrder.plate} />
                  {tw("parts.requestedBy", { name: r.requestedBy })} · {formatDateTime(r.createdAt)}
                </span>
                {r.rejectReason ? (
                  <span className="text-xs text-status-bad">{r.rejectReason}</span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <StatusBadge tone={TONE[r.status]} label={tw(`parts.statuses.${r.status}`)} />
                {r.urgency === "HIGH" || r.urgency === "URGENT" ? (
                  <StatusBadge tone="bad">
                    <AlertTriangle className="size-3" aria-hidden />
                    {tw(`priorityLabels.${r.urgency}`)}
                  </StatusBadge>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {r.status === "REQUESTED" ? (
                  <>
                    <Button onClick={() => update.mutate({ id: r.id, status: "PREPARING" })}>
                      {tw("parts.prepare")}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => update.mutate({ id: r.id, status: "ORDERED" })}
                    >
                      {tw("parts.ordered")}
                    </Button>
                  </>
                ) : null}
                {r.status === "PREPARING" || r.status === "ORDERED" ? (
                  <Button onClick={() => update.mutate({ id: r.id, status: "DELIVERED" })}>
                    {tw("parts.deliver")}
                  </Button>
                ) : null}
                {r.status === "REQUESTED" || r.status === "PREPARING" ? (
                  <Button variant="secondary" onClick={() => setRejecting(r.id)}>
                    {tw("parts.reject")}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={!!rejecting}
        title={tw("parts.reject")}
        onClose={() => setRejecting(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)}>
              {tw("cancel")}
            </Button>
            <Button
              disabled={!reason.trim()}
              onClick={() =>
                rejecting && update.mutate({ id: rejecting, status: "REJECTED", reason })
              }
            >
              {tw("confirm")}
            </Button>
          </>
        }
      >
        <Field label={tw("parts.rejectReason")}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
