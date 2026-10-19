// M05 §7 — PDF du devis : en-tête garage (logo, adresse, RCCM, NCC, régime), n° + version,
// validité, client (NCC entreprise), véhicule, lignes groupées par priorité, sous-totaux par
// groupe, remises, TVA, TTC, part assurance / franchise, conditions, zone de signature ou
// bloc « Accepté électroniquement … empreinte », lien public. Variante « expertise » (assureur) :
// détail MO (temps × taux) et références pièces. Données préparées côté serveur.
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatFCFA } from "@atelieros/core";

export type QuotePdfVariant = "customer" | "insurer" | "signed";

export interface QuotePdfLine {
  type: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  vatRate: number;
  total: number;
  payer: string;
  isOptional: boolean;
  accepted: boolean | null;
  reference?: string | null;
  hours?: number | null;
  rate?: number | null;
}

export interface QuotePdfGroup {
  label: string;
  priority: string | null;
  isOptional: boolean;
  explanation?: string | null;
  total: number;
  accepted: boolean | null;
  lines: QuotePdfLine[];
}

export interface QuotePdfData {
  variant: QuotePdfVariant;
  garage: {
    name: string;
    legalName?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    rccm?: string | null;
    ncc?: string | null;
    taxRegime?: string | null;
    logo?: string | null;
  };
  number: string;
  version: number;
  createdAt: string;
  validUntil: string;
  customer: { displayName: string; phone?: string | null; ncc?: string | null; address?: string | null };
  vehicle?: { plate: string; make: string; model: string; year?: number | null; mileage?: number | null } | null;
  repairOrderNumber?: string | null;
  groups: QuotePdfGroup[];
  totals: {
    subtotal: number;
    discountTotal: number;
    vatTotal: number;
    total: number;
    acceptedTotal: number;
    insuranceShare: number;
    customerShare: number;
    deductible: number;
  };
  terms: string;
  status: string;
  decision?: {
    signerName: string | null;
    decidedAt: string | null;
    channel: string | null;
    hash: string | null;
    signatureImage?: string | null;
  } | null;
  publicUrl?: string | null;
  insurer?: { name: string; claimNumber?: string | null } | null;
}

const PRIORITY_LABEL: Record<string, string> = {
  URGENT: "Urgent — à faire rapidement",
  WATCH: "À surveiller",
};

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  row: { flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  h1: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 5 },
  group: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 2 },
  muted: { color: "#555" },
  box: { border: "1pt solid #ccc", padding: 7, marginTop: 8 },
  th: { fontFamily: "Helvetica-Bold", borderBottom: "1pt solid #999", paddingVertical: 3 },
  td: { borderBottom: "0.5pt solid #ddd", paddingVertical: 3 },
  cDesc: { width: "44%" },
  cRef: { width: "16%" },
  cSmall: { width: "10%", textAlign: "right" },
  cTotal: { width: "14%", textAlign: "right" },
  footer: { marginTop: 14, fontSize: 8, color: "#555" },
  urgent: { color: "#b71c1c" },
  watch: { color: "#b26a00" },
});

