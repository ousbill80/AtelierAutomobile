// M17 — service IA unique (RG-M17-01) : activation et quotas (RG-M17-07/10), sorties
// structurées validées par Zod avec un seul nouvel essai (RG-M17-01), timeouts et
// disjoncteur (RG-M17-08), journal `AiInteraction` pour chaque appel (RG-M17-06), réinjection
// des données masquées (RG-M17-04). Les replis sans IA restent à la charge de l'appelant :
// un résultat `ok: false` porte toujours un statut et un motif lisible.
import {
  AI_TIMEOUT_MS,
  CLOSED_CIRCUIT,
  creditsFor,
  FAST_MODEL_FEATURES,
  gateAiCall,
  isCircuitOpen,
  recordCircuitFailure,
  recordCircuitSuccess,
  restorePiiDeep,
  systemClock,
  type AiFeature,
  type AiSettings,
  type CircuitState,
  type Clock,
  type PlanTierLike,
} from "@atelieros/core";
import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  AiProviderError,
  type AiCompletionRequest,
  type AiConsoleReply,
  type AiMessage,
  type AiProvider,
  type AiToolCall,
  type AiToolDef,
} from "./types";

export type AiInteractionStatus =
  "OK" | "INVALID_OUTPUT" | "TIMEOUT" | "ERROR" | "QUOTA_EXCEEDED" | "DISABLED";

export interface AiOrgContext {
  plan: PlanTierLike;
  settings: AiSettings;
  creditsUsedThisMonth: number;
  userCreditsToday: number;
}

export interface AiInteractionRecord {
  organizationId: string;
  feature: AiFeature;
  promptVersion: string;
  inputRef: string | null;
  output: unknown;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number | null;
  status: AiInteractionStatus;
  credits: number;
  model: string | null;
  createdById: string | null;
}

/** Persistance du service (implémentée par `@atelieros/db` : `createDbAiStore`). */
export interface AiStore {
  loadContext(
    organizationId: string,
    membershipId: string | null,
    now: Date,
  ): Promise<AiOrgContext>;
  logInteraction(record: AiInteractionRecord): Promise<string>;
}

export interface AiCallContext {
  organizationId: string;
  membershipId?: string | null;
}

interface AiBaseRun {
  feature: AiFeature;
  promptVersion: string;
  ctx: AiCallContext;
  /** Référence de l'entrée (ex. `message:msg_123`) — l'entrée brute n'est jamais stockée. */
  inputRef?: string;
  system: string;
  messages: AiMessage[];
  maxTokens?: number;
  /** Jetons de masquage à réinjecter dans la sortie (RG-M17-04). */
  piiTokens?: Record<string, string>;
  effort?: AiCompletionRequest["effort"];
}

export interface AiStructuredRun<T> extends AiBaseRun {
  schema: ZodType<T>;
  /** Fixture du fournisseur `console` : la sortie déterministe attendue. */
  consoleOutput: (request: AiCompletionRequest) => T;
}

export type AiRunResult<T> =
  | { ok: true; output: T; interactionId: string; credits: number; model: string }
  | { ok: false; status: AiInteractionStatus; reason: string; interactionId: string | null };

export interface AiToolLoopRun extends AiBaseRun {
  tools: AiToolDef[];
  /** Exécute un outil (lecture seule) ; une exception devient un `tool_result` en erreur. */
  executeTool: (call: AiToolCall) => Promise<unknown>;
  maxToolCalls: number;
  consoleReply: (request: AiCompletionRequest) => AiConsoleReply;
}

export type AiToolLoopResult =
  | {
      ok: true;
      text: string;
      toolResults: { call: AiToolCall; result: unknown }[];
      interactionId: string;
      credits: number;
    }
  | { ok: false; status: AiInteractionStatus; reason: string; interactionId: string | null };

export interface AiServiceDeps {
  provider: AiProvider;
  store: AiStore;
  clock?: Clock;
}

export const AI_UNAVAILABLE_REASON = "Assistant momentanément indisponible.";

