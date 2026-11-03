// M12 §7 — export PDF d'un rapport : A4 paysage, en-tête garage (logo, nom, NCC), rappel des
// filtres, tableau et ligne de totaux identiques à l'écran. Les cellules arrivent déjà
// formatées (`formatCell` de core/reports) : ce module ne fait que la mise en page.
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { garageInitials, printableLogo } from "./invoice";

export interface ReportPdfColumn {
  key: string;
  label: string;
  /** Alignement à droite pour les nombres et montants. */
  numeric: boolean;
}

export interface ReportPdfData {
  garage: { name: string; legalName?: string | null; ncc?: string | null; logo?: string | null };
  title: string;
  /** Lignes « Période : … », « Site : … », « Généré le … par … ». */
  params: string[];
  columns: ReportPdfColumn[];
  rows: Record<string, string>[];
  totals: Record<string, string> | null;
  totalLabel: string;
  notes: string[];
}

const PRIMARY = "#0C2A39";
const ORANGE = "#EB6120";
const INK = "#121F28";
const MUTED = "#545F68";
const LINE = "#D6DBE0";
const ALT = "#F4F8FA";

const styles = StyleSheet.create({
  page: {
    paddingTop: 22,
    paddingHorizontal: 22,
    paddingBottom: 32,
    fontSize: 7.5,
    fontFamily: "Helvetica",
    color: INK,
  },
  between: { flexDirection: "row", justifyContent: "space-between" },
  row: { flexDirection: "row" },
  header: { alignItems: "flex-start", marginBottom: 10 },
  h1: { fontSize: 13, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  garage: { fontFamily: "Helvetica-Bold", fontSize: 9, textAlign: "right" },
  muted: { color: MUTED, fontSize: 7.5, lineHeight: 1.35 },
  thead: { backgroundColor: PRIMARY },
  th: {
    color: "#ffffff",
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    paddingVertical: 5,
    paddingHorizontal: 3,
  },
  tr: {
    alignItems: "flex-start",
    borderBottomWidth: 0.4,
    borderBottomColor: LINE,
    borderBottomStyle: "solid",
  },
  alt: { backgroundColor: ALT },
  td: { fontSize: 7.5, paddingVertical: 4, paddingHorizontal: 3 },
  total: { backgroundColor: ORANGE },
  totalText: {
    color: "#ffffff",
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    paddingVertical: 5,
    paddingHorizontal: 3,
  },
  note: { color: MUTED, fontSize: 7.5, marginTop: 6 },
  footer: {
    position: "absolute",
    bottom: 12,
    left: 22,
    right: 22,
    borderTopWidth: 0.6,
    borderTopColor: LINE,
    borderTopStyle: "solid",
    paddingTop: 4,
    fontSize: 7,
    color: MUTED,
    textAlign: "center",
  },
});

function widths(columns: readonly ReportPdfColumn[]): string[] {
  const weights = columns.map((c) => (c.numeric ? 1 : 1.6));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => `${((w / sum) * 100).toFixed(2)}%`);
}

function Mark({ logo, name }: { logo?: string | null; name: string }) {
  const src = printableLogo(logo);
  if (src) return <Image src={src} style={{ width: 36, height: 36, objectFit: "contain" }} />;
  return (
    <View
      style={{
        width: 32,
        height: 32,
        borderRadius: 6,
        backgroundColor: PRIMARY,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 11 }}>
        {garageInitials(name)}
      </Text>
    </View>
  );
}

export function ReportDocument({ data }: { data: ReportPdfData }) {
  const w = widths(data.columns);
  const cell = (i: number, numeric: boolean) => ({
    width: w[i],
    textAlign: numeric ? ("right" as const) : ("left" as const),
  });
  const legal = data.garage.legalName || data.garage.name;
  return (
    <Document title={data.title}>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={[styles.between, styles.header]} fixed>
          <View style={{ width: "72%", flexDirection: "row", alignItems: "flex-start" }}>
            <Mark logo={data.garage.logo} name={legal} />
            <View style={{ marginLeft: 8, flexGrow: 1 }}>
              <Text style={styles.h1}>{data.title}</Text>
              {data.params.map((p) => (
                <Text key={p} style={styles.muted}>
                  {p}
                </Text>
              ))}
            </View>
          </View>
          <View style={{ width: "26%", alignItems: "flex-end" }}>
            <Text style={styles.garage}>{legal}</Text>
            {data.garage.ncc ? (
              <Text style={[styles.muted, { textAlign: "right" }]}>NCC {data.garage.ncc}</Text>
            ) : null}
          </View>
        </View>
        <View style={[styles.row, styles.thead]} fixed>
          {data.columns.map((c, i) => (
            <Text key={c.key} style={[styles.th, cell(i, c.numeric)]}>
              {c.label}
            </Text>
          ))}
        </View>
        {data.rows.map((row, r) => (
          <View key={r} style={[styles.row, styles.tr, r % 2 === 1 ? styles.alt : {}]} wrap={false}>
            {data.columns.map((c, i) => (
              <Text key={c.key} style={[styles.td, cell(i, c.numeric)]}>
                {row[c.key] ?? ""}
              </Text>
            ))}
          </View>
        ))}
        {data.totals ? (
          <View style={[styles.row, styles.total]} wrap={false}>
            {data.columns.map((c, i) => (
              <Text key={c.key} style={[styles.totalText, cell(i, c.numeric)]}>
                {i === 0 ? data.totalLabel : (data.totals?.[c.key] ?? "")}
              </Text>
            ))}
          </View>
        ) : null}
        {data.notes.map((n) => (
          <Text key={n} style={styles.note}>
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
