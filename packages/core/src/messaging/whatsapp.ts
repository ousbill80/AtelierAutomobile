// RG-M11-12 : conversion des variables {{client.salutation}} en paramètres positionnels {{1}}, {{2}}…

export interface ToWhatsappParamsResult {
  body: string; // gabarit avec {{1}}, {{2}}…
  paramMap: string[]; // ordre d'apparition des variables d'origine
}

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function toWhatsappParams(body: string): ToWhatsappParamsResult {
  const paramMap: string[] = [];
  let index = 0;
  const converted = body.replace(VARIABLE_PATTERN, (_match, variableName: string) => {
    index += 1;
    paramMap.push(variableName);
    return `{{${index}}}`;
  });
  return { body: converted, paramMap };
}

/** Nom du modèle Meta : `{orgSlug}_{key}_v{n}` (minuscules, `_`). */
export function whatsappTemplateName(orgSlug: string, key: string, version: number): string {
  const slug = `${orgSlug}_${key}_v${version}`.toLowerCase();
  return slug.replace(/[^a-z0-9_]+/g, "_");
}
