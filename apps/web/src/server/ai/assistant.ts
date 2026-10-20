// M17 RG-M17-20 / §8 — assistant conversationnel en LECTURE SEULE : `ai.assistant.ask`,
// `threads`, `thread`, `deleteThread`. Boucle d'outils du service IA (au plus 6 appels),
// outils permissionnés exécutés avec le contexte de l'utilisateur (`assistantTools.ts`),
// question masquée avant envoi (RG-M17-04), chiffres de la réponse vérifiés contre les
// résultats d'outils (sinon remplacée par les données brutes formatées), repli « indisponible »
// + liens vers les rapports (RG-M17-08). Historique conservé 30 jours, visible par son seul
// auteur.
//
// Écart v1 : pas de flux (streaming) — la réponse complète est renvoyée en une fois.
import { formatDate, redactPii, unverifiedNumbers, type Redaction } from "@atelieros/core";
import { adminDb, db, type Prisma } from "@atelieros/db";
import {
  ASSISTANT_MAX_TOOL_CALLS,
  ASSISTANT_PROMPT_VERSION,
  ASSISTANT_TOOLS,
  assistantSystemPrompt,
  type AiMessage,
} from "@atelieros/integrations";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { requirePermission, router } from "../trpc";
import { assistantConsoleReply, formatToolTraces } from "./assistantConsole";
import { collectLinks, createAssistantToolExecutor, type ToolLink } from "./assistantTools";
import { getAiService } from "./service";

export const ASSISTANT_THREAD_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Nombre d'échanges précédents renvoyés au modèle comme contexte. */
const HISTORY_MESSAGES = 6;

/** RG-M17-08 — repli quand l'IA est indisponible, désactivée ou hors quota. */
const REPORT_LINKS: ToolLink[] = [
  { label: "Tableau de bord", href: "/tableau-de-bord" },
  { label: "Créances", href: "/creances" },
  { label: "Relances du jour", href: "/relances" },
  { label: "Échéances", href: "/relances/echeances" },
];

export interface AssistantAnswer {
  text: string;
  links: ToolLink[];
  actions: ToolLink[];
  toolCalls: string[];
  /** Vrai si la réponse a été remplacée par les données brutes (chiffre non justifié). */
  verifiedFallback: boolean;
  unavailable: boolean;
}

type TenantDb = ReturnType<typeof db.forTenant>;

async function ownThread(tx: TenantDb, threadId: string, membershipId: string, now: Date) {
  const thread = await tx.aiAssistantThread.findFirst({
    where: { id: threadId, membershipId, expiresAt: { gt: now } },
  });
  if (!thread) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation introuvable." });
  return thread;
}

function textOf(content: unknown): string {
  return content && typeof content === "object" && "text" in content
    ? String((content as { text: unknown }).text ?? "")
    : "";
}

