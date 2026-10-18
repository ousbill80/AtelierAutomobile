const { daysBetween: daysBetweenA, fmtISO: fmtISOA, addDays: addDaysA } = window.AR_HELPERS;

/* ===================== Root App ===================== */
let TOAST_SEQ = 1;
let IMPORT_SEQ = 100;
let CLIENT_SEQ = 100;

function App() {
  const seed = useMemo(() => JSON.parse(JSON.stringify(window.AR_DATA)), []);

  const [authed, setAuthed] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("u2");
  const [theme, setTheme] = useState(() => localStorage.getItem("ar-theme") || "light");
  const [view, setView] = useState(() => localStorage.getItem("ar-view") || "dashboard");
  const [params, setParams] = useState({});
  const [collapsed, setCollapsed] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [toasts, setToasts] = useState([]);

  const [garage] = useState(seed.garage);
  const [users] = useState(seed.users);
  const [clients, setClients] = useState(seed.clients);
  const [vehicles, setVehicles] = useState(seed.vehicles);
  const [invoices, setInvoices] = useState(seed.invoices);
  const [reminders, setReminders] = useState(seed.reminders);
  const [history, setHistory] = useState(seed.history);
  const [templates, setTemplates] = useState(seed.templates);
  const [importsHistory, setImportsHistory] = useState(seed.importsHistory);
  const [settings, setSettings] = useState(seed.settings);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("ar-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("ar-view", view);
  }, [view]);

  function toast(type, msg) {
    const id = TOAST_SEQ++;
    setToasts((t) => [...t, { id, type, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }

  function navigate(nextView, nextParams) {
    setView(nextView);
    setParams(nextParams || {});
    setPlusOpen(false);
  }

  function login() {
    setAuthed(true);
    toast("ok", "Connexion réussie. Bienvenue !");
  }
  function logout() {
    setAuthed(false);
    setPlusOpen(false);
  }
  function setRole(userId) {
    setCurrentUserId(userId);
    toast("info", "Rôle changé — " + (users.find((u) => u.id === userId) || {}).nom);
  }
  const currentUser = users.find((u) => u.id === currentUserId) || users[0];

  /* ---- Relances ---- */
  function sendReminders(ids) {
    const idSet = new Set(ids);
    const now = new Date();
    const nowIso = now.toISOString().slice(0, 16);
    const newHistoryEntries = [];
    setReminders((rs) =>
      rs.map((r) => {
        if (!idSet.has(r.id)) return r;
        newHistoryEntries.push({
          id: "h" + (history.length + newHistoryEntries.length + 1) + "-" + r.id,
          datetime: nowIso,
          clientId: r.clientId,
          type: r.type,
          canal: r.canal,
          palier: r.palier,
          statut: "Envoyé",
          cout: r.canal === "sms" ? 15 : 0,
        });
        return { ...r, statut: "envoyee" };
      }),
    );
    setHistory((h) => [...newHistoryEntries, ...h]);
  }
  function reportReminder(id) {
    setReminders((rs) => rs.map((r) => (r.id === id ? { ...r, statut: "reportee" } : r)));
  }
  function ignoreReminder(id) {
    setReminders((rs) => rs.map((r) => (r.id === id ? { ...r, statut: "ignoree" } : r)));
  }
  function updateReminder(id, patch) {
    setReminders((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  /* ---- Créances ---- */
  function recordPayment(invoiceId, p) {
    setInvoices((inv) =>
      inv.map((i) => {
        if (i.id !== invoiceId) return i;
        const paye = i.paye + p.montant;
        const resteDue = Math.max(0, i.montant - paye);
        const paiements = [
          ...(i.paiements || []),
          { date: p.date, mode: p.mode, montant: p.montant, ref: p.ref },
        ];
        return {
          ...i,
          paye,
          resteDue,
          mode: p.mode,
          paiements,
          statut: resteDue <= 0 ? "Payée" : "Payée partiellement",
        };
      }),
    );
    setReminders((rs) =>
      rs.map((r) => (r.invoiceId === invoiceId ? { ...r, statut: "traitee" } : r)),
    );
  }
  function setPromesse(invoiceId, date, note) {
    setInvoices((inv) =>
      inv.map((i) =>
        i.id === invoiceId
          ? {
              ...i,
              statut: "Promesse de paiement",
              note: "Promesse de paiement le " + date + (note ? " — " + note : ""),
            }
          : i,
      ),
    );
  }
  function setLitige(invoiceId, note) {
    setInvoices((inv) =>
      inv.map((i) => (i.id === invoiceId ? { ...i, statut: "Litige/ne plus relancer", note } : i)),
    );
    setReminders((rs) =>
      rs.map((r) => (r.invoiceId === invoiceId ? { ...r, statut: "ignoree" } : r)),
    );
  }
  function relancerMaintenant(invoice) {
    const nowIso = new Date().toISOString().slice(0, 16);
    setInvoices((inv) =>
      inv.map((i) =>
        i.id === invoice.id && i.statut === "À échéance" ? { ...i, statut: "Relancée" } : i,
      ),
    );
    setHistory((h) => [
      {
        id: "h-manual-" + invoice.id + "-" + Date.now(),
        datetime: nowIso,
        clientId: invoice.clientId,
        type: "creance",
        canal: invoice.canalEnvoi || "whatsapp",
        palier: "Relance manuelle",
        statut: "Envoyé",
        cout: 0,
      },
      ...h,
    ]);
  }

  /* ---- Échéances ---- */
  function markVtDone(vehicleId) {
    setVehicles((vs) =>
      vs.map((v) => {
        if (v.id !== vehicleId) return v;
        const today = window.AR_TODAY;
        const vtDerniere = fmtISOA(today);
        const vtExpiration = fmtISOA(addDaysA(today, 365));
        const vtJoursRestants = daysBetweenA(vtExpiration);
        return { ...v, vtDerniere, vtExpiration, vtJoursRestants, vtStatut: "ok" };
      }),
    );
    setReminders((rs) =>
      rs.map((r) =>
        r.type === "vt" && r.vehicleId === vehicleId ? { ...r, statut: "traitee" } : r,
      ),
    );
  }
  function markRevisionDone(vehicleId) {
    setVehicles((vs) =>
      vs.map((v) => {
        if (v.id !== vehicleId) return v;
        const today = window.AR_TODAY;
        const revisionDerniereDate = fmtISOA(today);
        const revisionDerniereKm = v.km;
        const revisionProchaineKm = revisionDerniereKm + v.revisionIntervalleKm;
        const revisionProchaineDateEstimee = fmtISOA(
          addDaysA(today, v.revisionIntervalleMois * 30),
        );
        const revisionKmRestants = revisionProchaineKm - v.km;
        const revisionJoursRestants = daysBetweenA(revisionProchaineDateEstimee);
        return {
          ...v,
          revisionDerniereDate,
          revisionDerniereKm,
          revisionProchaineKm,
          revisionProchaineDateEstimee,
          revisionKmRestants,
          revisionJoursRestants,
          revisionStatut: "ok",
          revisionProgress: 0,
        };
      }),
    );
    setReminders((rs) =>
      rs.map((r) =>
        r.type === "revision" && r.vehicleId === vehicleId ? { ...r, statut: "traitee" } : r,
      ),
    );
  }
  function markRdvPris(vehicleId) {
    setVehicles((vs) => vs.map((v) => (v.id === vehicleId ? { ...v, rdvPris: true } : v)));
  }

  /* ---- Clients ---- */
  function addClient(form) {
    const id = "c" + CLIENT_SEQ++;
    const client = {
      id,
      type: form.type,
      nom: form.nom,
      telephone: form.telephone,
      whatsapp: form.whatsapp,
      email: form.email,
      canalPrefere: form.canalPrefere,
      consentement: true,
      derniereVisite: fmtISOA(window.AR_TODAY),
    };
    setClients((cs) => [...cs, client]);
    return client;
  }
  function doNotRemind(clientId, motif) {
    setClients((cs) =>
      cs.map((c) =>
        c.id === clientId ? { ...c, consentement: false, motifDoNotRemind: motif } : c,
      ),
    );
  }
  function setCanalPrefere(clientId, canal) {
    setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, canalPrefere: canal } : c)));
  }

  /* ---- Modèles & import & paramètres ---- */
  function updateTemplate(id, patch) {
    setTemplates((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }
  function addImportRecord(rec) {
    const id = "imp" + IMPORT_SEQ++;
    setImportsHistory((h) => [
      { id, date: new Date().toISOString(), utilisateur: currentUser.nom, ...rec },
      ...h,
    ]);
  }
  function updateSettings(patch) {
    setSettings((s) => ({ ...s, ...patch }));
  }

  /* ---- Données jointes pour l'affichage ---- */
  const data = useMemo(() => {
    const byId = (arr) => {
      const m = {};
      arr.forEach((x) => (m[x.id] = x));
      return m;
    };
    const cById = byId(clients),
      vById = byId(vehicles),
      iById = byId(invoices);
    const joinedReminders = reminders.map((r) => ({
      ...r,
      client: cById[r.clientId],
      vehicle: r.vehicleId ? vById[r.vehicleId] : null,
      invoice: r.invoiceId ? iById[r.invoiceId] : null,
    }));
    const pending = joinedReminders.filter((r) => r.statut === "attente").length;
    const openInvoices = invoices.filter((i) => i.statut !== "Payée");
    const creancesEnCours = openInvoices.reduce((s, i) => s + i.resteDue, 0);
    const creancesRetard30 = openInvoices
      .filter((i) => i.retardJours >= 30)
      .reduce((s, i) => s + i.resteDue, 0);
    const vtExpirant30 = vehicles.filter((v) => v.vtJoursRestants <= 30).length;
    const revisionsDues = vehicles.filter((v) => v.revisionStatut !== "ok").length;
    return {
      garage,
      users,
      clients,
      vehicles,
      invoices,
      history,
      templates,
      importsHistory,
      settings,
      reminders: joinedReminders,
      dashboard: {
        ...seed.dashboard,
        relancesATraiter: pending,
        creancesEnCours,
        creancesRetard30,
        vtExpirant30,
        revisionsDues,
      },
    };
  }, [
    garage,
    users,
    clients,
    vehicles,
    invoices,
    reminders,
    history,
    templates,
    importsHistory,
    settings,
    seed.dashboard,
  ]);

  const pendingReminders = useMemo(
    () => data.reminders.filter((r) => r.statut === "attente"),
    [data.reminders],
  );
  const counts = { relances: pendingReminders.length };

  const ctxValue = {
    data,
    settings,
    reminders: pendingReminders,
    invoices,
    navigate,
    toast,
    login,
    logout,
    setRole,
    currentUser,
    sendReminders,
    reportReminder,
    ignoreReminder,
    updateReminder,
    recordPayment,
    setPromesse,
    setLitige,
    relancerMaintenant,
    markVtDone,
    markRevisionDone,
    markRdvPris,
    addClient,
    doNotRemind,
    setCanalPrefere,
    updateTemplate,
    addImportRecord,
    updateSettings,
  };

  if (!authed) {
    return (
      <AppContext.Provider value={ctxValue}>
        <LoginScreen />
        <ToastHost toasts={toasts} />
      </AppContext.Provider>
    );
  }

  const SCREENS = {
    dashboard: DashboardScreen,
    relances: RelancesScreen,
    creances: CreancesScreen,
    echeances: EcheancesScreen,
    clients: ClientsScreen,
    "fiche-client": FicheClientScreen,
    "fiche-vehicule": FicheVehiculeScreen,
    historique: HistoriqueScreen,
    modeles: ModelesScreen,
    import: ImportScreen,
    parametres: ParametresScreen,
  };
  const Screen = SCREENS[view] || DashboardScreen;

  return (
    <AppContext.Provider value={ctxValue}>
      <div className={"app-shell" + (collapsed ? " sidebar-collapsed" : "")} data-od-id="app-shell">
        <Sidebar
          view={view}
          navigate={navigate}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          counts={counts}
        />
        <div className="app-main">
          <TopBar theme={theme} setTheme={setTheme} counts={counts} />
          <main className="app-content" data-od-id="app-content">
            <Screen params={params} />
          </main>
          <BottomTabBar
            view={view}
            navigate={navigate}
            counts={counts}
            onMore={() => setPlusOpen(true)}
          />
        </div>
        {plusOpen && (
          <PlusSheet
            view={view}
            navigate={navigate}
            onClose={() => setPlusOpen(false)}
            onLogout={logout}
            theme={theme}
            setTheme={setTheme}
          />
        )}
      </div>
      <ToastHost toasts={toasts} />
    </AppContext.Provider>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
