# M16 — Assurances et sinistres (carrosserie)

> Priorité : P2 · Dépend de : M02, M04, M05, M08, M09, M11, M15 · Rôles concernés : `ADVISOR`, `MANAGER`, `ACCOUNTANT`, `OWNER`, `CASHIER`

## 1. Objectif

Les réparations de carrosserie suite à un accident sont souvent payées en grande partie par l'assureur du client, avec une **franchise** à la charge de l'assuré, une **expertise** préalable, un accord écrit et des **délais de paiement longs** (60 à 120 jours). Sans outil, le garage perd la trace des dossiers, oublie de relancer l'assureur et ne sait pas combien les compagnies lui doivent. M16 suit chaque sinistre de l'ouverture à l'encaissement : expert, devis assurance, accord, double facturation (assurance + client), pièces jointes et relances de l'assureur.

## 2. Utilisateurs et cas d'usage

| Rôle | Ce qu'il fait | Fréquence |
|---|---|---|
| `ADVISOR` | Ouvre le dossier à la réception, joint constat et photos, planifie l'expert, envoie le devis, saisit l'accord | Plusieurs fois/semaine |
| `MANAGER` | Prépare le chiffrage carrosserie avec l'expert, suit l'avancement des réparations | Hebdomadaire |
| `ACCOUNTANT` | Émet les factures assurance et franchise, suit les encaissements, relance les compagnies | Hebdomadaire |
| `CASHIER` | Encaisse la franchise du client à la restitution | Ponctuel |
| `OWNER` | Voit l'encours par compagnie et les retards | Hebdomadaire |

## 3. User stories

