// M12 §7 — export PDF d'un rapport : A4 paysage, en-tête garage (nom, NCC), rappel des
// filtres, tableau et ligne de totaux identiques à l'écran. Les cellules arrivent déjà
// formatées (`formatCell` de core/reports) : ce module ne fait que la mise en page.
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

export interface ReportPdfColumn {
  key: string;
  label: string;
  /** Alignement à droite pour les nombres et montants. */
  numeric: boolean;
}

export interface ReportPdfData {
  garage: { name: string; legalName?: string | null; ncc?: string | null };
  title: string;
  /** Lignes « Période : … », « Site : … », « Généré le … par … ». */
  params: string[];
  columns: ReportPdfColumn[];
  rows: Record<string, string>[];
  totals: Record<string, string> | null;
  totalLabel: string;
  notes: string[];
}

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 7.5, fontFamily: "Helvetica", color: "#111" },
  between: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  h1: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  muted: { color: "#555" },
  row: { flexDirection: "row" },
  th: {
    fontFamily: "Helvetica-Bold",
    borderBottom: "1pt solid #999",
    paddingVertical: 3,
    paddingHorizontal: 2,
  },
  td: { borderBottom: "0.5pt solid #ddd", paddingVertical: 2, paddingHorizontal: 2 },
  total: {
    fontFamily: "Helvetica-Bold",
    borderTop: "1pt solid #999",
    paddingVertical: 3,
    paddingHorizontal: 2,
  },
  footer: { position: "absolute", bottom: 14, left: 24, right: 24, fontSize: 7, color: "#555" },
});

function widths(columns: readonly ReportPdfColumn[]): string[] {
  const weights = columns.map((c) => (c.numeric ? 1 : 1.6));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => `${((w / sum) * 100).toFixed(2)}%`);
}

export function ReportDocument({ data }: { data: ReportPdfData }) {
  const w = widths(data.columns);
  const cell = (i: number, numeric: boolean) => ({
    width: w[i],
    textAlign: numeric ? ("right" as const) : ("left" as const),
  });
  return (
    <Document title={data.title}>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.between} fixed>
          <View>
            <Text style={styles.h1}>{data.title}</Text>
            {data.params.map((p) => (
              <Text key={p} style={styles.muted}>
                {p}
              </Text>
            ))}
          </View>
          <View>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>
              {data.garage.legalName ?? data.garage.name}
            </Text>
            {data.garage.ncc ? <Text style={styles.muted}>NCC : {data.garage.ncc}</Text> : null}
          </View>
        </View>
        <View style={styles.row} fixed>
          {data.columns.map((c, i) => (
            <Text key={c.key} style={[styles.th, cell(i, c.numeric)]}>
              {c.label}
            </Text>
          ))}
        </View>
        {data.rows.map((row, r) => (
          <View key={r} style={styles.row} wrap={false}>
            {data.columns.map((c, i) => (
              <Text key={c.key} style={[styles.td, cell(i, c.numeric)]}>
                {row[c.key] ?? ""}
              </Text>
            ))}
          </View>
        ))}
        {data.totals ? (
          <View style={styles.row} wrap={false}>
            {data.columns.map((c, i) => (
              <Text key={c.key} style={[styles.total, cell(i, c.numeric)]}>
                {i === 0 ? data.totalLabel : (data.totals?.[c.key] ?? "")}
              </Text>
            ))}
          </View>
        ) : null}
        {data.notes.map((n) => (
          <Text key={n} style={[styles.muted, { marginTop: 6 }]}>
            {n}
          </Text>
        ))}
        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `${data.title} — page ${pageNumber} / ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}

export async function renderReportPdf(data: ReportPdfData): Promise<Buffer> {
  return renderToBuffer(<ReportDocument data={data} />);
}
