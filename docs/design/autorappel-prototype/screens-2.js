const {
  Icon: Icon2,
  Tip: Tip2,
  StatusPill: StatusPill2,
  TypePill: TypePill2,
  ChanPill: ChanPill2,
  PalierBadge: PalierBadge2,
  AlertBanner: AlertBanner2,
  Modal: Modal2,
  EmptyState: EmptyState2,
  Pagination: Pagination2,
  SortTh: SortTh2,
  sortRows: sortRows2,
  paginate: paginate2,
  MessagePreview: MessagePreview2,
  VariableChip: VariableChip2,
  VARIABLES: VARIABLES2,
  useApp: useApp2,
} = window;
const { fcfa: fcfa2, fmtFR: fmtFR2 } = window.AR_HELPERS;

/* ===================== Relances du jour ===================== */
function RelancesScreen({ params }) {
  const { data, reminders, sendReminders, reportReminder, ignoreReminder, updateReminder, toast } =
    useApp2();
  const [typeFilter, setTypeFilter] = useState((params && params.type) || "tout");
  const [chanFilter, setChanFilter] = useState("tout");
  const [selected, setSelected] = useState(new Set());
  const [expanded, setExpanded] = useState(null);
  const [editing, setEditing] = useState(null);
  const [reporting, setReporting] = useState(null);
  const [ignoring, setIgnoring] = useState(null);
  const [confirmSend, setConfirmSend] = useState(false);

  const byType = { tout: reminders.length, vt: 0, revision: 0, creance: 0 };
  reminders.forEach((r) => byType[r.type]++);

  let rows = reminders;
  if (typeFilter !== "tout") rows = rows.filter((r) => r.type === typeFilter);
  if (chanFilter !== "tout") rows = rows.filter((r) => r.canal === chanFilter);

  function toggleOne(id) {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  }
  function toggleAll() {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  }
  function doSend(ids) {
    sendReminders(ids);
    setSelected(new Set());
    setConfirmSend(false);
    toast("ok", ids.length + " relance(s) envoyée(s) avec succès.");
  }

  const chips = [
    { id: "tout", label: "Tout" },
    { id: "vt", label: "Visite technique" },
    { id: "revision", label: "Révision" },
    { id: "creance", label: "Créance" },
  ];

  return (
    <div data-od-id="relances-screen">
      <div className="page-head">
        <div>
          <h2>Relances du jour</h2>
          <div className="desc">{reminders.length} relance(s) en attente aujourd'hui.</div>
        </div>
      </div>

      <AlertBanner2 tone="info">
        <strong>Mode automatique —</strong> les relances de visite technique et révision partent
        automatiquement à 9h00. Les créances attendent toujours votre validation avant envoi.
      </AlertBanner2>

      <div className="table-wrap to-cards">
        <div className="table-toolbar">
          {chips.map((c) => (
            <button
              key={c.id}
              className={"filter-chip" + (typeFilter === c.id ? " active" : "")}
              onClick={() => {
                setTypeFilter(c.id);
                setSelected(new Set());
              }}
            >
              {c.label}
              <span className="cnt">{byType[c.id]}</span>
            </button>
          ))}
          <div className="spacer" />
          <select
            className="select"
            style={{ width: 160, height: 36 }}
            value={chanFilter}
            onChange={(e) => {
              setChanFilter(e.target.value);
              setSelected(new Set());
            }}
            aria-label="Filtrer par canal"
          >
            <option value="tout">Tous les canaux</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="sms">SMS</option>
            <option value="email">Email</option>
          </select>
        </div>

        {selected.size > 0 && (
          <div className="bulk-bar">
            <Icon2 name="checkCircle" size={16} />
            {selected.size} sélectionnée(s)
            <div className="spacer" />
            <button className="btn btn-primary btn-sm" onClick={() => setConfirmSend(true)}>
              <Icon2 name="send" size={14} />
              Envoyer la sélection
            </button>
          </div>
        )}

        {rows.length === 0 ? (
          <EmptyState2
            icon="checkCircle"
            title="Aucune relance aujourd'hui"
            text="Tout est à jour. Revenez demain matin pour la prochaine série de relances."
          />
        ) : (
          <>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={selected.size === rows.length}
                      onChange={toggleAll}
                      aria-label="Tout sélectionner"
                    />
                  </th>
                  <th>Type</th>
                  <th>Client</th>
                  <th>Véhicule / Motif</th>
                  <th>Palier</th>
                  <th>Canal</th>
                  <th style={{ width: 280 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <React.Fragment key={r.id}>
                    <tr className={selected.has(r.id) ? "selected" : ""}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggleOne(r.id)}
                          aria-label={"Sélectionner " + r.client.nom}
                        />
                      </td>
                      <td>
                        <TypePill2 type={r.type} />
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.client.nom}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>
                          {r.client.telephone}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: 13 }}>
                          {r.vehicle
                            ? r.vehicle.marque + " " + r.vehicle.modele + " · " + r.vehicle.plaque
                            : r.invoice
                              ? r.invoice.numero
                              : ""}
                        </div>
                        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{r.motif}</div>
                      </td>
                      <td>
                        <PalierBadge2 palier={r.palier} />
                      </td>
                      <td>
                        <select
                          className="select"
                          style={{ height: 32, padding: "0 8px", fontSize: 12.5, width: 120 }}
                          value={r.canal}
                          onChange={(e) => updateReminder(r.id, { canal: e.target.value })}
                          aria-label="Modifier le canal"
                        >
                          <option value="whatsapp">WhatsApp</option>
                          <option value="sms">SMS</option>
                          <option value="email">Email</option>
                        </select>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <Tip2 text="Envoyer cette relance immédiatement">
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => doSend([r.id])}
                            >
                              Envoyer
                            </button>
                          </Tip2>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setEditing(r)}
                          >
                            Modifier
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                          >
                            Aperçu
                            <Icon2
                              name="chevronDown"
                              size={13}
                              style={{ transform: expanded === r.id ? "rotate(180deg)" : "none" }}
                            />
                          </button>
                          <Tip2 text="Reporter à une date ultérieure">
                            <button
                              className="icon-btn"
                              style={{ width: 34, height: 34 }}
                              onClick={() => setReporting(r)}
                              aria-label="Reporter"
                            >
                              <Icon2 name="clock" size={15} />
                            </button>
                          </Tip2>
                          <Tip2 text="Ignorer cette relance">
                            <button
                              className="icon-btn"
                              style={{ width: 34, height: 34 }}
                              onClick={() => setIgnoring(r)}
                              aria-label="Ignorer"
                            >
                              <Icon2 name="x" size={15} />
                            </button>
                          </Tip2>
                          {r.canal === "whatsapp" && (
                            <Tip2 text="Ouvrir ce message pré-rempli dans WhatsApp (si l'API n'est pas configurée)">
                              <a
                                className="btn btn-ghost btn-sm"
                                href={
                                  "https://wa.me/" +
                                  r.client.telephone.replace(/[^0-9]/g, "") +
                                  "?text=" +
                                  encodeURIComponent(r.message)
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <Icon2 name="whatsapp" size={13} />
                                Ouvrir WhatsApp
                              </a>
                            </Tip2>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded === r.id && (
                      <tr>
                        <td colSpan={7} style={{ background: "var(--surface-2)" }}>
                          <div style={{ padding: "8px 0", maxWidth: 320 }}>
                            <MessagePreview2
                              canal={r.canal}
                              message={r.message}
                              client={r.client}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            <div className="card-list">
              {rows.map((r) => (
                <div className="row-card" key={r.id}>
                  <div className="row-card-top">
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggleOne(r.id)}
                        aria-label={"Sélectionner " + r.client.nom}
                      />
                      <TypePill2 type={r.type} compact />
                    </div>
                    <ChanPill2 canal={r.canal} compact />
                  </div>
                  <div style={{ fontWeight: 700 }}>{r.client.nom}</div>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>{r.motif}</div>
                  <PalierBadge2 palier={r.palier} />
                  {expanded === r.id && (
                    <MessagePreview2 canal={r.canal} message={r.message} client={r.client} />
                  )}
                  <div className="row-card-actions">
                    <button className="btn btn-primary btn-sm" onClick={() => doSend([r.id])}>
                      Envoyer
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditing(r)}>
                      Modifier
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                    >
                      Aperçu
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setReporting(r)}>
                      Reporter
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setIgnoring(r)}>
                      Ignorer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {editing && (
        <Modal2
          title={"Modifier le message — " + editing.client.nom}
          onClose={() => setEditing(null)}
          size="lg"
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setEditing(null)}>
                Annuler
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  updateReminder(editing.id, { message: editing.message });
                  setEditing(null);
                  toast("ok", "Message mis à jour.");
                }}
              >
                Enregistrer
              </button>
            </>
          }
        >
          <div className="grid-2">
            <div>
              <div className="field">
                <label>Canal</label>
                <select
                  className="select"
                  value={editing.canal}
                  onChange={(e) => setEditing({ ...editing, canal: e.target.value })}
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                </select>
              </div>
              <div className="field">
                <label>Message</label>
                <textarea
                  className="textarea"
                  rows={6}
                  value={editing.message}
                  onChange={(e) => setEditing({ ...editing, message: e.target.value })}
                />
                <div className="var-chip-row">
                  {VARIABLES2.map((v) => (
                    <VariableChip2
                      key={v}
                      name={v}
                      onInsert={(tok) =>
                        setEditing({ ...editing, message: editing.message + " " + tok })
                      }
                    />
                  ))}
                </div>
              </div>
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 8 }}>
                Aperçu
              </label>
              <MessagePreview2
                canal={editing.canal}
                message={editing.message}
                client={editing.client}
              />
            </div>
          </div>
        </Modal2>
      )}

      {reporting && (
        <Modal2
          title={"Reporter la relance — " + reporting.client.nom}
          onClose={() => setReporting(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setReporting(null)}>
                Annuler
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  reportReminder(reporting.id);
                  setReporting(null);
                  toast("ok", "Relance reportée.");
                }}
              >
                Confirmer le report
              </button>
            </>
          }
        >
          <div className="field">
            <label>Nouvelle date</label>
            <input type="date" className="input" defaultValue="2026-10-20" />
          </div>
          <div className="field">
            <label>Motif (optionnel)</label>
            <textarea
              className="textarea"
              rows={3}
              placeholder="Ex : client en déplacement, rappel demandé plus tard…"
            />
          </div>
        </Modal2>
      )}

      {ignoring && (
        <Modal2
          title={"Ignorer la relance — " + ignoring.client.nom}
          onClose={() => setIgnoring(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setIgnoring(null)}>
                Annuler
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  ignoreReminder(ignoring.id);
                  setIgnoring(null);
                  toast("info", "Relance ignorée.");
                }}
              >
                Ignorer la relance
              </button>
            </>
          }
        >
          <div className="field">
            <label>
              Motif <span style={{ color: "var(--status-bad)" }}>*</span>
            </label>
            <textarea
              className="textarea"
              rows={3}
              placeholder="Ex : déjà réglé en caisse, doublon, client injoignable…"
            />
          </div>
        </Modal2>
      )}

      {confirmSend && (
        <Modal2
          title="Confirmer l'envoi groupé"
          onClose={() => setConfirmSend(false)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setConfirmSend(false)}>
                Annuler
              </button>
              <button className="btn btn-primary" onClick={() => doSend(Array.from(selected))}>
                <Icon2 name="send" size={14} />
                Envoyer {selected.size} relance(s)
              </button>
            </>
          }
        >
          <p style={{ fontSize: 13.5, marginBottom: 10 }}>
            Vous allez envoyer <strong>{selected.size}</strong> relance(s) :
          </p>
          <ul style={{ fontSize: 13.5, paddingLeft: 18, lineHeight: 1.7 }}>
            {Array.from(selected)
              .slice(0, 8)
              .map((id) => {
                const r = reminders.find((x) => x.id === id);
                return (
                  <li key={id}>
                    {r.client.nom} — {r.motif}
                  </li>
                );
              })}
            {selected.size > 8 && <li>… et {selected.size - 8} autre(s)</li>}
          </ul>
        </Modal2>
      )}
    </div>
  );
}

