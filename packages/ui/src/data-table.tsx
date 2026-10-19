import type { ReactNode } from "react";
import { cn } from "./cn";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

export interface DataTableProps<T> {
  columns: ReadonlyArray<DataTableColumn<T>>;
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Affiche des squelettes à la place des lignes (CLAUDE.md § UI : « états chargement »). */
  isLoading?: boolean;
  skeletonRowCount?: number;
  /** Affiché si `rows` est vide et `isLoading` est faux. */
  emptyState?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
}

/** Tableau de données générique (en-têtes + lignes), avec états chargement/vide. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  isLoading = false,
  skeletonRowCount = 5,
  emptyState,
  rowClassName,
}: DataTableProps<T>) {
  if (!isLoading && rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className="relative w-full overflow-x-auto rounded-lg border border-border">
      <table className="w-full caption-bottom text-sm">
        <thead className="border-b border-border">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn(
                  "h-10 px-3 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted",
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? Array.from({ length: skeletonRowCount }).map((_, rowIndex) => (
                <tr key={`skeleton-${rowIndex}`} className="border-b border-border last:border-0">
                  {columns.map((column) => (
                    <td key={column.key} className="p-3">
                      <div className="h-4 w-full max-w-32 animate-pulse rounded-md bg-surface-2" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className={cn(
                    "border-b border-border transition-colors last:border-0 hover:bg-surface-2/60",
                    rowClassName?.(row),
                  )}
                >
                  {columns.map((column) => (
                    <td key={column.key} className={cn("p-3 align-middle", column.className)}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}
