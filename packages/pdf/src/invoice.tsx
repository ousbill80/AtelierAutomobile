// M08 §7 — PDF de la facture (A4, mentions RG-M08-04, montant en lettres, bloc FNE) et du reçu
// de paiement (ticket 80 mm). Données préparées côté serveur ; ce module ne fait que la mise en page.
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { amountInWords, formatFCFA } from "@atelieros/core";
import QRCode from "qrcode";
import { qrDataUrl } from "./qr";

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
  /** Lien portail (voir et payer). Le QR est produit au rendu. */
  portalUrl?: string | null;
  portalQr?: string | null;
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

const LEGAL_SUFFIXES = new Set(["SARL", "SA", "SAS", "SARLU", "SUARL", "EURL", "SCI", "SAU"]);

/** PNG, JPEG ou adresse https : les seuls formats que le moteur PDF intègre sans échec. */
export function printableLogo(logo: string | null | undefined): string | null {
  if (!logo) return null;
  if (
    logo.startsWith("data:image/png") ||
    logo.startsWith("data:image/jpeg") ||
    logo.startsWith("data:image/jpg") ||
    logo.startsWith("https://")
  ) {
    return logo;
  }
  return null;
}

/** Initiales du garage, hors suffixes juridiques, pour l'en-tête quand aucun logo n'est enregistré. */
export function garageInitials(name: string): string {
  const words = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word && !LEGAL_SUFFIXES.has(word.toUpperCase()));
  const letters = words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
  return letters || "G";
}

function DocumentLogo({
  logo,
  name,
  centered,
  width = 140,
}: {
  logo?: string | null;
  name: string;
  centered?: boolean;
  width?: number;
}) {
  const src = printableLogo(logo);
  return (
    <View style={{ alignItems: centered ? "center" : "flex-start", marginBottom: 6 }}>
      {src ? (
        <Image src={src} style={{ width }} />
      ) : (
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            backgroundColor: "#E4570E",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 13 }}>
            {garageInitials(name)}
          </Text>
        </View>
      )}
    </View>
  );
}

function day(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Marque AtelierOS : bleu pétrole pour la structure, orange atelier pour le total à payer. */
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
    paddingBottom: 62,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: INK,
  },
  between: { flexDirection: "row", justifyContent: "space-between" },
  row: { flexDirection: "row" },
  bold: { fontFamily: "Helvetica-Bold" },
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
  metaLabel: { width: "40%", color: MUTED, fontSize: 8 },
  metaValue: { width: "58%", fontFamily: "Helvetica-Bold", fontSize: 8, textAlign: "right" },
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
    fontSize: 7.5,
    paddingVertical: 6,
    paddingHorizontal: 3,
  },
  tr: {
    alignItems: "flex-start",
    borderBottomWidth: 0.4,
    borderBottomColor: LINE,
    borderBottomStyle: "solid",
  },
  td: { fontSize: 8, paddingVertical: 6, paddingHorizontal: 3 },
  cDesc: { width: "30%" },
  cQty: { width: "8%", textAlign: "right" },
  cPu: { width: "15%", textAlign: "right" },
  cRem: { width: "9%", textAlign: "right" },
  cVat: { width: "8%", textAlign: "right" },
  cHt: { width: "15%", textAlign: "right" },
  cTtc: { width: "15%", textAlign: "right" },
  sums: { width: 246, marginTop: 8 },
  sumRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
    paddingHorizontal: 8,
    fontSize: 9,
  },
  grand: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: ORANGE,
    marginTop: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  grandText: { color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 10 },
  words: {
    marginTop: 10,
    backgroundColor: PRIMARY_SOFT,
    paddingVertical: 7,
    paddingHorizontal: 8,
    fontSize: 8.5,
  },
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
  watermark: {
    position: "absolute",
    top: 390,
    left: 36,
    fontSize: 44,
    fontFamily: "Helvetica-Bold",
    color: PRIMARY,
    opacity: 0.07,
    transform: "rotate(-28deg)",
  },
  watermarkDraft: {
    position: "absolute",
    top: 370,
    left: 70,
    fontSize: 52,
    fontFamily: "Helvetica-Bold",
    color: PRIMARY,
    opacity: 0.1,
    transform: "rotate(-28deg)",
  },
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

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

