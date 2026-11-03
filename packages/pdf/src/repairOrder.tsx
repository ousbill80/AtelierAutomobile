// US-M04-15 — documents de l'OR : bon de réception, fiche de travail atelier (sans prix),
// OR complet (prix estimés), bon de restitution. Données préparées côté serveur ; ce module
// ne fait que la mise en page. Les prix et noms de mécaniciens ne sont imprimés que là où
// le PRD les prévoit (la fiche atelier est interne).
import {
  Circle,
  Document,
  Image,
  Page,
  Rect,
  StyleSheet,
  Svg,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import { formatFCFA } from "@atelieros/core";
import { garageInitials, printableLogo } from "./invoice";

export type RepairOrderPdfKind = "reception" | "workshop" | "full" | "delivery";

export interface RepairOrderPdfLine {
  type: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  total: number;
  approval: string;
  mechanic?: string | null;
  isCustomerSupplied: boolean;
}

export interface RepairOrderPdfData {
  kind: RepairOrderPdfKind;
  garage: {
    name: string;
    address?: string | null;
    phone?: string | null;
    rccm?: string | null;
    ncc?: string | null;
    logo?: string | null;
  };
  number: string;
  createdAt: string;
  promisedAt?: string | null;
  customer: { displayName: string; phone?: string | null };
  vehicle: { plate: string; make: string; model: string; year?: number | null };
  mileageIn: number | null;
  fuelLevel: number | null;
  complaint: string | null;
  diagnosis?: string | null;
  damages: {
    n: number;
    view: string;
    x: number;
    y: number;
    zone: string;
    type: string;
    severity: string;
  }[];
  noDamage: boolean;
  items: { label: string; present: boolean }[];
  keysCount?: number | null;
  belongings?: string | null;
  warningLights: string[];
  authorizationCeiling: number;
  returnOldParts: boolean;
  lines: RepairOrderPdfLine[];
  totals?: { subtotal: number; vatTotal: number; total: number };
  signature?: { image?: string | null; signerName?: string | null; status: string };
  photos: string[];
  photoCount: number;
  checkOut?: {
    mileage: number | null;
    fuelLevel: number;
    itemsConfirmed: boolean;
    oldPartsReturned: boolean;
    collectedBy: string;
    at: string;
    signatureImage?: string | null;
  } | null;
  trackingUrl?: string | null;
}

const TITLES: Record<RepairOrderPdfKind, string> = {
  reception: "Bon de réception",
  workshop: "Fiche de travail atelier",
  full: "Ordre de réparation",
  delivery: "Bon de restitution",
};

const DAMAGE_TYPES: Record<string, string> = {
  SCRATCH: "rayure",
  DENT: "bosse",
  CRACK: "fissure",
  BROKEN: "cassé",
  RUST: "rouille",
  PAINT: "peinture",
  MISSING: "manquant",
  OTHER: "autre",
};
const SEVERITY: Record<string, string> = { LIGHT: "légère", MEDIUM: "moyenne", HEAVY: "forte" };
const VIEWS: Record<string, string> = {
  TOP: "Dessus",
  FRONT: "Avant",
  REAR: "Arrière",
  LEFT: "Gauche",
  RIGHT: "Droite",
};

/** Même marque que la facture : bleu pétrole pour la structure, orange pour le total. */
const PRIMARY = "#0C2A39";
const PRIMARY_SOFT = "#E9F2F7";
const ORANGE = "#EB6120";
const INK = "#121F28";
const MUTED = "#545F68";
const LINE = "#D6DBE0";

const AUDIENCE: Record<RepairOrderPdfKind, string> = {
  reception: "Document remis au client à l'arrivée du véhicule.",
  workshop: "Document interne. Aucun prix. À remettre au mécanicien.",
  full: "Dossier des travaux, avec les prix estimés.",
  delivery: "Document remis au client à la restitution du véhicule.",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingHorizontal: 32,
    paddingBottom: 52,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: INK,
  },
  row: { flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  bold: { fontFamily: "Helvetica-Bold" },
  issuer: { fontFamily: "Helvetica-Bold", fontSize: 12, textAlign: "right", marginBottom: 2 },
  issuerLine: { fontSize: 8, color: "#36454E", textAlign: "right", lineHeight: 1.35 },
  docTitle: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.8,
    marginTop: 18,
  },
  audience: { marginTop: 2, marginBottom: 8, fontSize: 8, color: MUTED },
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
  sectionBody: { paddingTop: 6, paddingHorizontal: 8, fontSize: 8.5, lineHeight: 1.45 },
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
    borderBottomWidth: 0.4,
    borderBottomColor: LINE,
    borderBottomStyle: "solid",
  },
  td: { fontSize: 8, paddingVertical: 5, paddingHorizontal: 4 },
  grand: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: ORANGE,
    marginTop: 8,
    marginLeft: "auto",
    width: 230,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  grandText: { color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 10 },
  sumRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: 230,
    marginLeft: "auto",
    paddingVertical: 2,
    paddingHorizontal: 8,
    fontSize: 9,
  },
  note: {
    marginTop: 10,
    backgroundColor: PRIMARY_SOFT,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 8.5,
    lineHeight: 1.45,
  },
  pageFoot: {
    position: "absolute",
    bottom: 18,
    left: 32,
    right: 32,
    borderTopWidth: 0.6,
    borderTopColor: LINE,
    borderTopStyle: "solid",
    paddingTop: 6,
    fontSize: 7,
    color: "#7A8796",
    textAlign: "center",
  },
});

