// M05 §7 — PDF du devis : variante client, « Devis d'expertise » (assureur : détail MO temps ×
// taux et références pièces) et « Devis signé » (bloc d'acceptation électronique + empreinte).
// Données préparées côté serveur ; ce module ne fait que la mise en page.
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { amountInWords, formatFCFA } from "@atelieros/core";
import { garageInitials, printableLogo } from "./invoice";
import { qrDataUrl } from "./qr";

export type QuotePdfVariant = "customer" | "insurer" | "signed";

export interface QuotePdfLine {
  type: string;
  description: string;
  reference?: string | null;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  /** Taux de TVA de la ligne, en %. */
  vatRate?: number;
  /** HT net après remises. À défaut : quantité × PU moins la remise de ligne. */
  lineSubtotal?: number;
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
  /** Image du QR, produite par renderQuotePdf à partir de publicUrl. */
  linkQr?: string | null;
}

const PRIORITY: Record<string, string> = { URGENT: "Urgent", WATCH: "À surveiller" };

const LINE_KIND: Record<string, string> = {
  LABOR: "Main-d'œuvre",
  PART: "Pièce",
  CONSUMABLE: "Consommable",
  SUBCONTRACT: "Sous-traitance",
  FEE: "Frais",
};

function day(value: string): string {
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const PRIMARY = "#0C2A39";
const PRIMARY_SOFT = "#E9F2F7";
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
  issuer: { fontFamily: "Helvetica-Bold", fontSize: 12, textAlign: "right", marginBottom: 2 },
  issuerLine: { fontSize: 8, color: "#36454E", textAlign: "right", lineHeight: 1.35 },
  docTitle: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.6,
    marginTop: 16,
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
  table: { marginTop: 16 },
  groupBand: {
    backgroundColor: "#F4F7F9",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 0.4,
    borderBottomColor: LINE,
    borderBottomStyle: "solid",
  },
  groupTitle: {
    color: PRIMARY,
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
  },
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
  td: { fontSize: 8, paddingVertical: 5, paddingHorizontal: 3 },
  kind: {
    fontFamily: "Helvetica-Bold",
    fontSize: 6.5,
    letterSpacing: 0.3,
    color: PRIMARY,
    marginBottom: 1,
  },
  sums: { width: 230, marginTop: 8, alignSelf: "flex-end" },
  words: {
    marginTop: 10,
    backgroundColor: PRIMARY_SOFT,
    color: PRIMARY,
    fontSize: 8.5,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
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
    backgroundColor: PRIMARY,
    marginTop: 2,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  grandText: { color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 10 },
  close: {
    marginTop: 12,
    backgroundColor: PRIMARY_SOFT,
    paddingVertical: 7,
    paddingHorizontal: 8,
    fontSize: 8.5,
  },
  sign: {
    marginTop: 10,
    borderWidth: 0.8,
    borderColor: LINE,
    borderStyle: "solid",
    padding: 8,
    minHeight: 64,
  },
  muted: { color: MUTED, fontSize: 8, marginTop: 8 },
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

function lineHt(line: QuotePdfLine): number {
  if (line.lineSubtotal != null) return line.lineSubtotal;
  return Math.round(line.quantity * line.unitPrice * (1 - line.discountRate / 100));
}

function lineLabel(data: QuotePdfData, line: QuotePdfLine): string {
  const parts = [line.description];
  if (data.variant === "insurer" && line.reference) parts.push(`(réf. ${line.reference})`);
  if (line.payer === "INSURANCE") parts.push("— assurance");
  if (line.payer === "WARRANTY" || line.payer === "INTERNAL")
    parts.push("— pris en charge par le garage");
  return parts.join(" ");
}

export function QuoteDocument({ data }: { data: QuotePdfData }) {
  const g = data.garage;
  const title =
    data.variant === "insurer"
      ? "Devis d'expertise"
      : data.variant === "signed"
        ? "Devis signé"
        : "Devis";
  const showDecision = data.variant === "signed";
  const cols = showDecision
    ? { desc: "24%", qty: "8%", pu: "13%", rem: "8%", vat: "8%", ht: "13%", ttc: "14%", dec: "12%" }
    : { desc: "28%", qty: "8%", pu: "14%", rem: "9%", vat: "8%", ht: "16%", ttc: "17%", dec: "0%" };
  const groupTitle = (group: QuotePdfGroup) => {
    const head = [group.priority ? PRIORITY[group.priority] : null, group.label]
      .filter(Boolean)
      .join(" — ");
    return group.isOptional ? `${head} (optionnel)` : head;
  };

  return (
    <Document title={`${title} ${data.number} v${data.version}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.between}>
          <Mark logo={g.logo} name={g.name} />
          <View style={{ alignItems: "flex-end", maxWidth: "68%" }}>
            <Text style={styles.issuer}>{g.name}</Text>
            {g.address && <Text style={styles.issuerLine}>{g.address}</Text>}
            {g.phone && <Text style={styles.issuerLine}>Tél. {g.phone}</Text>}
            {(g.rccm || g.ncc) && (
              <Text style={styles.issuerLine}>
                {[g.rccm && `RCCM ${g.rccm}`, g.ncc && `NCC ${g.ncc}`]
                  .filter(Boolean)
                  .join("  ·  ")}
              </Text>
            )}
            {g.taxRegime && <Text style={styles.issuerLine}>{g.taxRegime}</Text>}
          </View>
        </View>

        <Text style={styles.docTitle}>{title.toUpperCase()}</Text>

        <View style={[styles.between, { alignItems: "flex-start" }]}>
          <View style={{ width: "46%" }}>
            <Meta label="N° Devis" value={data.number} />
            <Meta label="Version" value={String(data.version)} />
            <Meta label="Date" value={day(data.createdAt)} />
            <Meta label="Validité" value={day(data.validUntil)} />
          </View>
          <View style={styles.party}>
            <Text style={styles.partyLabel}>DESTINATAIRE</Text>
            <Text style={styles.partyName}>{data.customer.displayName}</Text>
            {data.customer.phone && (
              <Text style={styles.partyLine}>Tél. {data.customer.phone}</Text>
            )}
            {data.customer.ncc && <Text style={styles.partyLine}>NCC {data.customer.ncc}</Text>}
            {data.vehicle && (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.partyLabel}>VÉHICULE</Text>
                <Text style={styles.partyName}>{data.vehicle.plate}</Text>
                <Text style={styles.partyLine}>
                  {`${data.vehicle.make} ${data.vehicle.model}`.trim()}
                  {data.vehicle.mileage != null
                    ? `  ·  ${data.vehicle.mileage.toLocaleString("fr-FR")} km`
                    : ""}
                </Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.table}>
          <View style={[styles.row, styles.thead]}>
            <Text style={[styles.th, { width: cols.desc }]}>Désignation</Text>
            <Text style={[styles.th, { width: cols.qty, textAlign: "right" }]}>Qté</Text>
            <Text style={[styles.th, { width: cols.pu, textAlign: "right" }]}>P.U.</Text>
            <Text style={[styles.th, { width: cols.rem, textAlign: "right" }]}>Remise</Text>
            <Text style={[styles.th, { width: cols.vat, textAlign: "right" }]}>TVA</Text>
            <Text style={[styles.th, { width: cols.ht, textAlign: "right" }]}>Montant HT</Text>
            <Text style={[styles.th, { width: cols.ttc, textAlign: "right" }]}>Montant TTC</Text>
            {showDecision && (
              <Text style={[styles.th, { width: cols.dec, textAlign: "right" }]}>Accord</Text>
            )}
          </View>
          {data.groups.map((group, gi) => {
            const named =
              group.lines.length !== 1 ||
              group.lines[0]!.description !== group.label ||
              group.isOptional ||
              Boolean(group.priority);
            return (
              <View key={gi}>
                {named && (
                  <View style={styles.groupBand}>
                    <Text style={styles.groupTitle}>{groupTitle(group)}</Text>
                  </View>
                )}
                {group.lines.map((l, li) => (
                  <View key={li} style={[styles.row, styles.tr]} wrap={false}>
                    <View style={[styles.td, { width: cols.desc }]}>
                      <Text style={styles.kind}>{LINE_KIND[l.type] ?? l.type}</Text>
                      <Text>{lineLabel(data, l)}</Text>
                    </View>
                    <Text style={[styles.td, { width: cols.qty, textAlign: "right" }]}>
                      {l.type === "LABOR" ? `${l.quantity} h` : l.quantity}
                    </Text>
                    <Text style={[styles.td, { width: cols.pu, textAlign: "right" }]}>
                      {formatFCFA(l.unitPrice)}
                    </Text>
                    <Text style={[styles.td, { width: cols.rem, textAlign: "right" }]}>
                      {l.discountRate} %
                    </Text>
                    <Text style={[styles.td, { width: cols.vat, textAlign: "right" }]}>
                      {l.vatRate != null ? `${l.vatRate} %` : "—"}
                    </Text>
                    <Text style={[styles.td, { width: cols.ht, textAlign: "right" }]}>
                      {formatFCFA(lineHt(l))}
                    </Text>
                    <Text style={[styles.td, { width: cols.ttc, textAlign: "right" }]}>
                      {formatFCFA(l.total)}
                    </Text>
                    {showDecision && (
                      <Text style={[styles.td, { width: cols.dec, textAlign: "right" }]}>
                        {l.accepted === true ? "Oui" : l.accepted === false ? "Non" : "—"}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            );
          })}
        </View>

        <View style={styles.sums} wrap={false}>
          <Sum label="Total HT" value={formatFCFA(data.totals.subtotal)} />
          {data.totals.discountTotal > 0 && (
            <Sum label="Remises" value={`- ${formatFCFA(data.totals.discountTotal)}`} />
          )}
          <Sum label="Total TVA" value={formatFCFA(data.totals.vatTotal)} />
          <View style={styles.grand}>
            <Text style={styles.grandText}>TOTAL TTC</Text>
            <Text style={styles.grandText}>{formatFCFA(data.totals.total)}</Text>
          </View>
          {data.totals.insuranceShare > 0 && (
            <>
              <Sum label="Part assurance" value={formatFCFA(data.totals.insuranceShare)} />
              {data.deductible ? (
                <Sum label="Franchise" value={formatFCFA(data.deductible)} />
              ) : null}
              <Sum label="Part client" value={formatFCFA(data.totals.customerShare)} />
            </>
          )}
          {showDecision && (
            <Sum label="Total accepté" value={`${formatFCFA(data.totals.acceptedTotal)} TTC`} />
          )}
        </View>

        <Text style={styles.words}>
          Arrêté le présent devis à la somme de : {amountInWords(Math.abs(data.totals.total))}
        </Text>

        {data.termsText && (
          <View style={styles.close} wrap={false}>
            <Text>{data.termsText}</Text>
          </View>
        )}

        {data.acceptance ? (
          <View style={styles.sign} wrap={false}>
            <Text style={styles.bold}>
              Accepté électroniquement
              {data.acceptance.signerName ? ` par ${data.acceptance.signerName}` : ""} le{" "}
              {data.acceptance.decidedAt}
              {data.acceptance.hash ? ` (empreinte ${data.acceptance.hash.slice(0, 12)}…)` : ""}
            </Text>
            {data.acceptance.ip && (
              <Text style={{ color: MUTED, marginTop: 3 }}>Réseau : {data.acceptance.ip}</Text>
            )}
            {data.acceptance.signature?.startsWith("data:image") && (
              <Image
                src={data.acceptance.signature}
                style={{ width: 140, height: 48, marginTop: 6 }}
              />
            )}
          </View>
        ) : (
          <View style={styles.sign} wrap={false}>
            <Text style={{ color: MUTED }}>Bon pour accord — date et signature du client :</Text>
          </View>
        )}

        {data.linkQr && (
          <View style={[styles.between, styles.close, { alignItems: "center" }]} wrap={false}>
            <View style={{ width: "72%" }}>
              <Text style={styles.bold}>Scannez pour consulter et valider le devis.</Text>
              {data.publicUrl ? (
                <Text style={{ fontSize: 7, color: MUTED, marginTop: 3 }}>{data.publicUrl}</Text>
              ) : null}
            </View>
            <Image src={data.linkQr} style={{ width: 72, height: 72 }} />
          </View>
        )}
      </Page>
    </Document>
  );
}

export async function renderQuotePdf(data: QuotePdfData): Promise<Buffer> {
  const linkQr = data.publicUrl ? await qrDataUrl(data.publicUrl) : null;
  return renderToBuffer(<QuoteDocument data={{ ...data, linkQr }} />);
}