export const assistantProcedures = {
  assistant: router({
    ask: requirePermission("ai:use")
      .input(
        z.object({
          threadId: z.string().optional(),
          question: z.string().trim().min(1, "Posez une question.").max(1_000),
        }),
      )
      .mutation(async ({ ctx, input }): Promise<AssistantAnswer & { threadId: string }> => {
        const tx = db.forTenant({ organizationId: ctx.organizationId });
        const now = new Date();
        const org = await adminDb.organization.findUniqueOrThrow({
          where: { id: ctx.organizationId },
          select: { name: true, timezone: true },
        });

        const thread = input.threadId
          ? await ownThread(tx, input.threadId, ctx.membership.id, now)
          : await tx.aiAssistantThread.create({
              data: {
                organizationId: ctx.organizationId,
                membershipId: ctx.membership.id,
                title: input.question.slice(0, 80),
                expiresAt: new Date(now.getTime() + ASSISTANT_THREAD_TTL_MS),
              },
            });

        // RG-M17-04 : historique et question masqués avec une numérotation partagée.
        const previous = input.threadId
          ? await tx.aiAssistantMessage.findMany({
              where: { threadId: thread.id, role: { in: ["user", "assistant"] } },
              orderBy: { createdAt: "desc" },
              take: HISTORY_MESSAGES,
            })
          : [];
        let redaction: Redaction = { text: "", tokens: {} };
        const history: AiMessage[] = [];
        for (const m of previous.reverse()) {
          redaction = redactPii(textOf(m.content), redaction);
          history.push({ role: m.role as "user" | "assistant", content: redaction.text });
        }
        redaction = redactPii(input.question, redaction);
        const messages: AiMessage[] = [...history, { role: "user", content: redaction.text }];

        await tx.aiAssistantMessage.create({
          data: {
            organizationId: ctx.organizationId,
            threadId: thread.id,
            role: "user",
            content: { text: input.question },
          },
        });

        const execute = createAssistantToolExecutor({
          organizationId: ctx.organizationId,
          permissions: ctx.permissions,
          allowedSiteIds: ctx.allowedSiteIds,
          timezone: org.timezone,
          now,
        });
        const result = await getAiService().runToolLoop({
          feature: "assistant",
          promptVersion: ASSISTANT_PROMPT_VERSION,
          ctx: { organizationId: ctx.organizationId, membershipId: ctx.membership.id },
          inputRef: `assistant_thread:${thread.id}`,
          system: assistantSystemPrompt({
            garageName: org.name,
            today: formatDate(now, org.timezone),
          }),
          messages,
          tools: ASSISTANT_TOOLS,
          maxToolCalls: ASSISTANT_MAX_TOOL_CALLS,
          executeTool: execute,
          piiTokens: redaction.tokens,
          consoleReply: assistantConsoleReply,
        });

        let answer: AssistantAnswer;
        if (!result.ok) {
          answer = {
            text: `${result.reason} Consultez directement les rapports :`,
            links: REPORT_LINKS,
            actions: [],
            toolCalls: [],
            verifiedFallback: false,
            unavailable: true,
          };
        } else {
          const traces = result.toolResults.map((t) => ({
            name: t.call.name,
            input: t.call.input,
            result: t.result,
          }));
          const results = traces.map((t) => t.result);
          const { links, actions } = collectLinks(results);
          // RG-M17-20 : tout nombre de la réponse doit venir d'un résultat d'outil.
          const unverified = unverifiedNumbers(result.text, results);
          const replaced = unverified.length > 0;
          answer = {
            text: replaced ? formatToolTraces(traces) : result.text.trim(),
            links,
            actions,
            toolCalls: traces.map((t) => t.name),
            verifiedFallback: replaced,
            unavailable: false,
          };
        }

        await tx.aiAssistantMessage.create({
          data: {
            organizationId: ctx.organizationId,
            threadId: thread.id,
            role: "assistant",
            content: answer as unknown as Prisma.InputJsonValue,
            interactionId: result.interactionId,
          },
        });
        await tx.aiAssistantThread.update({ where: { id: thread.id }, data: { updatedAt: now } });
        return { ...answer, threadId: thread.id };
      }),

    threads: requirePermission("ai:use").query(async ({ ctx }) => {
      const tx = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      return tx.aiAssistantThread.findMany({
        where: { membershipId: ctx.membership.id, expiresAt: { gt: now } },
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: { id: true, title: true, updatedAt: true },
      });
    }),

    thread: requirePermission("ai:use")
      .input(z.object({ threadId: z.string() }))
      .query(async ({ ctx, input }) => {
        const tx = db.forTenant({ organizationId: ctx.organizationId });
        const thread = await ownThread(tx, input.threadId, ctx.membership.id, new Date());
        const messages = await tx.aiAssistantMessage.findMany({
          where: { threadId: thread.id, role: { in: ["user", "assistant"] } },
          orderBy: { createdAt: "asc" },
          select: { id: true, role: true, content: true, createdAt: true },
        });
        return {
          id: thread.id,
          title: thread.title,
          messages: messages.map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            createdAt: m.createdAt,
            ...(m.role === "user"
              ? { text: textOf(m.content), links: [], actions: [] }
              : (m.content as unknown as AssistantAnswer)),
          })),
        };
      }),

    deleteThread: requirePermission("ai:use")
      .input(z.object({ threadId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const tx = db.forTenant({ organizationId: ctx.organizationId });
        const thread = await ownThread(tx, input.threadId, ctx.membership.id, new Date());
        await tx.aiAssistantMessage.deleteMany({ where: { threadId: thread.id } });
        await tx.aiAssistantThread.delete({ where: { id: thread.id } });
        return { ok: true };
      }),
  }),
};
