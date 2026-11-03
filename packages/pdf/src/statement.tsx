// RG-M09-15 — relevé de compte client (PDF). Données préparées côté serveur
// (`buildCustomerStatement`, apps/web) ; ce module ne fait que la mise en page.
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatFCFA } from "@atelieros/core";
import { garageInitials, printableLogo } from "./invoice";

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
    logo?: string | null;
    footer?: string | null;
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

const PRIMARY = "#0C2A39";
const PRIMARY_SOFT = "#E9F2F7";
const ORANGE = "#EB6120";
const INK = "#121F28";
const MUTED = "#545F68";
const LINE = "#D6DBE0";
const ALT = "#F4F8FA";

const styles = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingHorizontal: 32,
    paddingBottom: 62,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: INK,
  },
  between: { flexDirection: "row", justifyContent: "space-between" },
  row: { flexDirection: "row" },
  issuer: { fontFamily: "Helvetica-Bold", fontSize: 12, textAlign: "right", marginBottom: 2 },
  issuerLine: { fontSize: 8, color: "#36454E", textAlign: "right", lineHeight: 1.35 },
  docTitle: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.8,
    marginTop: 18,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 0.6,
    borderBottomColor: LINE,
    borderBottomStyle: "solid",
    paddingVertical: 4,
  },
  metaLabel: { width: "42%", color: MUTED, fontSize: 8 },
  metaValue: { width: "56%", fontFamily: "Helvetica-Bold", fontSize: 8, textAlign: "right" },
  party: {
    width: "50%",
    backgroundColor: PRIMARY_SOFT,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  partyLabel: {
    color: PRIMARY,
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  partyName: { fontFamily: "Helvetica-Bold", fontSize: 10, marginBottom: 1 },
  partyLine: { fontSize: 8, lineHeight: 1.4 },
  section: { marginTop: 12 },
  sectionTitle: {
    backgroundColor: PRIMARY_SOFT,
    color: PRIMARY,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  thead: { backgroundColor: PRIMARY, marginTop: 8 },
  th: {
    color: "#ffffff",
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  tr: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderBottomWidth: 0.4,
    borderBottomColor: LINE,
    borderBottomStyle: "solid",
  },
  td: { fontSize: 8, paddingVertical: 5, paddingHorizontal: 4 },
  cDate: { width: "13%" },
  cRef: { width: "20%" },
  cLabel: { width: "28%" },
  cNum: { width: "13%", textAlign: "right" },
  grand: {
    flexDirection: "row",
    backgroundColor: ORANGE,
    marginTop: 2,
  },
  grandText: {
    color: "#ffffff",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  ageHead: {
    width: "20%",
    color: "#ffffff",
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  ageCell: { width: "20%", fontSize: 8, paddingVertical: 6, paddingHorizontal: 4 },
  invRef: { width: "28%" },
  invDue: { width: "22%" },
  invLate: { width: "18%" },
  invBal: { width: "32%", textAlign: "right" },
  note: { marginTop: 12, fontSize: 8, color: MUTED },
  pageFoot: {
    position: "absolute",
    bottom: 20,
    left: 32,
    right: 32,
    borderTopWidth: 0.6,
    borderTopColor: LINE,
    borderTopStyle: "solid",
    paddingTop: 6,
    fontSize: 7,
    color: "#7A8796",
    textAlign: "center",
    lineHeight: 1.45,
  },
});

function day(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const iso = typeof value === "string" ? value : value.toISOString();
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function joinParts(parts: Array<string | null | undefined | false>): string {
  return parts.filter((part): part is string => Boolean(part)).join("  ·  ");
}

function Mark({ logo, name }: { logo?: string | null; name: string }) {
  const src = printableLogo(logo);
  if (src) return <Image src={src} style={{ width: 72, height: 52, objectFit: "contain" }} />;
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 8,
        backgroundColor: PRIMARY,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 13 }}>
        {garageInitials(name)}
      </Text>
    </View>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

export function StatementDocument({ data }: { data: StatementPdfData }) {
  const g = data.garage;
  const footMain = g.footer?.trim() || joinParts([g.legalName || g.name, g.address]);
  const footLegal = joinParts([
    g.rccm && `RCCM ${g.rccm}`,
    g.ncc && `NCC ${g.ncc}`,
    g.phone && `Tél. ${g.phone}`,
    g.email,
  ]);
  return (
    <Document title={`Relevé de compte — ${data.customer.displayName}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.between}>
          <Mark logo={g.logo} name={g.legalName || g.name} />
          <View style={{ width: "68%", alignItems: "flex-end" }}>
            <Text style={styles.issuer}>{g.legalName || g.name}</Text>
            {g.name && g.legalName && g.name !== g.legalName && (
              <Text style={styles.issuerLine}>{g.name}</Text>
            )}
            {g.address && <Text style={styles.issuerLine}>{g.address}</Text>}
            {g.phone && <Text style={styles.issuerLine}>Tél. {g.phone}</Text>}
            {g.email && <Text style={styles.issuerLine}>{g.email}</Text>}
            {(g.rccm || g.ncc) && (
              <Text style={styles.issuerLine}>
                {joinParts([g.rccm && `RCCM ${g.rccm}`, g.ncc && `NCC ${g.ncc}`])}
              </Text>
            )}
          </View>
        </View>

        <Text style={styles.docTitle}>RELEVÉ DE COMPTE</Text>

        <View style={[styles.between, { alignItems: "flex-start" }]}>
          <View style={{ width: "46%" }}>
            <Meta label="Période du" value={day(data.from)} />
            <Meta label="Au" value={day(data.to)} />
            <Meta label="Solde d'ouverture" value={formatFCFA(data.openingBalance)} />
            <Meta label="Solde de clôture" value={formatFCFA(data.closingBalance)} />
          </View>
          <View style={styles.party}>
            <Text style={styles.partyLabel}>CLIENT</Text>
            <Text style={styles.partyName}>{data.customer.displayName}</Text>
            {data.customer.address && <Text style={styles.partyLine}>{data.customer.address}</Text>}
            {data.customer.phone && (
              <Text style={styles.partyLine}>Tél. {data.customer.phone}</Text>
            )}
            {data.customer.ncc && <Text style={styles.partyLine}>NCC {data.customer.ncc}</Text>}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Mouvements</Text>
          <View style={[styles.row, styles.thead]}>
            <Text style={[styles.th, styles.cDate]}>Date</Text>
            <Text style={[styles.th, styles.cRef]}>Document</Text>
            <Text style={[styles.th, styles.cLabel]}>Libellé</Text>
            <Text style={[styles.th, styles.cNum]}>Débit</Text>
            <Text style={[styles.th, styles.cNum]}>Crédit</Text>
            <Text style={[styles.th, styles.cNum]}>Solde</Text>
          </View>
          <View style={[styles.tr, { backgroundColor: ALT }]}>
            <Text style={[styles.td, styles.cDate]}>{day(data.from)}</Text>
            <Text style={[styles.td, styles.cRef]} />
            <Text style={[styles.td, styles.cLabel]}>Solde d&apos;ouverture</Text>
            <Text style={[styles.td, styles.cNum]} />
            <Text style={[styles.td, styles.cNum]} />
            <Text style={[styles.td, styles.cNum]}>{formatFCFA(data.openingBalance)}</Text>
          </View>
          {data.lines.map((line, index) => (
            <View key={index} style={styles.tr} wrap={false}>
              <Text style={[styles.td, styles.cDate]}>{day(line.date)}</Text>
              <Text style={[styles.td, styles.cRef]}>{line.reference}</Text>
              <Text style={[styles.td, styles.cLabel]}>{line.label}</Text>
              <Text style={[styles.td, styles.cNum]}>
                {line.debit ? formatFCFA(line.debit) : "—"}
              </Text>
              <Text style={[styles.td, styles.cNum]}>
                {line.credit ? formatFCFA(line.credit) : "—"}
              </Text>
              <Text style={[styles.td, styles.cNum]}>{formatFCFA(line.runningBalance)}</Text>
            </View>
          ))}
          <View style={styles.grand} wrap={false}>
            <Text style={[styles.grandText, styles.cDate]} />
            <Text style={[styles.grandText, styles.cRef]} />
            <Text style={[styles.grandText, styles.cLabel]}>Solde de clôture</Text>
            <Text style={[styles.grandText, styles.cNum]}>{formatFCFA(data.totalDebit)}</Text>
            <Text style={[styles.grandText, styles.cNum]}>{formatFCFA(data.totalCredit)}</Text>
            <Text style={[styles.grandText, styles.cNum]}>{formatFCFA(data.closingBalance)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Échu par ancienneté</Text>
          <View style={[styles.row, styles.thead]}>
            <Text style={styles.ageHead}>Non échu</Text>
            <Text style={styles.ageHead}>0 – 30 j</Text>
            <Text style={styles.ageHead}>31 – 60 j</Text>
            <Text style={styles.ageHead}>61 – 90 j</Text>
            <Text style={styles.ageHead}>+ 90 j</Text>
          </View>
          <View style={styles.tr}>
            <Text style={styles.ageCell}>{formatFCFA(data.aging.notDue)}</Text>
            <Text style={styles.ageCell}>{formatFCFA(data.aging.buckets.b0_30)}</Text>
            <Text style={styles.ageCell}>{formatFCFA(data.aging.buckets.b31_60)}</Text>
            <Text style={styles.ageCell}>{formatFCFA(data.aging.buckets.b61_90)}</Text>
            <Text style={styles.ageCell}>{formatFCFA(data.aging.buckets.b90p)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Factures ouvertes</Text>
          {data.openInvoices.length === 0 ? (
            <Text style={{ fontSize: 8, color: MUTED, paddingHorizontal: 8, paddingTop: 6 }}>
              Aucune facture ouverte.
            </Text>
          ) : (
            <>
              <View style={[styles.row, styles.thead]}>
                <Text style={[styles.th, styles.invRef]}>Facture</Text>
                <Text style={[styles.th, styles.invDue]}>Échéance</Text>
                <Text style={[styles.th, styles.invLate]}>Retard</Text>
                <Text style={[styles.th, styles.invBal]}>Reste dû</Text>
              </View>
              {data.openInvoices.map((invoice, index) => (
                <View key={index} style={styles.tr} wrap={false}>
                  <Text style={[styles.td, styles.invRef]}>
                    {invoice.number ?? "—"}
                    {invoice.fneNumber ? ` · FNE ${invoice.fneNumber}` : ""}
                  </Text>
                  <Text style={[styles.td, styles.invDue]}>{day(invoice.dueDate)}</Text>
                  <Text style={[styles.td, styles.invLate]}>
                    {invoice.daysOverdue > 0 ? `${invoice.daysOverdue} j` : "À échéance"}
                  </Text>
                  <Text style={[styles.td, styles.invBal]}>
                    {formatFCFA(invoice.balance)} / {formatFCFA(invoice.total)}
                  </Text>
                </View>
              ))}
            </>
          )}
        </View>

        {data.paymentInstructions && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>Moyens de paiement</Text>
            <Text style={{ fontSize: 8.5, paddingHorizontal: 8, paddingTop: 6, lineHeight: 1.45 }}>
              {data.paymentInstructions}
            </Text>
          </View>
        )}

        <Text style={styles.note}>Sauf erreur ou omission.</Text>

        <View style={styles.pageFoot} fixed>
          {footMain ? <Text>{footMain}</Text> : null}
          {footLegal ? <Text>{footLegal}</Text> : null}
        </View>
      </Page>
    </Document>
  );
}

export async function renderStatementPdf(data: StatementPdfData): Promise<Buffer> {
  return renderToBuffer(<StatementDocument data={data} />);
}
