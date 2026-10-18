const {
  Icon: Icon1,
  Tip: Tip1,
  StatusPill: StatusPill1,
  TypePill: TypePill1,
  ChanPill: ChanPill1,
  PalierBadge: PalierBadge1,
  KpiCard: KpiCard1,
  AlertList: AlertList1,
  useApp: useApp1,
  EmptyState: EmptyState1,
} = window;
const { fcfa: fcfa1, daysBetween: daysBetween1 } = window.AR_HELPERS;

/* ===================== Connexion ===================== */
function LoginScreen() {
  const { login, toast, data } = useApp1();
  const [email, setEmail] = useState("aya.kouame@excellence-auto.ci");
  const [pwd, setPwd] = useState("••••••••");
  const [err, setErr] = useState("");
  function submit(e) {
    e.preventDefault();
    if (!email.trim() || !pwd.trim()) {
      setErr("Merci de renseigner vos identifiants.");
      return;
    }
    setErr("");
    login();
  }
  return (
    <div className="login-wrap" data-od-id="login-screen">
      <div className="login-card">
        <div className="login-logo">
          <div className="mark">EA</div>
          <h1>AutoRappel</h1>
          <div className="sub">
            {data.garage.nom} · {data.garage.quartier}
          </div>
        </div>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="login-email">Email ou téléphone</label>
            <input
              id="login-email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nom@garage.ci ou 07 00 00 00 00"
            />
          </div>
          <div className="field">
            <label htmlFor="login-pwd">Mot de passe</label>
            <input
              id="login-pwd"
              type="password"
              className="input"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
            />
          </div>
          {err && (
            <div style={{ color: "var(--status-bad)", fontSize: 13, marginBottom: 12 }}>{err}</div>
          )}
          <button type="submit" className="btn btn-primary btn-block" style={{ marginBottom: 14 }}>
            Se connecter
          </button>
          <div style={{ textAlign: "center" }}>
            <button
              type="button"
              className="link-btn"
              onClick={() => toast("info", "Un lien de réinitialisation a été envoyé par SMS.")}
            >
              Mot de passe oublié ?
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ===================== Tableau de bord ===================== */
function ChartEnvoisSemaine({ parSemaine }) {
  const max = Math.max(...parSemaine.map((s) => s.whatsapp + s.sms + s.email), 1);
  return (
    <div>
      <div className="chart-bars">
        {parSemaine.map((s) => {
          const total = s.whatsapp + s.sms + s.email;
          const h = Math.round((total / max) * 130);
          return (
            <div className="chart-col" key={s.semaine}>
              <Tip1
                text={
                  s.whatsapp +
                  " WhatsApp · " +
                  s.sms +
                  " SMS · " +
                  s.email +
                  " Email (total " +
                  total +
                  ")"
                }
              >
                <div className="chart-bar-stack" style={{ height: h + "px" }}>
                  <div
                    style={{
                      height: (s.whatsapp / total) * 100 + "%",
                      background: "var(--chan-whatsapp)",
                    }}
                  />
                  <div
                    style={{ height: (s.sms / total) * 100 + "%", background: "var(--chan-sms)" }}
                  />
                  <div
                    style={{
                      height: (s.email / total) * 100 + "%",
                      background: "var(--chan-email)",
                    }}
                  />
                </div>
              </Tip1>
              <div className="lbl">{s.semaine}</div>
            </div>
          );
        })}
      </div>
      <div className="legend-row">
        <span className="sw">
          <span style={{ background: "var(--chan-whatsapp)" }} />
          WhatsApp
        </span>
        <span className="sw">
          <span style={{ background: "var(--chan-sms)" }} />
          SMS
        </span>
        <span className="sw">
          <span style={{ background: "var(--chan-email)" }} />
          Email
        </span>
      </div>
    </div>
  );
}

function DashboardScreen() {
  const { data, navigate } = useApp1();
  const { dashboard, reminders, clients, invoices } = data;
  const dashReminders = reminders.filter((r) => r.statut === "attente");

  const parClient = {};
  invoices.forEach((inv) => {
    if (inv.statut === "Payée") return;
    if (!parClient[inv.clientId]) parClient[inv.clientId] = { total: 0, retard: 0, invs: [] };
    parClient[inv.clientId].total += inv.resteDue;
    parClient[inv.clientId].retard = Math.max(parClient[inv.clientId].retard, inv.retardJours);
    parClient[inv.clientId].invs.push(inv);
  });
  const topImpayes = Object.keys(parClient)
    .map((cid) => ({ client: clients.find((c) => c.id === cid), ...parClient[cid] }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return (
    <div data-od-id="dashboard-screen">
      <div className="page-head">
        <div>
          <h2>Tableau de bord</h2>
          <div className="desc">Bonjour — voici ce qu'il se passe aujourd'hui au garage.</div>
        </div>
      </div>

      <div className="kpi-grid">
        <KpiCard1
          icon="bell"
          label="Relances à traiter aujourd'hui"
          value={dashboard.relancesATraiter}
          sub="À faire maintenant"
          subTone="bad"
          tooltip="Relances VT, révision et créance en attente de validation ou d'envoi aujourd'hui."
          onClick={() => navigate("relances")}
        />
        <KpiCard1
          icon="banknote"
          label="Créances en cours"
          value={fcfa1(dashboard.creancesEnCours)}
          sub={fcfa1(dashboard.creancesRetard30) + " en retard +30j"}
          subTone="bad"
          tooltip="Montant total dû sur les factures ouvertes (hors payées)."
          onClick={() => navigate("creances")}
        />
        <KpiCard1
          icon="shield"
          label="VT expirant sous 30j"
          value={dashboard.vtExpirant30 + " véhicules"}
          sub="À anticiper"
          subTone="bad"
          tooltip="VT = Visite Technique. Contrôle obligatoire à renouveler avant expiration."
          onClick={() => navigate("echeances", { tab: "vt" })}
        />
        <KpiCard1
          icon="wrench"
          label="Révisions dues ce mois"
          value={dashboard.revisionsDues + " véhicules"}
          sub="Entretien périodique"
          subTone="bad"
          tooltip="Véhicules dont la révision est due selon la date ou le kilométrage estimé."
          onClick={() => navigate("echeances", { tab: "revision" })}
        />
      </div>

      <div className="dashboard-grid">
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <div className="card-title">
                <Icon1 name="gauge" size={16} />
                Résultats des relances (30 derniers jours)
              </div>
            </div>
            <div className="grid-2" style={{ marginBottom: 16 }}>
              <div>
                <div className="kpi-value num" style={{ fontSize: 22 }}>
                  {dashboard.resultats30j.envoyes}
                </div>
                <div className="kpi-label">
                  Envoyés · {dashboard.resultats30j.delivres} délivrés ·{" "}
                  {dashboard.resultats30j.lus} lus
                </div>
              </div>
              <div>
                <div className="kpi-value num" style={{ fontSize: 22, color: "var(--status-ok)" }}>
                  {dashboard.resultats30j.clientsRevenus}
                </div>
                <div className="kpi-label">Clients revenus grâce aux relances</div>
              </div>
            </div>
            <div className="section-label" style={{ marginTop: 0 }}>
              Montant récupéré sur créances relancées
            </div>
            <div
              className="kpi-value num"
              style={{ fontSize: 26, color: "var(--status-ok)", marginBottom: 14 }}
            >
              {fcfa1(dashboard.resultats30j.montantRecupere)}
            </div>
            <div className="section-label">Envois par semaine (par canal)</div>
            <ChartEnvoisSemaine parSemaine={dashboard.resultats30j.parSemaine} />
          </div>

          <div className="card">
            <div className="card-head">
              <div className="card-title">
                <Icon1 name="bell" size={16} />À faire maintenant
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate("relances")}>
                Tout voir
                <Icon1 name="arrowRight" size={14} />
              </button>
            </div>
            {dashReminders.length === 0 ? (
              <EmptyState1
                icon="checkCircle"
                title="Tout est à jour"
                text="Aucune relance en attente."
              />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {dashReminders.slice(0, 5).map((r) => (
                  <div
                    key={r.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 0",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <TypePill1 type={r.type} compact />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: 13.5,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {r.client.nom}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--muted)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {r.motif}
                      </div>
                    </div>
                    <ChanPill1 canal={r.canal} compact />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head">
              <div className="card-title">
                <Icon1 name="banknote" size={16} />
                Plus gros impayés
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate("creances")}>
                Tout voir
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {topImpayes.map((t) => (
                <button
                  key={t.client.id}
                  onClick={() => navigate("fiche-client", { clientId: t.client.id })}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 0",
                    borderBottom: "1px solid var(--border)",
                    background: "none",
                    border: "none",
                    textAlign: "left",
                    cursor: "pointer",
                    color: "var(--fg)",
                    font: "inherit",
                    width: "100%",
                  }}
                >
                  <span
                    className={"badge-type" + (t.client.type === "entreprise" ? " entreprise" : "")}
                  >
                    {t.client.type === "entreprise" ? "Entreprise" : "Particulier"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 13.5,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {t.client.nom}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--status-bad)" }}>
                      Retard {t.retard} j
                    </div>
                  </div>
                  <div
                    className="num"
                    style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: "nowrap" }}
                  >
                    {fcfa1(t.total)}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div className="card-title">
                <Icon1 name="alertTriangle" size={16} />
                Alertes système
              </div>
            </div>
            <AlertList1 items={dashboard.alertes} onGo={(lien) => navigate(lien)} />
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { LoginScreen, DashboardScreen });