function day(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function hour(iso: string | null | undefined): string {
  return iso ? iso.slice(11, 16) : "";
}

function Diagram({ damages }: { damages: RepairOrderPdfData["damages"] }) {
  const views = ["TOP", "FRONT", "REAR", "LEFT", "RIGHT"] as const;
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      {views.map((view) => (
        <View key={view} style={{ width: 96, alignItems: "center" }}>
          <Svg width={90} height={50}>
            <Rect
              x={4}
              y={4}
              width={82}
              height={42}
              rx={8}
              stroke={PRIMARY}
              strokeWidth={1.1}
              fill={PRIMARY_SOFT}
            />
            {view === "TOP" && (
              <Rect
                x={24}
                y={12}
                width={42}
                height={26}
                rx={3}
                stroke={PRIMARY}
                strokeWidth={0.6}
                fill="#ffffff"
              />
            )}
            {(view === "FRONT" || view === "REAR") && (
              <>
                <Rect
                  x={16}
                  y={10}
                  width={58}
                  height={14}
                  rx={2}
                  stroke={PRIMARY}
                  strokeWidth={0.6}
                  fill="#ffffff"
                />
                <Circle cx={16} cy={38} r={2.5} fill={PRIMARY} />
                <Circle cx={74} cy={38} r={2.5} fill={PRIMARY} />
              </>
            )}
            {(view === "LEFT" || view === "RIGHT") && (
              <>
                <Circle cx={22} cy={38} r={5} stroke={PRIMARY} strokeWidth={0.8} fill="#ffffff" />
                <Circle cx={68} cy={38} r={5} stroke={PRIMARY} strokeWidth={0.8} fill="#ffffff" />
              </>
            )}
            {damages
              .filter((d) => d.view === view)
              .map((d) => (
                <Circle key={d.n} cx={4 + d.x * 82} cy={4 + d.y * 42} r={4.5} fill={ORANGE} />
              ))}
          </Svg>
          <Text style={{ fontSize: 7, color: MUTED, marginTop: 1 }}>{VIEWS[view]}</Text>
        </View>
      ))}
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

function km(value: number | null | undefined, empty = "illisible"): string {
  return value != null ? `${value.toLocaleString("fr-FR")} km` : empty;
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

export function RepairOrderDocument({ data }: { data: RepairOrderPdfData }) {
  const g = data.garage;
  const showPrices = data.kind === "full";
  const showMechanics = data.kind === "workshop";
  const showReception = data.kind === "reception" || data.kind === "delivery";
  const presentItems = data.items.filter((i) => i.present).map((i) => i.label);
  const descWidth = showPrices ? "46%" : "40%";
  const qtyWidth = "12%";
  return (
    <Document title={`${TITLES[data.kind]} — ${data.number}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.between}>
          <Mark logo={g.logo} name={g.name} />
          <View style={{ width: "68%", alignItems: "flex-end" }}>
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
          </View>
        </View>

        <Text style={styles.docTitle}>{TITLES[data.kind].toUpperCase()}</Text>
        <Text style={styles.audience}>{AUDIENCE[data.kind]}</Text>

        <View style={[styles.between, { alignItems: "flex-start" }]}>
          <View style={{ width: "46%" }}>
            <Meta label="N° d'ordre" value={data.number} />
            <Meta
              label="Reçu le"
              value={`${day(data.createdAt)}${hour(data.createdAt) ? ` à ${hour(data.createdAt)}` : ""}`}
            />
            {data.promisedAt && (
              <Meta
                label="Restitution prévue"
                value={`${day(data.promisedAt)}${hour(data.promisedAt) ? ` à ${hour(data.promisedAt)}` : ""}`}
              />
            )}
          </View>
          <View style={styles.party}>
            <Text style={styles.partyLabel}>CLIENT</Text>
            <Text style={styles.partyName}>{data.customer.displayName}</Text>
            {data.customer.phone && (
              <Text style={styles.partyLine}>Tél. {data.customer.phone}</Text>
            )}
            <View style={{ marginTop: 8 }}>
              <Text style={styles.partyLabel}>VÉHICULE</Text>
              <Text style={styles.partyName}>{data.vehicle.plate}</Text>
              <Text style={styles.partyLine}>
                {data.vehicle.make} {data.vehicle.model}
                {data.vehicle.year ? `  ·  ${data.vehicle.year}` : ""}
              </Text>
              <Text style={styles.partyLine}>
                {km(data.mileageIn)} · Carburant {data.fuelLevel ?? "—"}/8
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Doléances du client</Text>
          <Text style={styles.sectionBody}>{data.complaint || "—"}</Text>
        </View>
        {data.diagnosis && data.kind !== "reception" && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Diagnostic</Text>
            <Text style={styles.sectionBody}>{data.diagnosis}</Text>
          </View>
        )}

        {showReception && (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>État des lieux</Text>
              <View style={styles.sectionBody}>
                {data.noDamage ? (
                  <Text>Aucun dommage constaté.</Text>
                ) : (
                  <>
                    <Diagram damages={data.damages} />
                    {data.damages.map((d) => (
                      <Text key={d.n}>
                        {d.n}. {d.zone} — {DAMAGE_TYPES[d.type] ?? d.type}{" "}
                        {SEVERITY[d.severity] ?? ""}
                      </Text>
                    ))}
                  </>
                )}
                {data.warningLights.length > 0 && (
                  <Text>Voyants allumés : {data.warningLights.join(", ")}</Text>
                )}
              </View>
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Objets et accessoires</Text>
              <View style={styles.sectionBody}>
                <Text>{presentItems.join(", ") || "Aucun accessoire coché."}</Text>
                <Text>
                  Clés : {data.keysCount ?? "—"} · Objets personnels : {data.belongings || "aucun"}
                </Text>
                <Text>
                  Anciennes pièces à rendre : {data.returnOldParts ? "oui" : "non"} · Photos :{" "}
                  {data.photoCount}
                </Text>
                {data.photos.length > 0 && (
                  <View style={[styles.row, { flexWrap: "wrap", gap: 4, marginTop: 6 }]}>
                    {data.photos.slice(0, 8).map((src, i) => (
                      <Image
                        key={i}
                        src={src}
                        style={{ width: 110, height: 80, objectFit: "cover" }}
                      />
                    ))}
                  </View>
                )}
              </View>
            </View>
          </>
        )}

        {data.kind !== "reception" && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Travaux</Text>
            <View style={[styles.row, styles.thead]}>
              <Text style={[styles.th, { width: descWidth }]}>Désignation</Text>
              <Text style={[styles.th, { width: qtyWidth, textAlign: "right" }]}>Qté</Text>
              {showPrices && (
                <Text style={[styles.th, { width: "21%", textAlign: "right" }]}>PU HT</Text>
              )}
              {showPrices && (
                <Text style={[styles.th, { width: "21%", textAlign: "right" }]}>Total TTC</Text>
              )}
              {showMechanics && <Text style={[styles.th, { width: "24%" }]}>Mécanicien</Text>}
              {showMechanics && <Text style={[styles.th, { width: "24%" }]}>Pointage</Text>}
            </View>
            {data.lines.map((l, i) => (
              <View key={i} style={styles.tr} wrap={false}>
                <Text style={[styles.td, { width: descWidth }]}>
                  {l.description}
                  {l.isCustomerSupplied ? " — Pièce fournie par le client — non garantie" : ""}
                  {l.approval === "PENDING" ? " (en attente d'accord)" : ""}
                </Text>
                <Text style={[styles.td, { width: qtyWidth, textAlign: "right" }]}>
                  {l.quantity.toLocaleString("fr-FR")}
                </Text>
                {showPrices && (
                  <Text style={[styles.td, { width: "21%", textAlign: "right" }]}>
                    {formatFCFA(l.unitPrice)}
                  </Text>
                )}
                {showPrices && (
                  <Text style={[styles.td, { width: "21%", textAlign: "right" }]}>
                    {formatFCFA(l.total)}
                  </Text>
                )}
                {showMechanics && (
                  <Text style={[styles.td, { width: "24%" }]}>{l.mechanic ?? "—"}</Text>
                )}
                {showMechanics && (
                  <Text style={[styles.td, { width: "24%" }]}>[ ] début [ ] fin</Text>
                )}
              </View>
            ))}
            {showPrices && data.totals && (
              <View>
                <View style={styles.sumRow}>
                  <Text style={{ color: MUTED }}>Sous-total HT</Text>
                  <Text>{formatFCFA(data.totals.subtotal)}</Text>
                </View>
                <View style={styles.sumRow}>
                  <Text style={{ color: MUTED }}>TVA</Text>
                  <Text>{formatFCFA(data.totals.vatTotal)}</Text>
                </View>
                <View style={styles.grand}>
                  <Text style={styles.grandText}>Total TTC estimé</Text>
                  <Text style={styles.grandText}>{formatFCFA(data.totals.total)}</Text>
                </View>
              </View>
            )}
          </View>
        )}

        {data.kind === "reception" && (
          <View style={styles.note}>
            <Text>
              J&apos;autorise le diagnostic. Aucun travail ne sera réalisé sans mon accord au-delà
              de {formatFCFA(data.authorizationCeiling)}.
            </Text>
          </View>
        )}

        {data.kind === "delivery" && data.checkOut && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>Restitution</Text>
            <View style={styles.sectionBody}>
              <Text>
                Le {day(data.checkOut.at)} à {hour(data.checkOut.at)} · Compteur :{" "}
                {km(data.checkOut.mileage, "—")} · Carburant : {data.checkOut.fuelLevel}/8
              </Text>
              <Text>
                Objets de la réception vérifiés : {data.checkOut.itemsConfirmed ? "oui" : "non"} ·
                Anciennes pièces remises : {data.checkOut.oldPartsReturned ? "oui" : "non"}
              </Text>
              <Text>Véhicule récupéré par : {data.checkOut.collectedBy}</Text>
              {data.checkOut.signatureImage && (
                <Image src={data.checkOut.signatureImage} style={{ width: 160, height: 60 }} />
              )}
            </View>
          </View>
        )}

        {(data.kind === "reception" || data.kind === "full") && data.signature && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>Signature du client</Text>
            <View style={styles.sectionBody}>
              <Text>{data.signature.status}</Text>
              {data.signature.signerName && <Text>Signataire : {data.signature.signerName}</Text>}
              {data.signature.image && (
                <Image
                  src={data.signature.image}
                  style={{ width: 160, height: 60, marginTop: 4 }}
                />
              )}
            </View>
          </View>
        )}

        {data.trackingUrl && data.kind !== "workshop" && (
          <Text style={[styles.sectionBody, { marginTop: 8 }]}>
            Suivi en ligne : {data.trackingUrl}
          </Text>
        )}

        <Text style={styles.pageFoot} fixed>
          {[
            g.name,
            g.rccm && `RCCM ${g.rccm}`,
            g.ncc && `NCC ${g.ncc}`,
            g.phone && `Tél. ${g.phone}`,
          ]
            .filter(Boolean)
            .join("  ·  ")}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderRepairOrderPdf(data: RepairOrderPdfData): Promise<Buffer> {
  return renderToBuffer(<RepairOrderDocument data={data} />);
}
