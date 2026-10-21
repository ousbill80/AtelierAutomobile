"use client";

import type { MouseEvent } from "react";

export type BodyView = "TOP" | "FRONT" | "REAR" | "LEFT" | "RIGHT" | "INTERIOR";
export type BodyType = "SEDAN" | "SUV" | "PICKUP" | "HATCHBACK" | "VAN" | "MINIBUS" | "TRUCK";

export interface BodyDiagramMarker {
  n: number;
  view: BodyView;
  x: number;
  y: number;
}

export interface BodyDiagramProps {
  bodyType: BodyType;
  markers: BodyDiagramMarker[];
  viewLabels: Record<BodyView, string>;
  /** Absent = lecture seule. Coordonnées relatives 0-1. */
  onAdd?: (view: BodyView, x: number, y: number) => void;
}

export const VIEWS: BodyView[] = ["FRONT", "REAR", "LEFT", "RIGHT", "TOP", "INTERIOR"];

/** Clés de zones suggérées par vue (libellés dans `fr.json`). */
export const VIEW_ZONE_KEYS: Record<BodyView, readonly string[]> = {
  FRONT: ["bumper", "grille", "hood", "lightL", "lightR", "fog", "windshield"],
  REAR: ["bumper", "trunk", "lightL", "lightR", "window", "exhaust", "hitch"],
  LEFT: [
    "fenderFront",
    "doorFront",
    "doorRear",
    "fenderRear",
    "mirror",
    "sill",
    "wheelFront",
    "wheelRear",
  ],
  RIGHT: [
    "fenderFront",
    "doorFront",
    "doorRear",
    "fenderRear",
    "mirror",
    "sill",
    "fuelFlap",
    "wheelFront",
    "wheelRear",
  ],
  TOP: ["roof", "sunroof", "roofBars", "hoodTop", "trunkTop"],
  INTERIOR: [
    "seatDriver",
    "seatPassenger",
    "rearBench",
    "dashboard",
    "steering",
    "console",
    "gear",
    "headliner",
    "doorTrim",
    "carpet",
  ],
};

/** Hauteur relative de la caisse selon la silhouette (vue de côté). */
const SIDE_HEIGHT: Record<BodyType, number> = {
  SEDAN: 0.42,
  HATCHBACK: 0.48,
  SUV: 0.58,
  PICKUP: 0.52,
  VAN: 0.68,
  MINIBUS: 0.72,
  TRUCK: 0.75,
};

function Silhouette({ view, bodyType }: { view: BodyView; bodyType: BodyType }) {
  const h = SIDE_HEIGHT[bodyType];
  if (view === "LEFT" || view === "RIGHT") {
    const top = 100 - h * 100;
    const cabin = bodyType === "PICKUP" ? "M60 " : "M45 ";
    return (
      <g fill="none" stroke="currentColor" strokeWidth={2}>
        <rect x={10} y={top + 25} width={180} height={100 - top - 35} rx={12} />
        <path
          d={`${cabin}${top + 25} L70 ${top} L${bodyType === "PICKUP" ? 120 : 150} ${top} L170 ${top + 25}`}
        />
        <circle cx={50} cy={92} r={12} />
        <circle cx={150} cy={92} r={12} />
      </g>
    );
  }
  if (view === "TOP") {
    return (
      <g fill="none" stroke="currentColor" strokeWidth={2}>
        <rect x={10} y={15} width={180} height={70} rx={20} />
        <rect x={60} y={22} width={80} height={56} rx={10} />
      </g>
    );
  }
  if (view === "INTERIOR") {
    return (
      <g fill="none" stroke="currentColor" strokeWidth={2}>
        <rect x={25} y={16} width={150} height={78} rx={14} />
        <rect x={32} y={20} width={28} height={70} rx={4} />
        <circle cx={46} cy={38} r={8} />
        <rect x={70} y={26} width={26} height={24} rx={5} />
        <rect x={70} y={60} width={26} height={24} rx={5} />
        <rect x={124} y={24} width={34} height={62} rx={6} />
      </g>
    );
  }
  return (
    <g fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x={45} y={100 - h * 100 + 10} width={110} height={h * 100 - 20} rx={14} />
      <rect x={60} y={100 - h * 100 + 16} width={80} height={(h * 100 - 20) / 2.5} rx={6} />
      <circle cx={70} cy={80} r={6} />
      <circle cx={130} cy={80} r={6} />
    </g>
  );
}

/** M04 US-M04-02 — schéma de carrosserie et habitacle tactile (6 vues), repères numérotés. */
export function BodyDiagram({ bodyType, markers, viewLabels, onAdd }: BodyDiagramProps) {
  const handleClick = (view: BodyView) => (event: MouseEvent<SVGSVGElement>) => {
    if (!onAdd) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    onAdd(view, Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000);
  };
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {VIEWS.map((view) => (
        <figure
          key={view}
          className="flex flex-col items-center gap-1 rounded-md border border-border bg-surface p-1"
        >
          <svg
            viewBox="0 0 200 110"
            role={onAdd ? "button" : "img"}
            aria-label={viewLabels[view]}
            data-view={view}
            className={`w-full text-muted ${onAdd ? "cursor-crosshair" : ""}`}
            onClick={handleClick(view)}
          >
            <Silhouette view={view} bodyType={bodyType} />
            {markers
              .filter((m) => m.view === view)
              .map((m) => (
                <g key={m.n}>
                  <circle cx={m.x * 200} cy={m.y * 110} r={9} fill="var(--status-bad)" />
                  <text
                    x={m.x * 200}
                    y={m.y * 110 + 4}
                    textAnchor="middle"
                    fontSize={11}
                    fill="white"
                    fontWeight={700}
                  >
                    {m.n}
                  </text>
                </g>
              ))}
          </svg>
          <figcaption className="text-xs text-muted">{viewLabels[view]}</figcaption>
        </figure>
      ))}
    </div>
  );
}
