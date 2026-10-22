// M08 §7 — « Z de caisse » (A4) : rapport figé de clôture d'une session — fond, encaissements
// par mode, sorties (dépenses, versements, remboursements), espèces attendues / comptées, écart,
// comptage par coupures, validation. Données préparées côté serveur (montants déjà formatables).
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatFCFA } from "@atelieros/core";

export interface CashClosingPdfData {
  garage: { name: string; address?: string | null; phone?: string | null; ncc?: string | null };
  site: string;
  /** Dates déjà formatées `dd/MM/yyyy HH:mm` dans le fuseau de l'organisation. */
  openedAt: string;
  closedAt: string | null;
  openedBy: string;
  closedBy: string | null;
  lateClose: boolean;
  openingFloat: number;
  byMethod: { label: string; amount: number }[];
  totalReceived: number;
  pendingCheques: number;
  cashPayments: number;
  expensesTotal: number;
  cashRefunds: number;
  dropsTotal: number;
  expectedCash: number;
  countedCash: number | null;
  difference: number | null;
  notes: string | null;
  denominations: { value: number; count: number }[];
  expenses: { time: string; category: string; description: string; amount: number }[];
  drops: { time: string; destination: string; reference: string | null; amount: number }[];
  counts: { payments: number; expenses: number; drops: number; refunds: number };
  review: { by: string; at: string; comment: string | null } | null;
  printedAt: string;
}

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9.5, fontFamily: "Helvetica", color: "#111" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  garage: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  muted: { color: "#555" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", textAlign: "right" },
  section: { marginTop: 12 },
  h2: {
    fontSize: 10.5,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
    paddingBottom: 3,
    borderBottom: "0.75pt solid #999",
  },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  rowStrong: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    marginTop: 2,
    borderTop: "0.75pt solid #999",
    fontFamily: "Helvetica-Bold",
  },
  grid: { flexDirection: "row", gap: 18 },
  col: { flex: 1 },
  bad: { color: "#b42318" },
  ok: { color: "#067647" },
  cell: { flex: 1 },
  cellWide: { flex: 3 },
  cellRight: { flex: 1.2, textAlign: "right" },
  footer: { marginTop: 24, flexDirection: "row", gap: 24 },
  sign: { flex: 1, borderTop: "0.75pt solid #999", paddingTop: 4, color: "#555" },
});

function Line({ label, amount, strong }: { label: string; amount: number; strong?: boolean }) {
  return (
    <View style={strong ? s.rowStrong : s.row}>
      <Text>{label}</Text>
      <Text>{formatFCFA(amount)}</Text>
    </View>
  );
}

