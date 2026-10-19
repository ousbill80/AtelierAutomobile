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

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  row: { flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  h1: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 5 },
  muted: { color: "#555" },
  box: { border: "1pt solid #ccc", padding: 7, marginTop: 8 },
  th: { fontFamily: "Helvetica-Bold", borderBottom: "1pt solid #999", paddingVertical: 3 },
  td: { borderBottom: "0.5pt solid #ddd", paddingVertical: 3 },
  cDesc: { width: "46%" },
  cSmall: { width: "13%", textAlign: "right" },
  cMech: { width: "22%" },
  cCheck: { width: "19%" },
  footer: { marginTop: 14, fontSize: 8, color: "#555" },
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
  const views = ["TOP", "FRONT", "REAR", "LEFT", "RIGHT"];
  return (
    <View style={[styles.row, { flexWrap: "wrap", gap: 6 }]}>
      {views.map((view) => (
        <View key={view} style={{ alignItems: "center" }}>
          <Svg width={90} height={50}>
            <Rect
              x={4}
              y={4}
              width={82}
              height={42}
              rx={8}
              stroke="#555"
              strokeWidth={1}
              fill="#fafafa"
            />
            {damages
              .filter((d) => d.view === view)
              .map((d) => (
                <Circle key={d.n} cx={4 + d.x * 82} cy={4 + d.y * 42} r={4} fill="#c62828" />
              ))}
          </Svg>
          <Text style={styles.muted}>{VIEWS[view]}</Text>
        </View>
      ))}
    </View>
  );
}

