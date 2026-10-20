// M08 §7 — PDF de la facture (A4, mentions RG-M08-04, montant en lettres, bloc FNE) et du reçu
// de paiement (ticket 80 mm). Données préparées côté serveur ; ce module ne fait que la mise en page.
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { amountInWords, formatFCFA } from "@atelieros/core";
import QRCode from "qrcode";

export interface InvoicePdfLine {
  type: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  vatRate: number;
  lineSubtotal: number;
  lineTotal: number;
}

export interface InvoicePdfData {
  kind: "INVOICE" | "DEPOSIT" | "CREDIT_NOTE";
  /** null = brouillon (« Brouillon » et filigrane). */
  number: string | null;
  issuedAt: string | null;
  dueDate: string | null;
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
    footer?: string | null;
  };
  customer: {
    displayName: string;
    address?: string | null;
    phone?: string | null;
    ncc?: string | null;
    rccm?: string | null;
  };
  vehicle?: { plate: string; make: string; model: string; mileage?: number | null } | null;
  repairOrderNumber?: string | null;
  creditedInvoiceNumber?: string | null;
  lines: InvoicePdfLine[];
  totals: { subtotal: number; discountTotal: number; vatTotal: number; total: number };
  amountPaid: number;
  balance: number;
  vatEnabled: boolean;
  paymentTerms: string;
  /** `qrCode` : image (data URL) ou contenu décodé du QR, transformé en image au rendu. */
  fne: {
    status: string;
    number?: string | null;
    qrCode?: string | null;
    certifiedAt?: string | null;
  };
  notes?: string | null;
}

const TAX_REGIME: Record<string, string> = {
  RSI: "Régime simplifié d'imposition",
  RNI: "Régime normal d'imposition",
  RMI: "Régime des microentreprises",
  ENTREPRENANT: "Régime de l'entreprenant",
};

const KIND_TITLE: Record<InvoicePdfData["kind"], string> = {
  INVOICE: "Facture",
  DEPOSIT: "Facture d'acompte",
  CREDIT_NOTE: "Avoir",
};

function day(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  row: { flexDirection: "row" },
  h1: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  bold: { fontFamily: "Helvetica-Bold" },
  muted: { color: "#555" },
  box: { border: "1pt solid #ccc", padding: 7, marginTop: 8 },
  th: { fontFamily: "Helvetica-Bold", borderBottom: "1pt solid #999", paddingVertical: 3 },
  td: { borderBottom: "0.5pt solid #ddd", paddingVertical: 3 },
  cDesc: { width: "40%" },
  cQty: { width: "8%", textAlign: "right" },
  cNum: { width: "14%", textAlign: "right" },
  cRem: { width: "8%", textAlign: "right" },
  cVat: { width: "8%", textAlign: "right" },
  watermark: {
    position: "absolute",
    top: 330,
    left: 90,
    fontSize: 46,
    color: "#e5e5e5",
    transform: "rotate(-30deg)",
  },
  footer: { marginTop: 14, fontSize: 8, color: "#555" },
});

