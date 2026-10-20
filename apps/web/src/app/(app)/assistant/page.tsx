"use client";

// M17 §7 — `/assistant` : assistant conversationnel en lecture seule (US-M17-10), plein écran
// sur mobile. Suggestions de questions, réponses avec liens profonds et boutons d'action (jamais
// exécutés ici), saisie vocale si le navigateur la propose, historique des 30 derniers jours.
import { Suspense, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Lock, Mic, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { Button, EmptyState } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/react";

const SUGGESTIONS = [
  "topDebtors",
  "inspectionsWeek",
  "revenueYesterday",
  "appointmentsToday",
] as const;

interface ChatLink {
  label: string;
  href: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  links?: ChatLink[];
  actions?: ChatLink[];
  verifiedFallback?: boolean;
}

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

function speechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    (new () => SpeechRecognitionLike) | null;
}

const noopSubscribe = () => () => undefined;

export default function AssistantPage() {
  return (
    <Suspense fallback={<ThreadSkeleton />}>
      <Assistant />
    </Suspense>
  );
}

function Assistant() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const threadId = params.get("fil");
  const utils = trpc.useUtils();

  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  // Lu côté client seulement (rendu serveur : pas de micro) — évite un écart d'hydratation.
  const voiceSupported = useSyncExternalStore(
    noopSubscribe,
    () => speechRecognitionCtor() !== null,
    () => false,
  );
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const status = trpc.ai.status.useQuery(undefined, { staleTime: 60_000 });
  const threads = trpc.ai.assistant.threads.useQuery();
  const thread = trpc.ai.assistant.thread.useQuery(
    { threadId: threadId ?? "" },
    { enabled: !!threadId },
  );

  const ask = trpc.ai.assistant.ask.useMutation({
    async onSuccess(answer) {
      setPending(null);
      if (answer.threadId !== threadId) {
        router.replace(`${pathname}?fil=${answer.threadId}`);
      }
      await Promise.all([
        utils.ai.assistant.thread.invalidate({ threadId: answer.threadId }),
        utils.ai.assistant.threads.invalidate(),
      ]);
    },
    onError() {
      setPending(null);
    },
  });

  const deleteThread = trpc.ai.assistant.deleteThread.useMutation({
    async onSuccess() {
      router.replace(pathname);
      await utils.ai.assistant.threads.invalidate();
    },
  });

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [thread.data, pending]);

  const availability = status.data?.assistant;
  const unavailable = availability && !availability.available ? availability.reason : null;

  function submit(text: string) {
    const value = text.trim();
    if (!value || ask.isPending || unavailable) return;
    setPending(value);
    setQuestion("");
    ask.mutate({ question: value, ...(threadId ? { threadId } : {}) });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submit(question);
  }

  function toggleVoice() {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "fr-FR";
    rec.interimResults = false;
    rec.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      setQuestion((q) => (q ? `${q} ${transcript}` : transcript));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognition.current = rec;
    setListening(true);
    rec.start();
  }

  const messages: ChatMessage[] = threadId ? ((thread.data?.messages ?? []) as ChatMessage[]) : [];

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-3xl flex-col gap-3">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Sparkles aria-hidden className="h-5 w-5" />
            {t("assistant.title")}
          </h1>
          <p className="text-sm text-muted">{t("assistant.subtitle")}</p>
        </div>
        {threadId && (
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              iconOnly
              aria-label={t("assistant.newThread")}
              title={t("assistant.newThread")}
              className="min-h-11 min-w-11"
              onClick={() => router.replace(pathname)}
            >
              <Plus aria-hidden className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              iconOnly
              aria-label={t("assistant.deleteThread")}
              title={t("assistant.deleteThread")}
              className="min-h-11 min-w-11"
              loading={deleteThread.isPending}
              onClick={() => deleteThread.mutate({ threadId })}
            >
              <Trash2 aria-hidden className="h-5 w-5" />
            </Button>
          </div>
        )}
      </header>

      <p
        className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-xs text-muted"
        data-testid="assistant-read-only"
      >
        <Lock aria-hidden className="h-4 w-4 shrink-0" />
        {t("assistant.readOnly")}
      </p>

      <section
        aria-live="polite"
        className="flex flex-1 flex-col gap-3"
        data-testid="assistant-thread"
      >
        {threadId && thread.isLoading ? (
          <ThreadSkeleton />
        ) : threadId && thread.isError ? (
          <EmptyState
            title={t("assistant.loadError")}
            action={
              <Button variant="secondary" onClick={() => thread.refetch()}>
                {t("assistant.retry")}
              </Button>
            }
          />
        ) : messages.length === 0 && !pending ? (
          <EmptyState
            icon={<Sparkles aria-hidden />}
            title={t("assistant.emptyTitle")}
            description={t("assistant.emptyDescription")}
          />
        ) : (
          messages.map((m) => <Bubble key={m.id} message={m} />)
        )}
        {pending && (
          <>
            <Bubble message={{ id: "pending", role: "user", text: pending }} />
            <div
              className="flex flex-col gap-2 rounded-lg border border-border p-3"
              aria-busy="true"
            >
              <span className="text-sm text-muted">{t("assistant.sending")}</span>
              <div className="h-3 w-3/4 animate-pulse rounded bg-surface-2" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-surface-2" />
            </div>
          </>
        )}
        {ask.isError && (
          <p role="alert" className="text-sm text-status-bad">
            {t("assistant.error")}
          </p>
        )}
        <div ref={endRef} />
      </section>

      {!threadId && (
        <div className="flex flex-wrap gap-2" data-testid="assistant-suggestions">
          {SUGGESTIONS.map((key) => (
            <button
              key={key}
              type="button"
              disabled={!!unavailable || ask.isPending}
              onClick={() => submit(t(`assistant.questions.${key}`))}
              className="min-h-11 rounded-full border border-border bg-surface px-4 text-sm disabled:opacity-50"
            >
              {t(`assistant.suggestions.${key}`)}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={onSubmit}
        className="sticky bottom-0 flex gap-2 border-t border-border bg-background py-2"
      >
        <label className="sr-only" htmlFor="assistant-question">
          {t("assistant.placeholder")}
        </label>
        <input
          id="assistant-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={listening ? t("assistant.voiceListening") : t("assistant.placeholder")}
          maxLength={1000}
          disabled={!!unavailable}
          title={unavailable ?? undefined}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 text-sm"
        />
        {voiceSupported && (
          <Button
            type="button"
            variant={listening ? "primary" : "secondary"}
            iconOnly
            aria-label={t("assistant.voice")}
            title={t("assistant.voice")}
            aria-pressed={listening}
            disabled={!!unavailable}
            className="min-h-11 min-w-11"
            onClick={toggleVoice}
          >
            <Mic aria-hidden className="h-5 w-5" />
          </Button>
        )}
        <Button
          type="submit"
          className="min-h-11"
          loading={ask.isPending}
          disabled={!!unavailable || !question.trim()}
          title={unavailable ?? undefined}
        >
          <Send aria-hidden className="h-4 w-4" />
          <span className="max-sm:sr-only">{t("assistant.send")}</span>
        </Button>
      </form>
      {unavailable && (
        <p className="text-xs text-muted" role="status">
          {unavailable} {t("assistant.unavailableHint")}
        </p>
      )}

      <section className="flex flex-col gap-2 pb-4">
        <h2 className="text-sm font-semibold">{t("assistant.history")}</h2>
        {threads.isLoading ? (
          <div className="h-10 animate-pulse rounded bg-surface-2" />
        ) : (threads.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">{t("assistant.historyEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {(threads.data ?? []).map((th) => (
              <li key={th.id}>
                <Link
                  href={`${pathname}?fil=${th.id}`}
                  className={`flex min-h-11 items-center truncate rounded-md px-3 text-sm ${th.id === threadId ? "bg-surface-2 font-medium" : ""}`}
                >
                  {th.title ?? t("assistant.title")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const mine = message.role === "user";
  return (
    <div
      className={`flex flex-col gap-2 rounded-lg p-3 text-sm ${mine ? "self-end bg-accent text-accent-foreground" : "border border-border bg-surface"} max-w-[90%]`}
      data-testid={mine ? "assistant-question" : "assistant-answer"}
    >
      <span className="text-xs opacity-70">
        {mine ? t("assistant.you") : t("assistant.assistant")}
      </span>
      <p className="whitespace-pre-line">{message.text}</p>
      {message.verifiedFallback && (
        <p className="text-xs text-muted">{t("assistant.verifiedFallback")}</p>
      )}
      {!!message.actions?.length && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold">{t("assistant.actions")}</span>
          <div className="flex flex-wrap gap-2">
            {message.actions.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="btn btn-primary btn-sm inline-flex min-h-11 items-center"
              >
                {a.label}
              </Link>
            ))}
          </div>
        </div>
      )}
      {!!message.links?.length && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold">{t("assistant.links")}</span>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {message.links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-flex min-h-11 items-center underline">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ThreadSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-2" />
      ))}
    </div>
  );
}