function Sum({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.sumRow}>
      <Text style={{ color: MUTED }}>{label}</Text>
      <Text>{value}</Text>
    </View>
  );
}

function amountSentence(kind: InvoicePdfData["kind"]): string {
  if (kind === "CREDIT_NOTE") return "Arrêté le présent avoir à la somme de :";
  if (kind === "DEPOSIT") return "Arrêtée la présente facture d'acompte à la somme de :";
  return "Arrêtée la présente facture à la somme de :";
}

function joinParts(parts: Array<string | null | undefined | false>): string {
  return parts.filter((part): part is string => Boolean(part)).join("  ·  ");
}

export function InvoiceDocument({ data }: { data: InvoicePdfData }) {
  const g = data.garage;
  const title = KIND_TITLE[data.kind];
  const fnePending = data.fne.status === "PENDING" || data.fne.status === "FAILED";
  const certified = data.fne.status === "CERTIFIED" || data.fne.status === "MANUAL";
  const showSettlement = data.kind !== "CREDIT_NOTE" && Boolean(data.number);
  const logo = printableLogo(g.logo);
  const fneLines = fneBlockLines(data.fne).slice(1);
  const footMain = g.footer?.trim() || joinParts([g.legalName || g.name, g.address]);
  const footLegal = joinParts([
    g.rccm && `RCCM ${g.rccm}`,
    g.ncc && `NCC ${g.ncc}`,
    g.phone && `Tél. ${g.phone}`,
    g.email,
  ]);

  return (
    <Document title={`${title} ${data.number ?? "brouillon"}`}>
      <Page size="A4" style={styles.page}>
        {!data.number && (
          <Text style={styles.watermarkDraft} fixed>
            BROUILLON
          </Text>
        )}
        {data.number && fnePending && (
          <Text style={styles.watermark} fixed>
            FNE en attente
          </Text>
        )}

        <View style={styles.between}>
          <View style={{ width: 96, height: 58, justifyContent: "center" }}>
            {logo ? (
              <Image src={logo} style={{ width: 96, height: 58, objectFit: "contain" }} />
            ) : (
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 8,
                  backgroundColor: PRIMARY,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 14 }}>
                  {garageInitials(g.legalName || g.name)}
                </Text>
              </View>
            )}
          </View>
          <View style={{ alignItems: "flex-end", maxWidth: "68%" }}>
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
            {g.taxRegime && (
              <Text style={styles.issuerLine}>{TAX_REGIME[g.taxRegime] ?? g.taxRegime}</Text>
            )}
          </View>
        </View>

        <Text style={styles.docTitle}>{title.toUpperCase()}</Text>

        <View style={[styles.between, { alignItems: "flex-start" }]}>
          <View style={{ width: "46%" }}>
            <Meta label="N° Facture" value={data.number ?? "Brouillon"} />
            <Meta label="Date" value={day(data.issuedAt)} />
            {data.kind !== "CREDIT_NOTE" && <Meta label="Échéance" value={day(data.dueDate)} />}
            {data.repairOrderNumber && <Meta label="N° OR" value={data.repairOrderNumber} />}
            {data.creditedInvoiceNumber && (
              <Meta label="Avoir sur" value={data.creditedInvoiceNumber} />
            )}
          </View>
          <View style={styles.party}>
            <Text style={styles.partyLabel}>CLIENT</Text>
            <Text style={styles.partyName}>{data.customer.displayName}</Text>
            {data.customer.address && <Text style={styles.partyLine}>{data.customer.address}</Text>}
            {data.customer.phone && (
              <Text style={styles.partyLine}>Tél. {data.customer.phone}</Text>
            )}
            {(data.customer.ncc || data.customer.rccm) && (
              <Text style={styles.partyLine}>
                {joinParts([
                  data.customer.ncc && `NCC ${data.customer.ncc}`,
                  data.customer.rccm && `RCCM ${data.customer.rccm}`,
                ])}
              </Text>
            )}
            {data.vehicle && (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.partyLabel}>VÉHICULE</Text>
                <Text style={styles.partyName}>{data.vehicle.plate}</Text>
                <Text style={styles.partyLine}>
                  {joinParts([
                    `${data.vehicle.make} ${data.vehicle.model}`.trim(),
                    data.vehicle.mileage != null &&
                      `${data.vehicle.mileage.toLocaleString("fr-FR")} km`,
                  ])}
                </Text>
              </View>
            )}
          </View>
        </View>

        <View style={{ marginTop: 16 }}>
          <View style={[styles.row, styles.thead]}>
            <Text style={[styles.th, styles.cDesc]}>Désignation</Text>
            <Text style={[styles.th, styles.cQty]}>Qté</Text>
            <Text style={[styles.th, styles.cPu]}>PU HT</Text>
            <Text style={[styles.th, styles.cRem]}>Remise</Text>
            <Text style={[styles.th, styles.cVat]}>TVA</Text>
            <Text style={[styles.th, styles.cHt]}>Montant HT</Text>
            <Text style={[styles.th, styles.cTtc]}>Montant TTC</Text>
          </View>
          {data.lines.map((l, i) => (
            <View key={i} style={[styles.row, styles.tr]} wrap={false}>
              <Text style={[styles.td, styles.cDesc]}>{l.description}</Text>
              <Text style={[styles.td, styles.cQty]}>
                {l.type === "LABOR" ? `${l.quantity} h` : l.quantity.toLocaleString("fr-FR")}
              </Text>
              <Text style={[styles.td, styles.cPu]}>{formatFCFA(l.unitPrice)}</Text>
              <Text style={[styles.td, styles.cRem]}>
                {l.discountRate ? `${l.discountRate} %` : "—"}
              </Text>
              <Text style={[styles.td, styles.cVat]}>
                {data.vatEnabled ? `${l.vatRate} %` : "—"}
              </Text>
              <Text style={[styles.td, styles.cHt]}>{formatFCFA(l.lineSubtotal)}</Text>
              <Text style={[styles.td, styles.cTtc]}>{formatFCFA(l.lineTotal)}</Text>
            </View>
          ))}
        </View>

        <View style={{ alignItems: "flex-end" }} wrap={false}>
          <View style={styles.sums}>
            {data.totals.discountTotal !== 0 && (
              <Sum
                label="Total HT brut"
                value={formatFCFA(data.totals.subtotal + data.totals.discountTotal)}
              />
            )}
            {data.totals.discountTotal !== 0 && (
              <Sum label="Remises" value={`- ${formatFCFA(data.totals.discountTotal)}`} />
            )}
            <Sum label="Total HT" value={formatFCFA(data.totals.subtotal)} />
            <Sum label="Total TVA" value={formatFCFA(data.totals.vatTotal)} />
            <View style={styles.grand}>
              <Text style={styles.grandText}>TOTAL TTC</Text>
              <Text style={styles.grandText}>{formatFCFA(data.totals.total)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.words} wrap={false}>
          <Text>
            <Text style={styles.bold}>{amountSentence(data.kind)} </Text>
            {amountInWords(Math.abs(data.totals.total))}
          </Text>
        </View>

        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitle}>Informations de paiement</Text>
          <View style={styles.sectionBody}>
            {showSettlement && <Text>Montant payé : {formatFCFA(data.amountPaid)}</Text>}
            {showSettlement && (
              <Text style={styles.bold}>Reste à payer : {formatFCFA(data.balance)}</Text>
            )}
            <Text>Conditions : {data.paymentTerms}</Text>
            {!data.vatEnabled && <Text>TVA non applicable.</Text>}
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

        {data.portalQr && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>Accès client</Text>
            <View
              style={[
                styles.between,
                { alignItems: "center", paddingHorizontal: 8, paddingTop: 6 },
              ]}
            >
              <Text style={{ fontSize: 8.5, width: "70%" }}>
                Scannez pour voir la facture et la payer.
              </Text>
              <Image src={data.portalQr} style={{ width: 72, height: 72 }} />
            </View>
          </View>
        )}

        {data.fne.status !== "NOT_REQUIRED" && data.number && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>Facture normalisée électronique (FNE)</Text>
            <View
              style={[
                styles.between,
                { alignItems: "center", paddingHorizontal: 8, paddingTop: 6 },
              ]}
            >
              <View>
                {fneLines.map((line, i) => (
                  <Text key={i} style={{ fontSize: 8.5, lineHeight: 1.45 }}>
                    {line}
                  </Text>
                ))}
              </View>
              {certified && data.fne.qrCode?.startsWith("data:image") && (
                <Image src={data.fne.qrCode} style={{ width: 72, height: 72 }} />
              )}
            </View>
          </View>
        )}

        <View style={styles.pageFoot} fixed>
          {footMain ? <Text>{footMain}</Text> : null}
          {footLegal ? <Text>{footLegal}</Text> : null}
        </View>
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

