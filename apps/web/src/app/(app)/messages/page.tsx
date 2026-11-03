"use client";

// RG-M11 §7.1 : Messages. Deux vues :
// - « Conversations » : les échanges avec les clients (réponses reçues, messages écrits à la main) ;
// - « Envois » : tout ce qui est parti vers les clients (relances, reçus, documents, messages),
//   avec l'accusé de réception, pour vérifier qu'un message est bien arrivé.
import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Inbox, PenLine, Send } from "lucide-react";
import { Button } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ComposePanel } from "./compose-panel";
import { ConversationList } from "./conversation-list";
import { SentLog } from "./sent-log";
import { tm } from "./labels";

type Tab = "conversations" | "sent";

export default function MessagesPage() {
  return (
    <Suspense fallback={null}>
      <Messages />
    </Suspense>
  );
}

function Messages() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab: Tab = params.get("vue") === "envois" ? "sent" : "conversations";
  const [composeOpen, setComposeOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const unread = trpc.messaging.conversations.list.useQuery({ filter: "UNREAD", limit: 1 });
  const unreadTotal = unread.data?.unreadTotal ?? 0;

  function chooseTab(next: Tab) {
    router.replace(next === "sent" ? `${pathname}?vue=envois` : pathname);
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{tm("title")}</h1>
          <p className="mt-1 text-sm text-muted">{tm("subtitle")}</p>
        </div>
        <Button className="min-h-11" onClick={() => setComposeOpen(true)}>
          <PenLine size={16} aria-hidden />
          {tm("new")}
        </Button>
      </header>

      {notice && (
        <p
          className="flex items-start justify-between gap-3 rounded-md bg-status-ok-bg px-3 py-2 text-sm text-status-ok"
          role="status"
        >
          <span>{notice}</span>
          <button type="button" className="font-medium underline" onClick={() => setNotice(null)}>
            {tm("dismiss")}
          </button>
        </p>
      )}

      <div role="tablist" aria-label={tm("title")} className="flex gap-1 border-b border-border">
        {(
          [
            ["conversations", Inbox, tm("tabs.conversations")],
            ["sent", Send, tm("tabs.sent")],
          ] as const
        ).map(([value, Icon, label]) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={tab === value}
            onClick={() => chooseTab(value)}
            className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium ${
              tab === value
                ? "border-accent text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            <Icon size={16} aria-hidden />
            {label}
            {value === "conversations" && unreadTotal > 0 && (
              <span className="rounded-full bg-status-bad px-1.5 text-xs font-semibold text-white">
                {unreadTotal}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "conversations" ? <ConversationList /> : <SentLog />}

      {composeOpen && (
        <ComposePanel
          onClose={() => setComposeOpen(false)}
          onSent={(text) => {
            setNotice(text);
            setComposeOpen(false);
          }}
        />
      )}
    </div>
  );
}
