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

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  row: { flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  h1: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  bold: { fontFamily: "Helvetica-Bold" },
  muted: { color: "#555" },
  box: { border: "1pt solid #ccc", padding: 8, marginTop: 10, width: "48%" },
  th: { fontFamily: "Helvetica-Bold", borderBottom: "1pt solid #999", paddingVertical: 3 },
  td: { borderBottom: "0.5pt solid #ddd", paddingVertical: 3 },
  cRef: { width: "18%" },
  cLabel: { width: "38%" },
  cQty: { width: "12%", textAlign: "right" },
  cNum: { width: "16%", textAlign: "right" },
  footer: { marginTop: 18, fontSize: 8, color: "#555" },
});

export function PurchaseOrderDocument({ data }: { data: PurchaseOrderPdfData }) {
  return (
    <Document title={`Bon de commande ${data.number}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.between}>
          <View>
            <Text style={styles.h1}>{data.garage.legalName ?? data.garage.name}</Text>
            <Text>{data.site.name}</Text>
            {data.site.address && <Text>{data.site.address}</Text>}
            {data.site.phone && <Text>{data.site.phone}</Text>}
            {data.garage.ncc && <Text style={styles.muted}>NCC : {data.garage.ncc}</Text>}
          </View>
          <View>
            <Text style={styles.h1}>Bon de commande</Text>
            <Text style={styles.bold}>{data.number}</Text>
            {data.orderedAt && <Text>Date : {data.orderedAt}</Text>}
            {data.expectedAt && <Text>Livraison souhaitée : {data.expectedAt}</Text>}
          </View>
        </View>

        <View style={styles.box}>
          <Text style={styles.bold}>Fournisseur</Text>
          <Text>{data.supplier.name}</Text>
          {data.supplier.address && <Text>{data.supplier.address}</Text>}
          {data.supplier.phone && <Text>{data.supplier.phone}</Text>}
          {data.supplier.email && <Text>{data.supplier.email}</Text>}
        </View>

        <View style={[styles.row, styles.th, { marginTop: 14 }]}>
          <Text style={styles.cRef}>Référence</Text>
          <Text style={styles.cLabel}>Désignation</Text>
          <Text style={styles.cQty}>Quantité</Text>
          <Text style={styles.cNum}>PU HT</Text>
          <Text style={styles.cNum}>Total HT</Text>
        </View>
        {data.lines.map((l, i) => (
          <View key={i} style={[styles.row, styles.td]} wrap={false}>
            <Text style={styles.cRef}>{l.sku}</Text>
            <Text style={styles.cLabel}>{l.name}</Text>
            <Text style={styles.cQty}>
              {formatQty(l.quantity, l.quantityScale)} {l.unit}
            </Text>
            <Text style={styles.cNum}>{formatFCFA(l.unitCost)}</Text>
            <Text style={styles.cNum}>{formatFCFA(l.total)}</Text>
          </View>
        ))}
        <View style={[styles.row, styles.th]}>
          <Text style={styles.cRef} />
          <Text style={styles.cLabel}>Total HT</Text>
          <Text style={styles.cQty} />
          <Text style={styles.cNum} />
          <Text style={styles.cNum}>{formatFCFA(data.total)}</Text>
        </View>
        {data.notes && (
          <View style={[styles.box, { width: "100%" }]}>
            <Text>{data.notes}</Text>
          </View>
        )}
        <Text style={styles.footer}>
          Merci de confirmer la disponibilité et le délai de livraison.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderPurchaseOrderPdf(data: PurchaseOrderPdfData): Promise<Buffer> {
  return renderToBuffer(<PurchaseOrderDocument data={data} />);
}
