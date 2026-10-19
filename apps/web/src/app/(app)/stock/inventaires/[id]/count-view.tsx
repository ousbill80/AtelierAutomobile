"use client";

// M07 §7 — /stock/inventaires/[id] : écran de comptage pensé téléphone (scan ou recherche →
// quantité), écarts en quantité et en valeur, soumission puis validation par le gérant.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatFCFA } from "@atelieros/core/money";
import { BarcodeScanner, Button, Modal, StatusBadge, useScannerWedge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import {
  ErrorBox,
  InlineError,
  ListSkeleton,
  ModuleNav,
  PageTitle,
  ProductPicker,
  scannerLabels,
  useCan,
} from "../../_lib/components";
import { COUNT_TONE, errorMessage, qtyText, t } from "../../_lib/i18n";

export function CountView({ id }: { id: string }) {
  const can = useCan();
  const utils = trpc.useUtils();
  const query = trpc.stockCount.get.useQuery({ id });
  const [focusProduct, setFocusProduct] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [confirmValidate, setConfirmValidate] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => void utils.stockCount.invalidate();
  const start = trpc.stockCount.start.useMutation({ onSuccess: refresh });
  const submit = trpc.stockCount.submit.useMutation({ onSuccess: refresh });
  const cancel = trpc.stockCount.cancel.useMutation({ onSuccess: refresh });
  const validate = trpc.stockCount.validate.useMutation({
    onSuccess(r) {
      setConfirmValidate(false);
      setNotice(t("counts.validated", { count: r.corrections }));
      refresh();
      void utils.product.invalidate();
    },
  });
  const setLine = trpc.stockCount.setLine.useMutation({ onSuccess: refresh });

  const lines = query.data?.lines;
  const onCode = useCallback(
    async (code: string) => {
      setScanOpen(false);
      const line = lines?.find((l) => l.product.barcode === code || l.product.sku === code);
      if (line) {
        setFocusProduct(line.product.id);
        return;
      }
      const found = await utils.product.search.fetch({ barcode: code, filter: "all", limit: 1 });
      const product = found.items[0];
      if (product) {
        await setLine.mutateAsync({ countId: id, productId: product.id, countedQty: null });
        setNotice(t("counts.productNotInCount"));
        setFocusProduct(product.id);
      } else {
        setNotice(t("scanner.unknownTitle", { code }));
      }
    },
    [lines, utils, setLine, id],
  );
  const inProgress = query.data?.status === "IN_PROGRESS";
  useScannerWedge((code) => void onCode(code), inProgress);

  if (query.isLoading) return <ListSkeleton rows={6} />;
  if (query.isError || !query.data) return <ErrorBox onRetry={() => query.refetch()} />;
  const count = query.data;
  const actionError =
    start.error ?? submit.error ?? cancel.error ?? validate.error ?? setLine.error;
  const s = count.summary;

  return (
    <div className="flex flex-col gap-4 pb-10">
      <ModuleNav section="stock" />
      <Link href="/stock/inventaires" className="min-h-11 text-sm text-muted underline">
        {t("common.back")}
      </Link>
      <PageTitle
        title={count.number}
        description={count.site.name}
        actions={
          <>
            {count.status === "DRAFT" ? (
              <Button loading={start.isPending} onClick={() => start.mutate({ id })}>
                {t("counts.start")}
              </Button>
            ) : null}
            {count.status === "IN_PROGRESS" ? (
              <Button loading={submit.isPending} onClick={() => submit.mutate({ id })}>
                {t("counts.submit")}
              </Button>
            ) : null}
            {count.status === "SUBMITTED" && count.canValidate ? (
              <Button onClick={() => setConfirmValidate(true)}>{t("counts.validate")}</Button>
            ) : null}
            {["DRAFT", "IN_PROGRESS", "SUBMITTED"].includes(count.status) ? (
              <Button
                variant="ghost"
                loading={cancel.isPending}
                onClick={() => cancel.mutate({ id })}
              >
                {t("counts.cancel")}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge
          tone={COUNT_TONE[count.status] ?? "off"}
          label={t(`counts.status.${count.status}`)}
        />
        <span className="text-sm text-muted">
          {t("counts.summary", {
            counted: s.linesCounted,
            total: s.linesTotal,
            withVariance: s.linesWithVariance,
          })}
        </span>
        {s.netValue != null ? (
          <span className="text-sm font-medium" data-testid="count-net-value">
            {t("counts.netValue", { value: formatFCFA(s.netValue) })}
          </span>
        ) : null}
      </div>
      {notice ? (
        <p role="status" className="rounded-md bg-surface-2 p-2 text-sm">
          {notice}
        </p>
      ) : null}
      <InlineError message={actionError ? errorMessage(actionError) : null} />
      {count.status === "DRAFT" ? (
        <p className="text-sm text-muted">{t("counts.draftHint")}</p>
      ) : null}

      {inProgress ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
          <p className="text-sm text-muted">{t("counts.scanHint")}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setScanOpen(true)}>
              {t("common.scan")}
            </Button>
          </div>
          <ProductPicker
            onPick={(p) => {
              if (!count.lines.some((l) => l.product.id === p.id)) {
                setLine.mutate({ countId: id, productId: p.id, countedQty: null });
              }
              setFocusProduct(p.id);
            }}
          />
        </div>
      ) : null}

      {count.lines.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {count.lines.map((line) => (
            <CountLine
              key={`${line.id}:${line.countedQty ?? ""}`}
              countId={id}
              line={line}
              editable={inProgress && can("stock:count")}
              focused={focusProduct === line.product.id}
              onSave={(qty) =>
                setLine.mutate({ countId: id, productId: line.product.id, countedQty: qty })
              }
            />
          ))}
        </ul>
      ) : null}

      <BarcodeScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onDetected={(code) => void onCode(code)}
        labels={scannerLabels()}
      />
      <Modal
        open={confirmValidate}
        title={t("counts.validate")}
        onClose={() => setConfirmValidate(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmValidate(false)}>
              {t("common.cancel")}
            </Button>
            <Button loading={validate.isPending} onClick={() => validate.mutate({ id })}>
              {t("common.confirm")}
            </Button>
          </>
        }
      >
        <p className="text-sm">{t("counts.validateConfirm")}</p>
        <InlineError message={validate.error ? errorMessage(validate.error) : null} />
      </Modal>
    </div>
  );
}

type Line = {
  id: string;
  product: { id: string; sku: string; name: string; unit: string; quantityScale: number };
  binLocation: string | null;
  expectedQty: number;
  countedQty: number | null;
  movedAfterCount: boolean;
  variance: number;
  varianceValue: number | null;
};

function CountLine({
  line,
  editable,
  focused,
  onSave,
}: {
  countId: string;
  line: Line;
  editable: boolean;
  focused: boolean;
  onSave: (qty: number | null) => void;
}) {
  const scale = line.product.quantityScale;
  const initial = line.countedQty != null ? String(line.countedQty / scale).replace(".", ",") : "";
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focused) {
      ref.current?.focus();
      ref.current?.scrollIntoView({ block: "center" });
    }
  }, [focused]);
  function commit() {
    if (value === initial) return;
    const n = value.trim() === "" ? null : Number(value.replace(",", "."));
    if (n === null || (Number.isFinite(n) && n >= 0)) onSave(n);
  }
  return (
    <li
      className={`flex flex-col gap-2 rounded-lg border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between ${focused ? "border-accent" : "border-border"}`}
      data-testid={`count-line-${line.product.sku}`}
    >
      <div className="min-w-0">
        <div className="font-medium">{line.product.name}</div>
        <div className="text-xs text-muted">
          {line.product.sku}
          {line.binLocation ? ` · ${line.binLocation}` : ""}
        </div>
        {line.movedAfterCount ? (
          <StatusBadge tone="warn" label={t("counts.movedAfterCount")} />
        ) : null}
      </div>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <div>
          <div className="text-xs text-muted">{t("counts.expected")}</div>
          <div>{qtyText(line.expectedQty, scale)}</div>
        </div>
        {editable ? (
          <div className="w-28">
            <label className="text-xs text-muted" htmlFor={`count-${line.id}`}>
              {t("counts.counted")}
            </label>
            <input
              id={`count-${line.id}`}
              ref={ref}
              className="input"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
              }}
            />
          </div>
        ) : (
          <div>
            <div className="text-xs text-muted">{t("counts.counted")}</div>
            <div>
              {line.countedQty != null ? qtyText(line.countedQty, scale) : t("counts.notCounted")}
            </div>
          </div>
        )}
        <div>
          <div className="text-xs text-muted">{t("counts.variance")}</div>
          <div
            className={
              line.variance < 0 ? "text-status-bad" : line.variance > 0 ? "text-status-ok" : ""
            }
          >
            {line.countedQty == null
              ? "—"
              : `${line.variance > 0 ? "+" : ""}${qtyText(line.variance, scale)}`}
          </div>
        </div>
        {line.varianceValue != null ? (
          <div>
            <div className="text-xs text-muted">{t("counts.varianceValue")}</div>
            <div>{line.countedQty == null ? "—" : formatFCFA(line.varianceValue)}</div>
          </div>
        ) : null}
      </div>
    </li>
  );
}