/* ===================== Créances ===================== */
const STATUT_TONE = {
  "À échéance": "off",
  "En retard": "bad",
  Relancée: "warn",
  "Promesse de paiement": "warn",
  "Payée partiellement": "warn",
  Payée: "ok",
  "Litige/ne plus relancer": "off",
};
function PaymentModal({ invoice, client, onClose, onSave }) {
  const [montant, setMontant] = useState(invoice.resteDue);
  const [date, setDate] = useState("2026-10-18");
  const [mode, setMode] = useState("Wave");
  const [ref, setRef] = useState("");
  return (
    <Modal2
      title={"Enregistrer un paiement — " + client.nom}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onSave({ montant: Number(montant), date, mode, ref })}
          >
            Enregistrer le paiement
          </button>
        </>
      }
    >
      <div className="grid-2">
        <div className="field">
          <label>Montant (FCFA)</label>
          <input
            className="input num"
            type="number"
            value={montant}
            onChange={(e) => setMontant(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Date</label>
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <label>Mode de paiement</label>
        <select className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
          {["Espèces", "Wave", "Orange Money", "MTN MoMo", "Moov Money", "Virement", "Chèque"].map(
            (m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ),
          )}
        </select>
      </div>
      <div className="field">
        <label>Référence (optionnel)</label>
        <input
          className="input"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder="N° transaction, chèque…"
        />
      </div>
      <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
        Facture {invoice.numero} · Reste dû actuel :{" "}
        <strong className="num">{fcfa2(invoice.resteDue)}</strong>
      </div>
    </Modal2>
  );
}

