# M09 — Créances et recouvrement

> Priorité : **P0** · Dépend de : M01, M02, M04, M08, M10, M11, M13, M15 (M17 en option) · Rôles concernés : OWNER, ACCOUNTANT, CASHIER, MANAGER, ADVISOR

## 1. Objectif

Donner au garage une vue exacte de **qui doit quoi, depuis quand**, et transformer le recouvrement en processus : un **dossier par client** en retard, une séquence de relances graduées exécutée par M10, des promesses de paiement suivies, des litiges qui suspendent les relances, un plafond de crédit qui empêche de creuser la dette, et une mesure claire de l'argent récupéré grâce aux relances. Cible du client pilote : **−40 % de créances > 30 jours en 6 mois**.
Le module ne crée ni facture ni paiement (M08) : il lit les soldes, organise l'action et décide quand relancer, pauser, escalader ou passer en perte.

## 2. Utilisateurs et cas d'usage

| Rôle | Ce qu'il fait | Fréquence |
|---|---|---|
| OWNER | Regarde le tableau de bord recouvrement, valide les relances fermes et mises en demeure, fixe les plafonds, passe en perte | Quotidienne (téléphone) |
| ACCOUNTANT | Suit la balance âgée, appelle les clients, note promesses et litiges, envoie les relevés | Quotidienne |
| CASHIER | Enregistre les paiements (M08) qui ferment les dossiers ; voit l'alerte de retard au comptoir | À chaque encaissement |
| ADVISOR | Reçoit l'alerte « client en retard » à l'ouverture d'un OR ; demande une dérogation | À chaque OR |
| MANAGER | Accorde les dérogations de crédit ponctuelles | Hebdomadaire |

## 3. User stories

**US-M09-01 — En tant qu'OWNER, je veux une balance âgée afin de savoir en 10 secondes combien d'argent est dehors et depuis quand.**
- Étant donné 4 850 000 FCFA de soldes ouverts au 18/10/2026, quand j'ouvre `/creances`, alors je vois : total dû 4 850 000, non échu 1 200 000, 0-30 j 1 730 000, 31-60 j 1 420 000, 61-90 j 300 000, +90 j 200 000 (RG-M09-02), avec la somme des tranches égale au total, et « récupéré ce mois : 2 300 000 FCFA ».
- Quand je touche la barre « 31-60 j », alors la liste se filtre sur les clients ayant un solde dans cette tranche.

**US-M09-02 — En tant qu'ACCOUNTANT, je veux qu'un dossier de recouvrement s'ouvre automatiquement afin de ne rater aucun retard.**
- Étant donné la facture FAC-2026-000412 de M. Koné Ibrahim (185 000 FCFA, échéance 06/10/2026, non payée), quand `receivables.age` tourne le 07/10/2026 à 01:00, alors la facture passe `OVERDUE`, un `CollectionCase` `OPEN` est créé (`anchorDate = 2026-10-06`, `totalDue = 185 000`, `stage = 0`) et M10 planifiera le palier J+3 le 09/10/2026.
- Étant donné une seconde facture de M. Koné qui passe en retard le 20/10, alors elle rejoint **le même dossier** (pas de second dossier ni de nouvelle séquence) et `totalDue` passe à 412 000 FCFA.

**US-M09-03 — En tant qu'ACCOUNTANT, je veux noter une promesse de paiement afin que les relances s'adaptent.**
- Étant donné le dossier SOTRA Logistique SARL (1 240 000 FCFA, 38 j de retard), quand je saisis « Promesse : 600 000 FCFA le 25/10/2026, par téléphone », alors une `PaymentPromise` `PENDING` est créée, le dossier passe `PROMISED`, les relances non envoyées sont annulées et `nextActionAt = 2026-10-26T09:00`.
- Quand un virement de 600 000 FCFA est enregistré le 24/10, alors la promesse passe `KEPT`, le dossier revient `OPEN` avec `totalDue = 640 000`, et la séquence reprend au palier suivant (pas avant `minGapDays`).
- Quand rien n'arrive au 25/10 23:59, alors le 26/10 à 01:00 la promesse passe `BROKEN`, le dossier revient `OPEN`, `brokenPromiseCount = 1`, et une relance `PROMISE_BROKEN` est planifiée le 26/10 à 10:00 (en validation si client `COMPANY` ou montant > 500 000 FCFA).

**US-M09-04 — En tant qu'ACCOUNTANT, je veux marquer un dossier en litige afin d'arrêter les relances le temps de régler le désaccord.**
- Étant donné M. Koné qui conteste une ligne de main-d'œuvre, quand je choisis « Litige » avec motif « Conteste 2 h de MO sur FAC-2026-000412 » et la facture concernée, alors le dossier passe `DISPUTED`, la facture passe `DISPUTED`, toutes ses relances sont annulées, et une tâche est assignée au MANAGER avec échéance à 7 jours.
- Les autres factures non contestées du client restent relançables si le montant non contesté ≥ `minAmount` (RG-M09-09).

**US-M09-05 — En tant que conseiller, je veux être alerté à l'ouverture d'un OR pour un client en retard afin de ne pas accumuler de nouvelles dettes.**
- Étant donné SOTRA Logistique (plafond 1 000 000, solde dû 1 240 000, retard 38 j), quand je crée un OR pour leur Hilux `3315 KL 01`, alors une alerte rouge bloque l'enregistrement : « Plafond de crédit dépassé : 1 240 000 FCFA dus (plafond 1 000 000). Paiement comptant exigé ou dérogation d'un responsable. » avec boutons « Demander une dérogation » et « Continuer en paiement comptant ».
- Étant donné M. Koné (pas de plafond, 185 000 FCFA, 12 j de retard), alors l'alerte est orange et non bloquante : « Ce client a 185 000 FCFA impayés depuis 12 jours. Pensez à en parler à l'accueil. »

