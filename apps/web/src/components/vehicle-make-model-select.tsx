"use client";

import { useId, useMemo } from "react";
import {
  getCiPopularMakes,
  getCiVehicleMakes,
  getCiVehicleModels,
} from "@atelieros/core/src/vehicles/ci-catalog";
import { Field } from "@atelieros/ui";
import { trpc } from "@/trpc/react";

export interface VehicleMakeModelSelectProps {
  make: string;
  model: string;
  onMakeChange: (make: string) => void;
  onModelChange: (model: string) => void;
  required?: boolean;
  makeLabel?: string;
  modelLabel?: string;
}

/**
 * Composant intelligent de saisie Marque & Modèle adapté au parc ivoirien :
 * - Datalist & suggestions préchargées avec les 30 marques et 230+ modèles les plus fréquents en Côte d'Ivoire
 * - Complétion via le catalogue serveur tRPC (marques globales + marques créées localement)
 * - Auto-création transparente si l'utilisateur saisit une marque ou un modèle non répertorié
 */
export function VehicleMakeModelSelect({
  make,
  model,
  onMakeChange,
  onModelChange,
  required = false,
  makeLabel = "Marque",
  modelLabel = "Modèle",
}: VehicleMakeModelSelectProps) {
  const makeId = useId();
  const modelId = useId();

  // Requête tRPC catalogue marques
  const makesQuery = trpc.catalog.makes.useQuery({}, { staleTime: 60_000 });
  const serverMakes = makesQuery.data?.map((m) => m.name) ?? [];

  // Fusion des marques locales CI avec les marques du serveur
  const allMakes = useMemo(() => {
    const defaultMakes = getCiVehicleMakes();
    const set = new Set([...defaultMakes, ...serverMakes]);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
  }, [serverMakes]);

  const popularMakes = useMemo(() => getCiPopularMakes(), []);

  // Modèles pour la marque actuelle
  const matchingMakeRecord = makesQuery.data?.find(
    (m) => m.name.toLowerCase() === make.trim().toLowerCase(),
  );

  const modelsQuery = trpc.catalog.models.useQuery(
    { makeId: matchingMakeRecord?.id ?? "" },
    { enabled: Boolean(matchingMakeRecord?.id), staleTime: 60_000 },
  );

  const availableModels = useMemo(() => {
    const localModels = getCiVehicleModels(make);
    const serverModels = modelsQuery.data?.map((m) => m.name) ?? [];
    const set = new Set([...localModels, ...serverModels]);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
  }, [make, modelsQuery.data]);

  const isCustomMake = Boolean(
    make.trim() && !allMakes.some((m) => m.toLowerCase() === make.trim().toLowerCase()),
  );
  const isCustomModel = Boolean(
    model.trim() && !availableModels.some((m) => m.toLowerCase() === model.trim().toLowerCase()),
  );

  return (
    <>
      {/* Champ Marque */}
      <Field
        label={makeLabel}
        required={required}
        htmlFor={makeId}
        hint={
          isCustomMake
            ? "✨ Nouvelle marque (sera ajoutée à votre catalogue)"
            : "Suggestions des marques les plus courantes en Côte d'Ivoire"
        }
      >
        <div className="relative w-full">
          <input
            id={makeId}
            type="text"
            list={`makes-list-${makeId}`}
            autoComplete="off"
            placeholder="Ex: Toyota, Peugeot, Hyundai…"
            value={make}
            required={required}
            onChange={(e) => {
              onMakeChange(e.target.value);
            }}
            className="input pr-20 font-medium"
          />

          <datalist id={`makes-list-${makeId}`}>
            {popularMakes.map((m) => (
              <option key={m} value={m}>
                {m} (Courant en Côte d&apos;Ivoire)
              </option>
            ))}
            {allMakes
              .filter((m) => !popularMakes.includes(m))
              .map((m) => (
                <option key={m} value={m} />
              ))}
          </datalist>

          {isCustomMake && (
            <div className="pointer-events-none absolute right-2.5 top-0 bottom-0 flex items-center">
              <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-bold text-accent">
                Nouveau
              </span>
            </div>
          )}
        </div>
      </Field>

      {/* Champ Modèle */}
      <Field
        label={modelLabel}
        required={required}
        htmlFor={modelId}
        hint={
          isCustomModel
            ? "✨ Nouveau modèle (sera ajouté à votre catalogue)"
            : make.trim() && availableModels.length > 0
              ? `${availableModels.length} modèle(s) répertorié(s) pour ${make}`
              : "Saisissez ou choisissez un modèle"
        }
      >
        <div className="relative w-full">
          <input
            id={modelId}
            type="text"
            list={`models-list-${modelId}`}
            autoComplete="off"
            placeholder={
              make.trim()
                ? `Ex: ${availableModels[0] ?? "Modèle"}…`
                : "Choisissez d'abord une marque"
            }
            value={model}
            required={required}
            onChange={(e) => onModelChange(e.target.value)}
            className="input pr-20 font-medium"
          />

          <datalist id={`models-list-${modelId}`}>
            {availableModels.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>

          {isCustomModel && (
            <div className="pointer-events-none absolute right-2.5 top-0 bottom-0 flex items-center">
              <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-bold text-accent">
                Nouveau
              </span>
            </div>
          )}
        </div>
      </Field>
    </>
  );
}