function CreancesScreen({ params }) {
  const {
    data,
    invoices,
    recordPayment,
    setPromesse,
    setLitige,
    relancerMaintenant,
    toast,
    navigate,
  } = useApp2();
  const { clients } = data;
  const [statutFilter, setStatutFilter] = useState("tout");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState("retardJours");
  const [sortDir, setSortDir] = useState("desc");
  const [payInvoice, setPayInvoice] = useState(null);
  const [promiseInvoice, setPromiseInvoice] = useState(null);
  const [litigeInvoice, setLitigeInvoice] = useState(null);
  const [relanceInvoice, setRelanceInvoice] = useState(null);
  const [histInvoice, setHistInvoice] = useState(null);
  const [menuOpen, setMenuOpen] = useState(null);
  const pageSize = 8;

  const openInvoices = invoices.filter((i) => i.statut !== "Payée");
  const totalDue = openInvoices.reduce((s, i) => s + i.resteDue, 0);
  const totalRetard = openInvoices
    .filter((i) => i.retardJours > 0)
    .reduce((s, i) => s + i.resteDue, 0);
  const recupereMois = invoices
    .filter((i) => i.statut === "Payée")
    .reduce((s, i) => s + i.montant, 0);
  const buckets = [
    { id: "0-30", label: "0–30 j", min: 0, max: 30 },
    { id: "31-60", label: "31–60 j", min: 31, max: 60 },
    { id: "61-90", label: "61–90 j", min: 61, max: 90 },
    { id: "+90", label: "+90 j", min: 91, max: Infinity },
  ].map((b) => ({
    ...b,
    total: openInvoices
      .filter((i) => i.retardJours >= b.min && i.retardJours <= b.max)
      .reduce((s, i) => s + i.resteDue, 0),
  }));
  const maxBucket = Math.max(...buckets.map((b) => b.total), 1);

  const statuts = [
    "tout",
    "À échéance",
    "En retard",
    "Relancée",
    "Promesse de paiement",
    "Payée partiellement",
    "Payée",
    "Litige/ne plus relancer",
  ];
  let rows = statutFilter === "tout" ? invoices : invoices.filter((i) => i.statut === statutFilter);
  rows = sortRows2(rows, sortKey, sortDir, (r, k) =>
    k === "client" ? clients.find((c) => c.id === r.clientId).nom : r[k],
  );
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = paginate2(rows, page, pageSize);

  function onSort(k) {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  return (
    <div data-od-id="creances-screen">
      <div className="page-head">
        <div>
          <h2>Créances</h2>
          <div className="desc">Suivi des factures impayées et des relances de paiement.</div>
        </div>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        <div className="kpi-card" style={{ cursor: "default" }}>
          <div className="kpi-top">
            <div className="kpi-icon">
              <Icon2 name="banknote" size={18} />
            </div>
          </div>
          <div className="kpi-value num">{fcfa2(totalDue)}</div>
          <div className="kpi-label">Total dû</div>
        </div>
        <div className="kpi-card" style={{ cursor: "default" }}>
          <div className="kpi-top">
            <div className="kpi-icon" style={{ color: "var(--status-bad)" }}>
              <Icon2 name="alertTriangle" size={18} />
            </div>
          </div>
          <div className="kpi-value num" style={{ color: "var(--status-bad)" }}>
            {fcfa2(totalRetard)}
          </div>
          <div className="kpi-label">En retard</div>
        </div>
        <div className="kpi-card" style={{ cursor: "default" }}>
          <div className="kpi-top">
            <div className="kpi-icon" style={{ color: "var(--status-ok)" }}>
              <Icon2 name="checkCircle" size={18} />
            </div>
          </div>
          <div className="kpi-value num" style={{ color: "var(--status-ok)" }}>
            {fcfa2(recupereMois)}
          </div>
          <div className="kpi-label">Récupéré ce mois</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title" style={{ marginBottom: 14 }}>
          Répartition par ancienneté
        </div>
        <div className="aging-bars">
          {buckets.map((b) => (
            <div className="aging-row" key={b.id}>
              <div>{b.label}</div>
              <div className="aging-track">
                <div
                  className="aging-fill"
                  style={{
                    width: (b.total / maxBucket) * 100 + "%",
                    background:
                      b.id === "+90"
                        ? "var(--status-bad)"
                        : b.id === "61-90"
                          ? "var(--status-warn)"
                          : "var(--primary)",
                  }}
                />
              </div>
              <div className="num" style={{ textAlign: "right", fontWeight: 600 }}>
                {fcfa2(b.total)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="table-wrap to-cards">
        <div className="table-toolbar">
          {statuts.map((s) => (
            <button
              key={s}
              className={"filter-chip" + (statutFilter === s ? " active" : "")}
              onClick={() => {
                setStatutFilter(s);
                setPage(1);
              }}
            >
              {s === "tout" ? "Tous" : s}
            </button>
          ))}
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <SortTh2
                label="Client"
                sortKey="client"
                active={sortKey === "client"}
                dir={sortDir}
                onSort={onSort}
              />
              <th>N° facture</th>
              <SortTh2
                label="Échéance"
                sortKey="echeance"
                active={sortKey === "echeance"}
                dir={sortDir}
                onSort={onSort}
              />
              <th>Montant</th>
              <th>Payé</th>
              <th>Reste dû</th>
              <SortTh2
                label="Retard"
                sortKey="retardJours"
                active={sortKey === "retardJours"}
                dir={sortDir}
                onSort={onSort}
                tooltip="Nombre de jours écoulés depuis l'échéance"
              />
              <th>Statut</th>
              <th style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((inv) => {
              const c = clients.find((x) => x.id === inv.clientId);
              return (
                <tr
                  key={inv.id}
                  className={params && params.highlight === inv.id ? "selected" : ""}
                >
                  <td>
                    <button
                      className="link-btn"
                      style={{ color: "var(--fg)", fontWeight: 600, textDecoration: "none" }}
                      onClick={() => navigate("fiche-client", { clientId: c.id })}
                    >
                      {c.nom}
                    </button>
                    <div>
                      <span
                        className={"badge-type" + (c.type === "entreprise" ? " entreprise" : "")}
                        style={{ marginTop: 3 }}
                      >
                        {c.type === "entreprise" ? "Entreprise" : "Particulier"}
                      </span>
                    </div>
                  </td>
                  <td className="num" style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>
                    {inv.numero}
                  </td>
                  <td className="num">{fmtFR2(inv.echeance)}</td>
                  <td className="num">{fcfa2(inv.montant)}</td>
                  <td className="num">{fcfa2(inv.paye)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {fcfa2(inv.resteDue)}
                  </td>
                  <td className="num">{inv.retardJours > 0 ? inv.retardJours + " j" : "—"}</td>
                  <td>
                    <StatusPill2 tone={STATUT_TONE[inv.statut]}>{inv.statut}</StatusPill2>
                  </td>
                  <td style={{ position: "relative" }}>
                    <Tip2 text="Actions">
                      <button
                        className="icon-btn"
                        style={{ width: 32, height: 32 }}
                        onClick={() => setMenuOpen(menuOpen === inv.id ? null : inv.id)}
                        aria-label="Actions"
                      >
                        <Icon2 name="more" size={16} />
                      </button>
                    </Tip2>
                    {menuOpen === inv.id && (
                      <div
                        style={{
                          position: "absolute",
                          right: 0,
                          top: "100%",
                          background: "var(--surface)",
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          boxShadow: "var(--shadow-md)",
                          width: 210,
                          zIndex: 50,
                          padding: 6,
                        }}
                      >
                        {inv.statut !== "Payée" && (
                          <button
                            className="nav-item"
                            style={{ color: "var(--fg)", minHeight: 38 }}
                            onClick={() => {
                              setPayInvoice(inv);
                              setMenuOpen(null);
                            }}
                          >
                            <span className="ic">
                              <Icon2 name="creditCard" size={15} />
                            </span>
                            <span className="label">Enregistrer un paiement</span>
                          </button>
                        )}
                        {inv.statut !== "Payée" && inv.statut !== "Litige/ne plus relancer" && (
                          <button
                            className="nav-item"
                            style={{ color: "var(--fg)", minHeight: 38 }}
                            onClick={() => {
                              setRelanceInvoice(inv);
                              setMenuOpen(null);
                            }}
                          >
                            <span className="ic">
                              <Icon2 name="send" size={15} />
                            </span>
                            <span className="label">Relancer maintenant</span>
                          </button>
                        )}
                        {inv.statut !== "Payée" && (
                          <button
                            className="nav-item"
                            style={{ color: "var(--fg)", minHeight: 38 }}
                            onClick={() => {
                              setPromiseInvoice(inv);
                              setMenuOpen(null);
                            }}
                          >
                            <span className="ic">
                              <Icon2 name="clock" size={15} />
                            </span>
                            <span className="label">Noter une promesse</span>
                          </button>
                        )}
                        {inv.statut !== "Payée" && inv.statut !== "Litige/ne plus relancer" && (
                          <button
                            className="nav-item"
                            style={{ color: "var(--fg)", minHeight: 38 }}
                            onClick={() => {
                              setLitigeInvoice(inv);
                              setMenuOpen(null);
                            }}
                          >
                            <span className="ic">
                              <Icon2 name="flag" size={15} />
                            </span>
                            <span className="label">Marquer en litige</span>
                          </button>
                        )}
                        <button
                          className="nav-item"
                          style={{ color: "var(--fg)", minHeight: 38 }}
                          onClick={() => {
                            setHistInvoice(inv);
                            setMenuOpen(null);
                          }}
                        >
                          <span className="ic">
                            <Icon2 name="list" size={15} />
                          </span>
                          <span className="label">Voir l'historique</span>
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="card-list">
          {pageRows.map((inv) => {
            const c = clients.find((x) => x.id === inv.clientId);
            return (
              <div className="row-card" key={inv.id}>
                <div className="row-card-top">
                  <div style={{ fontWeight: 700 }}>{c.nom}</div>
                  <StatusPill2 tone={STATUT_TONE[inv.statut]}>{inv.statut}</StatusPill2>
                </div>
                <div className="row-card-fields">
                  <div className="k">Facture</div>
                  <div className="num">{inv.numero}</div>
                  <div className="k">Reste dû</div>
                  <div className="num" style={{ fontWeight: 700 }}>
                    {fcfa2(inv.resteDue)}
                  </div>
                  <div className="k">Échéance</div>
                  <div className="num">{fmtFR2(inv.echeance)}</div>
                  <div className="k">Retard</div>
                  <div className="num">{inv.retardJours > 0 ? inv.retardJours + " j" : "—"}</div>
                </div>
                <div className="row-card-actions">
                  {inv.statut !== "Payée" && (
                    <button className="btn btn-primary btn-sm" onClick={() => setPayInvoice(inv)}>
                      Paiement
                    </button>
                  )}
                  {inv.statut !== "Payée" && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setRelanceInvoice(inv)}
                    >
                      Relancer
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => setHistInvoice(inv)}>
                    Historique
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <Pagination2
          page={page}
          totalPages={totalPages}
          onChange={setPage}
          totalLabel={rows.length + " facture(s)"}
        />
      </div>

      {payInvoice && (
        <PaymentModal
          invoice={payInvoice}
          client={clients.find((c) => c.id === payInvoice.clientId)}
          onClose={() => setPayInvoice(null)}
          onSave={(p) => {
            recordPayment(payInvoice.id, p);
            setPayInvoice(null);
            toast("ok", "Paiement enregistré. Statut mis à jour.");
          }}
        />
      )}

      {relanceInvoice && (
        <Modal2
          title={
            "Relancer maintenant — " + clients.find((c) => c.id === relanceInvoice.clientId).nom
          }
          onClose={() => setRelanceInvoice(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setRelanceInvoice(null)}>
                Annuler
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  relancerMaintenant(relanceInvoice);
                  setRelanceInvoice(null);
                  toast("ok", "Relance envoyée.");
                }}
              >
                <Icon2 name="send" size={14} />
                Envoyer la relance
              </button>
            </>
          }
        >
          <MessagePreview2
            canal={clients.find((c) => c.id === relanceInvoice.clientId).canalPrefere}
            message={
              "Bonjour " +
              clients.find((c) => c.id === relanceInvoice.clientId).nom.split(" ")[0] +
              ", votre facture " +
              relanceInvoice.numero +
              " de " +
              fcfa2(relanceInvoice.resteDue) +
              " est en retard de " +
              relanceInvoice.retardJours +
              " jours. Merci de régulariser dès que possible. — " +
              data.garage.nom
            }
            client={clients.find((c) => c.id === relanceInvoice.clientId)}
          />
        </Modal2>
      )}

      {promiseInvoice && (
        <Modal2
          title="Noter une promesse de paiement"
          onClose={() => setPromiseInvoice(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setPromiseInvoice(null)}>
                Annuler
              </button>
              <button
                className="btn btn-primary"
                onClick={(e) => {
                  const d = document.getElementById("promise-date").value;
                  const n = document.getElementById("promise-note").value;
                  setPromesse(promiseInvoice.id, d, n);
                  setPromiseInvoice(null);
                  toast("ok", "Promesse de paiement enregistrée.");
                }}
              >
                Enregistrer
              </button>
            </>
          }
        >
          <div className="field">
            <label>Date promise</label>
            <input id="promise-date" type="date" className="input" defaultValue="2026-10-25" />
          </div>
          <div className="field">
            <label>Note</label>
            <textarea
              id="promise-note"
              className="textarea"
              rows={3}
              placeholder="Ex : paiement promis par téléphone le…"
            />
          </div>
        </Modal2>
      )}

      {litigeInvoice && (
        <Modal2
          title="Marquer en litige"
          onClose={() => setLitigeInvoice(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setLitigeInvoice(null)}>
                Annuler
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  const n = document.getElementById("litige-note").value;
                  setLitige(litigeInvoice.id, n);
                  setLitigeInvoice(null);
                  toast("info", "Facture marquée en litige. Les relances sont arrêtées.");
                }}
              >
                Marquer en litige
              </button>
            </>
          }
        >
          <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
            Les relances automatiques seront arrêtées pour cette facture.
          </p>
          <div className="field">
            <label>
              Motif <span style={{ color: "var(--status-bad)" }}>*</span>
            </label>
            <textarea id="litige-note" className="textarea" rows={3} />
          </div>
        </Modal2>
      )}

      {histInvoice && (
        <Modal2 title={"Historique — " + histInvoice.numero} onClose={() => setHistInvoice(null)}>
          <div className="section-label" style={{ marginTop: 0 }}>
            Détails
          </div>
          <p style={{ fontSize: 13.5 }}>
            Montant : <strong className="num">{fcfa2(histInvoice.montant)}</strong> · Payé :{" "}
            <strong className="num">{fcfa2(histInvoice.paye)}</strong> · Reste dû :{" "}
            <strong className="num">{fcfa2(histInvoice.resteDue)}</strong>
          </p>
          {histInvoice.note && (
            <p style={{ fontSize: 13, color: "var(--muted)" }}>Note : {histInvoice.note}</p>
          )}
          <div className="section-label">Relances & paiements liés</div>
          <div className="timeline-list">
            {data.history
              .filter((h) => h.clientId === histInvoice.clientId && h.type === "creance")
              .map((h) => (
                <div className="tl-item" key={h.id}>
                  <div className="tl-ic">
                    <Icon2 name="banknote" size={15} />
                  </div>
                  <div className="tl-content">
                    <div className="tl-top">
                      <strong style={{ fontSize: 13.5 }}>
                        Relance {h.palier} — {h.statut}
                      </strong>
                      <span className="tl-date">{fmtFR2(h.datetime.slice(0, 10))}</span>
                    </div>
                  </div>
                </div>
              ))}
            {histInvoice.paiements &&
              histInvoice.paiements.map((p, i) => (
                <div className="tl-item" key={i}>
                  <div className="tl-ic" style={{ color: "var(--status-ok)" }}>
                    <Icon2 name="checkCircle" size={15} />
                  </div>
                  <div className="tl-content">
                    <div className="tl-top">
                      <strong style={{ fontSize: 13.5 }}>
                        Paiement {p.mode} — {fcfa2(p.montant)}
                      </strong>
                      <span className="tl-date">{fmtFR2(p.date)}</span>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </Modal2>
      )}
    </div>
  );
}

Object.assign(window, { RelancesScreen, CreancesScreen });
