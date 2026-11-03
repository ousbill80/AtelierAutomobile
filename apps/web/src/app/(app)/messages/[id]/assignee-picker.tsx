"use client";

// Responsable d'une conversation : qui, dans l'équipe, répond à ce client. Évite que deux
// personnes répondent en même temps, ou que personne ne réponde. Changer le responsable
// demande la permission message:assign ; sinon, on affiche seulement le nom.
import { UserCheck, UserRound } from "lucide-react";
import { Button } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { tm } from "../labels";

type Assignee = { id: string; name: string; isMe: boolean } | null;

export function AssigneePicker({
  conversationId,
  assignee,
}: {
  conversationId: string;
  assignee: Assignee;
}) {
  const utils = trpc.useUtils();
  const me = trpc.me.get.useQuery(undefined, { staleTime: 60_000 });
  const canAssign = me.data?.permissions.includes("message:assign") ?? false;
  const members = trpc.messaging.conversations.assignees.useQuery(undefined, {
    enabled: canAssign,
    staleTime: 60_000,
  });
  const assign = trpc.messaging.conversations.assign.useMutation({
    onSuccess: () => {
      void utils.messaging.conversations.get.invalidate({ id: conversationId });
      void utils.messaging.conversations.list.invalidate();
    },
  });

  const current = assignee ? (assignee.isMe ? tm("assignee.byYou") : assignee.name) : null;

  if (!canAssign) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted">
        <UserRound size={14} aria-hidden />
        {tm("assignee.label")} : {current ?? tm("assignee.nobody")}
      </p>
    );
  }

  const myId = members.data?.find((m) => m.isMe)?.id;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex min-w-0 items-center gap-2 text-sm">
        <UserRound size={14} className="shrink-0 text-muted" aria-hidden />
        <span className="shrink-0 text-muted">{tm("assignee.label")}</span>
        <select
          className="min-h-11 max-w-52 min-w-0 rounded-md border border-border bg-surface px-2 text-sm"
          value={assignee?.id ?? ""}
          disabled={assign.isPending || members.isLoading}
          onChange={(e) => assign.mutate({ conversationId, assignedToId: e.target.value || null })}
        >
          <option value="">{tm("assignee.nobody")}</option>
          {/* Le responsable actuel reste visible même s'il n'a plus accès aux messages. */}
          {assignee && !members.data?.some((m) => m.id === assignee.id) && (
            <option value={assignee.id}>{assignee.name}</option>
          )}
          {members.data?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.isMe ? tm("assignee.meSuffix", { name: m.name }) : m.name}
            </option>
          ))}
        </select>
      </label>
      {myId && !assignee?.isMe && (
        <Button
          variant="secondary"
          className="min-h-11"
          disabled={assign.isPending}
          onClick={() => assign.mutate({ conversationId, assignedToId: myId })}
        >
          <UserCheck size={16} aria-hidden />
          {tm("assignee.take")}
        </Button>
      )}
      {assign.isError && (
        <p className="w-full text-sm text-status-bad" role="alert">
          {assign.error.message || tm("assignee.error")}
        </p>
      )}
    </div>
  );
}