**US-M09-06 — En tant qu'OWNER, je veux passer une créance en perte afin d'assainir les comptes.**
- Étant donné une facture de 45 000 FCFA à 210 jours de retard, client injoignable, quand je choisis « Passer en perte » avec motif obligatoire, alors (permission `receivable:writeoff`) la facture passe `WRITTEN_OFF`, `writtenOffAmount = 45 000`, un `AuditLog` est écrit, le dossier se ferme `CLOSED_WRITTEN_OFF` si plus rien n'est dû, et le montant sort de la balance âgée mais apparaît dans le rapport « Pertes ».

**US-M09-07 — En tant qu'ACCOUNTANT, je veux envoyer un relevé de compte PDF afin que le client voie exactement ce qu'il doit.**
- Quand je clique « Relevé de compte » sur SOTRA Logistique pour la période 01/01/2026-18/10/2026, alors un PDF est généré (RG-M09-15), consultable via un lien portail sécurisé, et envoyable par WhatsApp/email en un clic (M11).

**US-M09-08 — En tant qu'ACCOUNTANT, je veux tracer un appel téléphonique afin que l'équipe sache où en est le dossier.**
- Quand je clique « Appeler » sur le dossier de M. Koné, alors le téléphone compose `+2250152770943` et, au retour sur l'écran, un formulaire « Résultat de l'appel » s'ouvre : Joint / Pas de réponse / Numéro erroné / Rappeler plus tard ; note ; promesse éventuelle. Une `CollectionNote` `type = call` est créée avec `callOutcome`.
- Si « Pas de réponse » 3 fois de suite, alors le dossier affiche le badge « Injoignable » et le score de risque augmente (RG-M09-12).

**US-M09-09 — En tant qu'OWNER, je veux savoir combien les relances ont rapporté.**
- Étant donné qu'en septembre 3 400 000 FCFA ont été encaissés sur des factures en retard, dont 2 300 000 dans les 7 jours suivant une relance, alors le tableau de bord affiche « Récupéré grâce aux relances : 2 300 000 FCFA (68 %) » (RG-M09-14).

## 4. Règles métier

**RG-M09-01 — Échéance et retard.** `Invoice.dueDate = issuedAt (date locale) + Customer.paymentTermsDays`. Comptant (`0`) : échéance = jour d'émission. `daysOverdue = max(0, today − dueDate)` en jours calendaires dans le fuseau de l'organisation. Une facture est **en retard** si `balance > 0`, `daysOverdue ≥ 1` et statut ∈ {`ISSUED`, `PARTIALLY_PAID`, `OVERDUE`}. Avoirs (`CREDIT_NOTE`) : soldes négatifs imputés au client, déduits du total dû et jamais relancés. Factures `billTo = INSURANCE` : hors de ce module en P0 (suivies par M16) ; seule la **franchise** (facture client) est relancée.