export function CashClosingDocument({ data }: { data: CashClosingPdfData }) {
  const diff = data.difference;
  return (
    <Document title={`Z de caisse — ${data.site} — ${data.openedAt}`}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.garage}>{data.garage.name}</Text>
            {data.garage.address && <Text style={s.muted}>{data.garage.address}</Text>}
            {data.garage.phone && <Text style={s.muted}>Tél. {data.garage.phone}</Text>}
            {data.garage.ncc && <Text style={s.muted}>NCC {data.garage.ncc}</Text>}
          </View>
          <View>
            <Text style={s.title}>Z de caisse</Text>
            <Text style={[s.muted, { textAlign: "right" }]}>Site : {data.site}</Text>
            {!data.closedAt && (
              <Text style={[s.bad, { textAlign: "right" }]}>Session non clôturée</Text>
            )}
          </View>
        </View>

        <View style={s.grid}>
          <View style={s.col}>
            <Text>Ouverture : {data.openedAt}</Text>
            <Text>Par : {data.openedBy}</Text>
          </View>
          <View style={s.col}>
            <Text>Clôture : {data.closedAt ?? "—"}</Text>
            <Text>Par : {data.closedBy ?? "—"}</Text>
            {data.lateClose && <Text style={s.bad}>Clôture tardive</Text>}
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.h2}>Encaissements par mode de paiement</Text>
          {data.byMethod.length === 0 ? (
            <Text style={s.muted}>Aucun encaissement.</Text>
          ) : (
            data.byMethod.map((m) => <Line key={m.label} label={m.label} amount={m.amount} />)
          )}
          <Line
            label={`Total encaissé (${data.counts.payments} opérations)`}
            amount={data.totalReceived}
            strong
          />
          {data.pendingCheques > 0 && (
            <Text style={s.muted}>
              Chèques en attente d'encaissement (non comptés) : {formatFCFA(data.pendingCheques)}
            </Text>
          )}
        </View>

        <View style={s.section}>
          <Text style={s.h2}>Espèces</Text>
          <Line label="Fond de caisse" amount={data.openingFloat} />
          <Line label="+ Espèces encaissées" amount={data.cashPayments} />
          <Line label={`− Dépenses (${data.counts.expenses})`} amount={-data.expensesTotal} />
          <Line
            label={`− Remboursements espèces (${data.counts.refunds})`}
            amount={-data.cashRefunds}
          />
          <Line
            label={`− Versements coffre / banque (${data.counts.drops})`}
            amount={-data.dropsTotal}
          />
          <Line label="Espèces attendues" amount={data.expectedCash} strong />
          {data.countedCash !== null && <Line label="Espèces comptées" amount={data.countedCash} />}
          {diff !== null && (
            <View style={s.rowStrong}>
              <Text>Écart</Text>
              <Text style={diff === 0 ? s.ok : s.bad}>
                {diff > 0 ? "+" : ""}
                {formatFCFA(diff)}
              </Text>
            </View>
          )}
          {data.notes && <Text style={s.muted}>Commentaire : {data.notes}</Text>}
        </View>

        {data.denominations.length > 0 && (
          <View style={s.section}>
            <Text style={s.h2}>Comptage par coupures</Text>
            {data.denominations.map((d) => (
              <View key={d.value} style={s.row}>
                <Text>
                  {d.count} × {formatFCFA(d.value)}
                </Text>
                <Text>{formatFCFA(d.value * d.count)}</Text>
              </View>
            ))}
          </View>
        )}

        {data.expenses.length > 0 && (
          <View style={s.section}>
            <Text style={s.h2}>Détail des dépenses</Text>
            {data.expenses.map((e, i) => (
              <View key={i} style={s.row}>
                <Text style={s.cell}>{e.time}</Text>
                <Text style={s.cell}>{e.category}</Text>
                <Text style={s.cellWide}>{e.description}</Text>
                <Text style={s.cellRight}>{formatFCFA(e.amount)}</Text>
              </View>
            ))}
          </View>
        )}

        {data.drops.length > 0 && (
          <View style={s.section}>
            <Text style={s.h2}>Détail des versements</Text>
            {data.drops.map((d, i) => (
              <View key={i} style={s.row}>
                <Text style={s.cell}>{d.time}</Text>
                <Text style={s.cell}>{d.destination}</Text>
                <Text style={s.cellWide}>{d.reference ?? ""}</Text>
                <Text style={s.cellRight}>{formatFCFA(d.amount)}</Text>
              </View>
            ))}
          </View>
        )}

        {data.review && (
          <View style={s.section}>
            <Text style={s.h2}>Validation</Text>
            <Text>
              Écart validé par {data.review.by} le {data.review.at}
              {data.review.comment ? ` — « ${data.review.comment} »` : ""}
            </Text>
          </View>
        )}

        <View style={s.footer}>
          <Text style={s.sign}>Signature du caissier</Text>
          <Text style={s.sign}>Signature du gérant</Text>
        </View>
        <Text style={[s.muted, { marginTop: 12, fontSize: 8 }]}>Imprimé le {data.printedAt}</Text>
      </Page>
    </Document>
  );
}

export async function renderCashClosingPdf(data: CashClosingPdfData): Promise<Buffer> {
  return renderToBuffer(<CashClosingDocument data={data} />);
}