export function InvoiceDocument({ data }: { data: InvoicePdfData }) {
  const g = data.garage;
  const title = KIND_TITLE[data.kind];
  const fnePending = data.fne.status === "PENDING" || data.fne.status === "FAILED";
  const certified = data.fne.status === "CERTIFIED" || data.fne.status === "MANUAL";
  return (
    <Document title={`${title} ${data.number ?? "brouillon"}`}>
      <Page size="A4" style={styles.page}>
        {!data.number && <Text style={styles.watermark}>BROUILLON</Text>}
        {data.number && fnePending && <Text style={styles.watermark}>FNE en attente</Text>}
        <View style={styles.between}>
          <View style={{ maxWidth: "55%" }}>
            {g.logo && <Image src={g.logo} style={{ width: 80, height: 40, marginBottom: 4 }} />}
            <Text style={styles.h1}>{g.legalName || g.name}</Text>
            {g.address && <Text>{g.address}</Text>}
            {g.phone && <Text>Tél. {g.phone}</Text>}
            {g.email && <Text>{g.email}</Text>}
            <Text style={styles.muted}>
              {g.rccm ? `RCCM ${g.rccm}` : ""}
              {g.ncc ? ` · NCC ${g.ncc}` : ""}
            </Text>
            {g.taxRegime && (
              <Text style={styles.muted}>{TAX_REGIME[g.taxRegime] ?? g.taxRegime}</Text>
            )}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.h1}>{title}</Text>
            <Text style={styles.bold}>{data.number ?? "Brouillon"}</Text>
            <Text>Date : {day(data.issuedAt)}</Text>
            {data.kind !== "CREDIT_NOTE" && <Text>Échéance : {day(data.dueDate)}</Text>}
            {data.creditedInvoiceNumber && (
              <Text>Avoir sur la facture {data.creditedInvoiceNumber}</Text>
            )}
            {data.repairOrderNumber && <Text>OR : {data.repairOrderNumber}</Text>}
          </View>
        </View>

        <View style={[styles.box, styles.between]}>
          <View style={{ maxWidth: "55%" }}>
            <Text style={styles.bold}>Client</Text>
            <Text>{data.customer.displayName}</Text>
            {data.customer.address && <Text>{data.customer.address}</Text>}
            {data.customer.phone && <Text>{data.customer.phone}</Text>}
            {(data.customer.ncc || data.customer.rccm) && (
              <Text style={styles.muted}>
                {data.customer.ncc ? `NCC ${data.customer.ncc}` : ""}
                {data.customer.rccm ? ` · RCCM ${data.customer.rccm}` : ""}
              </Text>
            )}
          </View>
          {data.vehicle && (
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.bold}>Véhicule</Text>
              <Text>
                {data.vehicle.make} {data.vehicle.model}
              </Text>
              <Text>{data.vehicle.plate}</Text>
              {data.vehicle.mileage != null && (
                <Text>{data.vehicle.mileage.toLocaleString("fr-FR")} km</Text>
              )}
            </View>
          )}
        </View>

        <View style={{ marginTop: 10 }}>
          <View style={[styles.row, styles.th]}>
            <Text style={styles.cDesc}>Désignation</Text>
            <Text style={styles.cQty}>Qté</Text>
            <Text style={styles.cNum}>PU HT</Text>
            <Text style={styles.cRem}>Rem.</Text>
            <Text style={styles.cVat}>TVA</Text>
            <Text style={styles.cNum}>Total HT</Text>
          </View>
          {data.lines.map((l, i) => (
            <View key={i} style={[styles.row, styles.td]} wrap={false}>
              <Text style={styles.cDesc}>{l.description}</Text>
              <Text style={styles.cQty}>
                {l.type === "LABOR" ? `${l.quantity} h` : l.quantity.toLocaleString("fr-FR")}
              </Text>
              <Text style={styles.cNum}>{formatFCFA(l.unitPrice)}</Text>
              <Text style={styles.cRem}>{l.discountRate ? `${l.discountRate} %` : ""}</Text>
              <Text style={styles.cVat}>{data.vatEnabled ? `${l.vatRate} %` : "—"}</Text>
              <Text style={styles.cNum}>{formatFCFA(l.lineSubtotal)}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.between, { marginTop: 8 }]} wrap={false}>
          <View style={{ width: "50%" }}>
            <Text style={styles.bold}>
              Arrêtée la présente {title.toLowerCase()} à la somme de :
            </Text>
            <Text>{amountInWords(Math.abs(data.totals.total))}</Text>
            <Text style={[styles.muted, { marginTop: 6 }]}>{data.paymentTerms}</Text>
            {!data.vatEnabled && <Text style={styles.muted}>TVA non applicable.</Text>}
          </View>
          <View style={[styles.box, { width: "45%", marginTop: 0, alignItems: "flex-end" }]}>
            {data.totals.discountTotal !== 0 && (
              <Text>
                Total HT brut : {formatFCFA(data.totals.subtotal + data.totals.discountTotal)}
              </Text>
            )}
            {data.totals.discountTotal !== 0 && (
              <Text>Remises : −{formatFCFA(data.totals.discountTotal)}</Text>
            )}
            <Text>Total HT : {formatFCFA(data.totals.subtotal)}</Text>
            <Text>TVA : {formatFCFA(data.totals.vatTotal)}</Text>
            <Text style={styles.bold}>Total TTC : {formatFCFA(data.totals.total)}</Text>
            {data.kind !== "CREDIT_NOTE" && data.number && (
              <>
                <Text>Déjà payé : {formatFCFA(data.amountPaid)}</Text>
                <Text style={styles.bold}>Reste à payer : {formatFCFA(data.balance)}</Text>
              </>
            )}
          </View>
        </View>

        {data.notes && <Text style={styles.footer}>{data.notes}</Text>}

        {data.fne.status !== "NOT_REQUIRED" && data.number && (
          <View style={[styles.box, styles.between]} wrap={false}>
            <View>
              {fneBlockLines(data.fne).map((line, i) => (
                <Text key={i} style={i === 0 ? styles.bold : undefined}>
                  {line}
                </Text>
              ))}
            </View>
            {certified && data.fne.qrCode?.startsWith("data:image") && (
              <Image src={data.fne.qrCode} style={{ width: 70, height: 70 }} />
            )}
          </View>
        )}

        {g.footer && <Text style={styles.footer}>{g.footer}</Text>}
      </Page>
    </Document>
  );
}