/**
 * RG-M14-13 — QR FNE en SVG pour la page portail (net à toute taille, plus léger qu'un PNG).
 * Le SVG ne contient que des tracés générés : aucun texte de la facture n'y est recopié.
 */
export async function fneQrSvg(qrCode: string | null | undefined): Promise<string | null> {
  if (!qrCode || qrCode.startsWith("data:image")) return null;
  return QRCode.toString(qrCode, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
}

export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const certified = data.fne.status === "CERTIFIED" || data.fne.status === "MANUAL";
  const qrCode = certified ? await fneQrImage(data.fne.qrCode) : null;
  const portalQr = data.portalUrl ? await qrDataUrl(data.portalUrl) : null;
  return renderToBuffer(
    <InvoiceDocument data={{ ...data, portalQr, fne: { ...data.fne, qrCode } }} />,
  );
}

// ───────────── Reçu de paiement (ticket 80 mm) ─────────────

export interface ReceiptPdfData {
  number: string;
  receivedAt: string;
  garage: {
    name: string;
    address?: string | null;
    phone?: string | null;
    ncc?: string | null;
    logo?: string | null;
  };
  customer: string;
  method: string;
  reference?: string | null;
  amount: number;
  status: string;
  allocations: { invoiceNumber: string; amount: number; balanceAfter: number }[];
  unallocated: number;
  cashier?: string | null;
  /** Texte encodé dans le QR (lien facture, ou identité du reçu). */
  qrText?: string | null;
  qrCaption?: string | null;
  qrImage?: string | null;
}

