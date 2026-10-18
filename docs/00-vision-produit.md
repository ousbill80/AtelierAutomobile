# 00 — PRD maître : AtelierOS

> **AtelierOS** (nom provisoire) est un logiciel complet de gestion d'atelier automobile, pensé pour les garages de Côte d'Ivoire et d'Afrique de l'Ouest (zone UEMOA / OHADA).
> Ce document est la **source de vérité produit**. Chaque PRD de module (`docs/modules/*.md`) le précise ; en cas de contradiction, ce document gagne, sauf pour le modèle de données où `02-modele-donnees.md` fait foi.

---

## 1. Problème

Les ateliers automobiles perdent de l'argent sur trois points, que le client a lui-même signalés :

1. **Visites techniques oubliées** : le client ne revient pas avant son contrôle, le garage rate la pré-visite et les réparations associées.
2. **Créances qui traînent** : factures impayées non suivies, relances faites « quand on y pense », aucune vue claire de qui doit quoi.
3. **Révisions non rappelées** : le client part chez un autre garage ou attend la panne.

Plus largement :
- Ordres de réparation sur papier, devis perdus, accords clients verbaux et contestés ensuite.
- Stock de pièces mal connu (ruptures, vols, pièces dormantes).
- Temps des mécaniciens non mesuré : impossible de savoir si un travail est rentable.
- Paiements éclatés entre espèces, Wave, Orange Money, MTN MoMo, Moov, virements, assurances.
- Obligation de **Facture Normalisée Électronique (FNE)** de la DGI (arrêté n°0337 du 9 mai 2025) que beaucoup de logiciels ne gèrent pas.

## 2. Vision

> **Le garage tourne tout seul pour tout ce qui est répétitif.** Le gérant ouvre l'application le matin et sait en 10 secondes : ce qui rentre aujourd'hui, ce qui est bloqué dans l'atelier, qui doit de l'argent, et ce que les relances automatiques ont rapporté.

Trois piliers :
1. **Gérer** : du rendez-vous à la facture, sans papier.
2. **Relancer** : visites techniques, révisions, créances, devis non signés, véhicules prêts — automatiquement, par WhatsApp, SMS et email.
3. **Piloter** : chiffres fiables, alertes, et une IA qui propose plutôt que d'attendre qu'on lui demande.

## 3. Cibles

| Segment | Taille | Besoin principal |
|---|---|---|
| Garage indépendant | 2 à 10 personnes | Relances, devis, facturation, encaissement mobile money |
| Atelier structuré | 10 à 50 personnes, plusieurs ponts | Planning, temps mécaniciens, stock, rentabilité |
| Réseau / multi-sites | 2+ ateliers | Consolidation, transferts de stock, comparaison des sites |
| Gestionnaire de flotte (client B2B du garage) | Entreprises, transporteurs | Suivi par véhicule, factures groupées, crédit client |

**Client pilote** : garage indépendant d'Abidjan qui a déjà un logiciel de gestion. Le produit doit donc **aussi fonctionner en complément** d'un logiciel existant (mode « Relances seules » alimenté par import), puis permettre de **migrer complètement**.

## 4. Personas et rôles

| Rôle (code) | Qui | Écrans principaux | Appareil |
|---|---|---|---|
| `OWNER` Gérant / propriétaire | Décide, suit l'argent | Tableau de bord, créances, rapports | Téléphone |
| `MANAGER` Chef d'atelier | Organise le travail | Planning, OR, affectations, contrôle qualité | PC + tablette |
| `ADVISOR` Réceptionnaire / conseiller service | Accueille, fait les devis | RDV, réception, OR, devis, relances du jour | PC |
| `MECHANIC` Mécanicien / technicien | Répare | Ses tâches, pointage, photos, pièces demandées | Tablette / téléphone (PWA) |
| `STOREKEEPER` Magasinier | Gère les pièces | Stock, sorties, commandes, réceptions | PC + scanner |
| `CASHIER` Caissier | Encaisse | Caisse, paiements, reçus | PC |
| `ACCOUNTANT` Comptable | Suit les comptes | Factures, créances, exports comptables | PC |
| `CUSTOMER` Client final | Paie, approuve | Portail client (devis, factures, suivi) | Téléphone, sans compte obligatoire |

## 5. Périmètre fonctionnel (modules)

| # | Module | PRD | Priorité |
|---|---|---|---|
| M01 | Comptes, rôles, multi-garages, multi-sites | `modules/M01-comptes-roles.md` | P0 |
| M02 | Clients et véhicules | `modules/M02-clients-vehicules.md` | P0 |
| M03 | Rendez-vous et planning atelier | `modules/M03-rendez-vous-planning.md` | P1 |
| M04 | Réception et ordres de réparation (OR) | `modules/M04-ordres-reparation.md` | P0 |
| M05 | Devis et approbation client | `modules/M05-devis.md` | P0 |
| M06 | Atelier : mécaniciens, tâches, pointage | `modules/M06-atelier-mecaniciens.md` | P1 |
| M07 | Stock, pièces, fournisseurs, achats | `modules/M07-stock-achats.md` | P1 |
| M08 | Facturation, FNE, paiements, caisse | `modules/M08-facturation-paiements.md` | P0 |
| M09 | Créances et recouvrement | `modules/M09-creances-recouvrement.md` | P0 |
| M10 | Moteur de relances automatiques (VT, révision, créances, etc.) | `modules/M10-relances-automatiques.md` | P0 |
| M11 | Communications multicanal (WhatsApp, SMS, email, boîte de réception) | `modules/M11-communications.md` | P0 |
| M12 | Tableau de bord et rapports | `modules/M12-tableau-de-bord-rapports.md` | P0 |
| M13 | Import, synchronisation et API | `modules/M13-import-integrations-api.md` | P0 |
| M14 | Portail client | `modules/M14-portail-client.md` | P1 |
| M15 | Paramètres et administration | `modules/M15-parametres-administration.md` | P0 |
| M16 | Assurances et sinistres (carrosserie) | `modules/M16-assurances-sinistres.md` | P2 |
| M17 | Intelligence (IA) et automatisations | `modules/M17-ia-automatisations.md` | P1 |