**RG-M09-02 — Balance âgée.** Calculée à la date `asOf` (défaut aujourd'hui) depuis `Invoice.balance` et `dueDate` :

| Tranche | Condition |
|---|---|
| Non échu | `daysOverdue = 0` |
| 0-30 j | 1 ≤ `daysOverdue` ≤ 30 |
| 31-60 j | 31 – 60 |
| 61-90 j | 61 – 90 |
| +90 j | > 90 |

Une facture tombe dans une seule tranche selon **sa propre** échéance (pas celle du client). Les paiements non affectés (`Payment.unallocated`) et avoirs non imputés apparaissent sur une ligne « Crédits non affectés » en négatif. Exemple SOTRA : FAC-…0350 640 000 (52 j) → 31-60 ; FAC-…0388 400 000 (38 j) → 31-60 ; FAC-…0447 200 000 (5 j) → 0-30 ; total 1 240 000. Filtres : site, type de client, conseiller, assigné. Export Excel.

**RG-M09-03 — Ouverture et vie du dossier.** Un seul dossier **actif** (statut ≠ `CLOSED_*`) par client. Créé par `receivables.age` dès qu'une facture du client entre en retard et que `soldeEnRetard ≥ settings.collections.minAmount` (défaut 2 000 FCFA). `anchorDate` = plus ancienne échéance en retard **à l'ouverture**, figée (elle détermine la séquence M10 ; `sequenceKey = RECEIVABLE:{caseId}:{anchorDate}`). Une nouvelle facture en retard rejoint le dossier sans réinitialiser la séquence. Mis à jour à chaque paiement, avoir, nouvelle facture et chaque nuit : `totalDue` (somme des soldes ouverts, échus ou non), `overdueDue` (échus), `oldestDueDate`, `stage` (dernier palier M10 envoyé : 1 = J+3, 2 = J+15, 3 = J+30, 4 = J+45, 5 = J+60).
Fermeture : `overdueDue = 0` → `CLOSED_PAID` ; tout le reste passé en perte → `CLOSED_WRITTEN_OFF`. Si le client retombe en retard après fermeture, **nouveau dossier** (nouvelle séquence, retour au ton courtois) sauf si la fermeture date de moins de 30 jours : le dossier fermé est **rouvert** au palier atteint (évite qu'un client paie 10 000 FCFA pour remettre la séquence à zéro).

**RG-M09-04 — Séquence graduée** (exécutée par M10, règle « Créances », ancre `anchorDate`) :

| Palier | Offset | Ton particulier / entreprise | Mode | Effet M09 |
|---|---|---|---|---|
| 1 `J+3` | +3 | Courtois : « sauf erreur… » / information au service comptable | Auto | `stage = 1` |
| 2 `J+15` | +15 | Rappel, demande de date / 2e rappel avec n° et jours de retard | Auto | `stage = 2` |
| 3 `J+30` | +30 | Ferme : régulariser sous 7 j / suspension du crédit | Validation (ACCOUNTANT/OWNER) | `stage = 3` ; client `creditHold = true` (RG-M09-10) |
| 4 `J+45` | +45 | Interne : alerte gérant | — | `status = ESCALATED`, notification OWNER, ligne dans le résumé quotidien |
| 5 `J+60` | +60 | Mise en demeure PDF | Validation OWNER (`receivable:formal_notice`) | PDF RG-M09-16 joint, `formalNoticeAt` |

Ton : modèles `{key}` pour `INDIVIDUAL`, `{key}_pro` pour `COMPANY` (M10 annexe A.3). Destinataires entreprise : contacts `receivesInvoices` ; à défaut, contact principal. Après J+60 : aucune relance automatique ; le dossier reste dans « À traiter » (appel, visite, passage en perte, procédure externe). Le garage peut désactiver J+60 s'il ne pratique pas la mise en demeure.

**RG-M09-05 — Avant échéance (entreprises).** Option `cr_avant_echeance_pro` (J-3 avant `dueDate`, inactive par défaut) : par facture, pas par dossier.

**RG-M09-06 — Promesse de paiement.**
- Saisie : montant (défaut `overdueDue`, entier ≥ 1 000 FCFA), date (≥ aujourd'hui, ≤ aujourd'hui + 60 j ; au-delà, saisir un échéancier = plusieurs promesses), canal (`phone`, `whatsapp`, `in_person`, `email`).
- Plusieurs promesses = **échéancier** ; les relances restent suspendues jusqu'au lendemain de la dernière échéance non tenue.
- Effets : dossier `PROMISED`, `CollectionCase.pausedUntil = promisedDate + graceDays` (défaut `graceDays = 0`), annulation des relances non envoyées (`collection.promised`), `ReminderOutcome = PROMISED` sur la dernière relance envoyée dans la fenêtre d'attribution. Option `cr_promesse_j0` (rappel le matin du jour promis).
- Évaluation (job `collections.promises`, 01:00) pour chaque promesse `PENDING` dont `promisedDate + graceDays < today` : `paid = Σ allocations sur les factures du dossier entre createdAt de la promesse et la fin de promisedDate + graceDays` ; `paid ≥ amount` → `KEPT` ; `0 < paid < amount` → `PARTIALLY_KEPT` (traité comme rompue pour le reste) ; `paid = 0` → `BROKEN`. Un paiement arrivé avant l'évaluation rend la promesse `KEPT` immédiatement (événement `payment.received`).
- Promesse rompue : dossier `OPEN`, `brokenPromiseCount++`, relance `PROMISE_BROKEN` le lendemain dans la fenêtre d'envoi (`dedupeKey = …:PROMISE_BROKEN:{promiseId}`), puis la séquence reprend au palier suivant le dernier envoyé (minimum `minGapDays` après). 2 promesses rompues → `creditHold = true` et validation obligatoire pour toutes les relances suivantes de ce dossier (ton à ajuster par un humain).
- Exemple : promesse 600 000 le 25/10 ; Wave 400 000 le 25/10 → `PARTIALLY_KEPT` ; relance du 26/10 : « Merci pour votre paiement de 400 000 FCFA. Il reste 840 000 FCFA dus… ».

**RG-M09-07 — Pause manuelle.** « Mettre en pause jusqu'au… » (≤ 30 jours, motif obligatoire : « Client hospitalisé », « Attente bon de commande ») → `PAUSED`, `pausedUntil` ; reprise automatique le jour venu par `receivables.age` au palier suivant.

**RG-M09-08 — Litige.** Ouverture : motif, factures concernées (≥ 1), montant contesté (défaut : solde des factures). Effets : dossier `DISPUTED`, factures `DISPUTED`, relances annulées, `ReminderSuppression` sur la séquence, tâche/notification au MANAGER, `disputeOpenedAt`. Le litige n'est **jamais** clos automatiquement ; issues : « Résolu — client paie » (retour `OPEN`, séquence reprise au palier suivant **mais pas avant 7 j**), « Résolu — avoir » (M08 crée l'avoir, le solde est recalculé), « Résolu — passage en perte ». Un litige ouvert depuis 30 j génère une alerte quotidienne au MANAGER. Un client qui écrit « je conteste » (intention M17 `DISPUTE`) ne passe pas en litige automatiquement : le dossier est **pausé 72 h** et l'ACCOUNTANT reçoit une notification « Contestation possible ».

**RG-M09-09 — Montant relançable.** `relançable = overdueDue − Σ soldes des factures DISPUTED − crédits non affectés`. Si `relançable < minAmount`, aucune relance client (le dossier reste visible).

**RG-M09-10 — Plafond de crédit et blocage.** Évaluation `creditCheck(customer)` à l'ouverture d'un OR (M04), à la création d'un devis (M05, informatif) et à l'émission d'une facture à crédit (M08) :

| Niveau | Condition | Comportement |
|---|---|---|
| `OK` | rien en retard, sous plafond | Aucun message |
| `WARN` (orange) | `overdueDue > 0` et `maxDaysOverdue ≤ 30`, ou exposition ≥ 80 % du plafond | Bandeau non bloquant |
| `BLOCK` (rouge) | `creditHold = true`, ou exposition > plafond, ou `maxDaysOverdue > settings.collections.blockAfterDays` (défaut 60), ou dossier `ESCALATED` | OR possible seulement : (a) en « paiement comptant à la livraison » (OR marqué `cashOnly`, M08 refuse la facture à crédit) ; ou (b) avec dérogation |

`exposition = totalDue (y c. non échu) + montant estimé de l'OR en cours`. Exemple : SOTRA plafond 1 000 000, dû 1 240 000 → `BLOCK`. Dérogation : `receivable:credit_override` (OWNER, MANAGER), motif obligatoire, valable pour **cet OR uniquement**, `AuditLog`. Demande de dérogation par un ADVISOR → `Notification` push à l'OWNER avec boutons Accepter/Refuser depuis le téléphone. `creditHold` est levé automatiquement à `CLOSED_PAID`, ou manuellement (permission `receivable:credit_override`).

**RG-M09-11 — Plafond par défaut.** `creditLimit = null` : pas de contrôle d'exposition (seuls retards et `creditHold` s'appliquent). Paramètre `settings.collections.defaultCreditLimitCompany` (défaut null) appliqué à la création des clients `COMPANY`.