const ticket = StyleSheet.create({
  page: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 14,
    fontSize: 8,
    fontFamily: "Helvetica",
    color: INK,
  },
  bold: { fontFamily: "Helvetica-Bold" },
  garage: { fontFamily: "Helvetica-Bold", fontSize: 9, textAlign: "center" },
  meta: { fontSize: 7.5, color: MUTED, textAlign: "center", lineHeight: 1.35 },
  rule: {
    borderBottomWidth: 0.8,
    borderBottomColor: PRIMARY,
    borderBottomStyle: "solid",
    marginTop: 8,
    marginBottom: 8,
  },
  kicker: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 1.2,
    textAlign: "center",
    color: PRIMARY,
  },
  number: { fontFamily: "Helvetica-Bold", fontSize: 10, textAlign: "center", marginTop: 1 },
  date: { fontSize: 7.5, color: MUTED, textAlign: "center", marginTop: 1 },
  ref: { fontSize: 7.5, color: MUTED, marginTop: 1 },
  label: {
    fontFamily: "Helvetica-Bold",
    fontSize: 6.5,
    letterSpacing: 0.4,
    color: PRIMARY,
    marginTop: 6,
  },
  value: { fontSize: 8.5, marginTop: 1 },
  pending: {
    marginTop: 6,
    backgroundColor: PRIMARY_SOFT,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  pendingText: { fontFamily: "Helvetica-Bold", fontSize: 7.5, textAlign: "center", color: PRIMARY },
  amountBox: {
    marginTop: 8,
    borderWidth: 0.8,
    borderColor: PRIMARY,
    borderTopWidth: 3,
    borderTopColor: ORANGE,
    paddingVertical: 7,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  amount: { fontFamily: "Helvetica-Bold", fontSize: 14, textAlign: "center", color: PRIMARY },
  words: { fontSize: 7, textAlign: "center", color: MUTED, marginTop: 2 },
  between: { flexDirection: "row", justifyContent: "space-between", marginTop: 1 },
  allocTitle: { fontFamily: "Helvetica-Bold", fontSize: 8, marginTop: 6 },
  thanks: { textAlign: "center", fontSize: 7.5, color: MUTED, marginTop: 8 },
});

