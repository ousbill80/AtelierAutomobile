"use client";

// Parcours sinistre, de la réception au virement de la compagnie.
import { t } from "@/components/claims/i18n";
import { ClaimsNav } from "../nav";

const SOURCES = ["1", "2", "3", "4"] as const;

const STEPS: { n: string; rows?: string[] }[] = [
  { n: "1" },
  { n: "2", rows: ["1", "2", "3", "4"] },
  { n: "3", rows: ["1", "2", "3"] },
  { n: "4", rows: ["1", "2", "3", "4", "5"] },
  { n: "5" },
  { n: "6", rows: ["1", "2", "3", "4"] },
  { n: "7", rows: ["1", "2", "3"] },
  { n: "8" },
  { n: "9" },
  { n: "10", rows: ["1", "2"] },
  { n: "11", rows: ["1", "2"] },
  { n: "12", rows: ["1", "2"] },
];

const STAGES = ["1", "2", "3", "4", "5", "6", "7"] as const;

function Rows({ step, rows }: { step: string; rows: string[] }) {
  return (
    <dl className="mt-3 grid gap-2 sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row} className="rounded-md bg-surface-2 px-3 py-2">
          <dt className="text-xs text-muted">{t(`guideS${step}R${row}l`)}</dt>
          <dd className="font-medium">{t(`guideS${step}R${row}v`)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function ClaimGuidePage() {
  return (
    <div className="flex min-w-0 flex-col gap-4 pb-8">
      <div>
        <h1 className="text-xl font-semibold">{t("guideTitle")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t("guideIntro")}</p>
      </div>
      <ClaimsNav />

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="font-semibold">{t("guideSourcesTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t("guideSourcesNote")}</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3 font-semibold">{t("guideColInfo")}</th>
                <th className="py-2 pr-3 font-semibold">{t("guideColWho")}</th>
                <th className="py-2 font-semibold">{t("guideColExample")}</th>
              </tr>
            </thead>
            <tbody>
              {SOURCES.map((n) => (
                <tr key={n} className="border-b border-border last:border-0">
                  <td className="py-2 pr-3 font-medium">{t(`guideSource${n}Info`)}</td>
                  <td className="py-2 pr-3">{t(`guideSource${n}Who`)}</td>
                  <td className="py-2">{t(`guideSource${n}Example`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <ol className="flex flex-col gap-3">
        {STEPS.map((step) => (
          <li key={step.n} className="rounded-lg border border-border bg-surface p-4">
            <h2 className="flex items-start gap-3 font-semibold">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm text-accent-foreground">
                {step.n}
              </span>
              <span className="pt-1">{t(`guideS${step.n}Title`)}</span>
            </h2>
            <p className="mt-2 text-sm leading-relaxed">{t(`guideS${step.n}Body`)}</p>
            {step.rows && <Rows step={step.n} rows={step.rows} />}
          </li>
        ))}
      </ol>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="font-semibold">{t("guideStagesTitle")}</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {STAGES.map((n) => (
            <li key={n} className="rounded-md bg-surface-2 px-3 py-2">
              {t(`guideStage${n}`)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