**RG-M09-12 — Score de risque client (`Customer.riskScore`, 0-100, 100 = risque maximal).** Recalculé chaque nuit par `receivables.age` et à chaque paiement. Fonction pure `core/receivables/riskScore` :
```
A = min(maxDaysOverdue, 120) / 120 × 35                      // retard actuel
B = min(overdueDue / max(avgMonthlyBilled12m, 50 000), 2) / 2 × 20   // poids de la dette
C = min(brokenPromises12m, 3) / 3 × 15                       // promesses rompues
D = (1 − onTimeRatio12m) × 20                                // historique : part des factures (12 mois, ≥ 3 factures) soldées au plus tard à échéance + 7 j ; si < 3 factures : D = 10
E = (unreachable ? 5 : 0) + (openDispute ? 5 : 0)            // signaux
riskScore = round(A + B + C + D + E)
```
Libellés : 0-24 « Bon payeur » (vert), 25-49 « À surveiller » (orange), 50-74 « Risqué » (rouge), 75-100 « Très risqué » (rouge + icône). Exemple SOTRA : maxDaysOverdue 52 → A = 15,2 ; dette 1 240 000 / moyenne mensuelle 620 000 = 2 → B = 20 ; 1 promesse rompue → C = 5 ; onTimeRatio 0,50 → D = 10 ; E = 0 → **50 « Risqué »**. M. Traoré (aucun retard, 4 factures payées à temps) → A = B = C = D = E = 0 → **0**. Le détail des 5 composantes est affiché au survol (pas de boîte noire). M17 peut proposer un score prédictif en complément, jamais en remplacement.

**RG-M09-13 — Passage en perte.** Permission `receivable:writeoff` (OWNER par défaut) ; motif obligatoire ; uniquement factures en retard depuis ≥ `settings.collections.writeOffMinDays` (défaut 90) sauf OWNER avec confirmation renforcée (saisie du montant). Effet : `Invoice.status = WRITTEN_OFF`, `writtenOffAmount = balance`, `writtenOffAt/ById`, `balance` conservé en lecture pour l'historique mais exclu de la balance âgée ; aucune écriture de paiement ; `AuditLog` (`receivable.writeoff`) ; export comptable (M12) en « créances irrécouvrables ». Annulation possible (`receivable:writeoff`) si un paiement arrive : la facture revient `OVERDUE` puis le paiement l'affecte. Le passage en perte ne modifie **pas** la FNE.

**RG-M09-14 — Attribution des encaissements aux relances.** Un paiement affecté à une facture d'un dossier est **attribué** à la dernière relance `RECEIVABLE` (`SENT`, client destinataire) envoyée dans les `attributionDays` (défaut **7 j**) précédant `receivedAt`, ou à un appel tracé (`CollectionNote type=call`, outcome `REACHED`) dans la même fenêtre si plus récent. Sinon « spontané ». `recoveredByReminders(période) = Σ allocations attribuées à une relance` ; `recoveredByCalls` idem ; `recoveredTotal` = toutes allocations sur des factures qui étaient en retard au moment du paiement. Mise à jour de `Reminder.outcome/attributedAmount` (M10 RG-M10-27). Exemple : relance J+15 le 05/10, paiement 100 000 le 08/10 → attribué ; appel tracé le 07/10 → attribué à l'appel (plus récent).

**RG-M09-15 — Relevé de compte (PDF, `packages/pdf/statement.tsx`).** En-tête garage (logo, RCCM, NCC, adresse) ; client (nom, NCC si entreprise) ; période ; tableau chronologique : date, document (facture, avoir, paiement avec mode et référence), débit, crédit, solde cumulé ; solde d'ouverture et de clôture ; encadré « Échu » par tranche d'âge ; liste des factures ouvertes avec n° FNE ; moyens de paiement (`{{paiement.wave}}`, `{{paiement.orangeMoney}}`, RIB) et lien de paiement QR ; mention « Sauf erreur ou omission ». Accès via jeton portail (M14) valable 30 j. Nom de fichier `Releve-SOTRA-Logistique-2026-10-18.pdf`.

