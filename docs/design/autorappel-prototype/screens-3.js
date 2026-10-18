const {
  Icon: Icon3,
  Tip: Tip3,
  StatusPill: StatusPill3,
  ChanPill: ChanPill3,
  Countdown: Countdown3,
  KmProgress: KmProgress3,
  Modal: Modal3,
  EmptyState: EmptyState3,
  Pagination: Pagination3,
  sortRows: sortRows3,
  paginate: paginate3,
  useApp: useApp3,
} = window;
const { fcfa: fcfa3, fmtFR: fmtFR3 } = window.AR_HELPERS;

const VT_TONE = { ok: "ok", bientot: "warn", urgent: "bad", expire: "bad" };
const VT_LABEL = { ok: "À jour", bientot: "Bientôt", urgent: "Urgent", expire: "Expirée" };
const REV_TONE = { ok: "ok", bientot: "warn", du: "bad" };
const REV_LABEL = { ok: "À jour", bientot: "Bientôt", du: "Due" };

/* ===================== Échéances ===================== */
const MOIS_FR = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];
function MiniCalendar({ month, items, dateKey, toneMap }) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startOffset = (first.getDay() + 6) % 7; // lundi = 0
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const byDay = {};
  items.forEach((it) => {
    const dt = new Date(it[dateKey] + "T00:00:00");
    if (dt.getFullYear() === month.getFullYear() && dt.getMonth() === month.getMonth()) {
      byDay[dt.getDate()] = byDay[dt.getDate()] || [];
      byDay[dt.getDate()].push(it);
    }
  });
  return (
    <div className="calendar">
      {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => (
        <div className="dow" key={d}>
          {d}
        </div>
      ))}
      {cells.map((d, i) => (
        <div key={i} className={"cal-day" + (d ? "" : " muted")}>
          {d && (
            <>
              <div>{d}</div>
              <div className="dots">
                {(byDay[d] || []).slice(0, 4).map((it, j) => (
                  <Tip3 key={j} text={it._label}>
                    <span style={{ background: "var(--status-" + toneMap[it._tone] + ")" }} />
                  </Tip3>
                ))}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function EcheancesScreen({ params }) {
  const { data, markVtDone, markRevisionDone, markRdvPris, toast, navigate } = useApp3();
  const [tab, setTab] = useState((params && params.tab) || "vt");
  const [view, setView] = useState("liste");
  const [filter, setFilter] = useState("tout");
  const [month, setMonth] = useState(new Date(2026, 9, 1));
  const [page, setPage] = useState(1);
  const pageSize = 8;

  const vehicles = data.vehicles.map((v) => ({
    ...v,
    client: data.clients.find((c) => c.id === v.clientId),
  }));

  let rows =
    tab === "vt"
      ? vehicles.map((v) => ({
          ...v,
          _tone: v.vtStatut,
          _days: v.vtJoursRestants,
          _label:
            v.marque +
            " " +
            v.modele +
            " — VT " +
            (v.vtJoursRestants < 0 ? "expirée" : "J-" + v.vtJoursRestants),
        }))
      : vehicles.map((v) => ({
          ...v,
          _tone: v.revisionStatut,
          _days: v.revisionJoursRestants,
          _label: v.marque + " " + v.modele + " — révision",
        }));

  if (filter === "expire7") rows = rows.filter((v) => v._days <= 7 && v._days >= 0);
  if (filter === "expire30") rows = rows.filter((v) => v._days <= 30 && v._days >= 0);
  if (filter === "expiree") rows = rows.filter((v) => v._days < 0);
  if (filter === "avenir") rows = rows.filter((v) => v._days > 30);

  rows = sortRows3(rows, "_days", "asc");
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = paginate3(rows, page, pageSize);

  const calItems =
    tab === "vt"
      ? vehicles.map((v) => ({
          vtExpiration: v.vtExpiration,
          _tone: v.vtStatut,
          _label: v.client.nom + " — " + v.plaque,
        }))
      : vehicles.map((v) => ({
          revisionProchaineDateEstimee: v.revisionProchaineDateEstimee,
          _tone: v.revisionStatut,
          _label: v.client.nom + " — " + v.plaque,
        }));

  const filters = [
    { id: "tout", label: "Tout" },
    { id: "expiree", label: tab === "vt" ? "Expirée" : "Due" },
    { id: "expire7", label: "Sous 7j" },
    { id: "expire30", label: "Sous 30j" },
    { id: "avenir", label: "À venir" },
  ];

  return (
    <div data-od-id="echeances-screen">
      <div className="page-head">
        <div>
          <h2>Échéances</h2>
          <div className="desc">Visites techniques et révisions à venir.</div>
        </div>
        <div className="page-head-actions">
          <button
            className={"btn btn-sm" + (view === "liste" ? " btn-primary" : " btn-secondary")}
            onClick={() => setView("liste")}
          >
            <Icon3 name="list" size={14} />
            Liste
          </button>
          <button
            className={"btn btn-sm" + (view === "calendrier" ? " btn-primary" : " btn-secondary")}
            onClick={() => setView("calendrier")}
          >
            <Icon3 name="calendar" size={14} />
            Calendrier
          </button>
        </div>
      </div>

      <div className="tabs-row">
        <button
          className={"tab-btn" + (tab === "vt" ? " active" : "")}
          onClick={() => {
            setTab("vt");
            setPage(1);
          }}
        >
          Visite technique
        </button>
        <button
          className={"tab-btn" + (tab === "revision" ? " active" : "")}
          onClick={() => {
            setTab("revision");
            setPage(1);
          }}
        >
          Révision
        </button>
      </div>

      {view === "liste" ? (
        <div className="table-wrap to-cards">
          <div className="table-toolbar">
            {filters.map((f) => (
              <button
                key={f.id}
                className={"filter-chip" + (filter === f.id ? " active" : "")}
                onClick={() => {
                  setFilter(f.id);
                  setPage(1);
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          {rows.length === 0 ? (
            <EmptyState3
              icon="checkCircle"
              title="Rien à signaler"
              text="Aucun véhicule ne correspond à ce filtre."
            />
          ) : (
            <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Véhicule</th>
                    <th>Plaque</th>
                    <th>Client</th>
                    {tab === "vt" ? (
                      <>
                        <th>Dernière VT</th>
                        <th>Expiration</th>
                      </>
                    ) : (
                      <>
                        <th>Dernière révision</th>
                        <th>Prochaine estimée</th>
                        <th>Km actuel</th>
                      </>
                    )}
                    <th>Statut</th>
                    <th style={{ width: 220 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((v) => (
                    <tr key={v.id}>
                      <td>
                        {v.marque} {v.modele} ({v.annee})
                      </td>
                      <td>
                        <span className="veh-plate">{v.plaque}</span>
                      </td>
                      <td>
                        <button
                          className="link-btn"
                          style={{ color: "var(--fg)", textDecoration: "none" }}
                          onClick={() => navigate("fiche-client", { clientId: v.client.id })}
                        >
                          {v.client.nom}
                        </button>
                      </td>
                      {tab === "vt" ? (
                        <>
                          <td className="num">{fmtFR3(v.vtDerniere)}</td>
                          <td>
                            <Countdown3 days={v.vtJoursRestants} size={34} />
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="num">
                            {fmtFR3(v.revisionDerniereDate)} ·{" "}
                            {v.revisionDerniereKm.toLocaleString("fr-FR")} km
                          </td>
                          <td className="num">{fmtFR3(v.revisionProchaineDateEstimee)}</td>
                          <td style={{ minWidth: 110 }}>
                            <KmProgress3
                              percent={v.revisionProgress}
                              remainingLabel={
                                Math.max(0, v.revisionKmRestants) + " km restants environ"
                              }
                            />
                          </td>
                        </>
                      )}
                      <td>
                        <StatusPill3
                          tone={tab === "vt" ? VT_TONE[v.vtStatut] : REV_TONE[v.revisionStatut]}
                        >
                          {tab === "vt" ? VT_LABEL[v.vtStatut] : REV_LABEL[v.revisionStatut]}
                        </StatusPill3>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              markRdvPris(v.id);
                              toast("ok", "Rendez-vous noté pour " + v.plaque + ".");
                            }}
                          >
                            RDV pris
                          </button>
                          {tab === "vt" ? (
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => {
                                markVtDone(v.id);
                                toast("ok", "VT marquée comme effectuée.");
                              }}
                            >
                              VT effectuée
                            </button>
                          ) : (
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => {
                                markRevisionDone(v.id);
                                toast("ok", "Révision marquée comme effectuée.");
                              }}
                            >
                              Révision effectuée
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="card-list">
                {pageRows.map((v) => (
                  <div className="row-card" key={v.id}>
                    <div className="row-card-top">
                      <div style={{ fontWeight: 700 }}>
                        {v.marque} {v.modele}
                      </div>
                      <StatusPill3
                        tone={tab === "vt" ? VT_TONE[v.vtStatut] : REV_TONE[v.revisionStatut]}
                      >
                        {tab === "vt" ? VT_LABEL[v.vtStatut] : REV_LABEL[v.revisionStatut]}
                      </StatusPill3>
                    </div>
                    <div className="row-card-fields">
                      <div className="k">Plaque</div>
                      <div>
                        <span className="veh-plate">{v.plaque}</span>
                      </div>
                      <div className="k">Client</div>
                      <div>{v.client.nom}</div>
                      {tab === "vt" ? (
                        <>
                          <div className="k">Expiration</div>
                          <div>
                            <Countdown3 days={v.vtJoursRestants} size={30} />
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="k">Km restants</div>
                          <div>{Math.max(0, v.revisionKmRestants)} km</div>
                        </>
                      )}
                    </div>
                    <div className="row-card-actions">
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => markRdvPris(v.id)}
                      >
                        RDV pris
                      </button>
                      {tab === "vt" ? (
                        <button className="btn btn-primary btn-sm" onClick={() => markVtDone(v.id)}>
                          VT effectuée
                        </button>
                      ) : (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => markRevisionDone(v.id)}
                        >
                          Révision effectuée
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          <Pagination3
            page={page}
            totalPages={totalPages}
            onChange={setPage}
            totalLabel={rows.length + " véhicule(s)"}
          />
        </div>
      ) : (
        <div className="card">
          <div className="card-head">
            <button
              className="icon-btn"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            >
              <Icon3 name="chevronLeft" size={16} />
            </button>
            <div className="card-title">
              {MOIS_FR[month.getMonth()]} {month.getFullYear()}
            </div>
            <button
              className="icon-btn"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            >
              <Icon3 name="chevronRight" size={16} />
            </button>
          </div>
          <MiniCalendar
            month={month}
            items={calItems}
            dateKey={tab === "vt" ? "vtExpiration" : "revisionProchaineDateEstimee"}
            toneMap={tab === "vt" ? VT_TONE : REV_TONE}
          />
          <div className="legend-row" style={{ marginTop: 14 }}>
            <span className="sw">
              <span style={{ background: "var(--status-ok)" }} />À jour
            </span>
            <span className="sw">
              <span style={{ background: "var(--status-warn)" }} />
              Bientôt
            </span>
            <span className="sw">
              <span style={{ background: "var(--status-bad)" }} />
              {tab === "vt" ? "Expirée" : "Due"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================== Clients — liste ===================== */
function NewClientModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    nom: "",
    type: "particulier",
    telephone: "",
    email: "",
    whatsapp: true,
    canalPrefere: "whatsapp",
  });
  return (
    <Modal3
      title="Nouveau client"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn btn-primary"
            disabled={!form.nom || !form.telephone}
            onClick={() => onSave(form)}
          >
            Créer le client
          </button>
        </>
      }
    >
      <div className="field">
        <label>Nom {form.type === "entreprise" ? "de l'entreprise" : "complet"}</label>
        <input
          className="input"
          value={form.nom}
          onChange={(e) => setForm({ ...form, nom: e.target.value })}
        />
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Type</label>
          <select
            className="select"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            <option value="particulier">Particulier</option>
            <option value="entreprise">Entreprise (flotte)</option>
          </select>
        </div>
        <div className="field">
          <label>Canal préféré</label>
          <select
            className="select"
            value={form.canalPrefere}
            onChange={(e) => setForm({ ...form, canalPrefere: e.target.value })}
          >
            <option value="whatsapp">WhatsApp</option>
            <option value="sms">SMS</option>
            <option value="email">Email</option>
          </select>
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Téléphone</label>
          <input
            className="input"
            value={form.telephone}
            onChange={(e) => setForm({ ...form, telephone: e.target.value })}
            placeholder="+225 07 00 00 00 00"
          />
        </div>
        <div className="field">
          <label>Email (optionnel)</label>
          <input
            className="input"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
      </div>
      <div className="checkbox-row">
        <input
          type="checkbox"
          id="nc-wa"
          checked={form.whatsapp}
          onChange={(e) => setForm({ ...form, whatsapp: e.target.checked })}
        />
        <label htmlFor="nc-wa">Ce numéro est joignable sur WhatsApp</label>
      </div>
    </Modal3>
  );
}

function ClientsScreen({ params }) {
  const { data, addClient, toast, navigate } = useApp3();
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("tout");
  const [onlyDue, setOnlyDue] = useState(false);
  const [onlyVt, setOnlyVt] = useState(false);
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(!!(params && params.openNew));
  const pageSize = 9;
  useEffect(() => {
    if (params && params.openNew) setShowNew(true);
  }, [params]);

  const enriched = data.clients.map((c) => {
    const vs = data.vehicles.filter((v) => v.clientId === c.id);
    const solde = data.invoices
      .filter((i) => i.clientId === c.id && i.statut !== "Payée")
      .reduce((s, i) => s + i.resteDue, 0);
    const vtSoon = vs.some((v) => v.vtJoursRestants <= 30);
    return { ...c, nbVehicules: vs.length, solde, vtSoon };
  });

  let rows = enriched.filter(
    (c) => c.nom.toLowerCase().includes(q.toLowerCase()) || c.telephone.includes(q),
  );
  if (typeFilter !== "tout") rows = rows.filter((c) => c.type === typeFilter);
  if (onlyDue) rows = rows.filter((c) => c.solde > 0);
  if (onlyVt) rows = rows.filter((c) => c.vtSoon);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = paginate3(rows, page, pageSize);

  return (
    <div data-od-id="clients-screen">
      <div className="page-head">
        <div>
          <h2>Clients & véhicules</h2>
          <div className="desc">{data.clients.length} client(s) enregistré(s).</div>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>
            <Icon3 name="plus" size={15} />
            Nouveau client
          </button>
        </div>
      </div>
      <div className="table-wrap to-cards">
        <div className="table-toolbar">
          <div className="search-box" style={{ maxWidth: 260, height: 36 }}>
            <Icon3 name="search" size={15} />
            <input
              placeholder="Rechercher…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <button
            className={"filter-chip" + (typeFilter === "tout" ? " active" : "")}
            onClick={() => setTypeFilter("tout")}
          >
            Tous
          </button>
          <button
            className={"filter-chip" + (typeFilter === "particulier" ? " active" : "")}
            onClick={() => setTypeFilter("particulier")}
          >
            Particuliers
          </button>
          <button
            className={"filter-chip" + (typeFilter === "entreprise" ? " active" : "")}
            onClick={() => setTypeFilter("entreprise")}
          >
            Entreprises
          </button>
          <button
            className={"filter-chip" + (onlyDue ? " active" : "")}
            onClick={() => setOnlyDue(!onlyDue)}
          >
            Impayés
          </button>
          <button
            className={"filter-chip" + (onlyVt ? " active" : "")}
            onClick={() => setOnlyVt(!onlyVt)}
          >
            VT bientôt expirée
          </button>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Téléphone</th>
              <th>WhatsApp</th>
              <th>Email</th>
              <th>Véhicules</th>
              <th>Solde dû</th>
              <th>Dernière visite</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((c) => (
              <tr
                key={c.id}
                style={{ cursor: "pointer" }}
                onClick={() => navigate("fiche-client", { clientId: c.id })}
              >
                <td>
                  <div style={{ fontWeight: 600 }}>{c.nom}</div>
                  <span className={"badge-type" + (c.type === "entreprise" ? " entreprise" : "")}>
                    {c.type === "entreprise" ? "Entreprise" : "Particulier"}
                  </span>
                </td>
                <td className="num">{c.telephone}</td>
                <td>
                  {c.whatsapp ? (
                    <StatusPill3 tone="ok">Oui</StatusPill3>
                  ) : (
                    <StatusPill3 tone="off">Non</StatusPill3>
                  )}
                </td>
                <td>{c.email || "—"}</td>
                <td className="num">{c.nbVehicules}</td>
                <td
                  className="num"
                  style={{
                    fontWeight: c.solde > 0 ? 700 : 400,
                    color: c.solde > 0 ? "var(--status-bad)" : "inherit",
                  }}
                >
                  {c.solde > 0 ? fcfa3(c.solde) : "—"}
                </td>
                <td className="num">{fmtFR3(c.derniereVisite)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="card-list">
          {pageRows.map((c) => (
            <div
              className="row-card"
              key={c.id}
              onClick={() => navigate("fiche-client", { clientId: c.id })}
            >
              <div className="row-card-top">
                <div style={{ fontWeight: 700 }}>{c.nom}</div>
                <span className={"badge-type" + (c.type === "entreprise" ? " entreprise" : "")}>
                  {c.type === "entreprise" ? "Entreprise" : "Particulier"}
                </span>
              </div>
              <div className="row-card-fields">
                <div className="k">Téléphone</div>
                <div>{c.telephone}</div>
                <div className="k">Véhicules</div>
                <div>{c.nbVehicules}</div>
                <div className="k">Solde dû</div>
                <div className="num">{c.solde > 0 ? fcfa3(c.solde) : "—"}</div>
              </div>
            </div>
          ))}
        </div>
        <Pagination3
          page={page}
          totalPages={totalPages}
          onChange={setPage}
          totalLabel={rows.length + " client(s)"}
        />
      </div>
      {showNew && (
        <NewClientModal
          onClose={() => setShowNew(false)}
          onSave={(f) => {
            const c = addClient(f);
            setShowNew(false);
            toast("ok", "Client créé.");
            navigate("fiche-client", { clientId: c.id });
          }}
        />
      )}
    </div>
  );
}

/* ===================== Fiche client ===================== */
function DoNotRemindModal({ onClose, onSave }) {
  const [motif, setMotif] = useState("");
  return (
    <Modal3
      title="Ne plus relancer ce client"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-danger" disabled={!motif} onClick={() => onSave(motif)}>
            Confirmer
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
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          placeholder="Ex : demande explicite du client, litige en cours…"
        />
      </div>
    </Modal3>
  );
}

function FicheClientScreen({ params }) {
  const { data, setCanalPrefere, doNotRemind, toast, navigate } = useApp3();
  const client = data.clients.find((c) => c.id === params.clientId);
  const [showDnr, setShowDnr] = useState(false);
  const [showChan, setShowChan] = useState(false);
  if (!client) return <EmptyState3 icon="xCircle" title="Client introuvable" />;
  const vehicles = data.vehicles.filter((v) => v.clientId === client.id);
  const invoicesOpen = data.invoices.filter(
    (i) => i.clientId === client.id && i.statut !== "Payée",
  );
  const solde = invoicesOpen.reduce((s, i) => s + i.resteDue, 0);
  const histo = data.history.filter((h) => h.clientId === client.id);

  const timeline = [
    ...histo.map((h) => ({
      date: h.datetime.slice(0, 10),
      kind: "relance",
      label: "Relance " + h.palier + " (" + h.type + ") — " + h.statut,
      icon: h.type === "creance" ? "banknote" : h.type === "vt" ? "shield" : "wrench",
    })),
    ...invoicesOpen
      .filter((i) => i.paiements)
      .flatMap((i) =>
        i.paiements.map((p) => ({
          date: p.date,
          kind: "paiement",
          label: "Paiement " + p.mode + " — " + fcfa3(p.montant),
          icon: "checkCircle",
        })),
      ),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div data-od-id="fiche-client-screen">
      <div className="breadcrumb">
        <a onClick={() => navigate("clients")}>Clients</a>
        <Icon3 name="chevronRight" size={12} />
        <span>{client.nom}</span>
      </div>
      <div className="page-head">
        <div>
          <h2>
            {client.nom}{" "}
            <span
              className={"badge-type" + (client.type === "entreprise" ? " entreprise" : "")}
              style={{ marginLeft: 8, verticalAlign: "middle" }}
            >
              {client.type === "entreprise"
                ? "Entreprise · " + client.flotteSize + " véhicules"
                : "Particulier"}
            </span>
          </h2>
          <div className="desc">
            {client.telephone} {client.email && "· " + client.email} · Canal préféré :{" "}
            <ChanPill3 canal={client.canalPrefere} compact />
          </div>
        </div>
        <div className="page-head-actions">
          <a className="btn btn-secondary" href={"tel:" + client.telephone.replace(/\s/g, "")}>
            <Icon3 name="phone" size={15} />
            Appeler
          </a>
          {client.whatsapp && (
            <a
              className="btn btn-primary"
              href={"https://wa.me/" + client.telephone.replace(/[^0-9]/g, "")}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon3 name="whatsapp" size={15} />
              WhatsApp
            </a>
          )}
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <div className="card-title">
                <Icon3 name="banknote" size={16} />
                Solde
              </div>
            </div>
            <div
              className="kpi-value num"
              style={{ color: solde > 0 ? "var(--status-bad)" : "var(--status-ok)", fontSize: 24 }}
            >
              {fcfa3(solde)}
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
              {invoicesOpen.length} facture(s) ouverte(s)
            </div>
            {invoicesOpen.map((i) => (
              <div
                key={i.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "7px 0",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 13,
                }}
              >
                <span style={{ fontFamily: "var(--font-mono)" }}>{i.numero}</span>
                <StatusPill3
                  tone={
                    {
                      "À échéance": "off",
                      "En retard": "bad",
                      Relancée: "warn",
                      "Promesse de paiement": "warn",
                      "Payée partiellement": "warn",
                      "Litige/ne plus relancer": "off",
                    }[i.statut]
                  }
                >
                  {i.statut}
                </StatusPill3>
                <span className="num" style={{ fontWeight: 700 }}>
                  {fcfa3(i.resteDue)}
                </span>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-head">
              <div className="card-title">
                <Icon3 name="car" size={16} />
                Véhicules
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))",
                gap: 12,
              }}
            >
              {vehicles.map((v) => (
                <div
                  className="veh-card"
                  key={v.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => navigate("fiche-vehicule", { vehicleId: v.id })}
                >
                  <div style={{ fontWeight: 700 }}>
                    {v.marque} {v.modele}
                  </div>
                  <span className="veh-plate">{v.plaque}</span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <StatusPill3 tone={VT_TONE[v.vtStatut]}>VT {VT_LABEL[v.vtStatut]}</StatusPill3>
                    <StatusPill3 tone={REV_TONE[v.revisionStatut]}>
                      Révision {REV_LABEL[v.revisionStatut]}
                    </StatusPill3>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head">
              <div className="card-title">
                <Icon3 name="list" size={16} />
                Chronologie
              </div>
            </div>
            {timeline.length === 0 ? (
              <EmptyState3 icon="info" title="Aucun historique" />
            ) : (
              <div className="timeline-list">
                {timeline.slice(0, 10).map((t, i) => (
                  <div className="tl-item" key={i}>
                    <div className="tl-ic">
                      <Icon3 name={t.icon} size={15} />
                    </div>
                    <div className="tl-content">
                      <div className="tl-top">
                        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t.label}</span>
                        <span className="tl-date">{fmtFR3(t.date)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card">
            <div className="card-head">
              <div className="card-title">
                <Icon3 name="gear" size={16} />
                Préférences
              </div>
            </div>
            <div style={{ fontSize: 13.5, marginBottom: 10 }}>
              Consentement relances :{" "}
              {client.consentement ? (
                <StatusPill3 tone="ok">Actif</StatusPill3>
              ) : (
                <StatusPill3 tone="off">Désactivé</StatusPill3>
              )}
            </div>
            <button
              className="btn btn-secondary btn-sm btn-block"
              style={{ marginBottom: 8 }}
              onClick={() => setShowChan(true)}
            >
              Changer le canal préféré
            </button>
            <button className="btn btn-danger btn-sm btn-block" onClick={() => setShowDnr(true)}>
              Ne plus relancer
            </button>
          </div>
        </div>
      </div>

      {showDnr && (
        <DoNotRemindModal
          onClose={() => setShowDnr(false)}
          onSave={(m) => {
            doNotRemind(client.id, m);
            setShowDnr(false);
            toast("info", "Les relances sont désactivées pour " + client.nom + ".");
          }}
        />
      )}
      {showChan && (
        <Modal3
          title="Changer le canal préféré"
          onClose={() => setShowChan(false)}
          footer={
            <button className="btn btn-primary" onClick={() => setShowChan(false)}>
              Fermer
            </button>
          }
        >
          {["whatsapp", "sms", "email"].map((c) => (
            <button
              key={c}
              className="nav-item"
              style={{ color: "var(--fg)", marginBottom: 4 }}
              onClick={() => {
                setCanalPrefere(client.id, c);
                toast("ok", "Canal préféré mis à jour.");
                setShowChan(false);
              }}
            >
              <span className="ic">
                <ChanPill3 canal={c} compact />
              </span>
              <span className="label">
                {c === "whatsapp" ? "WhatsApp" : c === "sms" ? "SMS" : "Email"}
              </span>
              {client.canalPrefere === c && <Icon3 name="check" size={15} />}
            </button>
          ))}
        </Modal3>
      )}
    </div>
  );
}

/* ===================== Fiche véhicule ===================== */
function FicheVehiculeScreen({ params }) {
  const { data, markVtDone, markRevisionDone, toast, navigate } = useApp3();
  const v = data.vehicles.find((x) => x.id === params.vehicleId);
  if (!v) return <EmptyState3 icon="xCircle" title="Véhicule introuvable" />;
  const client = data.clients.find((c) => c.id === v.clientId);
  const passages = [
    { date: v.vtDerniere, label: "Visite technique effectuée", icon: "shield" },
    {
      date: v.revisionDerniereDate,
      label: "Révision effectuée — " + v.revisionDerniereKm.toLocaleString("fr-FR") + " km",
      icon: "wrench",
    },
    {
      date: v.kmDate,
      label: "Relevé kilométrique — " + v.km.toLocaleString("fr-FR") + " km",
      icon: "gauge",
    },
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div data-od-id="fiche-vehicule-screen">
      <div className="breadcrumb">
        <a onClick={() => navigate("clients")}>Clients</a>
        <Icon3 name="chevronRight" size={12} />
        <a onClick={() => navigate("fiche-client", { clientId: client.id })}>{client.nom}</a>
        <Icon3 name="chevronRight" size={12} />
        <span>{v.plaque}</span>
      </div>
      <div className="page-head">
        <div>
          <h2>
            {v.marque} {v.modele} ({v.annee})
          </h2>
          <div className="desc">
            Propriétaire :{" "}
            <a
              onClick={() => navigate("fiche-client", { clientId: client.id })}
              style={{ cursor: "pointer", textDecoration: "underline" }}
            >
              {client.nom}
            </a>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-title" style={{ marginBottom: 10 }}>
            Identification
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 13.5 }}>
            <div>
              <div style={{ color: "var(--muted)" }}>Plaque</div>
              <span className="veh-plate">{v.plaque}</span>
            </div>
            <div>
              <div style={{ color: "var(--muted)" }}>VIN</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>{v.vin}</div>
            </div>
            <div>
              <div style={{ color: "var(--muted)" }}>Kilométrage</div>
              <div className="num">
                {v.km.toLocaleString("fr-FR")} km{" "}
                <span style={{ color: "var(--muted)" }}>({fmtFR3(v.kmDate)})</span>
              </div>
            </div>
            <div>
              <div style={{ color: "var(--muted)" }}>Année</div>
              <div>{v.annee}</div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-title" style={{ marginBottom: 10 }}>
            Historique des passages
          </div>
          <div className="timeline-list">
            {passages.map((p, i) => (
              <div className="tl-item" key={i}>
                <div className="tl-ic">
                  <Icon3 name={p.icon} size={15} />
                </div>
                <div className="tl-content">
                  <div className="tl-top">
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{p.label}</span>
                    <span className="tl-date">{fmtFR3(p.date)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <div className="card-title">
              <Icon3 name="shield" size={16} />
              Visite technique
            </div>
            <StatusPill3 tone={VT_TONE[v.vtStatut]}>{VT_LABEL[v.vtStatut]}</StatusPill3>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
            <Countdown3 days={v.vtJoursRestants} size={56} />
            <div style={{ fontSize: 13.5 }}>
              <div>
                Dernière VT : <strong className="num">{fmtFR3(v.vtDerniere)}</strong>
              </div>
              <div>
                Expiration : <strong className="num">{fmtFR3(v.vtExpiration)}</strong>
              </div>
            </div>
          </div>
          <button
            className="btn btn-primary btn-block"
            onClick={() => {
              markVtDone(v.id);
              toast("ok", "VT mise à jour (valable 1 an).");
            }}
          >
            Marquer la VT comme effectuée
          </button>
        </div>
        <div className="card">
          <div className="card-head">
            <div className="card-title">
              <Icon3 name="wrench" size={16} />
              Révision
            </div>
            <StatusPill3 tone={REV_TONE[v.revisionStatut]}>
              {REV_LABEL[v.revisionStatut]}
            </StatusPill3>
          </div>
          <div style={{ fontSize: 13.5, marginBottom: 8 }}>
            Intervalle : {v.revisionIntervalleKm.toLocaleString("fr-FR")} km /{" "}
            {v.revisionIntervalleMois} mois · Dernière : {fmtFR3(v.revisionDerniereDate)} (
            {v.revisionDerniereKm.toLocaleString("fr-FR")} km)
          </div>
          <KmProgress3
            percent={v.revisionProgress}
            remainingLabel={
              Math.max(0, v.revisionKmRestants) +
              " km restants environ (" +
              v.revisionProgress +
              "% parcouru)"
            }
          />
          <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "8px 0 14px" }}>
            Prochaine estimée : {fmtFR3(v.revisionProchaineDateEstimee)} · ~
            {Math.max(0, v.revisionKmRestants)} km restants
          </div>
          <button
            className="btn btn-primary btn-block"
            onClick={() => {
              markRevisionDone(v.id);
              toast("ok", "Révision mise à jour.");
            }}
          >
            Marquer la révision comme effectuée
          </button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { EcheancesScreen, ClientsScreen, FicheClientScreen, FicheVehiculeScreen });
