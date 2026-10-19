// RG-M09-15 — relevé de compte client (PDF). Données préparées côté serveur
// (`buildCustomerStatement`, apps/web) ; ce module ne fait que la mise en page.
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatFCFA } from "@atelieros/core";

export interface StatementPdfLine {
  date: Date | string;
  reference: string;
  label: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface StatementPdfData {
  garage: {
    name: string;
    legalName?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    rccm?: string | null;
    ncc?: string | null;
  };
  customer: {
    displayName: string;
    ncc?: string | null;
    address?: string | null;
    phone?: string | null;
  };
  from: string;
  to: string;
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
  lines: StatementPdfLine[];
  aging: {
    notDue: number;
    buckets: { b0_30: number; b31_60: number; b61_90: number; b90p: number };
  };
  openInvoices: {
    number: string | null;
    fneNumber: string | null;
    dueDate: Date | string | null;
    total: number;
    balance: number;
    daysOverdue: number;
  }[];
  paymentInstructions?: string | null;
}

function day(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const iso = typeof value === "string" ? value : value.toISOString();
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  row: { flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  h1: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 6 },
  muted: { color: "#555" },
  box: { border: "1pt solid #ccc", padding: 8, marginTop: 10 },
  th: { fontFamily: "Helvetica-Bold", borderBottom: "1pt solid #999", paddingVertical: 3 },
  td: { borderBottom: "0.5pt solid #ddd", paddingVertical: 3 },
  cDate: { width: "13%" },
  cRef: { width: "17%" },
  cLabel: { width: "31%" },
  cNum: { width: "13%", textAlign: "right" },
  footer: { marginTop: 18, fontSize: 8, color: "#555" },
});

export function StatementDocument({ data }: { data: StatementPdfData }) {
  const g = data.garage;
  return (
    <Document title={`Relevé de compte — ${data.customer.displayName}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.between}>
          <View>
            <Text style={styles.h1}>{g.legalName ?? g.name}</Text>
            {g.address && <Text>{g.address}</Text>}
            {(g.phone || g.email) && <Text>{[g.phone, g.email].filter(Boolean).join(" · ")}</Text>}
            {g.rccm && <Text style={styles.muted}>RCCM : {g.rccm}</Text>}
            {g.ncc && <Text style={styles.muted}>NCC : {g.ncc}</Text>}
          </View>
          <View>
            <Text style={styles.h1}>Relevé de compte</Text>
            <Text>
              Période du {day(data.from)} au {day(data.to)}
            </Text>
          </View>
        </View>

        <View style={styles.box}>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>{data.customer.displayName}</Text>
          {data.customer.ncc && <Text>NCC : {data.customer.ncc}</Text>}
          {data.customer.address && <Text>{data.customer.address}</Text>}
          {data.customer.phone && <Text>{data.customer.phone}</Text>}
        </View>

        <Text style={styles.h2}>Mouvements</Text>
        <View style={[styles.row, styles.th]}>
          <Text style={styles.cDate}>Date</Text>
          <Text style={styles.cRef}>Document</Text>
          <Text style={styles.cLabel}>Libellé</Text>
          <Text style={styles.cNum}>Débit</Text>
          <Text style={styles.cNum}>Crédit</Text>
          <Text style={styles.cNum}>Solde</Text>
        </View>
        <View style={[styles.row, styles.td]}>
          <Text style={styles.cDate}>{day(data.from)}</Text>
          <Text style={styles.cRef} />
          <Text style={styles.cLabel}>Solde d&apos;ouverture</Text>
          <Text style={styles.cNum} />
          <Text style={styles.cNum} />
          <Text style={styles.cNum}>{formatFCFA(data.openingBalance)}</Text>
        </View>
        {data.lines.map((line, index) => (
          <View key={index} style={[styles.row, styles.td]} wrap={false}>
            <Text style={styles.cDate}>{day(line.date)}</Text>
            <Text style={styles.cRef}>{line.reference}</Text>
            <Text style={styles.cLabel}>{line.label}</Text>
            <Text style={styles.cNum}>{line.debit ? formatFCFA(line.debit) : ""}</Text>
            <Text style={styles.cNum}>{line.credit ? formatFCFA(line.credit) : ""}</Text>
            <Text style={styles.cNum}>{formatFCFA(line.runningBalance)}</Text>
          </View>
        ))}
        <View style={[styles.row, styles.th]}>
          <Text style={styles.cDate} />
          <Text style={styles.cRef} />
          <Text style={styles.cLabel}>Solde de clôture</Text>
          <Text style={styles.cNum}>{formatFCFA(data.totalDebit)}</Text>
          <Text style={styles.cNum}>{formatFCFA(data.totalCredit)}</Text>
          <Text style={styles.cNum}>{formatFCFA(data.closingBalance)}</Text>
        </View>

        <View style={styles.box}>
          <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 4 }}>Échu par ancienneté</Text>
          <View style={styles.between}>
            <Text>Non échu : {formatFCFA(data.aging.notDue)}</Text>
            <Text>0-30 j : {formatFCFA(data.aging.buckets.b0_30)}</Text>
            <Text>31-60 j : {formatFCFA(data.aging.buckets.b31_60)}</Text>
            <Text>61-90 j : {formatFCFA(data.aging.buckets.b61_90)}</Text>
            <Text>+90 j : {formatFCFA(data.aging.buckets.b90p)}</Text>
          </View>
        </View>

        <Text style={styles.h2}>Factures ouvertes</Text>
        {data.openInvoices.length === 0 ? (
          <Text style={styles.muted}>Aucune facture ouverte.</Text>
        ) : (
          data.openInvoices.map((i, index) => (
            <View key={index} style={[styles.between, styles.td]} wrap={false}>
              <Text>
                {i.number ?? "—"}
                {i.fneNumber ? ` (FNE ${i.fneNumber})` : ""}
              </Text>
              <Text>Échéance {day(i.dueDate)}</Text>
              <Text>{i.daysOverdue > 0 ? `${i.daysOverdue} j de retard` : "À échéance"}</Text>
              <Text>
                Reste dû {formatFCFA(i.balance)} / {formatFCFA(i.total)}
              </Text>
            </View>
          ))
        )}

        {data.paymentInstructions && (
          <View style={styles.box}>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>Moyens de paiement</Text>
            <Text>{data.paymentInstructions}</Text>
          </View>
        )}

        <Text style={styles.footer}>Sauf erreur ou omission.</Text>
      </Page>
    </Document>
  );
}

export async function renderStatementPdf(data: StatementPdfData): Promise<Buffer> {
  return renderToBuffer(<StatementDocument data={data} />);
}
