// M09 RG-M09-16 — mise en demeure de payer (PDF). Données préparées côté serveur
// (apps/web/src/server/receivables/formalNotice.ts) ; ce module ne fait que la mise en page.
// Le contenu est un modèle : la plateforme ne fournit pas de conseil juridique.
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatFCFA } from "@atelieros/core";
import { garageInitials, printableLogo } from "./invoice";

export interface FormalNoticePdfData {
  garage: {
    name: string;
    legalName?: string | null;
    address?: string | null;
    city?: string | null;
    phone?: string | null;
    email?: string | null;
    rccm?: string | null;
    ncc?: string | null;
    logo?: string | null;
  };
  customer: {
    displayName: string;
    ncc?: string | null;
    rccm?: string | null;
    address?: string | null;
    commune?: string | null;
  };
  /** Date de la mise en demeure (AAAA-MM-JJ). */
  issuedOn: string;
  /** Date limite de paiement (AAAA-MM-JJ). */
  deadline: string;
  delayDays: number;
  invoices: {
    number: string | null;
    issuedAt: Date | string | null;
    fneNumber: string | null;
    total: number;
    balance: number;
  }[];
  totalDue: number;
  closingText: string;
  signerName: string;
  paymentInstructions?: string | null;
}

const PRIMARY = "#0C2A39";
const INK = "#121F28";
const MUTED = "#545F68";
const LINE = "#D6DBE0";
const ALT = "#F4F8FA";

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingHorizontal: 44,
    paddingBottom: 56,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: INK,
    lineHeight: 1.45,
  },
  between: { flexDirection: "row", justifyContent: "space-between" },
  issuer: { fontFamily: "Helvetica-Bold", fontSize: 12, marginBottom: 2 },
  small: { fontSize: 8.5, color: "#36454E" },
  recipientBox: {
    marginTop: 22,
    marginLeft: "52%",
    padding: 10,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 4,
  },
  bold: { fontFamily: "Helvetica-Bold" },
  place: { marginTop: 18, textAlign: "right" },
  object: { marginTop: 18, fontFamily: "Helvetica-Bold", fontSize: 11 },
  para: { marginTop: 10, textAlign: "justify" },
  table: { marginTop: 12, borderWidth: 1, borderColor: LINE, borderRadius: 4 },
  th: {
    flexDirection: "row",
    backgroundColor: PRIMARY,
    color: "#ffffff",
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  tr: {
    flexDirection: "row",
    fontSize: 9,
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderTopWidth: 1,
    borderTopColor: LINE,
  },
  total: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingVertical: 6,
    paddingHorizontal: 6,
    backgroundColor: ALT,
    borderTopWidth: 1,
    borderTopColor: LINE,
  },
  signature: { marginTop: 28, marginLeft: "55%" },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 44,
    right: 44,
    fontSize: 7.5,
    color: MUTED,
    textAlign: "center",
  },
});

const COL = { number: "24%", date: "16%", fne: "22%", total: "19%", balance: "19%" };

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

export function FormalNoticeDocument({ data }: { data: FormalNoticePdfData }) {
  const g = data.garage;
  const c = data.customer;
  const creditor = g.legalName || g.name;
  return (
    <Document title={`Mise en demeure — ${c.displayName}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.between}>
          <View style={{ width: "60%" }}>
            <Text style={styles.issuer}>{creditor}</Text>
            {g.address && <Text style={styles.small}>{g.address}</Text>}
            {g.phone && <Text style={styles.small}>Tél. {g.phone}</Text>}
            {g.email && <Text style={styles.small}>{g.email}</Text>}
            {(g.rccm || g.ncc) && (
              <Text style={styles.small}>
                {joinParts([g.rccm && `RCCM ${g.rccm}`, g.ncc && `NCC ${g.ncc}`])}
              </Text>
            )}
          </View>
          <Mark logo={g.logo} name={creditor} />
        </View>

        <View style={styles.recipientBox}>
          <Text style={styles.bold}>{c.displayName}</Text>
          {c.address && <Text>{c.address}</Text>}
          {c.commune && <Text>{c.commune}</Text>}
          {(c.rccm || c.ncc) && (
            <Text style={styles.small}>
              {joinParts([c.rccm && `RCCM ${c.rccm}`, c.ncc && `NCC ${c.ncc}`])}
            </Text>
          )}
        </View>

        <Text style={styles.place}>
          {g.city || "Abidjan"}, le {day(data.issuedOn)}
        </Text>

        <Text style={styles.object}>Objet : Mise en demeure de payer</Text>

        <Text style={styles.para}>Madame, Monsieur,</Text>
        <Text style={styles.para}>
          Malgré nos précédents rappels, nous constatons que les factures ci-dessous, établies par{" "}
          {creditor}, restent impayées à ce jour :
        </Text>

        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={{ width: COL.number }}>Facture</Text>
            <Text style={{ width: COL.date }}>Date</Text>
            <Text style={{ width: COL.fne }}>N° FNE</Text>
            <Text style={{ width: COL.total, textAlign: "right" }}>Montant TTC</Text>
            <Text style={{ width: COL.balance, textAlign: "right" }}>Reste dû</Text>
          </View>
          {data.invoices.map((invoice, index) => (
            <View key={`${invoice.number ?? "f"}-${index}`} style={styles.tr}>
              <Text style={{ width: COL.number }}>{invoice.number ?? "—"}</Text>
              <Text style={{ width: COL.date }}>{day(invoice.issuedAt)}</Text>
              <Text style={{ width: COL.fne }}>{invoice.fneNumber ?? "—"}</Text>
              <Text style={{ width: COL.total, textAlign: "right" }}>
                {formatFCFA(invoice.total)}
              </Text>
              <Text style={{ width: COL.balance, textAlign: "right" }}>
                {formatFCFA(invoice.balance)}
              </Text>
            </View>
          ))}
          <View style={styles.total}>
            <Text style={styles.bold}>Total restant dû : {formatFCFA(data.totalDue)}</Text>
          </View>
        </View>

        <Text style={styles.para}>
          Par la présente, nous vous mettons en demeure de régler la somme de{" "}
          <Text style={styles.bold}>{formatFCFA(data.totalDue)}</Text> dans un délai de{" "}
          {data.delayDays} jours, soit au plus tard le{" "}
          <Text style={styles.bold}>{day(data.deadline)}</Text>.
        </Text>
        {data.paymentInstructions && <Text style={styles.para}>{data.paymentInstructions}</Text>}
        <Text style={styles.para}>{data.closingText}</Text>
        <Text style={styles.para}>
          Si vous avez réglé cette somme entre-temps, nous vous prions de ne pas tenir compte du
          présent courrier. Veuillez agréer, Madame, Monsieur, nos salutations distinguées.
        </Text>

        <View style={styles.signature}>
          <Text>Pour {creditor},</Text>
          <Text style={[styles.bold, { marginTop: 36 }]}>{data.signerName}</Text>
          <Text style={styles.small}>Signature et cachet</Text>
        </View>

        <Text style={styles.footer} fixed>
          {joinParts([creditor, g.address, g.rccm && `RCCM ${g.rccm}`, g.ncc && `NCC ${g.ncc}`])}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderFormalNoticePdf(data: FormalNoticePdfData): Promise<Buffer> {
  return renderToBuffer(<FormalNoticeDocument data={data} />);
}
