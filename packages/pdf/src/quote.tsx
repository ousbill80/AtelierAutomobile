// M05 §7 — PDF du devis : variante client, « Devis d'expertise » (assureur : détail MO temps ×
// taux et références pièces) et « Devis signé » (bloc d'acceptation électronique + empreinte).
// Données préparées côté serveur ; ce module ne fait que la mise en page.
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatFCFA } from "@atelieros/core";

export type QuotePdfVariant = "customer" | "insurer" | "signed";

export interface QuotePdfLine {
  type: string;
  description: string;
  reference?: string | null;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  total: number;
  payer: string;
  accepted: boolean | null;
}

export interface QuotePdfGroup {
  label: string;
  priority: string | null;
  isOptional: boolean;
  total: number;
  lines: QuotePdfLine[];
}

export interface QuotePdfData {
  variant: QuotePdfVariant;
  garage: {
    name: string;
    address?: string | null;
    phone?: string | null;
    rccm?: string | null;
    ncc?: string | null;
    taxRegime?: string | null;
    logo?: string | null;
  };
  number: string;
  version: number;
  createdAt: string;
  validUntil: string;
  customer: { displayName: string; ncc?: string | null; phone?: string | null };
  vehicle?: { plate: string; make: string; model: string; mileage?: number | null } | null;
  groups: QuotePdfGroup[];
  totals: {
    subtotal: number;
    discountTotal: number;
    vatTotal: number;
    total: number;
    insuranceShare: number;
    customerShare: number;
    acceptedTotal: number;
  };
  deductible?: number | null;
  termsText?: string | null;
  acceptance?: {
    signerName: string | null;
    decidedAt: string;
    channel: string | null;
    hash: string | null;
    ip?: string | null;
    signature?: string | null;
  } | null;
  publicUrl?: string | null;
}

const PRIORITY: Record<string, string> = { URGENT: "Urgent", WATCH: "À surveiller" };

function day(value: string): string {
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  row: { flexDirection: "row" },
  h1: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  h2: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 4 },
  muted: { color: "#555" },
  box: { border: "1pt solid #ccc", padding: 7, marginTop: 8 },
  th: { fontFamily: "Helvetica-Bold", borderBottom: "1pt solid #999", paddingVertical: 3 },
  td: { borderBottom: "0.5pt solid #ddd", paddingVertical: 3 },
  cDesc: { width: "44%" },
  cQty: { width: "10%", textAlign: "right" },
  cNum: { width: "15%", textAlign: "right" },
  cRem: { width: "8%", textAlign: "right" },
  cDec: { width: "8%", textAlign: "center" },
  footer: { marginTop: 14, fontSize: 8, color: "#555" },
});

