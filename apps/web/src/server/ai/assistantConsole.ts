// M17 RG-M17-01 — fixture déterministe de l'assistant pour le fournisseur `console` (local et
// tests, sans clé) : routage par mots-clés vers les outils, puis réponse française rédigée à
// partir des résultats d'outils présents dans l'historique — exactement comme le modèle doit
// le faire (chiffres repris des champs `…Label`, jamais calculés). Sert aussi de mise en forme
// « données brutes » quand une réponse du modèle cite un chiffre non justifié (RG-M17-20).
import {
  ASSISTANT_DENIED_TEXT,
  ASSISTANT_NOT_FOUND_CUSTOMER_TEXT,
  type AiCompletionRequest,
  type AiConsoleReply,
  type AiMessage,
  type AiToolCall,
} from "@atelieros/integrations";

export interface ToolTrace {
  name: string;
  input: unknown;
  result: unknown;
}

function fold(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "'");
}

/** Dernière question (texte) et outils déjà appelés depuis, avec leurs résultats. */
function readTurn(messages: AiMessage[]): { question: string; traces: ToolTrace[] } {
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "user" && typeof m.content === "string") {
      start = i;
      break;
    }
  }
  const question = messages[start]?.content as string;
  const calls = new Map<string, AiToolCall>();
  const traces: ToolTrace[] = [];
  for (const m of messages.slice(start + 1)) {
    if (typeof m.content === "string") continue;
    for (const block of m.content) {
      if (block.type === "tool_use") calls.set(block.id, block);
      if (block.type === "tool_result") {
        const call = calls.get(block.toolUseId);
        let result: unknown = block.content;
        try {
          result = JSON.parse(block.content);
        } catch {
          // résultat texte (erreur) : gardé tel quel
        }
        if (call) traces.push({ name: call.name, input: call.input, result });
      }
    }
  }
  return { question: question ?? "", traces };
}

let callSeq = 0;
const call = (name: string, input: Record<string, unknown>): AiConsoleReply => ({
  toolCalls: [{ id: `console_${++callSeq}`, name, input }],
});

type Plan =
  | { kind: "balance"; name: string }
  | { kind: "action"; name: string | null }
  | { kind: "tool"; name: string; input: Record<string, unknown> }
  | { kind: "off_topic" };

