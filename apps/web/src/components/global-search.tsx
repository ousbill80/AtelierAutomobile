"use client";

// RG-M02-19 — recherche globale du bandeau : téléphone, plaque, n° de document ou nom.
// Résultats groupés (5 max par groupe) ; un document mène à la fiche de son client tant que
// les écrans OR/devis/factures n'existent pas.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

const MIN_LENGTH = 2;
const DEBOUNCE_MS = 250;

function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounced = useDebounced(query.trim(), DEBOUNCE_MS);
  const enabled = debounced.length >= MIN_LENGTH;

  const search = trpc.search.global.useQuery({ q: debounced }, { enabled });

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  // Navigation vers un résultat : on referme et on vide la recherche.
  function close() {
    setOpen(false);
    setQuery("");
  }

  const data = search.data;
  const total = data ? data.customers.length + data.vehicles.length + data.documents.length : 0;

  return (
    <div className="search-box relative" ref={wrapRef}>
      <input
        type="search"
        value={query}
        placeholder={t("search.placeholder")}
        aria-label={t("search.ariaLabel")}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && query.trim().length > 0 && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-[60] max-h-[70vh] overflow-y-auto rounded-md border border-border bg-surface p-2 shadow-lg"
          role="listbox"
          aria-label={t("search.resultsLabel")}
        >
          {query.trim().length < MIN_LENGTH ? (
            <p className="p-2 text-sm text-muted">{t("search.minLength")}</p>
          ) : search.isError ? (
            <p className="p-2 text-sm text-status-bad">{t("search.error")}</p>
          ) : !data || search.isFetching ? (
            <div className="flex flex-col gap-2 p-1" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-9 animate-pulse rounded bg-surface-2" />
              ))}
            </div>
          ) : total === 0 ? (
            <p className="p-2 text-sm text-muted">{t("search.empty", { query: debounced })}</p>
          ) : (
            <>
              {data.customers.length > 0 && (
                <ResultGroup title={t("search.groups.customers")}>
                  {data.customers.map((c) => (
                    <ResultLink
                      onSelect={close}
                      key={c.id}
                      href={`/clients/${c.id}`}
                      title={c.displayName}
                      detail={
                        c.matchedContactName
                          ? t("search.viaContact", { name: c.matchedContactName })
                          : (c.phone ?? c.email ?? "")
                      }
                    />
                  ))}
                </ResultGroup>
              )}
              {data.vehicles.length > 0 && (
                <ResultGroup title={t("search.groups.vehicles")}>
                  {data.vehicles.map((v) => (
                    <ResultLink
                      onSelect={close}
                      key={v.id}
                      href={`/vehicules/${v.id}`}
                      title={`${v.plate} — ${v.make} ${v.model}`}
                      detail={v.customerDisplayName}
                    />
                  ))}
                </ResultGroup>
              )}
              {data.documents.length > 0 && (
                <ResultGroup title={t("search.groups.documents")}>
                  {data.documents.map((d) =>
                    d.customerId ? (
                      <ResultLink
                        onSelect={close}
                        key={`${d.type}:${d.id}`}
                        href={`/clients/${d.customerId}`}
                        title={`${t(`search.documentTypes.${d.type}`)} ${d.number}`}
                        detail={d.customerDisplayName ?? ""}
                      />
                    ) : (
                      <li key={`${d.type}:${d.id}`} className="px-2 py-2 text-sm">
                        {t(`search.documentTypes.${d.type}`)} {d.number}
                      </li>
                    ),
                  )}
                </ResultGroup>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ResultGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-1">
      <h3 className="px-2 pb-1 pt-2 text-xs font-semibold uppercase text-muted">{title}</h3>
      <ul>{children}</ul>
    </section>
  );
}

function ResultLink({
  href,
  title,
  detail,
  onSelect,
}: {
  href: string;
  title: string;
  detail: string;
  onSelect: () => void;
}) {
  return (
    <li>
      <Link
        href={href}
        role="option"
        aria-selected={false}
        onClick={onSelect}
        className="flex min-h-11 flex-col justify-center rounded px-2 py-1 hover:bg-surface-2"
      >
        <span className="text-sm font-medium">{title}</span>
        {detail ? <span className="text-xs text-muted">{detail}</span> : null}
      </Link>
    </li>
  );
}
