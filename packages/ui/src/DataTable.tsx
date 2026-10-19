import type { ReactNode } from "react";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Colonne utilisée comme titre de la carte mobile (par défaut la première). */
  primary?: boolean;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  toolbar?: ReactNode;
  empty?: ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  toolbar,
  empty,
}: DataTableProps<T>) {
  if (rows.length === 0 && empty) {
    return (
      <div className="table-wrap">
        {toolbar ? <div className="table-toolbar">{toolbar}</div> : null}
        {empty}
      </div>
    );
  }

  const primaryCol = columns.find((c) => c.primary) ?? columns[0];

  return (
    <div className="table-wrap to-cards">
      {toolbar ? <div className="table-toolbar">{toolbar}</div> : null}
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={() => onRowClick?.(row)}
              style={onRowClick ? { cursor: "pointer" } : undefined}
            >
              {columns.map((col) => (
                <td key={col.key}>{col.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="card-list">
        {rows.map((row) => (
          <div
            key={rowKey(row)}
            className="row-card"
            onClick={() => onRowClick?.(row)}
            style={onRowClick ? { cursor: "pointer" } : undefined}
          >
            <div className="row-card-top">{primaryCol ? primaryCol.render(row) : null}</div>
            <div className="row-card-fields">
              {columns
                .filter((c) => c !== primaryCol)
                .map((col) => (
                  <div key={col.key} className="field-pair">
                    <span className="k">{col.header}</span>
                    <span>{col.render(row)}</span>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