function planFor(question: string): Plan {
  const q = fold(question);
  const action = /^(relance[rz]?|envoie[rz]?|cree[rz]?|facture[rz]?|annule[rz]?)\b\s*(.*)$/.exec(
    q.trim(),
  );
  if (action) {
    const name = question
      .trim()
      .split(/\s+/)
      .slice(1)
      .join(" ")
      .replace(/[?.!]+$/, "");
    return { kind: "action", name: name || null };
  }
  const owes = /combien (?:me |nous )?doit\s+(.+?)\s*\??$/.exec(
    question.trim().replace(/[’']/g, "'"),
  );
  if (owes && !/\ble plus\b/.test(q)) return { kind: "balance", name: owes[1]! };
  if (/qui (me |nous )?doit|plus gros|impayes|creances/.test(q)) {
    return { kind: "tool", name: "list_receivables", input: { limit: 5 } };
  }
  if (/\b(vt|visite technique|revision|vidange)\b/.test(q)) {
    const period = /semaine/.test(q) ? "week" : /mois prochain/.test(q) ? "next_month" : "month";
    return {
      kind: "tool",
      name: "list_vehicle_due_dates",
      input: { kind: /revision|vidange/.test(q) ? "SERVICE" : "VT", period },
    };
  }
  if (/\b(ca|chiffre d'affaires?)\b/.test(q)) {
    const period = /hier/.test(q)
      ? "yesterday"
      : /aujourd'?hui/.test(q)
        ? "today"
        : /mois (dernier|precedent)/.test(q)
          ? "prev_month"
          : "month";
    return { kind: "tool", name: "get_kpi", input: { metric: "revenue", period } };
  }
  if (/\bstock\b/.test(q)) {
    const query = q
      .replace(/.*\bstock\b\s*(de |d'|des |du )?/, "")
      .replace(/[?.!]/g, "")
      .trim();
    return { kind: "tool", name: "get_stock", input: { query: query || "huile" } };
  }
  if (/\b(rdv|rendez[- ]vous)\b/.test(q)) {
    return {
      kind: "tool",
      name: "list_appointments",
      input: { date: /demain/.test(q) ? "tomorrow" : "today" },
    };
  }
  if (/\b(or|ordres?|vehicules? (en cours|a l'atelier))\b/.test(q)) {
    return { kind: "tool", name: "list_repair_orders", input: {} };
  }
  if (/\brelances?\b/.test(q)) {
    return { kind: "tool", name: "list_reminders", input: { status: "NEEDS_APPROVAL" } };
  }
  return { kind: "off_topic" };
}

const isDenied = (r: unknown) => !!r && typeof r === "object" && (r as { denied?: boolean }).denied;

export function assistantConsoleReply(request: AiCompletionRequest): AiConsoleReply {
  const { question, traces } = readTurn(request.messages);
  const plan = planFor(question);
  if (traces.some((t) => isDenied(t.result))) return { text: ASSISTANT_DENIED_TEXT };

  switch (plan.kind) {
    case "off_topic":
      return {
        text: "Je vous aide uniquement pour la gestion du garage : clients, créances, rendez-vous, atelier, stock et relances.",
      };
    case "balance": {
      const search = traces.find((t) => t.name === "search_customers");
      if (!search) return call("search_customers", { query: plan.name });
      const found = (search.result as { customers?: { id: string }[] }).customers ?? [];
      if (!found.length) return { text: ASSISTANT_NOT_FOUND_CUSTOMER_TEXT };
      const balance = traces.find((t) => t.name === "get_customer_balance");
      if (!balance) return call("get_customer_balance", { customerId: found[0]!.id });
      return { text: formatToolTraces([balance]) };
    }
    case "action": {
      const search = traces.find((t) => t.name === "search_customers");
      if (plan.name && !search) return call("search_customers", { query: plan.name });
      const proposal = traces.find((t) => t.name === "propose_action");
      const customerId = (search?.result as { customers?: { id: string }[] } | undefined)
        ?.customers?.[0]?.id;
      if (plan.name && !customerId) return { text: ASSISTANT_NOT_FOUND_CUSTOMER_TEXT };
      if (!proposal) {
        return call("propose_action", {
          kind: "remind_customer",
          ...(customerId ? { customerId } : {}),
        });
      }
      return {
        text: "Je ne peux rien modifier ni envoyer moi-même. Utilisez le bouton ci-dessous pour ouvrir l'écran concerné et valider l'action.",
      };
    }
    case "tool": {
      const done = traces.find((t) => t.name === plan.name);
      if (!done) return call(plan.name, plan.input);
      return { text: formatToolTraces([done]) };
    }
  }
}

// ── Mise en forme française des résultats (sans aucun calcul de chiffre) ──

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function formatOne(trace: ToolTrace): string {
  const r = (trace.result ?? {}) as Row;
  if (isDenied(r)) return ASSISTANT_DENIED_TEXT;
  if (r.notFound) return ASSISTANT_NOT_FOUND_CUSTOMER_TEXT;
  if (r.error) return `Information indisponible (${str(r.error)}).`;
  switch (trace.name) {
    case "get_customer_balance": {
      const customer = (r.customer as Row | undefined)?.name;
      if (!r.openInvoicesCount) return `${str(customer)} n'a aucune facture ouverte.`;
      const oldest = r.oldestInvoice as Row | null;
      let text = `${str(customer)} vous doit ${str(r.balanceLabel)} sur ${str(r.openInvoicesCount)} facture(s)`;
      if (oldest) {
        text += ` ; la plus ancienne (${str(oldest.number)}, ${str(oldest.amountLabel)}) a ${str(oldest.daysOverdue)} jour(s) de retard`;
      }
      text += ".";
      if (r.lastReminderDate) text += ` Dernière relance le ${str(r.lastReminderDate)}.`;
      return text;
    }
    case "search_customers": {
      const list = (r.customers as Row[]) ?? [];
      if (!list.length) return ASSISTANT_NOT_FOUND_CUSTOMER_TEXT;
      return `Clients trouvés : ${list.map((c) => `${str(c.name)}${c.balanceLabel ? ` (${str(c.balanceLabel)})` : ""}`).join(" ; ")}.`;
    }
    case "list_receivables": {
      const list = (r.customers as Row[]) ?? [];
      if (!list.length) return "Aucune créance ouverte.";
      return `Créances ouvertes : ${str(r.totalLabel)} au total. ${list
        .map((c) => `${str(c.name)} : ${str(c.amountLabel)}`)
        .join(" ; ")}.`;
    }
    case "list_vehicle_due_dates": {
      const list = (r.vehicles as Row[]) ?? [];
      const what = r.kind === "VT" ? "visite technique" : "révision";
      if (!r.count) return `Aucun véhicule n'a sa ${what} du ${str(r.from)} au ${str(r.to)}.`;
      return `Échéances de ${what} du ${str(r.from)} au ${str(r.to)} : ${str(r.count)} véhicule(s). ${list
        .map((v) => `${str(v.plate)} (${str(v.customer)}, ${str(v.dueDate)})`)
        .join(" ; ")}.`;
    }
    case "get_kpi":
      return `${str(r.label)} : ${str(r.valueLabel)}.`;
    case "list_repair_orders": {
      const list = (r.repairOrders as Row[]) ?? [];
      if (!r.count) return "Aucun ordre de réparation en cours.";
      return `Ordres de réparation : ${str(r.count)}. ${list
        .map((o) => `${str(o.number)} (${str(o.plate)}, ${str(o.customer)})`)
        .join(" ; ")}.`;
    }
    case "list_appointments": {
      const list = (r.appointments as Row[]) ?? [];
      if (!r.count) return `Aucun rendez-vous le ${str(r.date)}.`;
      return `Rendez-vous du ${str(r.date)} : ${str(r.count)}. ${list
        .map((a) => `${str(a.time)} ${str(a.customer)}${a.plate ? ` (${str(a.plate)})` : ""}`)
        .join(" ; ")}.`;
    }
    case "get_stock": {
      const list = (r.products as Row[]) ?? [];
      if (!list.length) return "Aucun produit ne correspond.";
      return list
        .map((p) => {
          const levels = ((p.levels as Row[]) ?? [])
            .map((l) => `${str(l.site)} : ${str(l.available)} disponible(s)`)
            .join(", ");
          return `${str(p.name)} — ${levels || "pas de stock"}`;
        })
        .join(" ; ");
    }
    case "list_reminders": {
      const list = (r.reminders as Row[]) ?? [];
      if (!r.count) return "Aucune relance dans ce statut.";
      return `Relances : ${str(r.count)}. ${list.map((m) => `${str(m.customer)} (${str(m.step)})`).join(" ; ")}.`;
    }
    case "propose_action":
      return "Utilisez le bouton proposé pour faire l'action vous-même.";
    default:
      return "";
  }
}

/** Réponse construite uniquement à partir des données des outils (repli RG-M17-20). */
export function formatToolTraces(traces: readonly ToolTrace[]): string {
  const parts = traces.map(formatOne).filter(Boolean);
  // Une seule fois le refus, même si plusieurs outils l'ont renvoyé.
  return [...new Set(parts)].join("\n") || "Je n'ai trouvé aucune donnée pour répondre.";
}
