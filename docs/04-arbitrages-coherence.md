# 04 — Arbitrages et règles de cohérence entre modules

> Les PRD de modules ont été rédigés en parallèle. Ce document tranche leurs recouvrements. **Il prime sur les PRD de modules** et complète `02-modele-donnees.md`.

---

## 1. Comment appliquer les « Évolutions du modèle de données »

Chaque PRD de module se termine par une section **§14 Évolutions du modèle de données**.
- Quand un module est implémenté (voir `03-plan-construction.md`), l'agent **applique sa §14** à `schema.prisma` **et** reporte les ajouts dans `02-modele-donnees.md`, dans la même migration.
- Si deux modules proposent le même champ (ex. `RepairOrder.bayId` dans M03, M04 et M06 ; `Membership.pinHash` dans M01 et M06), il n'est créé **qu'une fois**, avec la définition la plus complète.
- Une évolution d'un module non encore implémenté n'est pas anticipée, sauf si elle est listée au §3 ci-dessous.

## 2. Décisions tranchées

| # | Sujet | Décision |
|---|---|---|
| A1 | **Jours fériés** | Source unique : modèle `Holiday` de **M15** (avec `siteId` optionnel, `isEstimated`). M03 (créneaux), M10 (décalage des envois) et M12 (capacité) lisent `Holiday` via `core/calendar`. Les clés `settings.holidays` / `settings.reminders.holidays` mentionnées dans M03 et M10 **ne sont pas créées**. La liste et l'algorithme (Pâques, fêtes musulmanes « estimées ») sont ceux de M10 RG-M10-10 et M15 RG-M15-08. |
| A2 | **Liens publics (portail)** | Mécanisme unique : `PortalToken` de **M14** (jeton haché, portée, expiration, révocation). Les champs `publicToken` sur `Quote`, `Invoice`, `RepairOrder`, `Appointment` ne stockent que le **hash** et servent de raccourci de recherche ; toute création/révocation passe par `portal.createToken` / `portal.revokeToken`. |
| A3 | **Taux horaires de main-d'œuvre** | Clé `settings.labor.rates` (M15). Défauts : STANDARD 15 000, DIAGNOSTIC 20 000, BODYWORK 15 000, ELECTRICAL 18 000 FCFA HT/h. La clé `settings.laborRates` citée dans M04 désigne la même chose. |
| A4 | **Numérotation** | Documents fiscaux numérotés **par organisation** (`siteId = null`) : `FAC`, `AV`, `REC`. Documents opérationnels numérotés **par site** : `OR`, `DEV`, `BC`, `INV`, `TR`, `SIN`. |
| A5 | **Permissions** | Catalogue unique dans **M01 §10**. Un module qui a besoin d'une permission absente l'ajoute à M01 dans le même commit. |
| A6 | **Authentification** | Better Auth gère uniquement l'authentification (`Session`, `Account`, `Verification`). Rôles et permissions restent dans `Membership` + `RolePermission`. `User.passwordHash` est retiré (mot de passe dans `Account`). |
| A7 | **Relances de l'assureur** | Gérées par `ClaimFollowUp` (M16), pas par `Reminder` (M10), car un assureur n'est pas forcément un `Customer`. Elles utilisent néanmoins `messaging.enqueue` (M11) et le même calendrier (A1). |
| A8 | **Travaux conseillés refusés** | Ajout de `RECOMMENDED_WORK` à l'enum `ReminderType`, alimenté par `VehicleRecommendation` (M04). Règle par défaut : rappel à J+30 et J+90 après le refus, modèle WhatsApp/SMS à rédiger dans le style de M10 Annexe A. |
| A9 | **Anti-spam** | Les plafonds de M10 s'appliquent **par adresse** (téléphone/email) et pas par fiche client, et englobent tous les types de relances, y compris `RECOMMENDED_WORK` et les relances de créance de M09. Les messages transactionnels (M11) n'y sont pas soumis. |
| A10 | **Attribution des encaissements** | Une seule règle, celle de **M12** : fenêtre de 14 jours, la dernière relance (ou appel tracé M09) avant le paiement est créditée. M09 et M10 l'utilisent via `core/receivables/attribution` et la table `PaymentAttribution` (M09). |
| A11 | **Consentement** | `remindersConsent = true` par défaut (intérêt légitime, relation client existante), STOP toujours respecté. À faire valider par le garage auprès de l'ARTCI ; prévoir un paramètre pour passer à un consentement explicite. |
| A12 | **Valeurs par défaut commerciales** | Les quotas par plan (messages, crédits IA, requêtes API) et limites d'utilisateurs/sites sont **ceux de M15** ; ce sont des hypothèses à valider commercialement, centralisées dans `core/billing/plans.ts`. |
| A13 | **Anciens numéros ivoiriens à 8 chiffres** | `core/phone` convertit les anciens numéros vers le format à 10 chiffres à partir de la table officielle ARTCI, à compléter dans `core/phone/legacy-ci.ts`. Tant qu'elle n'est pas complète, un numéro à 8 chiffres est signalé « à vérifier » à l'import au lieu d'être deviné. |

## 3. Champs à créer dès la phase 0 (utilisés par plusieurs modules)

Pour éviter des migrations en cascade, l'étape 0.2 ajoute dès le départ au schéma de `02` :

- **`organizationId` sur toutes les tables enfants** qui n'en ont pas dans 02 : `InspectionItem`, `QuoteLine`, `InvoiceLine`, `PurchaseOrderLine`, `PaymentAllocation`, `PaymentPromise`, `CollectionNote`, `ImportRowError`. Obligatoire pour la RLS.
- `RepairOrder.bayId`, `Membership.pinHash`.
- `Holiday` (M15 §14).
- `PortalToken` (M14 §14).
- Enum `RecordOrigin` et champ `origin` sur `Customer`, `Vehicle`, `Invoice`, `Payment`, `RepairOrder` (M13 §14) — nécessaire au mode `REMINDERS_ONLY` dès le Jalon A.
- `Reminder` : champs de M10 §14 (`groupKey`, `messageId`, `priority`, etc.) et `ReminderSuppression`.
- `Message.idempotencyKey` et `MessageStatusEvent` (M11 §14).
- `ReminderType.RECOMMENDED_WORK` (A8).

## 4. Événements de domaine (complète 01 §5)

En plus de ceux de 01 §5, les modules émettent/consomment :

| Événement | Émis par | Consommé par |
|---|---|---|
| `vehicle.service_recorded` | M02, M04 | M10 (nouvelle échéance de révision) |
| `vehicle.owner_changed` | M02 | M10 (annule les relances de l'ancien propriétaire) |
| `vehicle.insurance_updated` | M02 | M10 (`INSURANCE_EXPIRY`) |
| `repair_order.created` | M04 | M03 (RDV → ARRIVED), M09 (contrôle du crédit) |
| `collection.opened / stage_changed / promise_broken / closed` | M09 | M10, M12 |
| `credit.override_requested / granted / denied` | M09 | M04, M11 (notif gérant) |
| `customer.opted_out / opted_in` | M11 | M10 (annule / réactive) |
| `message.status_changed` | M11 | M10 (résultat), M12 |
| `message.failed_all` | M11 | M10 (relance en échec), M12 (alerte) |
| `reminder.planned / sent / skipped / outcome_recorded` | M10 | M12, M17 (apprentissage du meilleur moment) |

## 5. Ordre de vérité final

`04-arbitrages-coherence.md` > `02-modele-donnees.md` (+ §14 des modules implémentés) > `00-vision-produit.md` > `01-architecture-technique.md` > PRD de module.
