// US-M07-07 — bon de commande fournisseur (PDF). Données préparées côté serveur
// (route /api/achats/[id]/pdf) ; ce module ne fait que la mise en page.
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatFCFA, formatQty } from "@atelieros/core";

export interface PurchaseOrderPdfData {
  garage: { name: string; legalName?: string | null; address?: string | null; ncc?: string | null };
  site: { name: string; address?: string | null; phone?: string | null };
  supplier: { name: string; phone?: string | null; email?: string | null; address?: string | null };
  number: string;
  orderedAt?: string | null; // dd/MM/yyyy
  expectedAt?: string | null; // dd/MM/yyyy
  notes?: string | null;
  lines: {
    sku: string;
    name: string;
    unit: string;
    quantity: number; // unités de base
    quantityScale: number;
    unitCost: number;
    total: number;
  }[];
  total: number;
}

/** Marque AtelierOS : bleu pétrole pour la structure, orange atelier pour le total. */
const PRIMARY = "#0C2A39";
const PRIMARY_SOFT = "#E9F2F7";
const ORANGE = "#EB6120";
const INK = "#121F28";
const MUTED = "#545F68";
const LINE = "#D6DBE0";

const styles = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingHorizontal: 32,
    paddingBottom: 36,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: INK,
  },
  between: { flexDirection: "row", justifyContent: "space-between" },
  row: { flexDirection: "row" },
  bold: { fontFamily: "Helvetica-Bold" },
  issuer: { fontFamily: "Helvetica-Bold", fontSize: 12, marginBottom: 2 },
  issuerLine: { fontSize: 8, color: "#36454E", lineHeight: 1.35 },
  docTitle: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.6,
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
  partyLine: { fontSize: 8, lineHeight: 1.35 },
  thead: { backgroundColor: PRIMARY },
  th: {
    color: "#ffffff",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  tr: {
    alignItems: "flex-start",
    borderBottomWidth: 0.4,
    borderBottomColor: LINE,
    borderBottomStyle: "solid",
  },
  td: { fontSize: 8, paddingVertical: 6, paddingHorizontal: 4 },
  cRef: { width: "18%" },
  cLabel: { width: "36%" },
  cQty: { width: "14%", textAlign: "right" },
  cNum: { width: "16%", textAlign: "right" },
  sums: { width: 220, marginTop: 8 },
  grand: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: ORANGE,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  grandText: { color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 10 },
  section: { marginTop: 12 },
  sectionTitle: {
    backgroundColor: PRIMARY_SOFT,
    color: PRIMARY,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  sectionBody: { paddingTop: 6, paddingHorizontal: 8, fontSize: 8.5, lineHeight: 1.45 },
  close: {
    marginTop: 12,
    backgroundColor: PRIMARY_SOFT,
    paddingVertical: 7,
    paddingHorizontal: 8,
    fontSize: 8.5,
  },
});

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

export function PurchaseOrderDocument({ data }: { data: PurchaseOrderPdfData }) {
  const legalName = data.garage.legalName || data.garage.name;
  const deliveryAddress = data.site.address || data.garage.address;
  return (
    <Document title={`Bon de commande ${data.number}`}>
      <Page size="A4" style={styles.page}>
        <View>
          <Text style={styles.issuer}>{legalName}</Text>
          {data.garage.name !== legalName && (
            <Text style={styles.issuerLine}>{data.garage.name}</Text>
          )}
          <Text style={styles.issuerLine}>{data.site.name}</Text>
          {deliveryAddress && <Text style={styles.issuerLine}>{deliveryAddress}</Text>}
          {data.site.phone && <Text style={styles.issuerLine}>Tél. {data.site.phone}</Text>}
          {data.garage.ncc && <Text style={styles.issuerLine}>NCC {data.garage.ncc}</Text>}
        </View>

        <Text style={styles.docTitle}>BON DE COMMANDE</Text>

        <View style={[styles.between, { alignItems: "flex-start" }]}>
          <View style={{ width: "46%" }}>
            <Meta label="N°" value={data.number} />
            {data.orderedAt && <Meta label="Date" value={data.orderedAt} />}
            {data.expectedAt && <Meta label="Livraison souhaitée" value={data.expectedAt} />}
          </View>
          <View style={styles.party}>
            <Text style={styles.partyLabel}>FOURNISSEUR</Text>
            <Text style={styles.partyName}>{data.supplier.name}</Text>
            {data.supplier.address && <Text style={styles.partyLine}>{data.supplier.address}</Text>}
            {data.supplier.phone && (
              <Text style={styles.partyLine}>Tél. {data.supplier.phone}</Text>
            )}
            {data.supplier.email && <Text style={styles.partyLine}>{data.supplier.email}</Text>}
          </View>
        </View>

        <View style={{ marginTop: 16 }}>
          <View style={[styles.row, styles.thead]}>
            <Text style={[styles.th, styles.cRef]}>Référence</Text>
            <Text style={[styles.th, styles.cLabel]}>Désignation</Text>
            <Text style={[styles.th, styles.cQty]}>Quantité</Text>
            <Text style={[styles.th, styles.cNum]}>PU HT</Text>
            <Text style={[styles.th, styles.cNum]}>Total HT</Text>
          </View>
          {data.lines.map((l, i) => (
            <View key={i} style={[styles.row, styles.tr]} wrap={false}>
              <Text style={[styles.td, styles.cRef]}>{l.sku}</Text>
              <Text style={[styles.td, styles.cLabel]}>{l.name}</Text>
              <Text style={[styles.td, styles.cQty]}>
                {formatQty(l.quantity, l.quantityScale)} {l.unit}
              </Text>
              <Text style={[styles.td, styles.cNum]}>{formatFCFA(l.unitCost)}</Text>
              <Text style={[styles.td, styles.cNum]}>{formatFCFA(l.total)}</Text>
            </View>
          ))}
        </View>

        <View style={{ alignItems: "flex-end" }} wrap={false}>
          <View style={styles.sums}>
            <View style={styles.grand}>
              <Text style={styles.grandText}>TOTAL HT</Text>
              <Text style={styles.grandText}>{formatFCFA(data.total)}</Text>
            </View>
          </View>
        </View>

        {data.notes && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <View style={styles.sectionBody}>
              <Text>{data.notes}</Text>
            </View>
          </View>
        )}

        <View style={styles.close} wrap={false}>
          <Text style={styles.bold}>
            Merci de confirmer la disponibilité et le délai de livraison.
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderPurchaseOrderPdf(data: PurchaseOrderPdfData): Promise<Buffer> {
  return renderToBuffer(<PurchaseOrderDocument data={data} />);
}