**RG-M09-16 — Mise en demeure (PDF).** Gabarit `formal-notice.tsx` : lieu et date (« Abidjan, le 18/10/2026 »), identité complète du créancier et du débiteur, objet « Mise en demeure de payer », liste des factures (n°, date, n° FNE, montant, reste dû), total, délai de paiement (défaut 8 jours), mention des suites possibles **paramétrables et sobres** (texte par défaut : « À défaut de règlement dans ce délai, nous nous réservons le droit d'engager toute procédure de recouvrement prévue par la loi. »), signature du gérant (image enregistrée en M15). Remise : email + WhatsApp document, et/ou impression pour remise en main propre ou par huissier (« Marquer comme remise » avec date). Le contenu est un modèle : la plateforme ne fournit pas de conseil juridique (avertissement dans l'écran de paramétrage).

**RG-M09-17 — Encaissement depuis une relance.** Tout message de relance contient `{{lien.paiement}}` (M08 crée un `PaymentLink` du montant `relançable`, expirant à 7 j, réutilisé s'il en existe un valide au même montant). Paiement reçu par webhook → `payment.received` → M08 alloue (plus ancienne facture d'abord, sauf factures en litige exclues) → M09 recalcule → M10 annule les relances devenues inutiles, M11 envoie le reçu.

