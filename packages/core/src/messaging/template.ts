// RG-M11-03 : rendu des modèles de message (Handlebars, sans helpers personnalisés exécutables)

import Handlebars from "handlebars";
import { DomainError } from "../errors";
import { formatFCFA } from "../money/format";
import { formatDate as formatDateInTimeZone } from "../calendar";

export type RenderChannel = "WHATSAPP" | "SMS" | "EMAIL";

export interface RenderTemplateInput {
  template: string;
  context: Record<string, unknown>;
  channel: RenderChannel;
  /** Variables marquées optionnelles dans le catalogue (ex. "garage.horaires") : vides, elles ne bloquent pas l'envoi. */
  optionalVariables?: string[];
}

export interface RenderTemplateResult {
  body: string;
}

const PLAIN_VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
const HELPER_CALL_PATTERN = /\{\{\s*(formatMoney|formatDate|upper)\s+([a-zA-Z0-9_.]+)\s*\}\}/g;

const sharedHandlebars = Handlebars.create();
sharedHandlebars.registerHelper("formatMoney", (amount: unknown) => formatFCFA(Number(amount)));
sharedHandlebars.registerHelper(
  "formatDate",
  function formatDateHelper(
    this: Record<string, unknown>,
    date: unknown,
    options: Handlebars.HelperOptions,
  ) {
    const timeZone =
      (options.data?.root as { timeZone?: string } | undefined)?.timeZone ?? "Africa/Abidjan";
    return formatDateInTimeZone(date as Date, timeZone);
  },
);
sharedHandlebars.registerHelper("upper", (value: unknown) => String(value ?? "").toUpperCase());

function getPath(context: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, context);
}

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * Variable manquante ou vide → blocage (`TEMPLATE_VARIABLE_MISSING`) plutôt qu'un message avec un trou,
 * sauf variables marquées optionnelles. `noEscape` pour SMS/WhatsApp ; échappement HTML pour l'email.
 */
export function renderTemplate(input: RenderTemplateInput): RenderTemplateResult {
  const optional = new Set(input.optionalVariables ?? []);
  const referenced = new Set<string>();
  for (const match of input.template.matchAll(PLAIN_VARIABLE_PATTERN)) {
    referenced.add(match[1] as string);
  }
  for (const match of input.template.matchAll(HELPER_CALL_PATTERN)) {
    referenced.add(match[2] as string);
  }

  for (const path of referenced) {
    if (optional.has(path)) continue;
    const value = getPath(input.context, path);
    if (isEmptyValue(value)) {
      throw new DomainError(
        "messaging.template_variable_missing",
        `{{${path}}} vide : aucune information disponible pour cette variable.`,
        { variable: path },
      );
    }
  }

  const compiled = sharedHandlebars.compile(input.template, {
    noEscape: input.channel !== "EMAIL",
    strict: false,
  });
  return { body: compiled(input.context) };
}