**Priorités** : P0 = MVP vendable au client pilote · P1 = version 1.0 · P2 = après la v1.

## 6. Parcours de bout en bout (le « fil rouge »)

1. **Relance VT J-30** part automatiquement par WhatsApp à M. Kouassi (M10, M11).
2. Il répond « oui, samedi ». La réponse arrive dans la boîte de réception, l'IA propose un créneau (M11, M17). Le conseiller confirme → **RDV** (M03).
3. Samedi, **réception** : kilométrage, niveau de carburant, photos, doléances, signature sur tablette → **OR** créé (M04).
4. **Inspection multipoints** par le mécanicien : 3 points « à surveiller », 1 « urgent » avec photos (M06).
5. **Devis** généré à partir de l'inspection, envoyé par lien WhatsApp ; le client accepte 2 lignes sur 3 depuis son téléphone (M05, M14).
6. Le magasinier **réserve les pièces** ; une pièce manque → commande fournisseur (M07).
7. Mécanicien **pointe** ses temps sur chaque tâche ; chef d'atelier fait le **contrôle qualité** (M06).
8. Client notifié « véhicule prêt » avec **lien de paiement Wave** (M11, M08).
9. **Facture FNE certifiée** générée, paiement partiel 100 000 FCFA, solde à crédit (M08).
10. Solde non payé → **relances créance** graduées, promesse de paiement enregistrée, alerte gérant à J+45 (M09, M10).
11. La révision suivante est **calculée automatiquement** à partir du kilométrage moyen (M02, M17).
12. Le gérant voit dans le **tableau de bord** : CA, marge, taux d'acceptation des devis, montant récupéré par les relances (M12).

## 7. Exigences non fonctionnelles

| Domaine | Exigence |
|---|---|
| Langue | Interface 100 % français. Code, noms de variables et commentaires en anglais. Libellés via un fichier de traduction (prêt pour l'anglais plus tard). |
| Monnaie | FCFA (XOF), **entiers sans décimales**. Affichage `185 000 FCFA`. |
| Fuseau | `Africa/Abidjan` (UTC+0) par défaut, configurable par organisation. |
| Téléphone | Format E.164 (`+2250708123456`). Saisie tolérante (`07 08 12 34 56`, `0708123456`). |
| Fiscalité | TVA paramétrable (18 % par défaut), FNE DGI, mentions légales (RCCM, NCC/compte contribuable). |
| Performance | Pages < 1,5 s sur connexion 3G moyenne ; listes paginées côté serveur ; images compressées. |
| Hors-ligne | PWA mécanicien : consultation des tâches et pointage hors-ligne, synchronisation au retour du réseau. |
| Disponibilité | 99,5 % ; sauvegarde base quotidienne + point-in-time ; restauration testée. |
| Sécurité | Voir `01-architecture-technique.md` §8 : multi-locataire strict, RBAC, audit, chiffrement des secrets. |
| Accessibilité | Contraste AA, cibles tactiles ≥ 44 px, utilisable au clavier. |
| Traçabilité | Toute modification sur OR, devis, facture, paiement, stock → journal d'audit. |
| Données personnelles | Loi ivoirienne n°2013-450 sur la protection des données (ARTCI) : consentement aux relances, désinscription (STOP), export et suppression sur demande. |

## 8. Indicateurs de succès

| Indicateur | Cible à 6 mois chez le client pilote |
|---|---|
| Créances > 30 jours | −40 % |
| Taux de retour des clients relancés pour VT | ≥ 25 % |
| Taux de retour des clients relancés pour révision | ≥ 20 % |
| Taux d'acceptation des devis | ≥ 70 % |
| Délai moyen d'encaissement | −30 % |
| Utilisation quotidienne | 100 % des OR créés dans l'outil |

## 9. Hors périmètre v1

- Comptabilité générale complète (on fournit les exports SYSCOHADA, pas le grand livre).
- Paie des employés.
- Marketplace de pièces.
- Application mobile native (la PWA suffit).
- Diagnostic électronique (OBD) en direct — prévu comme intégration future.

## 10. Glossaire

| Terme | Sens |
|---|---|
| **OR** | Ordre de réparation : le dossier de travail d'un véhicule dans l'atelier. |
| **VT** | Visite technique (contrôle technique obligatoire, centres SICTA). |
| **Révision** | Entretien périodique (vidange, filtres, contrôles), selon date ou kilométrage. |
| **Créance** | Montant facturé non encore encaissé. |
| **FNE** | Facture Normalisée Électronique, certifiée par la DGI (QR code, numéro fiscal, signature). |
| **NCC** | Numéro de compte contribuable. |
| **RCCM** | Registre du commerce et du crédit mobilier. |
| **Pont / poste** | Emplacement de travail dans l'atelier. |
| **Main-d'œuvre (MO)** | Temps facturé des mécaniciens. |
| **CMP** | Coût moyen pondéré des pièces en stock. |
| **Palier** | Étape d'une séquence de relance (J-30, J-7…). |
