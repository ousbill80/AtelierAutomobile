import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_AI_SETTINGS, fixedClock, type AiSettings } from "@atelieros/core";
import { createConsoleAiProvider } from "./console";
import {
  createAiService,
  extractJson,
  resolveAiProviderFromEnv,
  type AiInteractionRecord,
} from "./service";
import { AiProviderError, type AiProvider } from "./types";

function memoryStore(
  context: Partial<{ settings: AiSettings; credits: number; plan: "STARTER" | "PRO" }> = {},
) {
  const logs: AiInteractionRecord[] = [];
  return {
    logs,
    store: {
      async loadContext() {
        return {
          plan: context.plan ?? "PRO",
          settings: context.settings ?? DEFAULT_AI_SETTINGS,
          creditsUsedThisMonth: context.credits ?? 0,
          userCreditsToday: 0,
        };
      },
      async logInteraction(record: AiInteractionRecord) {
        logs.push(record);
        return `int_${logs.length}`;
      },
    },
  };
}

const schema = z.object({ intent: z.enum(["A", "B"]), confidence: z.number() });
const ctx = { organizationId: "org_1", membershipId: "mem_1" };
const clock = fixedClock(new Date("2026-10-20T10:00:00Z"));

function run(
  service: ReturnType<typeof createAiService>,
  output: unknown = { intent: "A", confidence: 0.9 },
) {
  return service.runStructured({
    feature: "intent_classification",
    promptVersion: "v1",
    ctx,
    inputRef: "message:msg_1",
    system: "Classe.",
    messages: [{ role: "user", content: "oui" }],
    schema,
    consoleOutput: () => output as z.infer<typeof schema>,
  });
}

