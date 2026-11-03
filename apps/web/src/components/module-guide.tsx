"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import fr from "../../messages/fr.json";

export type GuideRow = { label: string; value: string };
export type GuideStep = { title: string; body: string; rows?: GuideRow[] };
export type GuideDoc = {
  title: string;
  intro: string;
  home: string;
  back: string;
  steps: GuideStep[];
};

type GuidesFile = {
  guides: {
    nav: string;
    modules: Record<string, GuideDoc>;
  };
};

const modules = (fr as GuidesFile).guides.modules;

export function guideNavLabel(): string {
  return (fr as GuidesFile).guides.nav;
}

export function ModuleGuide({ id }: { id: string }) {
  const doc = modules[id];
  if (!doc) return null;
  return (
    <div className="flex min-w-0 flex-col gap-4 pb-8">
      <Link href={doc.home} className="inline-flex min-h-11 items-center gap-2 text-sm text-accent">
        <ArrowLeft size={16} aria-hidden /> {doc.back}
      </Link>
      <div>
        <h1 className="text-xl font-semibold">{doc.title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{doc.intro}</p>
      </div>
      <ol className="flex flex-col gap-3">
        {doc.steps.map((step, index) => (
          <li key={step.title} className="rounded-lg border border-border bg-surface p-4">
            <h2 className="flex items-start gap-3 font-semibold">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm text-accent-foreground">
                {index + 1}
              </span>
              <span className="pt-1">{step.title}</span>
            </h2>
            <p className="mt-2 text-sm leading-relaxed">{step.body}</p>
            {step.rows && step.rows.length > 0 && (
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                {step.rows.map((row) => (
                  <div key={row.label} className="rounded-md bg-surface-2 px-3 py-2">
                    <dt className="text-xs text-muted">{row.label}</dt>
                    <dd className="font-medium">{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