**RG-M09-18 — Indicateurs du tableau de bord recouvrement.**
- `DSO` (délai moyen d'encaissement) = (créances clients fin de période / CA TTC à crédit des 90 derniers jours) × 90.
- `% > 30 j` = (31-60 + 61-90 + +90) / total échu.
- Taux de tenue des promesses = KEPT / (KEPT + PARTIALLY_KEPT + BROKEN) sur 90 j.
- Récupéré ce mois (total, par relances, par appels, spontané).
- Top 10 débiteurs (montant, retard max, score, dernier contact, prochaine action).
- Dossiers « À traiter » : `ESCALATED`, promesses rompues d'hier, litiges > 30 j, clients injoignables, mises en demeure à valider.

## 5. Machine à états

### 5.1 `CollectionCase.status`

| De → Vers | Déclencheur | Qui | Effets / événements |
|---|---|---|---|
| ∅ → `OPEN` | `receivables.age` (facture en retard ≥ minAmount) | Système | `collection.opened` ; M10 planifie |
| `OPEN` → `PROMISED` | `collections.addPromise` | `receivable:collect` | `collection.promised` |
| `PROMISED` → `OPEN` | promesse KEPT avec solde restant, BROKEN, PARTIALLY_KEPT | Système | `collection.promise_kept` / `collection.promise_broken` |
| `OPEN`/`PROMISED`/`ESCALATED` → `PAUSED` | `collections.pause` ou intention « conteste » (72 h) | `receivable:collect` / Système | `collection.paused` |
| `PAUSED` → statut précédent | `pausedUntil` atteint ou `collections.resume` | Système / utilisateur | `collection.resumed` |
| * actif → `DISPUTED` | `collections.openDispute` | `receivable:collect` | `collection.disputed` ; factures `DISPUTED` |
| `DISPUTED` → `OPEN` | `collections.resolveDispute` | `receivable:dispute_resolve` | `collection.dispute_resolved` |
| `OPEN`/`PROMISED` → `ESCALATED` | palier J+45 (M10) ou `collections.escalate` | Système / OWNER | `collection.escalated` ; notification OWNER |
| * actif → `CLOSED_PAID` | `overdueDue = 0` | Système | `collection.closed` ; `creditHold` levé |
| * actif → `CLOSED_WRITTEN_OFF` | dernier solde passé en perte | `receivable:writeoff` | `collection.closed` |
| `CLOSED_*` → `OPEN` | nouveau retard < 30 j après fermeture | Système | `collection.reopened` |

Le statut `ESCALATED` est conservé pendant `PROMISED`/`PAUSED` via `escalatedAt` (le retour à `OPEN` restitue `ESCALATED` si `escalatedAt` non nul).

### 5.2 `PaymentPromise.status` : `PENDING` → `KEPT` | `PARTIALLY_KEPT` | `BROKEN` (terminaux). Une promesse `PENDING` peut être annulée (`CANCELLED`, §14) si l'utilisateur la remplace.

### 5.3 `Invoice.status` (portion M09) : `ISSUED`/`PARTIALLY_PAID` → `OVERDUE` (nuit, retard ≥ 1 j) ; → `DISPUTED` (litige) ; → `WRITTEN_OFF` (perte) ; `DISPUTED` → `OVERDUE`/`PAID` à la résolution. Les transitions vers `PAID` restent dans M08.

## 6. Données

Entités de `02` : `CollectionCase`, `PaymentPromise`, `CollectionNote`, `Invoice`, `Payment`, `PaymentAllocation`, `PaymentLink`, `Customer` (`creditLimit`, `paymentTermsDays`, `riskScore`), `CustomerContact`, `Reminder`, `Message`, `Notification`, `AuditLog`, `Organization.settings`.

`Organization.settings.collections` :
```json
{ "minAmount": 2000, "attributionDays": 7, "blockAfterDays": 60, "writeOffMinDays": 90,
  "graceDays": 0, "reopenWithinDays": 30, "defaultCreditLimitCompany": null,
  "promiseBrokenNeedsApprovalAbove": 500000, "formalNotice": { "enabled": true, "delayDays": 8, "closingText": "…" } }
```
Ajouts : §14.

## 7. Écrans et interface

### 7.1 Créances — `/creances`
- **En-tête KPI** : Total dû · En retard (dont +30 j) · Récupéré ce mois (dont par relances) · DSO. Mobile : grille 2×2.
- **Balance âgée** : barres horizontales cliquables (Non échu, 0-30, 31-60, 61-90, +90), montant et nombre de clients.
- **Onglets** : Par client (défaut) · Par facture · À traiter (badge) · Promesses · Litiges · Pertes.
- **Par client** : client + badge Particulier/Entreprise, solde dû, en retard, retard max, palier (« Relance ferme envoyée le 12/10 »), score (pastille), dernière action, prochaine action (« Relance J+45 le 22/10 » ou « Promesse 600 000 le 25/10 »), statut du dossier.
- **Par facture** : client, n°, date, total, payé, reste dû, échéance, retard (j), dernière relance, prochaine relance, statut (À échéance · En retard · Relancée · Promesse · Payée partiellement · Litige · Perte).
- Actions de ligne : Enregistrer un paiement (modale M08 : montant, date, mode Espèces/Wave/Orange Money/MTN MoMo/Moov Money/Virement/Chèque, référence, factures), Relancer maintenant, Promesse, Litige, Pause, Appeler, Relevé, Voir le dossier.
- Filtres : tranche, site, type de client, statut, score, assigné, montant min. Pagination serveur.
- États : vide « Aucune créance en cours. Bravo ! » ; chargement squelettes ; erreur avec « Réessayer ».

### 7.2 Dossier de recouvrement — `/creances/[caseId]`
- En-tête : client, téléphones (bouton Appeler, bouton WhatsApp), contacts comptabilité, plafond / exposition (jauge), score (composantes au survol), statut, assigné (modifiable), badge « Crédit suspendu ».
- **Frise de la séquence** : J+3 ✓ envoyé (lu) · J+15 ✓ · J+30 en attente de validation · J+45 · J+60, avec dates prévues.
- Factures ouvertes (sélection pour litige/perte/paiement), promesses (statut), chronologie unifiée : relances (statut M11), appels, notes, paiements, promesses, changements de statut.
- Actions : Enregistrer un paiement, Noter une promesse (ou échéancier), Appeler (→ formulaire de résultat), Ajouter une note, Litige, Pause, Escalader, Mise en demeure (aperçu PDF → valider), Relevé de compte, Passer en perte, Fermer manuellement (si solde réglé ailleurs en mode `REMINDERS_ONLY` : renvoie vers M08 « Marquer payé »).

### 7.3 Alerte crédit (composant partagé `CreditAlert`)
Affichée dans M04 (création OR), M05 (devis), M08 (facture à crédit), et fiche client. Orange/rouge avec texte RG-M09-10, montant dû, retard max, boutons selon permissions.

### 7.4 Tableau de bord recouvrement (bloc M12 + page `/creances/tableau-de-bord`)
KPI RG-M09-18, courbe mensuelle de l'encours en retard (12 mois), répartition des encaissements (relances / appels / spontané), taux de tenue des promesses, top 10 débiteurs, liste « À traiter ».

## 8. API

Routeur `collections` :

| Procédure | Entrée | Sortie |
|---|---|---|
| `collections.agingSummary` | `{ asOf?, siteId?, customerType? }` | `{ total, notDue, buckets: {b0_30,b31_60,b61_90,b90p}, unallocatedCredits, customersCount }` |
| `collections.listCases` | `{ tab, bucket?, status?, scoreMin?, assignedToId?, search?, cursor, limit }` | `{ items, nextCursor }` |
| `collections.listInvoices` | `{ bucket?, status?, customerId?, cursor }` | `{ items, nextCursor }` |
| `collections.getCase` | `{ id }` | dossier + factures + promesses + chronologie + séquence M10 |
| `collections.addPromise` | `{ caseId, installments: [{ amount, date }], channel, note? }` | PaymentPromise[] |
| `collections.cancelPromise` | `{ promiseId, reason }` | PaymentPromise |
| `collections.logCall` | `{ caseId, outcome: REACHED|NO_ANSWER|WRONG_NUMBER|CALLBACK, note?, callbackAt?, promise? }` | CollectionNote |
| `collections.addNote` | `{ caseId, body, type: note|visit }` | CollectionNote |
| `collections.openDispute` | `{ caseId, invoiceIds, reason, disputedAmount? }` | Case |
| `collections.resolveDispute` | `{ caseId, resolution: PAY|CREDIT_NOTE|WRITE_OFF, note }` | Case |
| `collections.pause` / `resume` | `{ caseId, until, reason }` / `{ caseId }` | Case |
| `collections.escalate` | `{ caseId, note? }` | Case |
| `collections.assign` | `{ caseId, membershipId }` | Case |
| `collections.remindNow` | `{ caseId, channel?, templateKey? }` | Reminder (`MANUAL`, via M10, en validation) |
| `collections.formalNotice.preview` / `.approve` / `.markDelivered` | `{ caseId }` / `{ caseId, reminderId }` / `{ caseId, date, method }` | PDF URL / Reminder / Case |
| `collections.statement` | `{ customerId, from, to, send?: { channel } }` | `{ pdfUrl, portalUrl, messageId? }` |
| `collections.writeOff` | `{ invoiceIds, reason }` | Invoice[] |
| `collections.reverseWriteOff` | `{ invoiceId, reason }` | Invoice |
| `collections.creditCheck` | `{ customerId, additionalAmount? }` | `{ level: OK|WARN|BLOCK, reasons[], overdueDue, maxDaysOverdue, exposure, creditLimit }` |
| `collections.requestOverride` / `grantOverride` | `{ customerId, repairOrderId, reason }` / `{ requestId, approve, reason }` | CreditOverride |
| `collections.setCreditLimit` | `{ customerId, creditLimit|null, paymentTermsDays? }` | Customer |
| `collections.dashboard` | `{ from, to, siteId? }` | KPI RG-M09-18 |
| `collections.exportAging` | `{ asOf, format: xlsx }` | URL signée |

REST public (M13) : `GET /api/v1/receivables/aging`, `GET /api/v1/customers/{id}/statement?from&to`, `POST /api/v1/collections/{caseId}/promises`.

## 9. Automatisations et événements

| Job | Fréquence | Rôle |
|---|---|---|
| `receivables.age` | 01:00 (fuseau org) | Statuts `OVERDUE`, ouverture/mise à jour/fermeture/réouverture des dossiers, reprise des pauses, `riskScore`, alerte litiges > 30 j |
| `collections.promises` | 01:15 | Évaluation des promesses échues, planification `PROMISE_BROKEN` (via M10) |
| `collections.attribution` | 03:30 (avec `reminders.outcomes`) | Consolidation RG-M09-14 |
| `collections.snapshot` | 23:55 | Photo quotidienne de la balance âgée (`ReceivableSnapshot`) pour les courbes M12 |

Consomme : `invoice.issued`, `invoice.voided`, `payment.received` (recalcul immédiat, promesse KEPT, fermeture), `payment.allocation_changed`, `reminder.sent` (`stage`, `lastContactAt`), `reminder.outcome_recorded`, `message.inbound_received` avec intention (`PAID_CLAIM` → pause 48 h + tâche caisse ; `DISPUTE` → pause 72 h ; `PROMISE` → suggestion de promesse pré-remplie à valider).
Émet : `collection.opened|promised|promise_kept|promise_broken|paused|resumed|disputed|dispute_resolved|escalated|closed|reopened`, `receivable.writeoff`, `credit.override_requested|granted`.

## 10. Permissions

| Action | Permission | OWNER | MANAGER | ACCOUNTANT | CASHIER | ADVISOR |
|---|---|:-:|:-:|:-:|:-:|:-:|
| Voir créances, dossiers, balance âgée | `receivable:read` | ✅ | ✅ | ✅ | ✅ | solde seul (fiche client) |
| Promesse, note, appel, pause, litige, relevé | `receivable:collect` | ✅ | ✅ | ✅ | ✅ | — |
| Résoudre un litige | `receivable:dispute_resolve` | ✅ | ✅ | ✅ | — | — |
| Valider J+30 | `reminder:approve` + `receivable:collect` | ✅ | ✅ | ✅ | — | — |
| Valider une mise en demeure | `receivable:formal_notice` | ✅ | — | — | — | — |
| Plafond, conditions de paiement | `receivable:credit_limit` | ✅ | — | ✅ | — | — |
| Dérogation de crédit | `receivable:credit_override` | ✅ | ✅ | — | — | — |
| Passer en perte / annuler | `receivable:writeoff` | ✅ | — | — | — | — |
| Tableau de bord recouvrement | `receivable:dashboard` | ✅ | ✅ | ✅ | — | — |

## 11. Cas limites et erreurs

| Situation | Comportement |
|---|---|
| Paiement arrivé entre la planification et l'envoi | Revérification M10 (RG-M10-24) : annulation « Facture déjà réglée » |
| Paiement en espèces non saisi, le client répond « j'ai payé » | Intention `PAID_CLAIM` → pause 48 h, tâche caisse ; aucune relance pendant la vérification |
| Paiement non affecté (acompte) couvrant le retard | Dossier marqué « À rapprocher », relances bloquées jusqu'à affectation (M08) |
| Facture annulée par avoir total | `invoice.voided` → recalcul, fermeture si plus rien |
| Avoir partiel | Solde réduit ; prochaine relance utilise le nouveau montant (re-rendu) |
| Entreprise avec 25 factures ouvertes | Un seul dossier, une relance avec le total ; détail dans le relevé PDF joint |
| Deux fiches client pour la même entreprise | Alerte doublon ; fusion M02 fusionne les dossiers (séquence au palier le plus avancé) |
| Client `doNotRemind` ou `OptOut` | Pas de message ; dossier traité par appels ; la mise en demeure reste possible en papier |
| Mode `REMINDERS_ONLY` : solde importé périmé | RG-M10-29 ; bandeau sur `/creances` « Soldes du 15/10/2026 » |
| Promesse saisie à une date passée | Refus « La date promise doit être aujourd'hui ou plus tard. » |
| Montant de promesse > dû | Refus « Le montant promis dépasse le solde dû (1 240 000 FCFA). » |
| Passage en perte d'une facture en litige | Autorisé seulement via « Résolu — passage en perte » |
| Paiement après passage en perte | Alerte « Facture passée en perte le 12/09/2026 : annuler la perte et affecter le paiement ? » |
| Sans permission | `FORBIDDEN` « Seul le gérant peut passer une créance en perte. » |
| Facture d'assurance en retard | Hors balance client ; onglet « Assurances » (M16) |

## 12. Tests

**Unitaires `packages/core/receivables`** : `ageBucket` (bornes 0/1/30/31/60/61/90/91), `agingSummary` (somme = total, avoirs, crédits non affectés) ; `riskScore` (exemples SOTRA = 50, Traoré = 0, < 3 factures → D = 10, bornes) ; `evaluatePromise` (KEPT, PARTIALLY_KEPT, BROKEN, paiement avant la date, échéancier) ; `creditCheck` (OK/WARN/BLOCK, chaque raison) ; `attributePayment` (relance vs appel plus récent, hors fenêtre) ; `caseLifecycle` (rattachement d'une nouvelle facture, réouverture < 30 j, nouveau dossier ≥ 30 j) ; `dso`.
**Intégration** : facture en retard → dossier → relances M10 → paiement webhook → fermeture et annulation de la relance planifiée ; promesse rompue → relance `PROMISE_BROKEN` unique même si le job tourne deux fois ; isolement multi-locataire.
**E2E Playwright** : `/creances` → balance âgée → SOTRA → noter promesse 600 000 le 25/10 → horloge au 26/10 → relance « promesse rompue » en file → créer un OR SOTRA → alerte rouge → dérogation OWNER → Koné : enregistrer paiement Wave 185 000 → statut « Payée », dossier fermé, relance planifiée annulée.

## 13. Définition de « terminé »

- [ ] `receivables.age`, `collections.promises`, `collections.snapshot` déployés, idempotents, verrouillés par organisation.
- [ ] Balance âgée exacte (test de réconciliation : somme des tranches = Σ balances) et export Excel.
- [ ] Dossiers, promesses, litiges, pauses, escalade, perte fonctionnels avec audit.
- [ ] `CreditAlert` intégré dans M04, M05, M08 ; dérogation depuis le téléphone de l'OWNER.
- [ ] Score de risque affiché avec ses composantes.
- [ ] Relevé de compte et mise en demeure PDF conformes, envoyables via M11.
- [ ] Attribution des encaissements visible dans le tableau de bord.
- [ ] Tests unitaires `core/receivables` ≥ 90 % de couverture ; E2E vert.

## 14. Évolutions du modèle de données

```prisma
model CollectionCase {
  // … champs existants de 02 …
  anchorDate          DateTime? @db.Date    // plus ancienne échéance en retard à l'ouverture (ancre M10)
  overdueDue          Int       @default(0) // part échue de totalDue
  maxDaysOverdue      Int       @default(0)
  escalatedAt         DateTime?
  disputeOpenedAt     DateTime?
  disputeReason       String?
  disputedAmount      Int?
  formalNoticeAt      DateTime?
  formalNoticeDeliveredAt DateTime?
  formalNoticeMethod  String?               // email | whatsapp | hand | bailiff
  lastContactAt       DateTime?
  brokenPromiseCount  Int       @default(0)
  unreachableCount    Int       @default(0) // appels « pas de réponse » consécutifs
  previousStatus      CollectionStatus?     // restauré à la fin d'une pause
  @@index([organizationId, status])
  @@index([organizationId, customerId])
}

model PaymentPromise {
  // …
  organizationId   String                   // manquant dans 02 : obligatoire (multi-locataire)
  paidAmount       Int       @default(0)
  evaluatedAt      DateTime?
  reminderId       String?                  // relance à l'origine de la promesse (attribution)
  cancelledReason  String?
}
enum PromiseStatus { PENDING KEPT PARTIALLY_KEPT BROKEN CANCELLED }

model CollectionNote {
  // …
  organizationId   String                   // manquant dans 02
  callOutcome      CallOutcome?
  callbackAt       DateTime?
}
enum CallOutcome { REACHED NO_ANSWER WRONG_NUMBER CALLBACK }

model Customer {
  // …
  creditHold        Boolean  @default(false)
  creditHoldReason  String?
  riskComponents    Json?                   // { A, B, C, D, E } pour l'affichage
}

model Invoice {
  // …
  writtenOffAmount  Int?
  writtenOffAt      DateTime?
  writtenOffById    String?
  writeOffReason    String?
  disputedAt        DateTime?
  collectionCaseId  String?
}

model RepairOrder {
  // …
  cashOnly          Boolean  @default(false) // OR ouvert sous blocage crédit sans dérogation
}

model CreditOverride {
  id              String   @id @default(cuid())
  organizationId  String
  customerId      String
  repairOrderId   String?
  requestedById   String
  decidedById     String?
  status          String   @default("PENDING")   // PENDING | GRANTED | REFUSED
  reason          String
  decisionReason  String?
  createdAt       DateTime @default(now())
  decidedAt       DateTime?
}

model PaymentAttribution {                 // RG-M09-14
  id              String   @id @default(cuid())
  organizationId  String
  paymentAllocationId String @unique
  source          String                   // reminder | call | spontaneous
  reminderId      String?
  collectionNoteId String?
  amount          Int
  createdAt       DateTime @default(now())
}

model ReceivableSnapshot {                 // photo quotidienne pour les courbes
  id              String   @id @default(cuid())
  organizationId  String
  siteId          String?
  date            DateTime @db.Date
  notDue          Int
  b0_30           Int
  b31_60          Int
  b61_90          Int
  b90p            Int
  @@unique([organizationId, siteId, date])
}
```