/** Hauteur du rouleau : le ticket s'arrête après le texte, sans page blanche en dessous. */
function receiptHeight(data: ReceiptPdfData): number {
  const logo = printableLogo(data.garage.logo) ? 74 : 46;
  const identity =
    12 + (data.garage.address ? 11 : 0) + (data.garage.phone ? 11 : 0) + (data.garage.ncc ? 11 : 0);
  const party = 40 + (data.reference ? 12 : 0) + (data.status === "PENDING" ? 26 : 0);
  const amount = 72;
  const allocations = data.allocations.length * 40 + (data.unallocated > 0 ? 16 : 0);
  const foot = (data.cashier ? 26 : 0) + 22;
  const qr = data.qrText ? 96 : 0;
  return logo + identity + 48 + party + amount + allocations + foot + qr + 12;
}

export function ReceiptDocument({ data }: { data: ReceiptPdfData }) {
  return (
    <Document title={`Reçu ${data.number}`}>
      {/* 80 mm ≈ 227 pt. */}
      <Page size={[227, receiptHeight(data)]} style={ticket.page}>
        <DocumentLogo logo={data.garage.logo} name={data.garage.name} centered width={64} />
        <Text style={ticket.garage}>{data.garage.name}</Text>
        {data.garage.address && <Text style={ticket.meta}>{data.garage.address}</Text>}
        {data.garage.phone && <Text style={ticket.meta}>Tél. {data.garage.phone}</Text>}
        {data.garage.ncc && <Text style={ticket.meta}>NCC {data.garage.ncc}</Text>}

        <View style={ticket.rule} />
        <Text style={ticket.kicker}>REÇU</Text>
        <Text style={ticket.number}>{data.number}</Text>
        <Text style={ticket.date}>{data.receivedAt}</Text>

        <Text style={ticket.label}>CLIENT</Text>
        <Text style={ticket.value}>{data.customer}</Text>
        <Text style={ticket.label}>RÈGLEMENT</Text>
        <Text style={ticket.value}>{data.method}</Text>
        {data.reference && <Text style={ticket.ref}>Réf. {data.reference}</Text>}
        {data.status === "PENDING" && (
          <View style={ticket.pending}>
            <Text style={ticket.pendingText}>Chèque en attente d'encaissement</Text>
          </View>
        )}

        <View style={ticket.amountBox}>
          <Text style={ticket.amount}>{formatFCFA(data.amount)}</Text>
          <Text style={ticket.words}>{amountInWords(data.amount)}</Text>
        </View>

        {(data.allocations.length > 0 || data.unallocated > 0) && <View style={ticket.rule} />}
        {data.allocations.map((a, i) => (
          <View key={i} wrap={false}>
            <Text style={ticket.allocTitle}>{a.invoiceNumber}</Text>
            <View style={ticket.between}>
              <Text>Imputé</Text>
              <Text style={ticket.bold}>{formatFCFA(a.amount)}</Text>
            </View>
            <View style={ticket.between}>
              <Text>Reste à payer</Text>
              <Text style={ticket.bold}>{formatFCFA(a.balanceAfter)}</Text>
            </View>
          </View>
        ))}
        {data.unallocated > 0 && (
          <View style={ticket.between}>
            <Text>Crédit / trop-perçu</Text>
            <Text style={ticket.bold}>{formatFCFA(data.unallocated)}</Text>
          </View>
        )}

        {data.cashier && (
          <>
            <Text style={ticket.label}>ENCAISSÉ PAR</Text>
            <Text style={ticket.value}>{data.cashier}</Text>
          </>
        )}
        {data.qrImage && (
          <View style={{ alignItems: "center", marginTop: 8 }}>
            <Image src={data.qrImage} style={{ width: 78, height: 78 }} />
            {data.qrCaption ? (
              <Text style={[ticket.meta, { marginTop: 2 }]}>{data.qrCaption}</Text>
            ) : null}
          </View>
        )}
        <Text style={ticket.thanks}>Merci de votre confiance.</Text>
      </Page>
    </Document>
  );
}

export async function renderReceiptPdf(data: ReceiptPdfData): Promise<Buffer> {
  const qrImage = data.qrText ? await qrDataUrl(data.qrText) : null;
  return renderToBuffer(<ReceiptDocument data={{ ...data, qrImage }} />);
}