export function RepairOrderDocument({ data }: { data: RepairOrderPdfData }) {
  const g = data.garage;
  const showPrices = data.kind === "full";
  const showMechanics = data.kind === "workshop";
  const showReception = data.kind === "reception" || data.kind === "delivery";
  return (
    <Document title={`${TITLES[data.kind]} — ${data.number}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.between}>
          <View>
            <Text style={styles.h1}>{g.name}</Text>
            {g.address && <Text>{g.address}</Text>}
            {g.phone && <Text>{g.phone}</Text>}
            {g.rccm && <Text style={styles.muted}>RCCM : {g.rccm}</Text>}
            {g.ncc && <Text style={styles.muted}>NCC : {g.ncc}</Text>}
          </View>
          <View>
            <Text style={styles.h1}>{TITLES[data.kind]}</Text>
            <Text>N° {data.number}</Text>
            <Text>
              Reçu le {day(data.createdAt)} à {hour(data.createdAt)}
            </Text>
            {data.promisedAt && (
              <Text>
                Restitution prévue le {day(data.promisedAt)} à {hour(data.promisedAt)}
              </Text>
            )}
          </View>
        </View>

        <View style={[styles.box, styles.between]}>
          <View>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{data.customer.displayName}</Text>
            {data.customer.phone && <Text>{data.customer.phone}</Text>}
          </View>
          <View>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>
              {data.vehicle.make} {data.vehicle.model}
              {data.vehicle.year ? ` (${data.vehicle.year})` : ""}
            </Text>
            <Text>Immatriculation : {data.vehicle.plate}</Text>
            <Text>
              Compteur :{" "}
              {data.mileageIn != null
                ? `${data.mileageIn.toLocaleString("fr-FR")} km`
                : "illisible"}{" "}
              · Carburant : {data.fuelLevel ?? "—"}/8
            </Text>
          </View>
        </View>

        <Text style={styles.h2}>Doléances du client</Text>
        <Text>{data.complaint || "—"}</Text>
        {data.diagnosis && data.kind !== "reception" && (
          <>
            <Text style={styles.h2}>Diagnostic</Text>
            <Text>{data.diagnosis}</Text>
          </>
        )}

        {showReception && (
          <>
            <Text style={styles.h2}>État des lieux</Text>
            {data.noDamage ? (
              <Text>Aucun dommage constaté.</Text>
            ) : (
              <>
                <Diagram damages={data.damages} />
                {data.damages.map((d) => (
                  <Text key={d.n}>
                    {d.n}. {d.zone} — {DAMAGE_TYPES[d.type] ?? d.type} {SEVERITY[d.severity] ?? ""}
                  </Text>
                ))}
              </>
            )}
            {data.warningLights.length > 0 && (
              <Text>Voyants allumés : {data.warningLights.join(", ")}</Text>
            )}
            <Text style={styles.h2}>Objets et accessoires</Text>
            <Text>
              {data.items
                .filter((i) => i.present)
                .map((i) => i.label)
                .join(", ") || "—"}
            </Text>
            <Text>
              Clés : {data.keysCount ?? "—"} · Objets personnels : {data.belongings || "aucun"}
            </Text>
            <Text>
              Anciennes pièces à rendre : {data.returnOldParts ? "oui" : "non"} · Photos :{" "}
              {data.photoCount}
            </Text>
            {data.photos.length > 0 && (
              <View style={[styles.row, { flexWrap: "wrap", gap: 4, marginTop: 4 }]}>
                {data.photos.slice(0, 8).map((src, i) => (
                  <Image key={i} src={src} style={{ width: 110, height: 80, objectFit: "cover" }} />
                ))}
              </View>
            )}
          </>
        )}

        {data.kind !== "reception" && (
          <>
            <Text style={styles.h2}>Travaux</Text>
            <View style={[styles.row, styles.th]}>
              <Text style={styles.cDesc}>Désignation</Text>
              <Text style={styles.cSmall}>Qté</Text>
              {showPrices && <Text style={styles.cSmall}>PU HT</Text>}
              {showPrices && <Text style={styles.cSmall}>Total TTC</Text>}
              {showMechanics && <Text style={styles.cMech}>Mécanicien</Text>}
              {showMechanics && <Text style={styles.cCheck}>Pointage</Text>}
            </View>
            {data.lines.map((l, i) => (
              <View key={i} style={[styles.row, styles.td]} wrap={false}>
                <Text style={styles.cDesc}>
                  {l.description}
                  {l.isCustomerSupplied ? " — Pièce fournie par le client — non garantie" : ""}
                  {l.approval === "PENDING" ? " (en attente d'accord)" : ""}
                </Text>
                <Text style={styles.cSmall}>{l.quantity.toLocaleString("fr-FR")}</Text>
                {showPrices && <Text style={styles.cSmall}>{formatFCFA(l.unitPrice)}</Text>}
                {showPrices && <Text style={styles.cSmall}>{formatFCFA(l.total)}</Text>}
                {showMechanics && <Text style={styles.cMech}>{l.mechanic ?? ""}</Text>}
                {showMechanics && <Text style={styles.cCheck}>[ ] début [ ] fin</Text>}
              </View>
            ))}
            {showPrices && data.totals && (
              <View style={{ alignItems: "flex-end", marginTop: 6 }}>
                <Text>Sous-total HT : {formatFCFA(data.totals.subtotal)}</Text>
                <Text>TVA : {formatFCFA(data.totals.vatTotal)}</Text>
                <Text style={{ fontFamily: "Helvetica-Bold" }}>
                  Total TTC estimé : {formatFCFA(data.totals.total)}
                </Text>
              </View>
            )}
          </>
        )}

        {data.kind === "reception" && (
          <View style={styles.box}>
            <Text>
              J&apos;autorise le diagnostic ; aucun travail ne sera réalisé sans mon accord au-delà
              de {formatFCFA(data.authorizationCeiling)}.
            </Text>
          </View>
        )}

        {data.kind === "delivery" && data.checkOut && (
          <View style={styles.box}>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>Restitution</Text>
            <Text>
              Le {day(data.checkOut.at)} à {hour(data.checkOut.at)} · Compteur :{" "}
              {data.checkOut.mileage != null
                ? `${data.checkOut.mileage.toLocaleString("fr-FR")} km`
                : "—"}{" "}
              · Carburant : {data.checkOut.fuelLevel}/8
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
        )}

        {(data.kind === "reception" || data.kind === "full") && data.signature && (
          <View style={styles.box}>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>Signature du client</Text>
            <Text>{data.signature.status}</Text>
            {data.signature.signerName && <Text>Signataire : {data.signature.signerName}</Text>}
            {data.signature.image && (
              <Image src={data.signature.image} style={{ width: 160, height: 60 }} />
            )}
          </View>
        )}

        {data.trackingUrl && data.kind !== "workshop" && (
          <Text style={styles.footer}>Suivi en ligne : {data.trackingUrl}</Text>
        )}
      </Page>
    </Document>
  );
}

export async function renderRepairOrderPdf(data: RepairOrderPdfData): Promise<Buffer> {
  return renderToBuffer(<RepairOrderDocument data={data} />);
}