export function QuoteDocument({ data }: { data: QuotePdfData }) {
  const g = data.garage;
  const title =
    data.variant === "insurer"
      ? "Devis d'expertise"
      : data.variant === "signed"
        ? "Devis signé"
        : "Devis";
  const showDecision = data.variant === "signed";
  return (
    <Document title={`${title} ${data.number} v${data.version}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.between}>
          <View>
            {g.logo && <Image src={g.logo} style={{ width: 80, height: 40, marginBottom: 4 }} />}
            <Text style={styles.h1}>{g.name}</Text>
            {g.address && <Text>{g.address}</Text>}
            {g.phone && <Text>Tél. {g.phone}</Text>}
            {(g.rccm || g.ncc) && (
              <Text style={styles.muted}>
                {g.rccm ? `RCCM ${g.rccm}` : ""} {g.ncc ? `· NCC ${g.ncc}` : ""}
                {g.taxRegime ? ` · ${g.taxRegime}` : ""}
              </Text>
            )}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.h1}>{title}</Text>
            <Text>
              {data.number} — version {data.version}
            </Text>
            <Text>Date : {day(data.createdAt)}</Text>
            <Text>Valable jusqu'au : {day(data.validUntil)}</Text>
          </View>
        </View>

        <View style={[styles.box, styles.between]}>
          <View>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>Client</Text>
            <Text>{data.customer.displayName}</Text>
            {data.customer.ncc && <Text>NCC {data.customer.ncc}</Text>}
          </View>
          {data.vehicle && (
            <View style={{ alignItems: "flex-end" }}>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>Véhicule</Text>
              <Text>
                {data.vehicle.make} {data.vehicle.model} · {data.vehicle.plate}
              </Text>
              {data.vehicle.mileage != null && (
                <Text>{data.vehicle.mileage.toLocaleString("fr-FR")} km</Text>
              )}
            </View>
          )}
        </View>

        {data.groups.map((group, gi) => (
          <View key={gi} wrap={false}>
            <Text style={styles.h2}>
              {group.priority ? `${PRIORITY[group.priority] ?? ""} — ` : ""}
              {group.label}
              {group.isOptional ? " (optionnel)" : ""}
            </Text>
            <View style={[styles.row, styles.th]}>
              <Text style={styles.cDesc}>Désignation</Text>
              <Text style={styles.cQty}>Qté</Text>
              <Text style={styles.cNum}>PU HT</Text>
              <Text style={styles.cRem}>Rem.</Text>
              <Text style={styles.cNum}>TTC</Text>
              {showDecision && <Text style={styles.cDec}>Accord</Text>}
            </View>
            {group.lines.map((l, li) => (
              <View key={li} style={[styles.row, styles.td]}>
                <Text style={styles.cDesc}>
                  {l.description}
                  {data.variant === "insurer" && l.reference ? ` (réf. ${l.reference})` : ""}
                  {l.payer === "INSURANCE" ? " — assurance" : ""}
                  {l.payer === "WARRANTY" || l.payer === "INTERNAL"
                    ? " — pris en charge par le garage"
                    : ""}
                </Text>
                <Text style={styles.cQty}>
                  {l.type === "LABOR" ? `${l.quantity} h` : l.quantity}
                </Text>
                <Text style={styles.cNum}>{formatFCFA(l.unitPrice)}</Text>
                <Text style={styles.cRem}>{l.discountRate ? `${l.discountRate} %` : ""}</Text>
                <Text style={styles.cNum}>{formatFCFA(l.total)}</Text>
                {showDecision && (
                  <Text style={styles.cDec}>
                    {l.accepted === true ? "Oui" : l.accepted === false ? "Non" : "—"}
                  </Text>
                )}
              </View>
            ))}
            <Text style={{ textAlign: "right", marginTop: 2 }}>
              Sous-total : {formatFCFA(group.total)} TTC
            </Text>
          </View>
        ))}

        <View style={[styles.box, { alignItems: "flex-end" }]}>
          <Text>Total HT avant remise : {formatFCFA(data.totals.subtotal)}</Text>
          {data.totals.discountTotal > 0 && (
            <Text>Remises : −{formatFCFA(data.totals.discountTotal)}</Text>
          )}
          <Text>TVA : {formatFCFA(data.totals.vatTotal)}</Text>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>
            Total TTC : {formatFCFA(data.totals.total)}
          </Text>
          {data.totals.insuranceShare > 0 && (
            <>
              <Text>Part assurance : {formatFCFA(data.totals.insuranceShare)}</Text>
              {data.deductible ? <Text>Franchise : {formatFCFA(data.deductible)}</Text> : null}
              <Text>Part client : {formatFCFA(data.totals.customerShare)}</Text>
            </>
          )}
          {showDecision && (
            <Text style={{ fontFamily: "Helvetica-Bold" }}>
              Total accepté : {formatFCFA(data.totals.acceptedTotal)} TTC
            </Text>
          )}
        </View>

        {data.termsText && <Text style={styles.footer}>{data.termsText}</Text>}

        {data.acceptance ? (
          <View style={styles.box}>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>
              Accepté électroniquement
              {data.acceptance.signerName ? ` par ${data.acceptance.signerName}` : ""} le{" "}
              {data.acceptance.decidedAt}
              {data.acceptance.hash ? ` (empreinte ${data.acceptance.hash.slice(0, 12)}…)` : ""}
            </Text>
            {data.acceptance.ip && <Text style={styles.muted}>Réseau : {data.acceptance.ip}</Text>}
            {data.acceptance.signature && (
              <Image src={data.acceptance.signature} style={{ width: 160, height: 60 }} />
            )}
          </View>
        ) : (
          <View style={[styles.box, { height: 70 }]}>
            <Text>Bon pour accord — date et signature du client :</Text>
          </View>
        )}

        {data.publicUrl && (
          <Text style={styles.footer}>Consulter et valider en ligne : {data.publicUrl}</Text>
        )}
      </Page>
    </Document>
  );
}

export async function renderQuotePdf(data: QuotePdfData): Promise<Buffer> {
  return renderToBuffer(<QuoteDocument data={data} />);
}
