const {
  Icon: Icon4,
  Tip: Tip4,
  StatusPill: StatusPill4,
  TypePill: TypePill4,
  ChanPill: ChanPill4,
  PalierBadge: PalierBadge4,
  Modal: Modal4,
  EmptyState: EmptyState4,
  Pagination: Pagination4,
  sortRows: sortRows4,
  paginate: paginate4,
  MessagePreview: MessagePreview4,
  VariableChip: VariableChip4,
  VARIABLES: VARIABLES4,
  useApp: useApp4,
} = window;
const { fcfa: fcfa4, fmtFR: fmtFR4 } = window.AR_HELPERS;

/* ===================== Historique des envois ===================== */
const HIST_TONE = {
  "En file": "off",
  Envoyé: "ok",
  Délivré: "ok",
  Lu: "ok",
  Échec: "bad",
  Répondu: "ok",
};
function HistoriqueScreen() {
  const { data } = useApp4();
  const [typeF, setTypeF] = useState("tout");
  const [canalF, setCanalF] = useState("tout");
  const [statutF, setStatutF] = useState("tout");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const pageSize = 8;

  let rows = data.history.map((h) => ({
    ...h,
    client: data.clients.find((c) => c.id === h.clientId),
  }));
  if (typeF !== "tout") rows = rows.filter((h) => h.type === typeF);
  if (canalF !== "tout") rows = rows.filter((h) => h.canal === canalF);
  if (statutF !== "tout") rows = rows.filter((h) => h.statut === statutF);
  if (q.trim()) rows = rows.filter((h) => h.client.nom.toLowerCase().includes(q.toLowerCase()));
  rows = sortRows4(rows, "datetime", "desc");
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = paginate4(rows, page, pageSize);

  function exportCsv() {
    const header = "Date;Client;Type;Canal;Palier;Statut;Coût\n";
    const body = rows
      .map((h) => [h.datetime, h.client.nom, h.type, h.canal, h.palier, h.statut, h.cout].join(";"))
      .join("\n");
    const blob = new Blob(["\ufeff" + header + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "historique-envois-autorappel.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div data-od-id="historique-screen">
      <div className="page-head">
        <div>
          <h2>Historique des envois</h2>
          <div className="desc">Toutes les relances envoyées, avec leur statut de livraison.</div>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-secondary" onClick={exportCsv}>
            <Icon4 name="download" size={15} />
            Export Excel
          </button>
        </div>
      </div>
      <div className="table-wrap to-cards">
        <div className="table-toolbar">
          <div className="search-box" style={{ maxWidth: 220, height: 36 }}>
            <Icon4 name="search" size={15} />
            <input
              placeholder="Client…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select
            className="select"
            style={{ height: 36, width: 150 }}
            value={typeF}
            onChange={(e) => {
              setTypeF(e.target.value);
              setPage(1);
            }}
          >
            <option value="tout">Tous les types</option>
            <option value="vt">Visite technique</option>
            <option value="revision">Révision</option>
            <option value="creance">Créance</option>
          </select>
          <select
            className="select"
            style={{ height: 36, width: 140 }}
            value={canalF}
            onChange={(e) => {
              setCanalF(e.target.value);
              setPage(1);
            }}
          >
            <option value="tout">Tous les canaux</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="sms">SMS</option>
            <option value="email">Email</option>
          </select>
          <select
            className="select"
            style={{ height: 36, width: 150 }}
            value={statutF}
            onChange={(e) => {
              setStatutF(e.target.value);
              setPage(1);
            }}
          >
            <option value="tout">Tous les statuts</option>
            {Object.keys(HIST_TONE).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        {rows.length === 0 ? (
          <EmptyState4 icon="info" title="Aucun envoi ne correspond" />
        ) : (
          <>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date / heure</th>
                  <th>Client</th>
                  <th>Type</th>
                  <th>Canal</th>
                  <th>Palier</th>
                  <th>Statut</th>
                  <th>Coût</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((h) => (
                  <tr key={h.id} style={{ cursor: "pointer" }} onClick={() => setDetail(h)}>
                    <td className="num">
                      {fmtFR4(h.datetime.slice(0, 10))} · {h.datetime.slice(11, 16)}
                    </td>
                    <td style={{ fontWeight: 600 }}>{h.client.nom}</td>
                    <td>
                      <TypePill4 type={h.type} compact />
                    </td>
                    <td>
                      <ChanPill4 canal={h.canal} compact />
                    </td>
                    <td>
                      <PalierBadge4 palier={h.palier} />
                    </td>
                    <td>
                      <StatusPill4 tone={HIST_TONE[h.statut]}>{h.statut}</StatusPill4>
                    </td>
                    <td className="num">{h.cout > 0 ? h.cout + " FCFA" : "Gratuit"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="card-list">
              {pageRows.map((h) => (
                <div className="row-card" key={h.id} onClick={() => setDetail(h)}>
                  <div className="row-card-top">
                    <div style={{ fontWeight: 700 }}>{h.client.nom}</div>
                    <StatusPill4 tone={HIST_TONE[h.statut]}>{h.statut}</StatusPill4>
                  </div>
                  <div className="row-card-fields">
                    <div className="k">Type</div>
                    <div>
                      <TypePill4 type={h.type} compact />
                    </div>
                    <div className="k">Canal</div>
                    <div>
                      <ChanPill4 canal={h.canal} compact />
                    </div>
                    <div className="k">Date</div>
                    <div>{fmtFR4(h.datetime.slice(0, 10))}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        <Pagination4
          page={page}
          totalPages={totalPages}
          onChange={setPage}
          totalLabel={rows.length + " envoi(s)"}
        />
      </div>
      {detail && (
        <Modal4
          title={"Détail de l\u2019envoi — " + detail.client.nom}
          onClose={() => setDetail(null)}
        >
          <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <TypePill4 type={detail.type} />
            <ChanPill4 canal={detail.canal} />
            <PalierBadge4 palier={detail.palier} />
            <StatusPill4 tone={HIST_TONE[detail.statut]}>{detail.statut}</StatusPill4>
          </div>
          <p style={{ fontSize: 13.5 }}>
            Envoyé le{" "}
            <strong className="num">
              {fmtFR4(detail.datetime.slice(0, 10))} à {detail.datetime.slice(11, 16)}
            </strong>{" "}
            · Coût :{" "}
            <strong className="num">{detail.cout > 0 ? detail.cout + " FCFA" : "Gratuit"}</strong>
          </p>
          {detail.statut === "Échec" && (
            <div className="alert-banner warn" style={{ marginTop: 10 }}>
              <span className="icon">
                <Icon4 name="alertTriangle" size={16} />
              </span>
              <span className="txt">
                <strong>Raison de l'échec :</strong> {detail.raisonEchec}
              </span>
            </div>
          )}
        </Modal4>
      )}
    </div>
  );
}

/* ===================== Modèles de messages ===================== */
function ModelesScreen() {
  const { data, updateTemplate, toast } = useApp4();
  const [selId, setSelId] = useState(data.templates[0].id);
  const sel = data.templates.find((t) => t.id === selId);
  const [draft, setDraft] = useState(sel);
  useEffect(() => {
    setDraft(data.templates.find((t) => t.id === selId));
  }, [selId, data.templates]);

  const groups = { vt: "Visite technique", revision: "Révision", creance: "Créance" };
  const approveLabel = {
    oui: "Approuvé par Meta",
    en_attente: "En attente d\u2019approbation",
    refuse: "Refusé par Meta",
  };
  const approveTone = { oui: "ok", en_attente: "warn", refuse: "bad" };

  return (
    <div data-od-id="modeles-screen">
      <div className="page-head">
        <div>
          <h2>Modèles de messages</h2>
          <div className="desc">Un modèle par type de relance, palier et canal.</div>
        </div>
      </div>
      <div className="grid-2" style={{ gridTemplateColumns: "340px 1fr", alignItems: "start" }}>
        <div className="card" style={{ padding: 10 }}>
          {Object.keys(groups).map((type) => (
            <div key={type}>
              <div className="section-label" style={{ margin: "10px 10px 6px" }}>
                {groups[type]}
              </div>
              {data.templates
                .filter((t) => t.type === type)
                .map((t) => (
                  <button
                    key={t.id}
                    className="nav-item"
                    style={{
                      color: "var(--fg)",
                      background: selId === t.id ? "var(--surface-2)" : "transparent",
                    }}
                    onClick={() => setSelId(t.id)}
                  >
                    <span className="ic">
                      <ChanPill4 canal={t.canal} compact />
                    </span>
                    <span className="label">{t.palier}</span>
                  </button>
                ))}
            </div>
          ))}
        </div>

        {draft && (
          <div className="card">
            <div className="card-head">
              <div className="card-title">
                {groups[draft.type]} · {draft.palier} · <ChanPill4 canal={draft.canal} compact />
              </div>
              {draft.canal === "whatsapp" && (
                <StatusPill4
                  tone={approveTone[draft.approuveMeta]}
                  tooltip="Statut d'approbation du modèle par Meta (obligatoire pour les modèles WhatsApp Business)"
                >
                  {approveLabel[draft.approuveMeta]}
                </StatusPill4>
              )}
            </div>
            <div className="grid-2">
              <div>
                {draft.canal === "email" && (
                  <div className="field">
                    <label>Objet</label>
                    <input
                      className="input"
                      value={draft.objet || ""}
                      onChange={(e) => setDraft({ ...draft, objet: e.target.value })}
                    />
                  </div>
                )}
                <div className="field">
                  <label>Corps du message</label>
                  <textarea
                    className="textarea"
                    rows={8}
                    value={draft.corps}
                    onChange={(e) => setDraft({ ...draft, corps: e.target.value })}
                  />
                  <div className="var-chip-row">
                    {VARIABLES4.map((v) => (
                      <VariableChip4
                        key={v}
                        name={v}
                        onInsert={(tok) => setDraft({ ...draft, corps: draft.corps + " " + tok })}
                      />
                    ))}
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    updateTemplate(draft.id, draft);
                    toast("ok", "Modèle enregistré.");
                  }}
                >
                  Enregistrer le modèle
                </button>
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 8 }}>
                  Aperçu
                </label>
                <MessagePreview4
                  canal={draft.canal}
                  objet={draft.objet}
                  message={draft.corps
                    .replace("{client}", "Kouassi")
                    .replace("{vehicule}", "Toyota Corolla")
                    .replace("{plaque}", "2547 GH 01")
                    .replace("{date_expiration}", "02/11/2026")
                    .replace("{montant}", "185 000 FCFA")
                    .replace("{facture}", "F-2026-0412")
                    .replace("{lien_paiement}", "pay.wave.com/xx")
                    .replace("{garage}", data.garage.nom)
                    .replace("{telephone_garage}", data.garage.telephone)}
                  client={{ nom: "Kouassi Jean-Marc" }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ===================== Import des données ===================== */
function ImportStepperModal({ onClose, onDone }) {
  const [step, setStep] = useState(1);
  const steps = ["Fichier", "Correspondance", "Aperçu", "Résumé"];
  const mapping = [
    { file: "client_nom", field: "Nom du client", auto: true },
    { file: "client_tel", field: "Téléphone", auto: true },
    { file: "vehicule_plaque", field: "Plaque", auto: true },
    { file: "vt_expiration", field: "Date expiration VT", auto: true },
    { file: "solde_du", field: "Solde dû", auto: false },
  ];
  const previewRows = [
    {
      nom: "Kouassi Jean-Marc",
      tel: "0544102231",
      plaque: "2547 GH 01",
      vt: "02/11/2026",
      err: null,
    },
    { nom: "Bamba Aminata", tel: "0712904410", plaque: "8812 JK 01", vt: "18/03/2027", err: null },
    {
      nom: "Koné Ibrahim",
      tel: "",
      plaque: "4421 FD 01",
      vt: "05/01/2027",
      err: "Téléphone manquant",
    },
    { nom: "Yao Adjoua", tel: "0755221088", plaque: "", vt: "12/10/2026", err: "Plaque manquante" },
    { nom: "Traoré Moussa", tel: "0590446723", plaque: "6630 HB 01", vt: "01/06/2027", err: null },
  ];
  return (
    <Modal4
      onClose={onClose}
      title="Importer un fichier Excel / CSV"
      size="lg"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          {step > 1 && (
            <button className="btn btn-secondary" onClick={() => setStep(step - 1)}>
              Précédent
            </button>
          )}
          {step < 4 && (
            <button className="btn btn-primary" onClick={() => setStep(step + 1)}>
              {step === 3 ? "Importer" : "Suivant"}
            </button>
          )}
          {step === 4 && (
            <button className="btn btn-primary" onClick={onDone}>
              Terminer
            </button>
          )}
        </>
      }
    >
      <div className="stepper">
        {steps.map((s, i) => (
          <React.Fragment key={s}>
            <div className={"step" + (step === i + 1 ? " active" : step > i + 1 ? " done" : "")}>
              <div className="step-circle">
                {step > i + 1 ? <Icon4 name="check" size={13} /> : i + 1}
              </div>
              <div className="step-label">{s}</div>
            </div>
            {i < steps.length - 1 && <div className="step-line" />}
          </React.Fragment>
        ))}
      </div>
      {step === 1 && (
        <div>
          <div className="dropzone">
            <Icon4 name="upload" size={26} />
            <div style={{ marginTop: 8, fontWeight: 600 }}>clients_export.xlsx</div>
            <div>142 lignes détectées — glissez un autre fichier pour remplacer</div>
          </div>
          <div className="checkbox-row" style={{ marginTop: 14 }}>
            <input type="checkbox" id="watch" />
            <label htmlFor="watch">Surveiller un dossier pour les imports automatiques</label>
          </div>
        </div>
      )}
      {step === 2 && (
        <div>
          <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>
            Colonnes du fichier (gauche) associées aux champs AutoRappel (droite).
          </p>
          {mapping.map((m) => (
            <div className="mapping-row" key={m.file}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>{m.file}</span>
              <Icon4 name="arrowRight" size={14} />
              <select className="select" style={{ height: 36 }} defaultValue={m.field}>
                <option>{m.field}</option>
              </select>
              {m.auto ? (
                <Tip4 text="Correspondance détectée automatiquement">
                  <span style={{ color: "var(--status-ok)" }}>
                    <Icon4 name="checkCircle" size={16} />
                  </span>
                </Tip4>
              ) : (
                <Tip4 text="À vérifier manuellement">
                  <span style={{ color: "var(--status-warn)" }}>
                    <Icon4 name="alertTriangle" size={16} />
                  </span>
                </Tip4>
              )}
            </div>
          ))}
        </div>
      )}
      {step === 3 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Téléphone</th>
                <th>Plaque</th>
                <th>Expiration VT</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((r, i) => (
                <tr key={i} style={r.err ? { background: "var(--status-bad-bg)" } : undefined}>
                  <td>{r.nom}</td>
                  <td>
                    {r.tel || (
                      <Tip4 text={r.err}>
                        <span style={{ color: "var(--status-bad)" }}>manquant</span>
                      </Tip4>
                    )}
                  </td>
                  <td>
                    {r.plaque || (
                      <Tip4 text={r.err}>
                        <span style={{ color: "var(--status-bad)" }}>manquante</span>
                      </Tip4>
                    )}
                  </td>
                  <td>{r.vt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {step === 4 && (
        <EmptyState4
          icon="checkCircle"
          title="Import terminé"
          text="140 lignes importées avec succès, 2 erreurs à corriger manuellement dans les fiches clients concernées."
        />
      )}
    </Modal4>
  );
}

function ImportScreen() {
  const { data, addImportRecord, toast, navigate } = useApp4();
  const [showStepper, setShowStepper] = useState(false);
  const [testing, setTesting] = useState(false);
  return (
    <div data-od-id="import-screen">
      <div className="page-head">
        <div>
          <h2>Import des données</h2>
          <div className="desc">
            Le garage ne change pas de logiciel : AutoRappel récupère les données existantes.
          </div>
        </div>
      </div>
      <div className="import-grid">
        <div className="card">
          <div className="card-title" style={{ marginBottom: 10 }}>
            <Icon4 name="upload" size={16} />
            Fichier Excel / CSV
          </div>
          <div className="dropzone" onClick={() => setShowStepper(true)}>
            <Icon4 name="upload" size={24} />
            Glissez-déposez un fichier, ou cliquez pour parcourir
            <div style={{ fontSize: 11.5, marginTop: 6 }}>.xlsx, .csv — jusqu'à 10 Mo</div>
          </div>
          <div className="checkbox-row" style={{ marginTop: 12 }}>
            <input type="checkbox" id="watchfolder" />
            <label htmlFor="watchfolder" style={{ fontSize: 12.5 }}>
              Dossier surveillé pour imports automatiques
            </label>
          </div>
        </div>
        <div className="card">
          <div className="card-title" style={{ marginBottom: 10 }}>
            <Icon4 name="plug" size={16} />
            Connexion directe
          </div>
          <div className="field">
            <label>Type de base</label>
            <select className="select">
              <option>MySQL</option>
              <option>PostgreSQL</option>
              <option>SQL Server</option>
            </select>
          </div>
          <div className="field">
            <label>Hôte</label>
            <input className="input" placeholder="192.168.1.10:3306" />
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Utilisateur</label>
              <input className="input" />
            </div>
            <div className="field">
              <label>Mot de passe</label>
              <input type="password" className="input" />
            </div>
          </div>
          <button
            className="btn btn-secondary btn-block"
            style={{ marginBottom: 10 }}
            onClick={() => {
              setTesting(true);
              setTimeout(() => {
                setTesting(false);
                toast("ok", "Connexion réussie.");
              }, 700);
            }}
          >
            {testing ? "Test en cours…" : "Tester la connexion"}
          </button>
          <div className="field">
            <label>Fréquence de synchronisation</label>
            <select className="select">
              <option>Toutes les heures</option>
              <option>Chaque nuit</option>
              <option>Manuelle</option>
            </select>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
            Dernière synchro : 17/10/2026 à 23h00 · <StatusPill4 tone="ok">Réussie</StatusPill4>
          </div>
        </div>
        <div className="card">
          <div className="card-title" style={{ marginBottom: 10 }}>
            <Icon4 name="edit" size={16} />
            Saisie manuelle
          </div>
          <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>
            Ajoutez vos premières fiches une par une si vous n'avez pas encore de fichier.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              className="btn btn-secondary btn-block"
              onClick={() => navigate("clients", { openNew: true })}
            >
              <Icon4 name="user" size={15} />
              Nouveau client
            </button>
            <button className="btn btn-secondary btn-block" onClick={() => navigate("echeances")}>
              <Icon4 name="car" size={15} />
              Nouveau véhicule
            </button>
            <button className="btn btn-secondary btn-block" onClick={() => navigate("creances")}>
              <Icon4 name="fileText" size={15} />
              Nouvelle facture
            </button>
          </div>
        </div>
      </div>

      <div className="section-label">Historique des imports</div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Fichier</th>
              <th>Lignes</th>
              <th>Réussies</th>
              <th>Erreurs</th>
              <th>Utilisateur</th>
            </tr>
          </thead>
          <tbody>
            {data.importsHistory.map((i) => (
              <tr key={i.id}>
                <td className="num">{fmtFR4(i.date.slice(0, 10))}</td>
                <td>{i.fichier}</td>
                <td className="num">{i.nbLignes}</td>
                <td className="num" style={{ color: "var(--status-ok)" }}>
                  {i.nbOk}
                </td>
                <td
                  className="num"
                  style={{ color: i.nbErreurs > 0 ? "var(--status-bad)" : "inherit" }}
                >
                  {i.nbErreurs}
                </td>
                <td>{i.utilisateur}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showStepper && (
        <ImportStepperModal
          onClose={() => setShowStepper(false)}
          onDone={() => {
            addImportRecord({
              fichier: "clients_export.xlsx",
              nbLignes: 142,
              nbOk: 140,
              nbErreurs: 2,
            });
            setShowStepper(false);
            toast("ok", "Import terminé : 140 lignes importées, 2 erreurs.");
          }}
        />
      )}
    </div>
  );
}

/* ===================== Paramètres ===================== */
function RuleTimeline({ points, onAdd, onRemove, unit }) {
  return (
    <div className="rule-timeline">
      <div className="line" />
      {points
        .sort((a, b) => a - b)
        .map((p, i) => (
          <div className="rule-point" key={i}>
            <button className="remove" onClick={() => onRemove(p)} aria-label="Supprimer">
              <Icon4 name="x" size={13} />
            </button>
            <div className="dot" />
            <div className="label">
              {p === 0 ? "J-0" : p < 0 ? "J" + p : "J+" + p}
              {unit ? " " + unit : ""}
            </div>
          </div>
        ))}
      <Tip4 text="Ajouter un rappel (J-3)">
        <button className="rule-add" onClick={onAdd} aria-label="Ajouter un rappel" />
      </Tip4>
    </div>
  );
}

function ParametresScreen() {
  const { data, settings, updateSettings, toast } = useApp4();
  const [tab, setTab] = useState("garage");
  const [vtPoints, setVtPoints] = useState(settings.regles.vt);
  const [creancePoints, setCreancePoints] = useState(settings.regles.creance);
  const [testingChan, setTestingChan] = useState(null);

  const tabs = [
    { id: "garage", label: "Garage", icon: "building" },
    { id: "regles", label: "Règles de relance", icon: "clock" },
    { id: "canaux", label: "Canaux", icon: "bell" },
    { id: "paiement", label: "Paiement mobile", icon: "creditCard" },
    { id: "utilisateurs", label: "Utilisateurs & rôles", icon: "users" },
    { id: "notifications", label: "Notifications", icon: "mail" },
  ];

  return (
    <div data-od-id="parametres-screen">
      <div className="page-head">
        <div>
          <h2>Paramètres</h2>
          <div className="desc">Configuration du garage, des règles de relance et des canaux.</div>
        </div>
      </div>
      <div className="settings-grid">
        <div className="settings-nav">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => setTab(t.id)}
            >
              <Icon4 name={t.icon} size={15} style={{ marginRight: 8, verticalAlign: -2 }} />
              {t.label}
            </button>
          ))}
        </div>
        <div className="settings-content">
          {tab === "garage" && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 14 }}>
                Informations du garage
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>Nom du garage</label>
                  <input className="input" defaultValue={data.garage.nom} />
                </div>
                <div className="field">
                  <label>Numéro WhatsApp</label>
                  <input className="input" defaultValue={data.garage.whatsapp} />
                </div>
              </div>
              <div className="field">
                <label>Adresse</label>
                <input className="input" defaultValue={data.garage.adresse} />
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>Téléphone</label>
                  <input className="input" defaultValue={data.garage.telephone} />
                </div>
                <div className="field">
                  <label>Horaires</label>
                  <input className="input" defaultValue={data.garage.horaires} />
                </div>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => toast("ok", "Informations du garage enregistrées.")}
              >
                Enregistrer
              </button>
            </div>
          )}

          {tab === "regles" && (
            <div className="stack">
              <div className="card">
                <div className="card-title" style={{ marginBottom: 4 }}>
                  Visite technique
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>
                  Rappels envoyés avant l'expiration de la VT.
                </div>
                <RuleTimeline
                  points={vtPoints}
                  onAdd={() => !vtPoints.includes(-3) && setVtPoints([...vtPoints, -3])}
                  onRemove={(p) => setVtPoints(vtPoints.filter((x) => x !== p))}
                />
                <div className="checkbox-row">
                  <div className="switch">
                    <input type="checkbox" defaultChecked={settings.regles.autoVt} />
                    <span className="track" />
                  </div>
                  <span style={{ fontSize: 13 }}>
                    Envoi automatique (sinon validation manuelle requise)
                  </span>
                </div>
              </div>
              <div className="card">
                <div className="card-title" style={{ marginBottom: 4 }}>
                  Révision
                </div>
                <div className="grid-2">
                  <div className="field">
                    <label>Rappel avant échéance (km)</label>
                    <input className="input" type="number" defaultValue={1000} />
                  </div>
                  <div className="field">
                    <label>Rappel avant échéance (mois)</label>
                    <input className="input" type="number" defaultValue={1} />
                  </div>
                </div>
                <div className="checkbox-row">
                  <div className="switch">
                    <input type="checkbox" defaultChecked={settings.regles.autoRevision} />
                    <span className="track" />
                  </div>
                  <span style={{ fontSize: 13 }}>Envoi automatique</span>
                </div>
              </div>
              <div className="card">
                <div className="card-title" style={{ marginBottom: 4 }}>
                  Créances
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>
                  Paliers de relance après échéance de facture (en jours de retard).
                </div>
                <RuleTimeline
                  points={creancePoints}
                  onAdd={() =>
                    setCreancePoints([...creancePoints, Math.max(...creancePoints) + 10])
                  }
                  onRemove={(p) => setCreancePoints(creancePoints.filter((x) => x !== p))}
                />
                <div className="checkbox-row">
                  <div className="switch">
                    <input type="checkbox" defaultChecked={settings.regles.autoCreance} />
                    <span className="track" />
                  </div>
                  <span style={{ fontSize: 13 }}>
                    Envoi automatique (recommandé : validation manuelle)
                  </span>
                </div>
              </div>
              <div className="card">
                <div className="card-title" style={{ marginBottom: 10 }}>
                  Envoi
                </div>
                <div className="grid-2">
                  <div className="field">
                    <label>Heure d'envoi</label>
                    <input
                      className="input"
                      type="time"
                      defaultValue={settings.regles.heureEnvoi}
                    />
                  </div>
                  <div className="field">
                    <label>Jours exclus</label>
                    <select
                      className="select"
                      multiple
                      defaultValue={settings.regles.joursExclus}
                      style={{ height: 80 }}
                    >
                      {[
                        "lundi",
                        "mardi",
                        "mercredi",
                        "jeudi",
                        "vendredi",
                        "samedi",
                        "dimanche",
                      ].map((j) => (
                        <option key={j}>{j}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid-2">
                  <div className="field">
                    <label>Canal prioritaire</label>
                    <select className="select" defaultValue={settings.regles.canalPrioritaire}>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="sms">SMS</option>
                      <option value="email">Email</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Canal de repli</label>
                    <select className="select" defaultValue={settings.regles.canalRepli}>
                      <option value="sms">SMS</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="email">Email</option>
                    </select>
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    updateSettings({
                      regles: { ...settings.regles, vt: vtPoints, creance: creancePoints },
                    });
                    toast("ok", "Règles de relance enregistrées.");
                  }}
                >
                  Enregistrer
                </button>
              </div>
            </div>
          )}

          {tab === "canaux" && (
            <div>
              {[
                {
                  id: "whatsapp",
                  label: "WhatsApp Business",
                  icon: "whatsapp",
                  bg: "var(--chan-whatsapp-bg)",
                  color: "var(--chan-whatsapp)",
                  info: "Numéro : " + settings.canaux.whatsapp.numero,
                },
                {
                  id: "sms",
                  label: "SMS",
                  icon: "message",
                  bg: "var(--chan-sms-bg)",
                  color: "var(--chan-sms)",
                  info: "Solde : " + settings.canaux.sms.solde,
                },
                {
                  id: "email",
                  label: "Email",
                  icon: "mail",
                  bg: "var(--chan-email-bg)",
                  color: "var(--chan-email)",
                  info: "Expéditeur : " + settings.canaux.email.expediteur,
                },
              ].map((c) => (
                <div className="channel-card" key={c.id}>
                  <div className="ic" style={{ background: c.bg, color: c.color }}>
                    <Icon4 name={c.icon} size={19} />
                  </div>
                  <div className="info">
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {c.label}{" "}
                      <StatusPill4 tone="ok" style={{ marginLeft: 6 }}>
                        Connecté
                      </StatusPill4>
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{c.info}</div>
                  </div>
                  <div className="actions">
                    <button className="btn btn-secondary btn-sm">Configurer</button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setTestingChan(c.id);
                        setTimeout(() => {
                          setTestingChan(null);
                          toast("ok", "Message test envoyé via " + c.label + ".");
                        }, 600);
                      }}
                    >
                      {testingChan === c.id ? "Envoi…" : "Envoyer un test"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "paiement" && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 14 }}>
                Liens de paiement mobile
              </div>
              <div className="field">
                <label>Wave</label>
                <input className="input" defaultValue={settings.paiementMobile.wave} />
              </div>
              <div className="field">
                <label>Orange Money</label>
                <input className="input" defaultValue={settings.paiementMobile.orangeMoney} />
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>MTN MoMo</label>
                  <input
                    className="input"
                    placeholder="Non configuré"
                    defaultValue={settings.paiementMobile.mtn}
                  />
                </div>
                <div className="field">
                  <label>Moov Money</label>
                  <input
                    className="input"
                    placeholder="Non configuré"
                    defaultValue={settings.paiementMobile.moov}
                  />
                </div>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => toast("ok", "Liens de paiement enregistrés.")}
              >
                Enregistrer
              </button>
            </div>
          )}

          {tab === "utilisateurs" && (
            <div className="table-wrap">
              <div className="table-toolbar">
                <div className="spacer" />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => toast("info", "Invitation envoyée (démo).")}
                >
                  <Icon4 name="plus" size={14} />
                  Nouvel utilisateur
                </button>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Rôle</th>
                    <th>Accès</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 600 }}>{u.nom}</td>
                      <td>{u.role}</td>
                      <td>
                        {u.role === "Gérant" ? (
                          <StatusPill4 tone="ok">Accès complet</StatusPill4>
                        ) : u.role === "Comptable" ? (
                          <StatusPill4 tone="warn">Créances & paiements</StatusPill4>
                        ) : (
                          <StatusPill4 tone="off">Relances & clients</StatusPill4>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "notifications" && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 14 }}>
                Résumé quotidien pour le gérant
              </div>
              <div className="checkbox-row" style={{ marginBottom: 14 }}>
                <div className="switch">
                  <input type="checkbox" defaultChecked={settings.notifGerant.whatsapp} />
                  <span className="track" />
                </div>
                <span style={{ fontSize: 13.5 }}>Recevoir le résumé par WhatsApp</span>
              </div>
              <div className="checkbox-row" style={{ marginBottom: 14 }}>
                <div className="switch">
                  <input type="checkbox" defaultChecked={settings.notifGerant.email} />
                  <span className="track" />
                </div>
                <span style={{ fontSize: 13.5 }}>Recevoir le résumé par email</span>
              </div>
              <div className="field" style={{ maxWidth: 200 }}>
                <label>Heure d'envoi du résumé</label>
                <input
                  className="input"
                  type="time"
                  defaultValue={settings.notifGerant.heureResume}
                />
              </div>
              <button
                className="btn btn-primary"
                onClick={() => toast("ok", "Préférences de notification enregistrées.")}
              >
                Enregistrer
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { HistoriqueScreen, ModelesScreen, ImportScreen, ParametresScreen });