describe("service IA (RG-M17-01/06/07/08)", () => {
  it("sortie valide → OK, crédits et journal (sans l'entrée brute)", async () => {
    const { store, logs } = memoryStore();
    const service = createAiService({ provider: createConsoleAiProvider(), store, clock });
    const result = await run(service);
    expect(result).toMatchObject({ ok: true, output: { intent: "A" }, interactionId: "int_1" });
    expect(logs[0]).toMatchObject({
      feature: "intent_classification",
      promptVersion: "v1",
      inputRef: "message:msg_1",
      status: "OK",
      model: "console",
      createdById: "mem_1",
    });
    expect(logs[0]!.credits).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(logs[0])).not.toContain('"oui"');
  });

  it("sortie invalide → 1 nouvel essai avec l'erreur, puis INVALID_OUTPUT", async () => {
    const { store, logs } = memoryStore();
    const calls: string[] = [];
    const provider: AiProvider = {
      name: "test",
      model: "m",
      fastModel: "m",
      async complete(request) {
        calls.push(JSON.stringify(request.messages));
        return {
          text: calls.length === 1 ? '{"intent":"Z"}' : '{"intent":"Z","confidence":1}',
          toolCalls: [],
          stopReason: "end_turn",
          tokensIn: 100,
          tokensOut: 10,
          model: "m",
        };
      },
    };
    const service = createAiService({ provider, store, clock });
    const result = await run(service);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("ne respecte pas le schéma");
    expect(result).toMatchObject({ ok: false, status: "INVALID_OUTPUT" });
    expect(logs[0]).toMatchObject({ status: "INVALID_OUTPUT", tokensIn: 200 });
  });

  it("le second essai valide est accepté", async () => {
    const { store } = memoryStore();
    let n = 0;
    const provider: AiProvider = {
      name: "test",
      model: "m",
      fastModel: "m",
      async complete() {
        n++;
        return {
          text: n === 1 ? "pas du json" : 'Voici : ```json\n{"intent":"B","confidence":0.7}\n```',
          toolCalls: [],
          stopReason: "end_turn",
          tokensIn: 10,
          tokensOut: 10,
          model: "m",
        };
      },
    };
    const result = await run(createAiService({ provider, store, clock }));
    expect(result).toMatchObject({ ok: true, output: { intent: "B" } });
  });

  it("quota atteint → QUOTA_EXCEEDED journalisé, aucun appel au modèle", async () => {
    const { store, logs } = memoryStore({ credits: 3_000 });
    const provider = createConsoleAiProvider({ fail: "ERROR" });
    const result = await run(createAiService({ provider, store, clock }));
    expect(result).toMatchObject({
      ok: false,
      status: "QUOTA_EXCEEDED",
      reason: "Quota IA du mois atteint.",
    });
    expect(logs[0]).toMatchObject({ status: "QUOTA_EXCEEDED", credits: 0 });
  });

  it("fonction désactivée → DISABLED", async () => {
    const { store } = memoryStore({ settings: { ...DEFAULT_AI_SETTINGS, enabled: false } });
    const result = await run(
      createAiService({ provider: createConsoleAiProvider(), store, clock }),
    );
    expect(result).toMatchObject({ ok: false, status: "DISABLED" });
  });

  it("timeout → TIMEOUT ; 5 erreurs en 1 min ouvrent le disjoncteur", async () => {
    const { store, logs } = memoryStore();
    const timeout = await run(
      createAiService({ provider: createConsoleAiProvider({ fail: "TIMEOUT" }), store, clock }),
    );
    expect(timeout).toMatchObject({ ok: false, status: "TIMEOUT" });

    let calls = 0;
    const failing: AiProvider = {
      name: "f",
      model: "m",
      fastModel: "m",
      async complete() {
        calls++;
        throw new AiProviderError("ERROR", "boom");
      },
    };
    const service = createAiService({ provider: failing, store, clock });
    for (let i = 0; i < 5; i++) await run(service);
    expect(calls).toBe(5);
    const blocked = await run(service);
    expect(calls).toBe(5);
    expect(blocked).toMatchObject({
      ok: false,
      status: "ERROR",
      reason: "Assistant momentanément indisponible.",
    });
    expect(logs.at(-1)!.status).toBe("ERROR");
  });

  it("réinjecte les données masquées dans la sortie", async () => {
    const { store } = memoryStore();
    const service = createAiService({ provider: createConsoleAiProvider(), store, clock });
    const result = await service.runStructured({
      feature: "reply_draft",
      promptVersion: "v1",
      ctx,
      system: "",
      messages: [{ role: "user", content: "x" }],
      schema: z.object({ body: z.string() }),
      piiTokens: { "[TEL_1]": "+2250701020304" },
      consoleOutput: () => ({ body: "Appelez le [TEL_1]" }),
    });
    expect(result).toMatchObject({ ok: true, output: { body: "Appelez le +2250701020304" } });
  });

  it("boucle d'outils : exécute les outils, plafonne les appels, un seul journal", async () => {
    const { store, logs } = memoryStore();
    const service = createAiService({ provider: createConsoleAiProvider(), store, clock });
    const executed: string[] = [];
    const result = await service.runToolLoop({
      feature: "assistant",
      promptVersion: "v1",
      ctx,
      system: "",
      messages: [{ role: "user", content: "combien me doit SOTRA ?" }],
      tools: [{ name: "search_customers", description: "", inputSchema: { type: "object" } }],
      maxToolCalls: 2,
      executeTool: async (call) => {
        executed.push(call.name);
        return { balance: 1240000 };
      },
      consoleReply: (request) => {
        const toolTurns = request.messages.filter((m) => m.role === "assistant").length;
        return request.tools && toolTurns < 5
          ? { toolCalls: [{ id: `t${toolTurns}`, name: "search_customers", input: {} }] }
          : { text: "SOTRA vous doit 1 240 000 FCFA." };
      },
    });
    expect(executed).toEqual(["search_customers", "search_customers"]);
    expect(result).toMatchObject({ ok: true, text: "SOTRA vous doit 1 240 000 FCFA." });
    expect(logs).toHaveLength(1);
  });

  it("extractJson et sélection du fournisseur sans clé", () => {
    expect(extractJson('texte {"a":1} fin')).toEqual({ a: 1 });
    expect(() => extractJson("rien")).toThrow();
    const pick = (env: Record<string, string | undefined>) =>
      resolveAiProviderFromEnv(env, {
        claude: () => ({ ...createConsoleAiProvider(), name: "claude" }),
        console: () => createConsoleAiProvider(),
      }).name;
    expect(pick({})).toBe("console");
    expect(pick({ ANTHROPIC_API_KEY: "k" })).toBe("claude");
    expect(pick({ ANTHROPIC_API_KEY: "k", AI_PROVIDER: "console" })).toBe("console");
    expect(pick({ AI_PROVIDER: "claude" })).toBe("console");
  });
});