function day(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function hour(iso: string | null | undefined): string {
  return iso ? iso.slice(11, 16) : "";
}

export function QuoteDocument({ data }: { data: QuotePdfData }) {
  const g = data.garage;
  const insurer = data.variant === "insurer";
  const title = insurer ? "Devis d'expertise" : "Devis";
  return (
    <Document title={`${title} — ${data.number}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.between}>
          <View>
            {g.logo && <Image src={g.logo} style={{ width: 90, height: 40, objectFit: "contain", marginBottom: 4 }} />}
            <Text style={styles.h1}>{g.name}</Text>
            {g.legalName && g.legalName !== g.name && <Text>{g.legalName}</Text>}
            {g.address && <Text>{g.address}</Text>}
            {g.phone && <Text>{g.phone}</Text>}
            {g.email && <Text>{g.email}</Text>}
            {g.rccm && <Text style={styles.muted}>RCCM : {g.rccm}</Text>}
            {g.ncc && <Text style={styles.muted}>NCC : {g.ncc}</Text>}
            {g.taxRegime && <Text style={styles.muted}>Régime : {g.taxRegime}</Text>}
          </View>
          <View>
            <Text style={styles.h1}>{title}</Text>
            <Text>
              N° {data.number}
              {data.version > 1 ? ` — version ${data.version}` : ""}
            </Text>
            <Text>Établi le {day(data.createdAt)}</Text>
            <Text>Valable jusqu&apos;au {day(data.validUntil)}</Text>
            {data.repairOrderNumber && <Text>OR lié : {data.repairOrderNumber}</Text>}
          </View>
        </View>

        <View style={[styles.box, styles.between]}>
          <View>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{data.customer.displayName}</Text>
            {data.customer.phone && <Text>{data.customer.phone}</Text>}
            {data.customer.ncc && <Text>NCC : {data.customer.ncc}</Text>}
            {data.customer.address && <Text>{data.customer.address}</Text>}
          </View>
          {data.vehicle && (
            <View>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>
                {data.vehicle.make} {data.vehicle.model}
                {data.vehicle.year ? ` (${data.vehicle.year})` : ""}
              </Text>
              <Text>Immatriculation : {data.vehicle.plate}</Text>
              {data.vehicle.mileage != null && <Text>Compteur : {data.vehicle.mileage.toLocaleString("fr-FR")} km</Text>}
            </View>
          )}
          {data.insurer && (
            <View>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>{data.insurer.name}</Text>
              {data.insurer.claimNumber && <Text>Sinistre : {data.insurer.claimNumber}</Text>}
            </View>
          )}
        </View>

        <Text style={styles.h2}>Travaux proposés</Text>
        <View style={[styles.row, styles.th]}>
          <Text style={styles.cDesc}>Désignation</Text>
          {insurer && <Text style={styles.cRef}>Référence</Text>}
          <Text style={styles.cSmall}>Qté</Text>
          <Text style={styles.cSmall}>PU HT</Text>
          <Text style={styles.cSmall}>Remise</Text>
          <Text style={styles.cTotal}>Total TTC</Text>
        </View>
        {data.groups.map((group, gi) => (
          <View key={gi} wrap={false}>
            <Text
              style={[
                styles.group,
                group.priority === "URGENT" ? styles.urgent : group.priority === "WATCH" ? styles.watch : {},
              ]}
            >
              {group.priority ? `${PRIORITY_LABEL[group.priority] ?? group.priority} — ` : ""}
              {group.label}
              {group.isOptional ? " (optionnel)" : ""}
              {group.accepted === true ? " — ACCEPTÉ" : group.accepted === false ? " — refusé" : ""}
            </Text>
            {group.explanation && !insurer && <Text style={styles.muted}>{group.explanation}</Text>}
            {group.lines.map((l, i) => (
              <View key={i} style={[styles.row, styles.td]}>
                <Text style={styles.cDesc}>
                  {l.description}
                  {insurer && l.type === "LABOR" && l.hours != null && l.rate != null
                    ? ` (${l.hours.toLocaleString("fr-FR")} h × ${formatFCFA(l.rate)})`
                    : ""}
                  {l.payer === "INSURANCE" ? " — assurance" : l.payer === "WARRANTY" ? " — garantie" : ""}
                </Text>
                {insurer && <Text style={styles.cRef}>{l.reference ?? ""}</Text>}
                <Text style={styles.cSmall}>{l.quantity.toLocaleString("fr-FR")}</Text>
                <Text style={styles.cSmall}>{formatFCFA(l.unitPrice)}</Text>
                <Text style={styles.cSmall}>{l.discountRate ? `${l.discountRate} %` : ""}</Text>
                <Text style={styles.cTotal}>{formatFCFA(l.total)}</Text>
              </View>
            ))}
            <Text style={{ textAlign: "right", marginTop: 1 }}>Sous-total groupe : {formatFCFA(group.total)}</Text>
          </View>
        ))}

        <View style={{ alignItems: "flex-end", marginTop: 8 }}>
          <Text>Total HT : {formatFCFA(data.totals.subtotal)}</Text>
          {data.totals.discountTotal > 0 && <Text>Remises : −{formatFCFA(data.totals.discountTotal)}</Text>}
          <Text>TVA : {formatFCFA(data.totals.vatTotal)}</Text>
          <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11 }}>Total TTC : {formatFCFA(data.totals.total)}</Text>
          {data.totals.insuranceShare > 0 && (
            <>
              <Text>Part assurance : {formatFCFA(data.totals.insuranceShare)}</Text>
              {data.totals.deductible > 0 && <Text>Franchise : {formatFCFA(data.totals.deductible)}</Text>}
              <Text>Part client : {formatFCFA(data.totals.customerShare)}</Text>
            </>
          )}
          {data.totals.acceptedTotal > 0 && (
            <Text style={{ fontFamily: "Helvetica-Bold" }}>Total accepté TTC : {formatFCFA(data.totals.acceptedTotal)}</Text>
          )}
        </View>

        <View style={styles.box}>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>Conditions</Text>
          <Text>{data.terms}</Text>
        </View>

        {data.decision && (data.variant === "signed" || data.decision.decidedAt) ? (
          <View style={styles.box}>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>Accord du client</Text>
            <Text>
              Accepté {data.decision.channel === "portal" ? "électroniquement " : ""}par {data.decision.signerName ?? "—"} le{" "}
              {day(data.decision.decidedAt)} à {hour(data.decision.decidedAt)}
              {data.decision.hash ? ` (empreinte ${data.decision.hash.slice(0, 8)}…)` : ""}
            </Text>
            {data.decision.signatureImage && (
              <Image src={data.decision.signatureImage} style={{ width: 160, height: 60 }} />
            )}
          </View>
        ) : (
          !insurer && (
            <View style={[styles.box, { height: 70 }]}>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>Bon pour accord — nom, date et signature du client</Text>
            </View>
          )
        )}

        {data.publicUrl && !insurer && (
          <Text style={styles.footer}>Consultez et validez ce devis en ligne : {data.publicUrl}</Text>
        )}
      </Page>
    </Document>
  );
}

export async function renderQuotePdf(data: QuotePdfData): Promise<Buffer> {
  return renderToBuffer(<QuoteDocument data={data} />);
}