/** Lignes du bloc FNE (RG-M08-04) : numéro fiscal et date, ou mention d'attente. */
export function fneBlockLines(fne: InvoicePdfData["fne"]): string[] {
  const lines = ["Facture normalisée électronique (FNE)"];
  const certified = fne.status === "CERTIFIED" || fne.status === "MANUAL";
  if (!certified || !fne.number) return [...lines, "FNE en attente de certification"];
  lines.push(`N° fiscal : ${fne.number}`);
  if (fne.certifiedAt) lines.push(`Certifiée le ${day(fne.certifiedAt)}`);
  return lines;
}

/** QR FNE : une image fournie est gardée telle quelle, un contenu décodé est encodé en QR. */
export async function fneQrImage(qrCode: string | null | undefined): Promise<string | null> {
  if (!qrCode) return null;
  if (qrCode.startsWith("data:image")) return qrCode;
  return QRCode.toDataURL(qrCode, { margin: 1, width: 240, errorCorrectionLevel: "M" });
}

export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const certified = data.fne.status === "CERTIFIED" || data.fne.status === "MANUAL";
  const qrCode = certified ? await fneQrImage(data.fne.qrCode) : null;
  return renderToBuffer(<InvoiceDocument data={{ ...data, fne: { ...data.fne, qrCode } }} />);
}

// ───────────── Reçu de paiement (ticket 80 mm) ─────────────

export interface ReceiptPdfData {
  number: string;
  receivedAt: string;
  garage: { name: string; address?: string | null; phone?: string | null; ncc?: string | null };
  customer: string;
  method: string;
  reference?: string | null;
  amount: number;
  status: string;
  allocations: { invoiceNumber: string; amount: number; balanceAfter: number }[];
  unallocated: number;
  cashier?: string | null;
}

const ticket = StyleSheet.create({
  page: { padding: 10, fontSize: 8, fontFamily: "Helvetica", color: "#111" },
  center: { textAlign: "center" },
  bold: { fontFamily: "Helvetica-Bold" },
  big: { fontSize: 11, fontFamily: "Helvetica-Bold", textAlign: "center", marginVertical: 4 },
  sep: { borderBottom: "0.5pt dashed #777", marginVertical: 4 },
  between: { flexDirection: "row", justifyContent: "space-between" },
});

export function ReceiptDocument({ data }: { data: ReceiptPdfData }) {
  return (
    <Document title={`Reçu ${data.number}`}>
      {/* 80 mm ≈ 227 pt ; hauteur suffisante pour un ticket courant. */}
      <Page size={[227, 420]} style={ticket.page}>
        <Text style={[ticket.center, ticket.bold]}>{data.garage.name}</Text>
        {data.garage.address && <Text style={ticket.center}>{data.garage.address}</Text>}
        {data.garage.phone && <Text style={ticket.center}>Tél. {data.garage.phone}</Text>}
        {data.garage.ncc && <Text style={ticket.center}>NCC {data.garage.ncc}</Text>}
        <View style={ticket.sep} />
        <Text style={ticket.big}>Reçu {data.number}</Text>
        <Text style={ticket.center}>{data.receivedAt}</Text>
        <View style={ticket.sep} />
        <Text>Client : {data.customer}</Text>
        <Text>
          Mode : {data.method}
          {data.reference ? ` — réf. ${data.reference}` : ""}
        </Text>
        {data.status === "PENDING" && (
          <Text style={ticket.bold}>Chèque en attente d'encaissement</Text>
        )}
        <Text style={ticket.big}>{formatFCFA(data.amount)}</Text>
        <Text style={ticket.center}>{amountInWords(data.amount)}</Text>
        <View style={ticket.sep} />
        {data.allocations.map((a, i) => (
          <View key={i}>
            <View style={ticket.between}>
              <Text>Facture {a.invoiceNumber}</Text>
              <Text>{formatFCFA(a.amount)}</Text>
            </View>
            <Text>Reste à payer : {formatFCFA(a.balanceAfter)}</Text>
          </View>
        ))}
        {data.unallocated > 0 && (
          <View style={ticket.between}>
            <Text>Crédit / trop-perçu</Text>
            <Text>{formatFCFA(data.unallocated)}</Text>
          </View>
        )}
        <View style={ticket.sep} />
        {data.cashier && <Text>Encaissé par : {data.cashier}</Text>}
        <Text style={[ticket.center, { marginTop: 6 }]}>Merci de votre confiance.</Text>
      </Page>
    </Document>
  );
}

export async function renderReceiptPdf(data: ReceiptPdfData): Promise<Buffer> {
  return renderToBuffer(<ReceiptDocument data={data} />);
}
