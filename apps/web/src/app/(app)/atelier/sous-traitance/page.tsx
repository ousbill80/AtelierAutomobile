"use client";

// M06 US-M06-11 / RG-M06-12 — /atelier/sous-traitance : lignes SUBCONTRACT par statut,
// sous-traitant, retour prévu (rouge si dépassé), alerte « vendue à perte ».
import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Clock, PackageCheck, Send } from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, EmptyState, PageHead, PlateBadge, Select, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDay } from "@/components/repair-orders/i18n";
import { tw } from "@/components/workshop/i18n";

type Status = "TO_SEND" | "SENT" | "RETURNED" | "CANCELLED";
const TONE: Record<Status, "ok" | "warn" | "bad" | "off"> = {
  TO_SEND: "warn",
  SENT: "warn",
  RETURNED: "ok",
  CANCELLED: "off",
};

export default function SubcontractPage() {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<Status | "">("");
  const list = trpc.workshop.subcontractList.useQuery({ status: status || undefined });
  const [error, setError] = useState<string | null>(null);
  const update = trpc.workshop.subcontractUpdateStatus.useMutation({
    onSuccess() {
      setError(null);
      void utils.workshop.subcontractList.invalidate();
    },
    onError: (err) => setError(err.message),
  });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHead title={tw("tabs.subcontract")} description={tw("subcontract.description")} />
      <label className="flex max-w-xs flex-col gap-1 text-sm">
        {tw("subcontract.status")}
        <Select value={status} onChange={(e) => setStatus(e.target.value as Status | "")}>
          <option value="">{tw("subcontract.allStatuses")}</option>
          {(["TO_SEND", "SENT", "RETURNED", "CANCELLED"] as const).map((s) => (
            <option key={s} value={s}>
              {tw(`subcontract.statuses.${s}`)}
            </option>
          ))}
        </Select>
      </label>
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
        <EmptyState title={tw("subcontract.empty")} />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.data.map((line) => (
            <li
              key={line.id}
              className={`flex flex-col gap-2 rounded-lg border bg-surface p-3 md:flex-row md:items-center ${
                line.overdue ? "border-status-bad" : "border-border"
              }`}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-medium">{line.description}</span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Link href={`/ordres/${line.repairOrder.id}`} className="hover:underline">
                    {line.repairOrder.number}
                  </Link>
                  <PlateBadge plate={line.repairOrder.plate} />
                  {tw("subcontract.supplier")} : {line.supplierName ?? tw("none")}
                </span>
                <span className="text-sm">
                  {tw("subcontract.expected")} : {formatDay(line.expectedAt)} ·{" "}
                  {tw("subcontract.cost")} :{" "}
                  {line.cost !== null ? formatFCFA(line.cost) : tw("none")} ·{" "}
                  {tw("subcontract.sale")} : {formatFCFA(line.salePrice)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <StatusBadge
                  tone={TONE[line.status]}
                  label={tw(`subcontract.statuses.${line.status}`)}
                />
                {line.overdue ? (
                  <StatusBadge tone="bad">
                    <Clock className="size-3" aria-hidden />
                    {tw("subcontract.overdue")}
                  </StatusBadge>
                ) : null}
                {line.loss ? (
                  <StatusBadge tone="bad">
                    <AlertTriangle className="size-3" aria-hidden />
                    {tw("subcontract.loss")}
                  </StatusBadge>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {line.status === "TO_SEND" ? (
                  <Button onClick={() => update.mutate({ lineId: line.id, status: "SENT" })}>
                    <Send className="size-4" aria-hidden /> {tw("subcontract.markSent")}
                  </Button>
                ) : null}
                {line.status === "SENT" ? (
                  <Button onClick={() => update.mutate({ lineId: line.id, status: "RETURNED" })}>
                    <PackageCheck className="size-4" aria-hidden /> {tw("subcontract.markReturned")}
                  </Button>
                ) : null}
                {line.status === "TO_SEND" || line.status === "SENT" ? (
                  <Button
                    variant="secondary"
                    onClick={() => update.mutate({ lineId: line.id, status: "CANCELLED" })}
                  >
                    {tw("subcontract.cancelLine")}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
