// Données d'exemple AutoRappel — Garage Excellence Auto (Yopougon, Abidjan)
(function () {
  var TODAY = new Date("2026-10-18T09:00:00");
  function addDays(d, n) {
    var r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }
  function fmtISO(d) {
    return d.toISOString().slice(0, 10);
  }
  function daysBetween(dateStr) {
    // positive = future, negative = past, vs TODAY
    var d = new Date(dateStr + "T00:00:00");
    return Math.round((d - new Date(fmtISO(TODAY) + "T00:00:00")) / 86400000);
  }
  function fmtFR(dateStr) {
    var d = new Date(dateStr + "T00:00:00");
    var jours = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
    return (
      String(d.getDate()).padStart(2, "0") +
      "/" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "/" +
      d.getFullYear()
    );
  }
  function fcfa(n) {
    return n.toLocaleString("fr-FR").replace(/\u202f|\u00a0/g, " ") + " FCFA";
  }

  var garage = {
    nom: "Garage Excellence Auto",
    quartier: "Yopougon, Abidjan",
    adresse: "Boulevard Principal, Yopougon Sicogi, Abidjan",
    telephone: "+225 07 08 12 34 56",
    whatsapp: "+225 07 08 12 34 56",
    horaires: "Lun–Sam 7h30–18h30",
    email: "contact@excellence-auto.ci",
    logoInit: "EA",
  };

  var users = [
    { id: "u1", nom: "Fatoumata Diarra", role: "Gérant", avatar: "FD" },
    { id: "u2", nom: "Aya Kouamé", role: "Réceptionniste", avatar: "AK" },
    { id: "u3", nom: "Brou Désiré", role: "Comptable", avatar: "BD" },
  ];

  var clients = [
    {
      id: "c1",
      type: "particulier",
      nom: "Kouassi Jean-Marc",
      telephone: "+225 05 44 10 22 31",
      whatsapp: true,
      email: "jm.kouassi@gmail.com",
      canalPrefere: "whatsapp",
      consentement: true,
      derniereVisite: "2026-05-02",
    },
    {
      id: "c2",
      type: "particulier",
      nom: "Bamba Aminata",
      telephone: "+225 07 12 90 44 10",
      whatsapp: true,
      email: "aminata.bamba@yahoo.fr",
      canalPrefere: "whatsapp",
      consentement: true,
      derniereVisite: "2026-04-18",
    },
    {
      id: "c3",
      type: "entreprise",
      nom: "SOTRA Logistique SARL",
      telephone: "+225 27 21 35 80 00",
      whatsapp: false,
      email: "flotte@sotralogistique.ci",
      canalPrefere: "email",
      consentement: true,
      flotteSize: 12,
      derniereVisite: "2026-06-30",
    },
    {
      id: "c4",
      type: "particulier",
      nom: "Koné Ibrahim",
      telephone: "+225 01 66 70 12 09",
      whatsapp: true,
      email: "",
      canalPrefere: "sms",
      consentement: true,
      derniereVisite: "2026-09-02",
    },
    {
      id: "c5",
      type: "particulier",
      nom: "Yao Adjoua Christelle",
      telephone: "+225 07 55 22 10 88",
      whatsapp: true,
      email: "adjoua.yao@gmail.com",
      canalPrefere: "whatsapp",
      consentement: true,
      derniereVisite: "2026-03-10",
    },
    {
      id: "c6",
      type: "particulier",
      nom: "Traoré Moussa",
      telephone: "+225 05 90 44 67 23",
      whatsapp: true,
      email: "",
      canalPrefere: "whatsapp",
      consentement: true,
      derniereVisite: "2026-09-28",
    },
    {
      id: "c7",
      type: "particulier",
      nom: "Diabaté Fatou",
      telephone: "+225 07 21 09 33 50",
      whatsapp: true,
      email: "fatou.diabate@outlook.fr",
      canalPrefere: "whatsapp",
      consentement: true,
      derniereVisite: "2026-08-14",
    },
    {
      id: "c8",
      type: "particulier",
      nom: "Ouattara Siaka",
      telephone: "+225 01 44 55 02 19",
      whatsapp: false,
      email: "siaka.ouattara@gmail.com",
      canalPrefere: "sms",
      consentement: true,
      derniereVisite: "2026-07-21",
    },
    {
      id: "c9",
      type: "particulier",
      nom: "N'Guessan Paul",
      telephone: "+225 05 33 21 90 44",
      whatsapp: true,
      email: "",
      canalPrefere: "whatsapp",
      consentement: true,
      derniereVisite: "2026-06-05",
    },
    {
      id: "c10",
      type: "particulier",
      nom: "Coulibaly Mariam",
      telephone: "+225 07 88 10 25 63",
      whatsapp: true,
      email: "mariam.coulibaly@gmail.com",
      canalPrefere: "whatsapp",
      consentement: true,
      derniereVisite: "2026-08-01",
    },
    {
      id: "c11",
      type: "entreprise",
      nom: "STE BTP Côte d'Ivoire",
      telephone: "+225 27 22 44 10 00",
      whatsapp: false,
      email: "compta@stebtp.ci",
      canalPrefere: "email",
      consentement: true,
      flotteSize: 6,
      derniereVisite: "2026-09-15",
    },
    {
      id: "c12",
      type: "particulier",
      nom: "Konan Serge",
      telephone: "+225 05 11 90 72 34",
      whatsapp: true,
      email: "serge.konan@gmail.com",
      canalPrefere: "whatsapp",
      consentement: true,
      derniereVisite: "2026-07-02",
    },
    {
      id: "c13",
      type: "particulier",
      nom: "Touré Aïcha",
      telephone: "+225 07 60 14 88 22",
      whatsapp: true,
      email: "",
      canalPrefere: "whatsapp",
      consentement: false,
      derniereVisite: "2026-02-20",
    },
    {
      id: "c14",
      type: "particulier",
      nom: "Yapo Bertin",
      telephone: "+225 01 25 60 90 11",
      whatsapp: true,
      email: "bertin.yapo@gmail.com",
      canalPrefere: "whatsapp",
      consentement: true,
      derniereVisite: "2026-08-29",
    },
  ];

  var vehicles = [
    {
      id: "v1",
      clientId: "c1",
      marque: "Toyota",
      modele: "Corolla",
      annee: 2018,
      plaque: "2547 GH 01",
      vin: "JTDBR32E000123456",
      km: 88400,
      kmDate: "2026-09-02",
      vtDerniere: "2025-11-02",
      vtExpiration: "2026-11-02",
      revisionDerniereDate: "2026-05-02",
      revisionDerniereKm: 81000,
      revisionIntervalleKm: 10000,
      revisionIntervalleMois: 6,
    },
    {
      id: "v2",
      clientId: "c2",
      marque: "Hyundai",
      modele: "Tucson",
      annee: 2020,
      plaque: "8812 JK 01",
      vin: "KMHJ381GBLU884201",
      km: 52200,
      kmDate: "2026-10-10",
      vtDerniere: "2026-03-18",
      vtExpiration: "2027-03-18",
      revisionDerniereDate: "2026-04-18",
      revisionDerniereKm: 42000,
      revisionIntervalleKm: 10000,
      revisionIntervalleMois: 6,
    },
    {
      id: "v3a",
      clientId: "c3",
      marque: "Toyota",
      modele: "Hiace (flotte)",
      annee: 2021,
      plaque: "1001 SL 01",
      vin: "JTFSX22P000000001",
      km: 61000,
      kmDate: "2026-10-01",
      vtDerniere: "2026-02-10",
      vtExpiration: "2027-02-10",
      revisionDerniereDate: "2026-07-01",
      revisionDerniereKm: 55000,
      revisionIntervalleKm: 15000,
      revisionIntervalleMois: 6,
    },
    {
      id: "v3b",
      clientId: "c3",
      marque: "Toyota",
      modele: "Hiace (flotte)",
      annee: 2021,
      plaque: "1002 SL 01",
      vin: "JTFSX22P000000002",
      km: 58200,
      kmDate: "2026-10-01",
      vtDerniere: "2026-02-10",
      vtExpiration: "2027-02-10",
      revisionDerniereDate: "2026-06-20",
      revisionDerniereKm: 49000,
      revisionIntervalleKm: 15000,
      revisionIntervalleMois: 6,
    },
    {
      id: "v4",
      clientId: "c4",
      marque: "Peugeot",
      modele: "301",
      annee: 2017,
      plaque: "4421 FD 01",
      vin: "VF3LAAHXBHS124001",
      km: 96500,
      kmDate: "2026-08-20",
      vtDerniere: "2026-01-05",
      vtExpiration: "2027-01-05",
      revisionDerniereDate: "2026-02-20",
      revisionDerniereKm: 88000,
      revisionIntervalleKm: 10000,
      revisionIntervalleMois: 6,
    },
    {
      id: "v5",
      clientId: "c5",
      marque: "Kia",
      modele: "Picanto",
      annee: 2021,
      plaque: "1190 LM 01",
      vin: "KNABX512BLT550231",
      km: 34800,
      kmDate: "2026-09-29",
      vtDerniere: "2025-10-12",
      vtExpiration: "2026-10-12",
      revisionDerniereDate: "2026-05-29",
      revisionDerniereKm: 30000,
      revisionIntervalleKm: 10000,
      revisionIntervalleMois: 6,
    },
    {
      id: "v6",
      clientId: "c6",
      marque: "Mitsubishi",
      modele: "L200",
      annee: 2019,
      plaque: "6630 HB 01",
      vin: "MMBJNKA40KD123876",
      km: 71200,
      kmDate: "2026-10-14",
      vtDerniere: "2026-06-01",
      vtExpiration: "2027-06-01",
      revisionDerniereDate: "2026-09-14",
      revisionDerniereKm: 70000,
      revisionIntervalleKm: 10000,
      revisionIntervalleMois: 6,
    },
    {
      id: "v7",
      clientId: "c7",
      marque: "Renault",
      modele: "Clio",
      annee: 2016,
      plaque: "3321 XY 01",
      vin: "VF1CR0A0H12345671",
      km: 112300,
      kmDate: "2026-09-20",
      vtDerniere: "2026-05-15",
      vtExpiration: "2027-05-15",
      revisionDerniereDate: "2026-03-20",
      revisionDerniereKm: 104000,
      revisionIntervalleKm: 10000,
      revisionIntervalleMois: 6,
    },
    {
      id: "v8",
      clientId: "c8",
      marque: "Toyota",
      modele: "Hilux",
      annee: 2015,
      plaque: "7765 CD 01",
      vin: "AHTFR22G600123009",
      km: 142000,
      kmDate: "2026-10-05",
      vtDerniere: "2025-11-12",
      vtExpiration: "2026-11-12",
      revisionDerniereDate: "2026-06-05",
      revisionDerniereKm: 134000,
      revisionIntervalleKm: 10000,
      revisionIntervalleMois: 6,
    },
    {
      id: "v9",
      clientId: "c9",
      marque: "Nissan",
      modele: "Micra",
      annee: 2019,
      plaque: "2290 EF 01",
      vin: "SJNFAAK13U1234567",
      km: 64700,
      kmDate: "2026-10-11",
      vtDerniere: "2026-04-02",
      vtExpiration: "2027-04-02",
      revisionDerniereDate: "2026-04-11",
      revisionDerniereKm: 55000,
      revisionIntervalleKm: 10000,
      revisionIntervalleMois: 6,
    },
    {
      id: "v10",
      clientId: "c10",
      marque: "Suzuki",
      modele: "Swift",
      annee: 2020,
      plaque: "5543 GH 01",
      vin: "MA3FB31S002345678",
      km: 41000,
      kmDate: "2026-08-30",
      vtDerniere: "2026-01-20",
      vtExpiration: "2027-01-20",
      revisionDerniereDate: "2026-02-28",
      revisionDerniereKm: 35000,
      revisionIntervalleKm: 10000,
      revisionIntervalleMois: 6,
    },
    {
      id: "v11a",
      clientId: "c11",
      marque: "Isuzu",
      modele: "NPR (flotte)",
      annee: 2020,
      plaque: "2201 BT 01",
      vin: "JAANPR71L00000001",
      km: 98000,
      kmDate: "2026-09-28",
      vtDerniere: "2026-04-10",
      vtExpiration: "2027-04-10",
      revisionDerniereDate: "2026-06-28",
      revisionDerniereKm: 91000,
      revisionIntervalleKm: 12000,
      revisionIntervalleMois: 6,
    },
    {
      id: "v12",
      clientId: "c12",
      marque: "Honda",
      modele: "Civic",
      annee: 2021,
      plaque: "9981 JK 01",
      vin: "2HGFC2F50MH123456",
      km: 28900,
      kmDate: "2026-10-12",
      vtDerniere: "2026-06-20",
      vtExpiration: "2027-06-20",
      revisionDerniereDate: "2026-08-12",
      revisionDerniereKm: 26000,
      revisionIntervalleKm: 10000,
      revisionIntervalleMois: 6,
    },
    {
      id: "v13",
      clientId: "c13",
      marque: "Ford",
      modele: "Ranger",
      annee: 2018,
      plaque: "4432 LM 01",
      vin: "MNBLMDE50JW123098",
      km: 103400,
      kmDate: "2026-07-30",
      vtDerniere: "2025-09-28",
      vtExpiration: "2026-09-28",
      revisionDerniereDate: "2026-01-30",
      revisionDerniereKm: 95000,
      revisionIntervalleKm: 10000,
      revisionIntervalleMois: 6,
    },
    {
      id: "v14",
      clientId: "c14",
      marque: "Toyota",
      modele: "Yaris",
      annee: 2017,
      plaque: "1122 NO 01",
      vin: "VNKKD3D30GA123087",
      km: 76100,
      kmDate: "2026-09-10",
      vtDerniere: "2026-02-14",
      vtExpiration: "2027-02-14",
      revisionDerniereDate: "2026-05-10",
      revisionDerniereKm: 68000,
      revisionIntervalleKm: 10000,
      revisionIntervalleMois: 6,
    },
  ];

  vehicles.forEach(function (v) {
    v.vtJoursRestants = daysBetween(v.vtExpiration);
    v.vtStatut =
      v.vtJoursRestants < 0
        ? "expire"
        : v.vtJoursRestants <= 7
          ? "urgent"
          : v.vtJoursRestants <= 30
            ? "bientot"
            : "ok";
    var nextKm = v.revisionDerniereKm + v.revisionIntervalleKm;
    var kmRestants = nextKm - v.km;
    var nextDate = addDays(
      new Date(v.revisionDerniereDate + "T00:00:00"),
      v.revisionIntervalleMois * 30,
    );
    v.revisionProchaineKm = nextKm;
    v.revisionProchaineDateEstimee = fmtISO(nextDate);
    v.revisionKmRestants = kmRestants;
    v.revisionJoursRestants = daysBetween(v.revisionProchaineDateEstimee);
    v.revisionStatut =
      kmRestants <= 0 || v.revisionJoursRestants < 0
        ? "du"
        : kmRestants <= 1500 || v.revisionJoursRestants <= 20
          ? "bientot"
          : "ok";
    v.revisionProgress = Math.min(
      100,
      Math.max(0, Math.round(((v.km - v.revisionDerniereKm) / v.revisionIntervalleKm) * 100)),
    );
  });

  var invoices = [
    {
      id: "f1",
      numero: "F-2026-0412",
      clientId: "c4",
      vehicleId: "v4",
      date: "2026-09-20",
      montant: 185000,
      paye: 0,
      echeance: "2026-10-06",
      statut: "En retard",
      mode: null,
      note: "",
    },
    {
      id: "f2",
      numero: "F-2026-0388",
      clientId: "c3",
      vehicleId: "v3a",
      date: "2026-08-20",
      montant: 1240000,
      paye: 0,
      echeance: "2026-09-10",
      statut: "En retard",
      mode: null,
      note: "Flotte — facturation mensuelle entretien",
    },
    {
      id: "f3",
      numero: "F-2026-0401",
      clientId: "c10",
      vehicleId: "v10",
      date: "2026-08-28",
      montant: 95000,
      paye: 0,
      echeance: "2026-09-03",
      statut: "En retard",
      mode: null,
      note: "",
    },
    {
      id: "f4",
      numero: "F-2026-0450",
      clientId: "c11",
      vehicleId: "v11a",
      date: "2026-10-02",
      montant: 620000,
      paye: 0,
      echeance: "2026-10-13",
      statut: "En retard",
      mode: null,
      note: "",
    },
    {
      id: "f5",
      numero: "F-2026-0399",
      clientId: "c7",
      vehicleId: "v7",
      date: "2026-10-11",
      montant: 45000,
      paye: 0,
      echeance: "2026-10-18",
      statut: "À échéance",
      mode: null,
      note: "",
    },
    {
      id: "f6",
      numero: "F-2026-0375",
      clientId: "c13",
      vehicleId: "v13",
      date: "2026-08-15",
      montant: 310000,
      paye: 0,
      echeance: "2026-09-15",
      statut: "Relancée",
      mode: null,
      note: "Cliente ne répond plus — à surveiller",
    },
    {
      id: "f7",
      numero: "F-2026-0420",
      clientId: "c12",
      vehicleId: "v12",
      date: "2026-09-30",
      montant: 120000,
      paye: 0,
      echeance: "2026-10-10",
      statut: "Relancée",
      mode: null,
      note: "",
    },
    {
      id: "f8",
      numero: "F-2026-0430",
      clientId: "c14",
      vehicleId: "v14",
      date: "2026-09-25",
      montant: 180000,
      paye: 100000,
      echeance: "2026-10-16",
      statut: "Payée partiellement",
      mode: "Wave",
      note: "",
    },
    {
      id: "f9",
      numero: "F-2026-0440",
      clientId: "c9",
      vehicleId: "v9",
      date: "2026-10-05",
      montant: 55000,
      paye: 0,
      echeance: "2026-10-19",
      statut: "Promesse de paiement",
      mode: null,
      note: "A promis de payer le 20/10/2026",
    },
    {
      id: "f10",
      numero: "F-2026-0460",
      clientId: "c8",
      vehicleId: "v8",
      date: "2026-09-10",
      montant: 40000,
      paye: 40000,
      echeance: "2026-09-24",
      statut: "Payée",
      mode: "Espèces",
      note: "",
    },
    {
      id: "f11",
      numero: "F-2026-0392",
      clientId: "c2",
      vehicleId: "v2",
      date: "2026-08-05",
      montant: 60000,
      paye: 0,
      echeance: "2026-08-20",
      statut: "Litige/ne plus relancer",
      mode: null,
      note: "Désaccord sur le montant de la main d\u2019œuvre",
    },
    {
      id: "f12",
      numero: "F-2026-0455",
      clientId: "c6",
      vehicleId: "v6",
      date: "2026-09-14",
      montant: 72000,
      paye: 72000,
      echeance: "2026-09-28",
      statut: "Payée",
      mode: "Orange Money",
      note: "",
    },
  ];
  invoices.forEach(function (inv) {
    inv.resteDue = inv.montant - inv.paye;
    inv.retardJours = Math.max(0, -daysBetween(inv.echeance));
  });

  // Relances du jour — 23 au total (VT:8, Révision:7, Créance:8)
  var reminders = [
    {
      id: "r1",
      type: "vt",
      clientId: "c1",
      vehicleId: "v1",
      palier: "1er rappel",
      canal: "whatsapp",
      statut: "attente",
    },
    {
      id: "r2",
      type: "vt",
      clientId: "c5",
      vehicleId: "v5",
      palier: "Alerte gérant",
      canal: "whatsapp",
      statut: "attente",
    },
    {
      id: "r3",
      type: "vt",
      clientId: "c8",
      vehicleId: "v8",
      palier: "1er rappel",
      canal: "sms",
      statut: "attente",
    },
    {
      id: "r4",
      type: "vt",
      clientId: "c13",
      vehicleId: "v13",
      palier: "Alerte gérant",
      canal: "whatsapp",
      statut: "attente",
    },
    {
      id: "r5",
      type: "vt",
      clientId: "c11",
      vehicleId: "v11a",
      palier: "2e rappel",
      canal: "email",
      statut: "attente",
    },
    {
      id: "r6",
      type: "vt",
      clientId: "c6",
      vehicleId: "v6",
      palier: "1er rappel",
      canal: "whatsapp",
      statut: "attente",
    },
    {
      id: "r7",
      type: "vt",
      clientId: "c12",
      vehicleId: "v12",
      palier: "1er rappel",
      canal: "whatsapp",
      statut: "attente",
    },
    {
      id: "r8",
      type: "vt",
      clientId: "c14",
      vehicleId: "v14",
      palier: "2e rappel",
      canal: "sms",
      statut: "attente",
    },
    {
      id: "r9",
      type: "revision",
      clientId: "c2",
      vehicleId: "v2",
      palier: "1er rappel",
      canal: "whatsapp",
      statut: "attente",
    },
    {
      id: "r10",
      type: "revision",
      clientId: "c9",
      vehicleId: "v9",
      palier: "1er rappel",
      canal: "whatsapp",
      statut: "attente",
    },
    {
      id: "r11",
      type: "revision",
      clientId: "c7",
      vehicleId: "v7",
      palier: "2e rappel",
      canal: "sms",
      statut: "attente",
    },
    {
      id: "r12",
      type: "revision",
      clientId: "c3",
      vehicleId: "v3b",
      palier: "1er rappel",
      canal: "email",
      statut: "attente",
    },
    {
      id: "r13",
      type: "revision",
      clientId: "c10",
      vehicleId: "v10",
      palier: "1er rappel",
      canal: "whatsapp",
      statut: "attente",
    },
    {
      id: "r14",
      type: "revision",
      clientId: "c4",
      vehicleId: "v4",
      palier: "2e rappel",
      canal: "sms",
      statut: "attente",
    },
    {
      id: "r15",
      type: "revision",
      clientId: "c1",
      vehicleId: "v1",
      palier: "1er rappel",
      canal: "whatsapp",
      statut: "attente",
    },
    {
      id: "r16",
      type: "creance",
      clientId: "c4",
      invoiceId: "f1",
      palier: "Relance ferme",
      canal: "sms",
      statut: "attente",
    },
    {
      id: "r17",
      type: "creance",
      clientId: "c3",
      invoiceId: "f2",
      palier: "Alerte gérant",
      canal: "email",
      statut: "attente",
    },
    {
      id: "r18",
      type: "creance",
      clientId: "c10",
      invoiceId: "f3",
      palier: "Relance ferme",
      canal: "whatsapp",
      statut: "attente",
    },
    {
      id: "r19",
      type: "creance",
      clientId: "c11",
      invoiceId: "f4",
      palier: "2e rappel",
      canal: "email",
      statut: "attente",
    },
    {
      id: "r20",
      type: "creance",
      clientId: "c7",
      invoiceId: "f5",
      palier: "1er rappel",
      canal: "whatsapp",
      statut: "attente",
    },
    {
      id: "r21",
      type: "creance",
      clientId: "c13",
      invoiceId: "f6",
      palier: "Alerte gérant",
      canal: "whatsapp",
      statut: "attente",
    },
    {
      id: "r22",
      type: "creance",
      clientId: "c12",
      invoiceId: "f7",
      palier: "2e rappel",
      canal: "whatsapp",
      statut: "attente",
    },
    {
      id: "r23",
      type: "creance",
      clientId: "c9",
      invoiceId: "f9",
      palier: "1er rappel",
      canal: "whatsapp",
      statut: "attente",
    },
  ];

  var messagesByType = {
    vt: function (c, v) {
      return (
        "Bonjour " +
        c.nom.split(" ")[0] +
        ", la visite technique de votre " +
        v.marque +
        " " +
        v.modele +
        " (" +
        v.plaque +
        ") " +
        (v.vtJoursRestants < 0
          ? "a expiré le " + fmtFR(v.vtExpiration)
          : "expire le " + fmtFR(v.vtExpiration)) +
        ". Merci de la renouveler rapidement. — " +
        garage.nom
      );
    },
    revision: function (c, v) {
      return (
        "Bonjour " +
        c.nom.split(" ")[0] +
        ", votre " +
        v.marque +
        " " +
        v.modele +
        " (" +
        v.plaque +
        ") approche de sa prochaine révision (" +
        v.revisionKmRestants +
        " km restants environ). Prenez rendez-vous quand vous voulez. — " +
        garage.nom
      );
    },
    creance: function (c, inv) {
      return (
        "Bonjour " +
        c.nom.split(" ")[0] +
        ", votre facture " +
        inv.numero +
        " de " +
        fcfa(inv.resteDue) +
        " est en retard de " +
        inv.retardJours +
        " jours. Merci de régulariser dès que possible. — " +
        garage.nom
      );
    },
  };

  reminders.forEach(function (r) {
    var c = clients.filter(function (x) {
      return x.id === r.clientId;
    })[0];
    var v = r.vehicleId
      ? vehicles.filter(function (x) {
          return x.id === r.vehicleId;
        })[0]
      : null;
    var inv = r.invoiceId
      ? invoices.filter(function (x) {
          return x.id === r.invoiceId;
        })[0]
      : null;
    r.client = c;
    r.vehicle = v;
    r.invoice = inv;
    if (r.type === "vt")
      r.motif =
        "VT " +
        (v.vtJoursRestants < 0
          ? "expirée depuis " + Math.abs(v.vtJoursRestants) + " j"
          : "expire le " + fmtFR(v.vtExpiration) + " (J-" + v.vtJoursRestants + ")");
    if (r.type === "revision")
      r.motif =
        "Révision due — environ " + Math.max(0, r.vehicle.revisionKmRestants) + " km restants";
    if (r.type === "creance")
      r.motif =
        "Facture " +
        inv.numero +
        " — " +
        fcfa(inv.resteDue) +
        ", retard " +
        inv.retardJours +
        " jours";
    r.message =
      r.type === "vt"
        ? messagesByType.vt(c, v)
        : r.type === "revision"
          ? messagesByType.revision(c, v)
          : messagesByType.creance(c, inv);
  });

  var history = [
    {
      id: "h1",
      datetime: "2026-10-17T09:02:00",
      clientId: "c6",
      type: "vt",
      canal: "whatsapp",
      palier: "1er rappel",
      statut: "Lu",
      cout: 0,
    },
    {
      id: "h2",
      datetime: "2026-10-17T09:02:00",
      clientId: "c9",
      type: "revision",
      canal: "whatsapp",
      palier: "1er rappel",
      statut: "Délivré",
      cout: 0,
    },
    {
      id: "h3",
      datetime: "2026-10-17T09:03:00",
      clientId: "c5",
      type: "vt",
      canal: "whatsapp",
      palier: "2e rappel",
      statut: "Échec",
      cout: 0,
      raisonEchec: "Numéro WhatsApp invalide / non enregistré",
    },
    {
      id: "h4",
      datetime: "2026-10-16T14:20:00",
      clientId: "c4",
      type: "creance",
      canal: "sms",
      palier: "1er rappel",
      statut: "Envoyé",
      cout: 15,
    },
    {
      id: "h5",
      datetime: "2026-10-16T09:00:00",
      clientId: "c13",
      type: "creance",
      canal: "whatsapp",
      palier: "Alerte gérant",
      statut: "Échec",
      cout: 0,
      raisonEchec: "Client non abonné WhatsApp Business",
    },
    {
      id: "h6",
      datetime: "2026-10-15T09:00:00",
      clientId: "c8",
      type: "vt",
      canal: "sms",
      palier: "1er rappel",
      statut: "Délivré",
      cout: 15,
    },
    {
      id: "h7",
      datetime: "2026-10-15T09:00:00",
      clientId: "c14",
      type: "vt",
      canal: "sms",
      palier: "2e rappel",
      statut: "Lu",
      cout: 15,
    },
    {
      id: "h8",
      datetime: "2026-10-14T16:40:00",
      clientId: "c3",
      type: "creance",
      canal: "email",
      palier: "Alerte gérant",
      statut: "Répondu",
      cout: 0,
    },
    {
      id: "h9",
      datetime: "2026-10-14T09:00:00",
      clientId: "c2",
      type: "revision",
      canal: "whatsapp",
      palier: "1er rappel",
      statut: "Lu",
      cout: 0,
    },
    {
      id: "h10",
      datetime: "2026-10-13T09:00:00",
      clientId: "c12",
      type: "creance",
      canal: "whatsapp",
      palier: "2e rappel",
      statut: "Délivré",
      cout: 0,
    },
    {
      id: "h11",
      datetime: "2026-10-12T09:00:00",
      clientId: "c7",
      type: "revision",
      canal: "sms",
      palier: "2e rappel",
      statut: "Envoyé",
      cout: 15,
    },
    {
      id: "h12",
      datetime: "2026-10-11T09:00:00",
      clientId: "c10",
      type: "creance",
      canal: "whatsapp",
      palier: "Relance ferme",
      statut: "Lu",
      cout: 0,
    },
  ];

  var templates = [
    {
      id: "t1",
      type: "vt",
      palier: "1er rappel",
      canal: "whatsapp",
      corps:
        "Bonjour {client}, la visite technique de votre {vehicule} ({plaque}) expire le {date_expiration}. Pensez à la renouveler. — {garage}",
      approuveMeta: "oui",
    },
    {
      id: "t2",
      type: "vt",
      palier: "2e rappel",
      canal: "whatsapp",
      corps:
        "Rappel : la VT de votre {vehicule} ({plaque}) expire le {date_expiration}. Contactez-nous au {telephone_garage} pour planifier. — {garage}",
      approuveMeta: "oui",
    },
    {
      id: "t3",
      type: "vt",
      palier: "Alerte gérant",
      canal: "whatsapp",
      corps:
        "{client}, la VT de votre {vehicule} ({plaque}) est expirée depuis plusieurs jours. Merci de régulariser rapidement. — {garage}",
      approuveMeta: "en_attente",
    },
    {
      id: "t4",
      type: "vt",
      palier: "1er rappel",
      canal: "sms",
      corps:
        "VT de votre vehicule {plaque} expire le {date_expiration}. {garage} {telephone_garage}",
      approuveMeta: "oui",
    },
    {
      id: "t5",
      type: "revision",
      palier: "1er rappel",
      canal: "whatsapp",
      corps:
        "Bonjour {client}, votre {vehicule} approche de sa prochaine révision. Prenez rendez-vous au {telephone_garage}. — {garage}",
      approuveMeta: "oui",
    },
    {
      id: "t6",
      type: "revision",
      palier: "2e rappel",
      canal: "sms",
      corps: "Révision bientôt due pour {plaque}. Appelez {telephone_garage}. — {garage}",
      approuveMeta: "oui",
    },
    {
      id: "t7",
      type: "creance",
      palier: "1er rappel",
      canal: "whatsapp",
      corps:
        "Bonjour {client}, la facture {facture} de {montant} arrive à échéance. Merci de régler. — {garage}",
      approuveMeta: "oui",
    },
    {
      id: "t8",
      type: "creance",
      palier: "2e rappel",
      canal: "sms",
      corps: "Facture {facture} ({montant}) en retard. Merci de régulariser. {garage}",
      approuveMeta: "oui",
    },
    {
      id: "t9",
      type: "creance",
      palier: "Relance ferme",
      canal: "whatsapp",
      corps:
        "{client}, votre facture {facture} de {montant} est en retard important. Merci de contacter {telephone_garage} rapidement. Payer: {lien_paiement}",
      approuveMeta: "en_attente",
    },
    {
      id: "t10",
      type: "creance",
      palier: "Alerte gérant",
      canal: "email",
      objet: "Facture {facture} toujours impayée",
      corps:
        "Bonjour {client},\n\nVotre facture {facture} d\u2019un montant de {montant} reste impayée.\n\nMerci de nous contacter au {telephone_garage}.\n\nCordialement,\n{garage}",
      approuveMeta: "refuse",
    },
  ];

  var importsHistory = [
    {
      id: "imp1",
      date: "2026-10-15T08:12:00",
      fichier: "clients_octobre.xlsx",
      nbLignes: 142,
      nbOk: 138,
      nbErreurs: 4,
      utilisateur: "Aya Kouamé",
    },
    {
      id: "imp2",
      date: "2026-09-02T10:05:00",
      fichier: "export_logiciel_garage.csv",
      nbLignes: 310,
      nbOk: 310,
      nbErreurs: 0,
      utilisateur: "Brou Désiré",
    },
  ];

  var settings = {
    garage: garage,
    regles: {
      vt: [-30, -7, 0],
      revisionRappelsKm: [1000, 0],
      revisionRappelsMois: [1, 0],
      creance: [3, 15, 30, 45],
      autoVt: true,
      autoRevision: true,
      autoCreance: false,
      heureEnvoi: "09:00",
      joursExclus: ["dimanche"],
      canalPrioritaire: "whatsapp",
      canalRepli: "sms",
    },
    canaux: {
      whatsapp: { statut: "connecte", numero: "+225 07 08 12 34 56" },
      sms: { statut: "connecte", solde: "2 450 crédits" },
      email: { statut: "connecte", expediteur: "contact@excellence-auto.ci" },
    },
    paiementMobile: {
      wave: "https://pay.wave.com/garage-excellence",
      orangeMoney: "#145900223",
      mtn: "",
      moov: "",
    },
    utilisateurs: users,
    notifGerant: { whatsapp: true, email: false, heureResume: "08:00" },
  };

  var dashboard = {
    relancesATraiter: 23,
    creancesEnCours: 4850000,
    creancesRetard30: 1920000,
    vtExpirant30: 41,
    revisionsDues: 37,
    resultats30j: {
      envoyes: 612,
      delivres: 589,
      lus: 471,
      clientsRevenus: 18,
      montantRecupere: 2300000,
      parSemaine: [
        { semaine: "S38", whatsapp: 88, sms: 34, email: 12 },
        { semaine: "S39", whatsapp: 102, sms: 28, email: 15 },
        { semaine: "S40", whatsapp: 95, sms: 40, email: 10 },
        { semaine: "S41", whatsapp: 118, sms: 36, email: 18 },
      ],
    },
    alertes: [
      {
        id: "al1",
        niveau: "bad",
        texte: "3 envois WhatsApp ont échoué aujourd\u2019hui",
        lien: "historique",
      },
      {
        id: "al2",
        niveau: "warn",
        texte: "Dernier import de données il y a 3 jours",
        lien: "import",
      },
      {
        id: "al3",
        niveau: "warn",
        texte: "Crédit SMS faible (2 450 restants)",
        lien: "parametres",
      },
    ],
  };

  function byId(arr, id) {
    var m = {};
    arr.forEach(function (x) {
      m[x.id] = x;
    });
    return m[id];
  }

  window.AR_TODAY = TODAY;
  window.AR_HELPERS = { addDays, fmtISO, daysBetween, fmtFR, fcfa, byId };
  window.AR_DATA = {
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
    dashboard,
  };
})();