/** Extrait le premier objet/tableau JSON d'une réponse texte (tolère un bloc ```json). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced ? fenced[1]! : text).trim();
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error("Aucun JSON dans la réponse.");
  const open = body[start]!;
  const end = body.lastIndexOf(open === "{" ? "}" : "]");
  if (end < start) throw new Error("JSON incomplet.");
  return JSON.parse(body.slice(start, end + 1));
}

function schemaInstruction(schema: ZodType<unknown>): string {
  const json = zodToJsonSchema(schema, { target: "jsonSchema7", $refStrategy: "none" });
  return `\n\nRéponds uniquement par un JSON valide conforme à ce schéma (aucun texte autour) :\n${JSON.stringify(json)}`;
}

export function createAiService(deps: AiServiceDeps) {
  const clock = deps.clock ?? systemClock;
  let circuit: CircuitState = CLOSED_CIRCUIT;

  async function gate(run: AiBaseRun, now: Date) {
    const context = await deps.store.loadContext(
      run.ctx.organizationId,
      run.ctx.membershipId ?? null,
      now,
    );
    const decision = gateAiCall({
      feature: run.feature,
      plan: context.plan,
      settings: context.settings,
      creditsUsedThisMonth: context.creditsUsedThisMonth,
      userCreditsToday: context.userCreditsToday,
    });
    if (!decision.allowed) return decision;
    if (isCircuitOpen(circuit, now)) {
      return { allowed: false as const, status: "ERROR" as const, reason: AI_UNAVAILABLE_REASON };
    }
    return decision;
  }

  async function log(
    run: AiBaseRun,
    partial: Partial<AiInteractionRecord> & { status: AiInteractionStatus },
  ) {
    return deps.store.logInteraction({
      organizationId: run.ctx.organizationId,
      feature: run.feature,
      promptVersion: run.promptVersion,
      inputRef: run.inputRef ?? null,
      output: partial.output ?? {},
      tokensIn: partial.tokensIn ?? null,
      tokensOut: partial.tokensOut ?? null,
      latencyMs: partial.latencyMs ?? null,
      status: partial.status,
      credits: partial.credits ?? 0,
      model: partial.model ?? null,
      createdById: run.ctx.membershipId ?? null,
    });
  }

  function modelFor(feature: AiFeature): string {
    return FAST_MODEL_FEATURES.has(feature) ? deps.provider.fastModel : deps.provider.model;
  }

  function failureOf(error: unknown): { status: AiInteractionStatus; reason: string } {
    if (error instanceof AiProviderError && error.kind === "TIMEOUT") {
      return { status: "TIMEOUT", reason: "Délai de réponse dépassé." };
    }
    return { status: "ERROR", reason: AI_UNAVAILABLE_REASON };
  }

  return {
    provider: deps.provider,

    /** Disponibilité pour l'affichage (bouton IA désactivé + info-bulle, §7). */
    async availability(ctx: AiCallContext, feature: AiFeature) {
      const decision = await gate(
        { feature, promptVersion: "-", ctx, system: "", messages: [] },
        clock.now(),
      );
      return decision.allowed
        ? { available: true as const }
        : { available: false as const, reason: decision.reason, status: decision.status };
    },

    async runStructured<T>(run: AiStructuredRun<T>): Promise<AiRunResult<T>> {
      const started = clock.now();
      const decision = await gate(run, started);
      if (!decision.allowed) {
        const interactionId = await log(run, { status: decision.status });
        return { ok: false, status: decision.status, reason: decision.reason, interactionId };
      }
      const model = modelFor(run.feature);
      const request: AiCompletionRequest = {
        feature: run.feature,
        model,
        system: run.system + schemaInstruction(run.schema as ZodType<unknown>),
        messages: run.messages,
        maxTokens: run.maxTokens ?? 2_000,
        timeoutMs: AI_TIMEOUT_MS[run.feature],
        effort: run.effort ?? (FAST_MODEL_FEATURES.has(run.feature) ? "low" : "medium"),
        consoleReply: (req) => ({ text: JSON.stringify(run.consoleOutput(req)) }),
      };
      let tokensIn = 0;
      let tokensOut = 0;
      let lastError = "";
      let lastText = "";
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await deps.provider.complete(request);
          tokensIn += response.tokensIn;
          tokensOut += response.tokensOut;
          lastText = response.text;
          if (response.stopReason === "refusal") {
            lastError = "Le modèle a refusé la demande.";
            break;
          }
          let parsed: ReturnType<typeof run.schema.safeParse>;
          try {
            parsed = run.schema.safeParse(extractJson(response.text));
          } catch (error) {
            parsed = {
              success: false,
              error: { message: error instanceof Error ? error.message : "JSON invalide" },
            } as never;
          }
          if (parsed.success) {
            circuit = recordCircuitSuccess(circuit, clock.now());
            const output = run.piiTokens
              ? restorePiiDeep(parsed.data, run.piiTokens)
              : (parsed.data as T);
            const credits = creditsFor(tokensIn, tokensOut);
            const interactionId = await log(run, {
              status: "OK",
              output,
              tokensIn,
              tokensOut,
              credits,
              model: response.model,
              latencyMs: clock.now().getTime() - started.getTime(),
            });
            return { ok: true, output, interactionId, credits, model: response.model };
          }
          lastError = parsed.error.message.slice(0, 500);
          // RG-M17-01 : un seul nouvel essai, avec le message d'erreur de validation.
          request.messages = [
            ...run.messages,
            { role: "assistant", content: response.text || "(vide)" },
            {
              role: "user",
              content: `Ta réponse ne respecte pas le schéma : ${lastError}. Renvoie uniquement le JSON corrigé.`,
            },
          ];
        }
      } catch (error) {
        circuit = recordCircuitFailure(circuit, clock.now());
        const failure = failureOf(error);
        const interactionId = await log(run, {
          status: failure.status,
          tokensIn: tokensIn || null,
          tokensOut: tokensOut || null,
          credits: tokensIn ? creditsFor(tokensIn, tokensOut) : 0,
          model,
          latencyMs: clock.now().getTime() - started.getTime(),
        });
        return { ok: false, ...failure, interactionId };
      }
      const interactionId = await log(run, {
        status: "INVALID_OUTPUT",
        output: { error: lastError, raw: lastText.slice(0, 2_000) },
        tokensIn,
        tokensOut,
        credits: creditsFor(tokensIn, tokensOut),
        model,
        latencyMs: clock.now().getTime() - started.getTime(),
      });
      return {
        ok: false,
        status: "INVALID_OUTPUT",
        reason: "Réponse de l'assistant inutilisable.",
        interactionId,
      };
    },

    /**
     * RG-M17-20 — boucle d'outils (lecture seule) : au plus `maxToolCalls` appels d'outils,
     * puis réponse finale en texte. Un seul `AiInteraction` pour toute la question.
     */
    async runToolLoop(run: AiToolLoopRun): Promise<AiToolLoopResult> {
      const started = clock.now();
      const decision = await gate(run, started);
      if (!decision.allowed) {
        const interactionId = await log(run, { status: decision.status });
        return { ok: false, status: decision.status, reason: decision.reason, interactionId };
      }
      const model = modelFor(run.feature);
      const messages: AiMessage[] = [...run.messages];
      const toolResults: { call: AiToolCall; result: unknown }[] = [];
      let tokensIn = 0;
      let tokensOut = 0;
      try {
        for (let turn = 0; turn <= run.maxToolCalls; turn++) {
          const exhausted = toolResults.length >= run.maxToolCalls;
          const response = await deps.provider.complete({
            feature: run.feature,
            model,
            system: run.system,
            messages,
            tools: exhausted ? undefined : run.tools,
            maxTokens: run.maxTokens ?? 4_000,
            timeoutMs: AI_TIMEOUT_MS[run.feature],
            effort: run.effort ?? "medium",
            consoleReply: run.consoleReply,
          });
          tokensIn += response.tokensIn;
          tokensOut += response.tokensOut;
          if (!response.toolCalls.length || exhausted) {
            circuit = recordCircuitSuccess(circuit, clock.now());
            const text = run.piiTokens
              ? restorePiiDeep(response.text, run.piiTokens)
              : response.text;
            const credits = creditsFor(tokensIn, tokensOut);
            const interactionId = await log(run, {
              status: "OK",
              output: { text, toolCalls: toolResults.map((t) => t.call.name) },
              tokensIn,
              tokensOut,
              credits,
              model: response.model,
              latencyMs: clock.now().getTime() - started.getTime(),
            });
            return { ok: true, text, toolResults, interactionId, credits };
          }
          messages.push({
            role: "assistant",
            content: [
              ...(response.text ? [{ type: "text" as const, text: response.text }] : []),
              ...response.toolCalls.map((c) => ({
                type: "tool_use" as const,
                id: c.id,
                name: c.name,
                input: c.input,
              })),
            ],
          });
          const results = [];
          for (const call of response.toolCalls.slice(0, run.maxToolCalls - toolResults.length)) {
            try {
              const result = await run.executeTool(call);
              toolResults.push({ call, result });
              results.push({
                type: "tool_result" as const,
                toolUseId: call.id,
                content: JSON.stringify(result),
              });
            } catch (error) {
              results.push({
                type: "tool_result" as const,
                toolUseId: call.id,
                content: error instanceof Error ? error.message : "Erreur",
                isError: true,
              });
            }
          }
          // Appels au-delà du plafond : résultat en erreur (chaque tool_use exige son résultat).
          for (const call of response.toolCalls.slice(results.length)) {
            results.push({
              type: "tool_result" as const,
              toolUseId: call.id,
              content: "Limite d'appels d'outils atteinte.",
              isError: true,
            });
          }
          messages.push({ role: "user", content: results });
        }
        throw new AiProviderError("ERROR", "Boucle d'outils non terminée.");
      } catch (error) {
        circuit = recordCircuitFailure(circuit, clock.now());
        const failure = failureOf(error);
        const interactionId = await log(run, {
          status: failure.status,
          tokensIn: tokensIn || null,
          tokensOut: tokensOut || null,
          credits: tokensIn ? creditsFor(tokensIn, tokensOut) : 0,
          model,
          latencyMs: clock.now().getTime() - started.getTime(),
        });
        return { ok: false, ...failure, interactionId };
      }
    },
  };
}

export type AiService = ReturnType<typeof createAiService>;

/**
 * Sélection du fournisseur (RG-M17-01) : `AI_PROVIDER=console|claude` ; à défaut Claude si
 * `ANTHROPIC_API_KEY` est renseignée, sinon `console`. Aucun test ni `pnpm dev` n'exige de clé.
 */
export function resolveAiProviderFromEnv(
  env: Record<string, string | undefined>,
  factories: {
    claude: (opts: { apiKey: string; model?: string; fastModel?: string }) => AiProvider;
    console: () => AiProvider;
  },
): AiProvider {
  const wanted = env.AI_PROVIDER ?? (env.ANTHROPIC_API_KEY ? "claude" : "console");
  if (wanted === "claude" && env.ANTHROPIC_API_KEY) {
    return factories.claude({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.AI_MODEL || undefined,
      fastModel: env.AI_MODEL_FAST || undefined,
    });
  }
  return factories.console();
}