**US-M16-01 — En tant que conseiller, je veux ouvrir un dossier sinistre à la réception du véhicule accidenté.**
- Étant donné Mme Traoré Aminata, Hyundai Tucson `8812 HK 01`, assurée chez « Compagnie A Assurances », quand je crée le dossier depuis l'OR (ou la fiche véhicule), alors un `InsuranceClaim` `OPENED` est créé, numéroté `SIN-2026-0031`, avec compagnie (pré-remplie depuis `Vehicle.insuranceCompanyId`), n° de police (`Vehicle.insurancePolicyNumber`), date de l'accident, n° de sinistre assureur (facultatif à ce stade), franchise prévue, et lié à l'OR (`RepairOrder.insuranceClaimId`).
- Étant donné que la police est expirée (`Vehicle.insuranceExpiryDate` < date de l'accident), alors un avertissement « L'assurance semblait expirée à la date de l'accident » s'affiche (non bloquant).

**US-M16-02 — En tant que conseiller, je veux joindre les pièces du dossier.**
- Quand j'ajoute le constat amiable (photo ou PDF), les photos des dégâts, la carte grise, l'attestation d'assurance, le permis, alors chaque fichier est un `Attachment` (`entity = "claim"`) typé (RG-M16-09) ; la checklist du dossier affiche les pièces manquantes requises par la compagnie.
- Quand je photographie le constat, alors M17 peut extraire date, lieu, n° de police et identités pour préremplir le dossier (suggestion à valider).

**US-M16-03 — En tant que conseiller, je veux planifier et tracer la visite de l'expert.**
- Quand je saisis l'expert (nom, cabinet, téléphone `+2250707445566`, email) et la date de visite, alors le dossier passe `EXPERT_SCHEDULED`, un rendez-vous de type `BODYWORK` est proposé dans le planning (M03), et un rappel est envoyé à l'expert la veille (M11, si numéro connu).
- Quand l'expert est passé, je saisis la date réelle et joins le **PV / rapport d'expertise**.

**US-M16-04 — En tant que chef d'atelier, je veux établir le devis assurance.**
- Quand je crée le devis depuis le dossier, alors un `Quote` lié est créé avec toutes les lignes `payer = INSURANCE` par défaut ; je peux marquer certaines lignes `payer = CUSTOMER` (ex. réparation d'un rétroviseur hors sinistre, demandée par le client).
- Le devis affiche : total assurance, franchise, vétusté éventuelle, part client, part assureur (RG-M16-03), et `Quote.insuranceShare` / `customerShare` sont renseignés.
- Quand j'envoie le devis à l'assureur (email avec PDF + pièces sélectionnées) ou le remets à l'expert, alors le dossier passe `ESTIMATE_SENT` et la date d'envoi démarre le délai de relance « accord ».

**US-M16-05 — En tant que conseiller, je veux enregistrer l'accord de l'assureur, même partiel.**
- Étant donné un devis de 653 720 FCFA TTC, quand l'assureur accorde 600 000 FCFA TTC avec franchise 100 000 et vétusté 30 000 sur le phare, alors je saisis montant accordé, franchise, vétusté, référence de l'accord (n° de lettre / bon de prise en charge) et je joins la lettre d'accord ; le dossier passe `APPROVED`.
- Étant donné un accord inférieur au devis (écart 53 720), alors je choisis (RG-M16-05) : réviser le devis (nouvelle version M05 alignée), mettre l'écart à la charge du client (avec son accord via M05/M14), ou l'absorber en remise garage (permission, motif).
- Quand le dossier est `APPROVED`, alors l'OR lié peut passer `APPROVED` (M04) et les pièces sont réservées (M07).

**US-M16-06 — En tant que comptable, je veux émettre deux factures : une à l'assureur, une au client.**
- Étant donné l'OR terminé, quand je clique « Facturer le sinistre », alors deux brouillons sont créés (RG-M16-04) : la facture **assurance** (`billTo = INSURANCE`, `insuranceClaimId`, destinataire = la compagnie) et la facture **client** (franchise + vétusté + lignes `payer = CUSTOMER`).
- Quand les deux sont émises, alors chacune a son numéro `FAC`, sa FNE (M08), et le dossier passe `INVOICED`.
- Le client ne peut récupérer son véhicule que si sa part est payée, sauf dérogation (`settings.claims.releaseBeforeDeductible`, permission `claim:release_unpaid`).

**US-M16-07 — En tant que comptable, je veux suivre ce que chaque compagnie me doit.**
- Quand j'ouvre `/assurances`, alors je vois par compagnie : nombre de dossiers ouverts, montant facturé non encaissé, ancienneté (0–30, 31–60, 61–90, 91–120, > 120 jours), délai moyen de paiement constaté, et le dossier le plus ancien.
- Étant donné un paiement de l'assureur par virement couvrant 3 dossiers, quand je l'enregistre (méthode `INSURANCE` ou `BANK_TRANSFER`, client payeur = la compagnie), alors je le répartis sur les 3 factures assurance (M08 RG-M08-19) et les dossiers soldés passent `PAID`.

**US-M16-08 — En tant que comptable, je veux que les relances de l'assureur soient planifiées automatiquement.**
- Étant donné un dossier en `ESTIMATE_SENT` depuis 7 jours sans accord, alors une tâche de relance « accord » est créée et un email modèle est proposé (ou envoyé si `autoSend`).
- Étant donné une facture assurance échue (émise + `InsuranceCompany.paymentTermsDays`) et non soldée, alors des relances graduées (J+0, J+15, J+30, puis toutes les 30 j) sont planifiées vers le contact sinistres de la compagnie ; chaque relance et chaque appel sont tracés dans la chronologie du dossier.

**US-M16-09 — En tant que gérant, je veux savoir quels dossiers sont bloqués.** Le tableau `/assurances/sinistres` affiche des badges : « Expert non passé depuis 5 j », « Accord attendu depuis 12 j », « Véhicule prêt, franchise impayée », « Facture assurance échue depuis 47 j ».

**US-M16-10 — En tant que conseiller, je veux gérer un refus de prise en charge.** Quand l'assureur refuse (motif, lettre jointe), le dossier passe `REJECTED` ; je peux convertir le devis en devis client classique (toutes les lignes `payer = CUSTOMER`, nouvelle version M05) et le client est informé par M11.

## 4. Règles métier

**RG-M16-01 — Compagnies.** `InsuranceCompany` est propre à chaque organisation (pas de liste nationale imposée). Exemples de seed génériques : « Compagnie A Assurances », « Compagnie B Assurances CI », « Mutuelle C ». Champs : raison sociale, NCC/RCCM (facturation FNE), adresse, contact sinistres (nom, téléphone +225, email), délai de paiement contractuel (`paymentTermsDays`, défaut 60), pièces exigées, conventions (taux horaire MO accordé, taux de remise pièces). Pour la facturation, chaque compagnie est aussi un `Customer` `COMPANY` lié (`InsuranceCompany.customerId`), afin que M08/M09 fonctionnent sans cas particulier.

**RG-M16-02 — Numérotation.** `SIN-{année}-{seq}` via `DocumentSequence` (`docType = "SIN"`, `siteId = null`). Le n° de sinistre de l'assureur (`claimNumber`) est distinct et obligatoire avant facturation.

**RG-M16-03 — Répartition des montants** (`core/claims/splitClaim`). Notations TTC : `E` = total TTC des lignes `payer = INSURANCE` ; `D` = franchise (`deductible`) ; `V` = vétusté retenue par l'assureur ; `X` = écart non accordé mis à la charge du client (0 par défaut) ; `C` = total TTC des lignes `payer = CUSTOMER`.
```
partAssureur = E − D − V − X           (doit être ≥ 0)
partClient   = D + V + X + C
Si approvedAmount est saisi : contrôle partAssureur ≤ approvedAmount − D − V (sinon alerte « dépasse l'accord »)
```
**Exemple** (TVA 18 %, arrondi par ligne M08) :

| Ligne (payer INSURANCE) | HT | TVA | TTC |
|---|---|---|---|
| Pare-choc AV | 185 000 | 33 300 | 218 300 |
| Phare AV gauche | 142 000 | 25 560 | 167 560 |
| Peinture et ingrédients | 95 000 | 17 100 | 112 100 |
| MO tôlerie 6 h × 12 000 | 72 000 | 12 960 | 84 960 |
| MO peinture 5 h × 12 000 | 60 000 | 10 800 | 70 800 |
| **E** | **554 000** | **99 720** | **653 720** |

Franchise D = 100 000 TTC, V = 0, X = 0, C = 0 → part assureur **553 720**, part client **100 000**.

**RG-M16-04 — Double facturation.** Les deux factures portent les mêmes lignes réelles réparties sans double comptage :
- **Facture assurance** (`billTo = INSURANCE`, `customerId` = Customer de la compagnie, `insuranceClaimId`, `vehicleId`) : toutes les lignes `payer = INSURANCE`, puis une ligne négative « Franchise à la charge de l'assuré — Mme Traoré Aminata » et, le cas échéant, « Vétusté » et « Écart non pris en charge », chacune convertie TTC → HT par RG-M08-07. Exemple : franchise 100 000 TTC → HT −84 746, TVA −15 254. Totaux facture assurance : HT 469 254, TVA 84 466, **TTC 553 720**.
- **Facture client** (`billTo = CUSTOMER`, `insuranceClaimId`) : lignes « Franchise sinistre SIN-2026-0031 (police n°…) » HT 84 746, TVA 15 254, TTC **100 000** ; « Vétusté » / « Écart non pris en charge » de même ; plus les lignes `payer = CUSTOMER`.
- Invariant contrôlé à l'émission : `totalAssurance + totalClient = E + C` (au FCFA près, garanti par la conversion TTC→HT appliquée à l'identique avec signe opposé).

**RG-M16-05 — Accord inférieur au devis.** Écart `G = E − approvedAmount` (si l'accord inclut franchise et vétusté, sinon adapter selon la saisie « accord net/brut »). Trois options : (a) **réviser** le devis : nouvelle version des lignes alignée (souvent MO réduite, pièce d'occasion) ; (b) **client** : `X = G`, accord client requis (M05, lien portail) avant travaux ; (c) **garage** : remise `discountRate` répartie sur les lignes assurance (RG-M08-09), permission `claim:absorb_gap`, motif. Le choix est tracé dans la chronologie.

**RG-M16-06 — TVA à la charge de l'assuré** (option par dossier `vatPaidBy = CUSTOMER`) : certaines entreprises récupèrent la TVA et leur assureur ne règle que le HT. Facture assurance = HT des lignes assurance − franchise HT ; la TVA de toutes les lignes assurance est reportée sur la facture client (ligne « TVA sur réparation sinistre »). Défaut `INSURANCE`.

**RG-M16-07 — Encaissement.** Paiement de la compagnie : méthode `INSURANCE` (règlement par lettre-chèque/virement de l'assureur) ou `BANK_TRANSFER`, `customerId` = Customer de la compagnie, allocation sur les factures assurance. Écart de règlement (assureur paie 540 000 au lieu de 553 720) : le solde reste dû ; l'utilisateur peut (a) le laisser en créance et relancer, (b) émettre un avoir (motif « abattement assureur ») avec `invoice:credit`, (c) refacturer au client (nouvelle facture, accord client). Dossier `PAID` quand factures assurance **et** client sont soldées ou avoirées ; `PARTIALLY_PAID` si l'une seulement ou en partie.

**RG-M16-08 — Relances assureur** (`core/claims/planFollowUps`) :

| Déclencheur | Paliers par défaut (paramétrables par compagnie) | Destinataire |
|---|---|---|
| Expert non passé (`EXPERT_SCHEDULED` et `expertVisitAt` dépassé de 2 j sans saisie) | J+2 | Conseiller (tâche interne) |
| Accord attendu (`ESTIMATE_SENT`) | J+7, J+14, J+21 puis escalade OWNER | Contact sinistres compagnie + expert |
| Facture assurance échue (`issuedAt + paymentTermsDays`) | J+0, J+15, J+30, puis tous les 30 j | Contact sinistres + comptabilité compagnie |

Les relances assureur sont des `ClaimFollowUp` (pas des `Reminder` M10, qui ciblent un client particulier) ; elles réutilisent les modèles M11 (`claim_approval_followup`, `claim_payment_followup`) avec variables `{{sinistre.numero}}`, `{{sinistre.numeroAssureur}}`, `{{facture.numero}}`, `{{facture.solde}}`, `{{facture.joursRetard}}`, `{{vehicule.plaque}}`, `{{assure.nom}}`. Canal par défaut : email (avec relevé PDF des factures dues joint) ; WhatsApp si numéro du gestionnaire connu. `autoSend` désactivé par défaut (validation manuelle). Arrêt automatique sur accord saisi / paiement reçu. Les relances de la **part client** (franchise impayée) passent par M09/M10 comme toute créance client.

**RG-M16-09 — Pièces jointes.** `Attachment.entity = "claim"`, `kind` ∈ {`claim_report` (constat amiable), `photo_damage`, `photo_repair` (avant/pendant/après), `expert_report` (PV d'expertise), `approval_letter`, `registration` (carte grise), `insurance_certificate`, `driver_license`, `police_report`, `invoice_supplier`, `other`}. Checklist requise par compagnie (`InsuranceCompany.requiredDocuments`, défaut : constat, photos dégâts, carte grise, attestation). Le passage `ESTIMATE_SENT` avertit si une pièce requise manque ; le passage `INVOICED` exige le PV d'expertise ou la lettre d'accord (`expert_report` ou `approval_letter`). Photos min. 4 angles recommandés.

**RG-M16-10 — Restitution.** Véhicule `DELIVERED` (M04) autorisé si la facture client est soldée ou si dérogation (US-M16-06, permission `claim:release_unpaid`). La facture assurance n'est jamais bloquante pour la restitution.

**RG-M16-11 — Encours et délai moyen.** Encours compagnie = Σ `balance` des factures `billTo = INSURANCE` de ses dossiers. Délai moyen de paiement = moyenne (date du dernier paiement soldant − `issuedAt`) sur les 12 derniers mois. Exemple : 3 dossiers payés en 74, 96 et 118 jours → **96 jours**.

## 5. Machine à états — `ClaimStatus`

| De | Vers | Déclencheur | Effets |
|---|---|---|---|
| `OPENED` | `EXPERT_SCHEDULED` | saisie expert + date | RDV proposé (M03), rappel expert |
| `OPENED`/`EXPERT_SCHEDULED` | `ESTIMATE_SENT` | envoi du devis assurance | relances « accord » planifiées |
| `ESTIMATE_SENT` | `APPROVED` | saisie accord (+ lettre) | OR → `APPROVED` possible (M04), relances accord stoppées |
| `ESTIMATE_SENT` | `ESTIMATE_SENT` | devis révisé (nouvelle version) | redémarre les délais |
| `APPROVED` | `REPAIRING` | OR → `IN_PROGRESS` (événement M04) | |
| `REPAIRING` | `INVOICED` | émission des deux factures | relances paiement planifiées |
| `INVOICED` | `PARTIALLY_PAID` | paiement partiel (assureur ou client) | |
| `INVOICED`/`PARTIALLY_PAID` | `PAID` | toutes les factures du dossier soldées/avoirées | relances stoppées, `closedAt` |
| `OPENED`…`ESTIMATE_SENT` | `REJECTED` | refus assureur (motif, lettre) | proposition de conversion en devis client |
| tout sauf `INVOICED`/`PARTIALLY_PAID`/`PAID` | `CANCELLED` | client retire le véhicule / abandon (motif) | relances stoppées |

`PARTIALLY_PAID` et `CANCELLED` sont ajoutés à l'enum (§14). Événement `claim.status_changed` à chaque transition.

## 6. Données

Entités de 02 : `InsuranceCompany`, `InsuranceClaim` (`claimNumber`, `policyNumber`, `accidentDate`, `expertName`, `expertVisitAt`, `status`, `deductible`, `approvedAmount`), `RepairOrder.insuranceClaimId`, `Quote` (`insuranceShare`, `customerShare`), `QuoteLine.payer`, `RepairOrderLine.payer`, `Invoice` (`billTo`, `insuranceClaimId`), `Payment` (méthode `INSURANCE`), `Customer`, `Vehicle` (`insuranceCompanyId`, `insurancePolicyNumber`, `insuranceExpiryDate`), `Attachment`, `Message`, `DocumentSequence`, `AuditLog`.

Ajouts (§14) : champs de `InsuranceCompany` et `InsuranceClaim`, `ClaimActivity` (chronologie), `ClaimFollowUp`, enum `ClaimStatus` étendu.

## 7. Écrans et interface

| Route | Contenu | Actions |
|---|---|---|
| `/assurances` | Tableau de bord : encours par compagnie (balance âgée), délai moyen, dossiers bloqués, relances du jour | Filtres site/compagnie ; clic → liste filtrée |
| `/assurances/sinistres` | Liste : n° SIN, n° assureur, client, plaque, compagnie, statut, part assureur, part client, soldes, badges de blocage, prochaine action | Recherche (plaque, n°), filtres statut/compagnie/ancienneté, export CSV |
| `/assurances/sinistres/nouveau` | Formulaire : client/véhicule, compagnie, police, date et lieu accident, circonstances, franchise prévue, OR lié | Créer ; import du constat (extraction M17) |
| `/assurances/sinistres/[id]` | Onglets : **Résumé** (statut, montants RG-M16-03, étapes), **Expertise** (expert, visite, PV), **Devis** (versions, accord, écart), **Factures et paiements** (deux factures, soldes), **Documents** (checklist + galerie, téléchargement ZIP), **Chronologie** (`ClaimActivity` : appels, emails, relances, changements de statut) | Changer statut, envoyer devis, saisir accord, facturer, enregistrer appel, envoyer relance, générer dossier PDF complet |
| `/assurances/compagnies`, `/assurances/compagnies/[id]` | Fiches compagnies : contacts, conditions, pièces exigées, paliers de relance, historique et statistiques | CRUD |
| `/assurances/relances` | Relances assureur dues aujourd'hui, à valider | Valider/envoyer, reporter, marquer « appel fait » |

Mobile : fiche sinistre consultable, prise de photos directement dans l'onglet Documents (compression M06/M04). États : aucune compagnie configurée → « Ajoutez d'abord une compagnie d'assurance » ; dossier sans `claimNumber` au moment de facturer → blocage explicite.

## 8. API (tRPC)

| Procédure | Entrée | Sortie |
|---|---|---|
| `insurer.list` / `.get` / `.create` / `.update` | `InsuranceCompanyInput` | `InsuranceCompany` (+ `customerId` lié créé automatiquement) |
| `insurer.stats` | `{ from?, to?, siteId? }` | `[{ insurerId, openClaims, outstanding, aging: {b0_30,…}, avgDaysToPay }]` |
| `claim.list` | `{ status?, insurerId?, blockedOnly?, q?, cursor }` | page de dossiers + soldes |
| `claim.get` | `{ id }` | dossier complet + factures + documents + chronologie |
| `claim.create` | `{ customerId, vehicleId, insuranceCompanyId, repairOrderId?, policyNumber?, claimNumber?, accidentDate?, deductible?, notes? }` | `InsuranceClaim` |
| `claim.update` | champs modifiables | `InsuranceClaim` |
| `claim.scheduleExpert` | `{ id, expertName, expertFirm?, expertPhone?, expertEmail?, expertVisitAt }` | `InsuranceClaim` |
| `claim.recordExpertVisit` | `{ id, visitedAt, reportAttachmentId? }` | |
| `claim.createQuote` | `{ id }` | `Quote` (lignes `payer = INSURANCE`) |
| `claim.sendEstimate` | `{ id, quoteId, to: { email?, phone? }, attachmentIds }` | `{ messageIds }` |
| `claim.recordApproval` | `{ id, approvedAmount, deductible, depreciation?, approvalRef?, approvalAttachmentId?, gapHandling?: 'REVISE'\|'CUSTOMER'\|'GARAGE', reason? }` | `{ claim, split }` |
| `claim.reject` / `.cancel` | `{ id, reason, attachmentId? }` | |
| `claim.previewSplit` | `{ id }` | `{ E, D, V, X, C, insurerShare, customerShare }` |
| `claim.invoice` | `{ id }` | `{ insurerInvoice, customerInvoice }` (brouillons M08) |
| `claim.addActivity` | `{ id, type: 'call'\|'note'\|'email'\|'visit', body, nextActionAt? }` | `ClaimActivity` |
| `claim.followUps` / `claim.sendFollowUp` / `claim.snoozeFollowUp` | `{ dueBefore? }` / `{ followUpId, channel }` / `{ followUpId, until }` | |
| `claim.exportFile` | `{ id }` | URL ZIP/PDF du dossier |
| `vehicle.setInsurance` | `{ vehicleId, insuranceCompanyId \| null, policyNumber \| null, expiryDate \| null }` | `Vehicle` — rattachement du véhicule à une compagnie et une police (bloc « Assurance » de la fiche véhicule, repris à l'ouverture du dossier), permission `vehicle:update`, audité |

Pas d'API REST publique spécifique en v1 (les factures assurance sont exposées par les endpoints M08).

## 9. Automatisations et événements

Émis : `claim.created`, `claim.status_changed`, `claim.approved`, `claim.followup_sent`.

Consommés : `repair_order.status_changed` (`IN_PROGRESS` → `REPAIRING` ; `READY` → notifier le comptable « dossier à facturer »), `invoice.issued` (factures du dossier → `INVOICED` quand les deux sont émises), `payment.received` (recalcul → `PARTIALLY_PAID`/`PAID`, arrêt des relances), `invoice.voided`.

Worker : `claims.plan_followups` (tous les jours 06:00, fuseau org) crée les `ClaimFollowUp` dus (RG-M16-08), dédoublonnés par `dedupeKey = "{claimId}:{kind}:{step}"` ; `claims.dispatch_followups` (toutes les 15 min, plage horaire ouvrée lun–ven 08:00–17:00) envoie les relances validées via M11 en revérifiant juste avant l'envoi que la condition est toujours vraie (accord toujours absent, facture toujours impayée).

IA (M17) : extraction du constat amiable et du PV d'expertise (dates, montants accordés, franchise, vétusté) en préremplissage ; rédaction de relances adaptées au ton et à l'ancienneté ; résumé du dossier pour le gérant. Toujours validé par un humain.

## 10. Permissions

| Action | Permission | Rôles par défaut |
|---|---|---|
| Voir dossiers | `claim:view` | OWNER, MANAGER, ADVISOR, ACCOUNTANT, CASHIER (lecture parts) |
| Créer / modifier dossier | `claim:edit` | ADVISOR, MANAGER, OWNER |
| Saisir accord / refus | `claim:approve_record` | ADVISOR, MANAGER, ACCOUNTANT, OWNER |
| Absorber un écart | `claim:absorb_gap` | OWNER |
| Facturer le dossier | `claim:invoice` | ACCOUNTANT, ADVISOR, OWNER |
| Relances assureur | `claim:followup` | ACCOUNTANT, OWNER |
| Restituer sans franchise payée | `claim:release_unpaid` | OWNER |
| Compagnies | `insurer:edit` | OWNER, ACCOUNTANT |

## 11. Cas limites et erreurs

| Situation | Comportement |
|---|---|
| Franchise supérieure au montant des réparations (dégâts 80 000, franchise 100 000) | Part assureur = 0 ; proposition « Traiter comme réparation client » (dossier `CANCELLED` motif « sous franchise », devis client) |
| Client refuse de payer la franchise à la restitution | Restitution bloquée sauf dérogation `claim:release_unpaid` ; créance suivie par M09 |
| Assureur paie 540 000 au lieu de 553 720 | Solde 13 720 reste dû ; options RG-M16-07 |
| Accord reçu après le début des travaux | Autorisé avec avertissement « Travaux démarrés avant accord » tracé |
| Supplément découvert en cours de réparation (support de radiateur) | Nouvelle version du devis assurance, dossier repasse `ESTIMATE_SENT` pour la partie complémentaire (accord complémentaire) ; l'OR continue sur les lignes déjà accordées |
| Changement de compagnie après création | Autorisé tant que non facturé ; audit |
| Facture assurance émise avec mauvais n° de sinistre | Avoir total + nouvelle facture (M08) ; jamais de modification |
| Paiement d'assureur sans référence de dossier | Rapprochement manuel : liste des factures assurance ouvertes de la compagnie, allocation par défaut la plus ancienne d'abord |
| Compagnie sans email ni WhatsApp | Relances créées comme tâches d'appel ; « Aucun contact numérique pour cette compagnie » |
| Délai de paiement > 120 jours | Escalade OWNER, badge rouge, proposition de courrier de mise en demeure (modèle, validation humaine) |
| Deux dossiers pour le même véhicule et la même date d'accident | Avertissement de doublon |
| Organisation sans module M16 activé (P2) | Champs `payer = INSURANCE` masqués ; M08 facture normalement |

## 12. Tests

Unitaires (`packages/core/claims`) :
- `splitClaim` : exemple RG-M16-03 (553 720 / 100 000), vétusté, écart client, franchise > E, `vatPaidBy = CUSTOMER`.
- `buildClaimInvoices` : invariant `totalAssurance + totalClient = E + C` sur 200 jeux aléatoires ; franchise 100 000 → −84 746 / −15 254.
- `planFollowUps` : paliers accord et paiement, arrêt sur accord/paiement, dédoublonnage, jours non ouvrés.
- `insurerAging` et `avgDaysToPay` : exemple 74/96/118 → 96.

Intégration : transitions de statut via événements M04/M08 ; paiement assureur alloué sur 3 dossiers ; blocage de restitution ; isolation multi-locataire ; permissions `claim:absorb_gap`.

E2E Playwright : « Réception de `8812 HK 01` accidentée → dossier SIN avec constat et photos → expert planifié → devis assurance 653 720 envoyé → accord avec franchise 100 000 → réparation → deux factures émises (553 720 assurance, 100 000 client) → client paie la franchise en Orange Money et récupère le véhicule → paiement assureur 553 720 par virement 96 jours plus tard (horloge simulée) après deux relances → dossier `PAID` ».

## 13. Définition de « terminé »

- [ ] Compagnies (avec Customer lié), dossiers, numérotation SIN, liens OR/devis/factures.
- [ ] Pièces jointes typées avec checklist par compagnie, export du dossier.
- [ ] Expertise, devis assurance, accord (y compris partiel et écarts), refus.
- [ ] Double facturation conforme à RG-M16-04, invariant testé, FNE via M08.
- [ ] Encours et balance âgée par compagnie, délai moyen.
- [ ] Relances assureur planifiées, validées, envoyées via M11, stoppées automatiquement.
- [ ] Permissions, audit, tests unitaires/intégration/E2E verts, libellés `fr.json`.

## 14. Évolutions du modèle de données

```prisma
model InsuranceCompany {
  // … champs existants
  customerId          String?               // Customer COMPANY utilisé pour facturer la compagnie
  legalName           String?
  ncc                 String?
  rccm                String?
  address             String?
  claimsContactName   String?
  claimsPhone         String?               // E.164
  claimsEmail         String?
  accountingEmail     String?
  laborRate           Int?                  // taux horaire MO convenu (FCFA HT)
  partsDiscountRate   Int?                  // remise pièces convenue (%)
  requiredDocuments   String[]              // kinds d'Attachment exigés
  followUpConfig      Json   @default("{}") // { approval:[7,14,21], payment:[0,15,30], repeatEvery:30 }
  isActive            Boolean @default(true)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}

model InsuranceClaim {
  // … champs existants
  siteId              String?
  number              String                 // SIN-2026-0031
  repairOrderId       String?
  quoteId             String?                // devis assurance retenu
  accidentPlace       String?
  circumstances       String?
  expertFirm          String?
  expertPhone         String?
  expertEmail         String?
  expertVisitedAt     DateTime?
  estimateSentAt      DateTime?
  approvedAt          DateTime?
  approvalRef         String?
  depreciationAmount  Int     @default(0)    // vétusté TTC à la charge du client
  gapAmount           Int     @default(0)    // écart non pris en charge mis à la charge du client
  gapHandling         String?                // REVISE | CUSTOMER | GARAGE
  vatPaidBy           Payer   @default(INSURANCE)  // INSURANCE ou CUSTOMER (RG-M16-06)
  rejectedAt          DateTime?
  rejectReason        String?
  closedAt            DateTime?
  createdById         String?
  deletedAt           DateTime?
  @@unique([organizationId, number])
  @@index([organizationId, status])
  @@index([organizationId, insuranceCompanyId])
}

enum ClaimStatus { OPENED EXPERT_SCHEDULED ESTIMATE_SENT APPROVED REPAIRING INVOICED PARTIALLY_PAID PAID REJECTED CANCELLED }

model ClaimActivity {                         // chronologie du dossier
  id               String   @id @default(cuid())
  organizationId   String
  claimId          String
  type             String                     // status_change | call | note | email | whatsapp | visit | followup
  body             String?
  data             Json     @default("{}")
  messageId        String?
  nextActionAt     DateTime?
  createdById      String?
  createdAt        DateTime @default(now())
  @@index([organizationId, claimId, createdAt])
}

model ClaimFollowUp {                         // relance planifiée vers l'assureur
  id               String   @id @default(cuid())
  organizationId   String
  claimId          String
  invoiceId        String?
  kind             String                     // approval | payment | expert
  stepKey          String                     // "J+7", "J+30"
  scheduledFor     DateTime
  status           ReminderStatus @default(PLANNED)
  channel          Channel?
  messageId        String?
  sentAt           DateTime?
  snoozedUntil     DateTime?
  dedupeKey        String
  createdAt        DateTime @default(now())
  @@unique([organizationId, dedupeKey])
  @@index([organizationId, status, scheduledFor])
}
```

`DocumentSequence.docType` accepte `SIN`. `Attachment.kind` accepte les valeurs de RG-M16-09. `Message.customerId` reste nul pour les messages envoyés à un assureur (adresse dans `Message.to`). Paramètres `Organization.settings.claims` : `releaseBeforeDeductible`, `defaultPaymentTermsDays`, `autoSendFollowUps`.
