# M01 — Comptes, rôles, multi-garages, multi-sites

> Priorité : **P0** · Dépend de : aucun (module socle) · Utilisé par : tous les modules · Rôles concernés : tous (`OWNER` en premier lieu)

## 1. Objectif

Permettre à un garage de créer son espace AtelierOS en moins de 10 minutes, d'y faire entrer son équipe avec les bons droits, et de garantir que chacun ne voit et ne fait que ce qui le concerne. Le module fournit l'authentification (mot de passe + OTP WhatsApp/SMS), l'isolation stricte entre organisations, la gestion des sites physiques, le catalogue des permissions `module:action` utilisé par tous les autres modules, et le journal d'audit consultable. Il héberge aussi l'**assistant de première configuration** (onboarding).

## 2. Utilisateurs et cas d'usage

| Rôle                       | Ce qu'il fait dans M01                                                                                            | Fréquence               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Futur client (non inscrit) | Crée son compte et son garage via l'assistant                                                                     | Une fois                |
| `OWNER`                    | Invite l'équipe, change les rôles, ajuste les permissions, ajoute un site, consulte l'audit, révoque des sessions | Hebdomadaire            |
| `MANAGER`                  | Invite des mécaniciens (si permission), change de site actif                                                      | Mensuelle               |
| Tous                       | Se connectent (email ou téléphone), réinitialisent leur mot de passe, gèrent leur profil et leurs sessions        | Quotidienne             |
| `MECHANIC`                 | Se connecte sur une tablette partagée avec son code PIN                                                           | Plusieurs fois par jour |
| `ACCOUNTANT` externe       | Appartient à plusieurs organisations (cabinet comptable), passe de l'une à l'autre                                | Hebdomadaire            |

## 3. User stories

**US-M01-01 — En tant que gérant, je veux créer mon compte avec mon numéro de téléphone afin de démarrer sans adresse email.**

- Étant donné un visiteur sur `/inscription`, quand il saisit « Konan Serge », « 07 08 12 34 56 » et un mot de passe valide, alors un OTP à 6 chiffres lui est envoyé par WhatsApp (repli SMS si WhatsApp échoue ou après 45 s sans accusé « délivré »).
- Étant donné l'OTP correct saisi dans les 5 minutes, alors le `User` est créé avec `phone = "+2250708123456"`, le téléphone est marqué vérifié, et il est redirigé vers `/bienvenue` (assistant).
- Étant donné un numéro déjà associé à un `User`, alors le message « Ce numéro a déjà un compte. Connectez-vous ou réinitialisez votre mot de passe. » s'affiche (sans révéler d'autre information).

**US-M01-02 — En tant que gérant, je veux être guidé pas à pas pour configurer mon garage afin d'être opérationnel le jour même.**

- Étant donné un utilisateur sans organisation, quand il ouvre l'application, alors il est redirigé vers `/bienvenue` à l'étape non terminée.
- Étant donné l'étape « Garage » remplie (nom « Garage Excellence Auto », commune « Yopougon »), quand il clique « Continuer », alors l'`Organization`, un premier `Site` (code « YOP » proposé à partir de la commune), sa `Membership` `OWNER` et les règles par défaut (modèles de messages, règles de relance, modèle d'inspection, catalogue MO de base) sont créés dans une seule transaction.
- Étant donné un départ au milieu de l'assistant, quand il revient deux jours plus tard, alors il reprend à la même étape avec les données déjà saisies.
- Étant donné les étapes facultatives (équipe, canaux, import), quand il clique « Plus tard », alors l'étape est marquée « passée » et une carte « Terminer la configuration » reste visible sur le tableau de bord jusqu'à complétion.

**US-M01-03 — En tant qu'utilisateur, je veux me connecter avec mon email ou mon téléphone et mon mot de passe.**

- Étant donné la saisie « 0708123456 », « +225 07 08 12 34 56 » ou « 07.08.12.34.56 », alors l'identifiant est normalisé en `+2250708123456` avant la recherche.
- Étant donné 5 échecs consécutifs en 15 minutes sur un même compte, alors le compte est verrouillé 15 minutes, le message « Trop de tentatives. Réessayez dans 15 minutes ou réinitialisez votre mot de passe. » s'affiche, et une entrée `auth.locked` est écrite dans l'audit de chaque organisation du compte.
- Étant donné un identifiant inexistant, alors le message est identique à celui d'un mauvais mot de passe : « Identifiant ou mot de passe incorrect. »

**US-M01-04 — En tant qu'utilisateur, je veux réinitialiser mon mot de passe par OTP afin de ne pas dépendre d'un email.**

- Étant donné un compte avec téléphone vérifié, quand je demande la réinitialisation, alors un OTP est envoyé (WhatsApp puis SMS) ; après saisie correcte, je définis un nouveau mot de passe et **toutes mes autres sessions sont révoquées**.
- Étant donné un compte avec email seulement, alors un lien valable 30 minutes est envoyé par email.

**US-M01-05 — En tant que gérant, je veux inviter un employé par WhatsApp, SMS ou email avec un rôle et des sites afin qu'il rejoigne l'équipe sans que je crée son mot de passe.**

- Étant donné l'invitation de « Coulibaly Drissa », `MECHANIC`, site « YOP », téléphone « 05 44 10 92 38 », alors une `Invitation` est créée (validité 7 jours) et un message contenant le lien `/invitation/[token]` est envoyé via le canal choisi (en mode `wa_link`, un bouton « Ouvrir dans WhatsApp » pré-remplit le message).
- Étant donné l'invité qui ouvre le lien, quand son numéro n'a pas de compte, alors il choisit un mot de passe, vérifie son téléphone par OTP et arrive directement sur son écran de rôle (PWA mécanicien pour `MECHANIC`).
- Étant donné un numéro qui a déjà un compte (ex. comptable d'un cabinet), alors il se connecte et la `Membership` est ajoutée à son compte existant.
- Étant donné une invitation expirée ou révoquée, alors « Cette invitation n'est plus valable. Demandez une nouvelle invitation à votre gérant. » s'affiche.
- Étant donné la limite d'utilisateurs du plan atteinte, alors l'invitation est refusée avec « Votre offre STARTER permet 5 utilisateurs actifs. »

**US-M01-06 — En tant que gérant, je veux modifier le rôle et les permissions d'un membre afin d'adapter ses droits à la réalité.**

- Étant donné Mme Bamba `ADVISOR`, quand je lui ajoute `invoice:void`, alors la permission apparaît comme « ajoutée » (surcharge) et elle peut annuler une facture dès sa requête suivante (les permissions sont relues à chaque requête, pas mises en cache plus de 60 s).
- Étant donné la tentative de retirer le rôle `OWNER` au dernier `OWNER` actif, alors l'action est refusée : « L'organisation doit garder au moins un gérant. »
- Étant donné toute modification, alors une entrée d'audit `member.role_changed` ou `member.permissions_changed` avec avant/après est créée.

**US-M01-07 — En tant que gérant, je veux modifier les permissions par défaut d'un rôle pour tout mon garage.**

- Étant donné `/parametres/roles`, quand je retire `quote:discount_override` au rôle `MANAGER`, alors tous les `MANAGER` sans surcharge contraire perdent ce droit.
- Étant donné le bouton « Rétablir les valeurs par défaut », alors la matrice du §10.2 est restaurée pour ce rôle.

**US-M01-08 — En tant que gérant d'un réseau, je veux créer un deuxième site et limiter certains employés à ce site.**

- Étant donné le plan `PRO`, quand je crée « Atelier Cocody » (code « COC »), alors le site apparaît dans le sélecteur de site, avec ses horaires et ses ponts.
- Étant donné un `CASHIER` avec `siteIds = [COC]`, alors il ne voit ni les OR, ni les factures, ni la caisse de « YOP » ; il voit en revanche les clients et véhicules (données d'organisation partagées).
- Étant donné le plan `STARTER`, alors « Ajouter un site » affiche « Passez à l'offre PRO pour gérer plusieurs ateliers. »

**US-M01-09 — En tant qu'utilisateur multi-sites, je veux changer de site actif en un clic.**

- Étant donné le sélecteur en haut de l'écran, quand je choisis « Atelier Cocody », alors le site actif est enregistré dans ma session, les listes se rechargent filtrées et les nouveaux documents sont créés sur ce site.
- Étant donné l'option « Tous les sites » (si j'ai accès à plus d'un site), alors les listes et le tableau de bord sont consolidés, mais les boutons de création demandent de choisir un site.

**US-M01-10 — En tant que comptable externe, je veux basculer entre les garages dont je m'occupe.**

- Étant donné un `User` membre de deux organisations, alors le menu profil liste les deux ; le changement d'organisation recharge l'application dans le contexte de la nouvelle, sans nouvelle connexion.
- Étant donné un onglet resté ouvert sur l'organisation A, quand une action est envoyée après bascule vers B, alors le serveur rejette avec « Le garage actif a changé. Rechargez la page. » (l'`organizationId` attendu est envoyé dans l'en-tête `x-org-id` et comparé à la session).

**US-M01-11 — En tant que mécanicien sur une tablette partagée, je veux me connecter avec mon code PIN afin de ne pas retaper un mot de passe 10 fois par jour.**

- Étant donné une tablette déclarée « appareil partagé d'atelier » par un `MANAGER`, quand je touche ma photo et tape mon PIN à 4 chiffres, alors une session courte (12 h, limitée au layout `(tech)`) s'ouvre à mon nom.
- Étant donné 5 PIN faux, alors mon PIN est bloqué et je dois me connecter par mot de passe.

**US-M01-12 — En tant que gérant, je veux consulter le journal d'audit afin de savoir qui a annulé une facture ou modifié un prix.**

- Étant donné `/parametres/journal`, quand je filtre « Action = invoice.void », « du 01/10/2026 au 18/10/2026 », alors je vois date, utilisateur, document (lien), motif, IP et un détail avant/après en diff lisible.
- Étant donné le bouton « Exporter », alors un CSV des résultats filtrés (max 50 000 lignes) est généré.
- Aucune interface ne permet de modifier ou supprimer une entrée.

**US-M01-13 — En tant qu'utilisateur, je veux voir mes sessions actives et déconnecter un appareil perdu.**

- Étant donné `/profil/securite`, alors je vois appareil, navigateur, ville approximative (IP), dernière activité ; « Déconnecter » révoque la session immédiatement.
- Étant donné un gérant, sur la fiche d'un membre, « Déconnecter partout » révoque toutes ses sessions (ex. téléphone volé).

**US-M01-14 — En tant que gérant, je veux désactiver un employé qui quitte le garage sans perdre l'historique.**

- Étant donné Traoré Moussa `ADVISOR` désactivé, alors ses sessions sont révoquées, il ne peut plus se connecter à cette organisation, son nom reste affiché sur les OR, devis et audits passés.
- Étant donné qu'il a 3 OR ouverts et 12 relances à valider assignés, alors l'écran de désactivation propose de les réaffecter à un autre membre avant confirmation.

## 4. Règles métier

**RG-M01-01 — Identifiant.** Un `User` a au moins un identifiant : `email` ou `phone`. Les deux sont uniques globalement (un humain = un compte, plusieurs organisations possibles). Email stocké en minuscules, sans espaces.

**RG-M01-02 — Normalisation téléphone.** Tout téléphone passe par `core/phone.normalize()` (spécifiée dans M02, RG-M02-03). Un numéro non normalisable est refusé : « Numéro invalide. Exemple : 07 08 12 34 56. »

**RG-M01-03 — Mot de passe.** 8 caractères minimum, au moins une lettre et un chiffre, refusé s'il figure dans la liste des 10 000 mots de passe les plus courants (+ « garage », nom du garage, numéro de téléphone). Haché en argon2id. Aucune expiration périodique imposée.

**RG-M01-04 — OTP.** 6 chiffres, valable 5 minutes, usage unique, 3 essais maximum puis invalidé. Nouveau code possible après 60 s ; maximum 5 envois par heure et par numéro, 10 par heure et par IP. Ordre d'envoi : WhatsApp (modèle d'authentification Meta) → SMS. Les OTP de connexion utilisent les **canaux de la plateforme** (variables `PLATFORM_WHATSAPP_*`, `PLATFORM_SMS_*`), pas ceux du garage, car aucune organisation n'est encore connue. Texte : « AtelierOS : votre code est 482913. Il expire dans 5 minutes. Ne le communiquez à personne. »

**RG-M01-05 — Verrouillage.** 5 échecs consécutifs → verrou 15 min ; un nouvel échec après déverrouillage (sans succès intermédiaire) → verrou 1 h et notification interne aux `OWNER`. Le compteur repasse à 0 après une connexion réussie. Limitation par IP : 20 tentatives / 15 min toutes identités confondues. Un verrou ne bloque pas la réinitialisation par OTP, qui le lève.

**RG-M01-06 — Sessions.** Session web : expiration après 7 jours d'inactivité, durée absolue 30 jours. Session PIN d'atelier : 12 h, limitée aux routes `(tech)`. Révocation immédiate en cas de : changement de mot de passe (sauf la session courante), désactivation du membre, « Déconnecter partout ». La session porte `activeOrganizationId` et `activeSiteId`.

**RG-M01-07 — Nouvel appareil.** Si l'organisation active `settings.security.otpOnNewDevice` (défaut : activé pour `OWNER` et `ACCOUNTANT`), une connexion depuis un appareil non approuvé demande un OTP ; l'appareil est ensuite approuvé 90 jours (`TrustedDevice`).

**RG-M01-08 — Résolution des permissions effectives.**

```
effective(membership) =
  si role = OWNER → toutes les permissions du catalogue
  sinon → (rolePermissions(org, role) ∪ grants) − revokes
rolePermissions(org, role) = RolePermission(org, role).permissions si présent, sinon DEFAULT_ROLE_PERMISSIONS[role] (§10.2)
grants  = Membership.permissions sans préfixe   (ex. "invoice:void")
revokes = Membership.permissions préfixées "!"  (ex. "!stock:adjust")
```

Fonction pure `core/auth/permissions.ts#resolvePermissions`. Une permission inconnue du catalogue est ignorée et journalisée en avertissement.

**RG-M01-09 — Portée par site.** `Membership.siteIds` vide = tous les sites. Sinon, toute entité portant `siteId` (Appointment, RepairOrder, Quote, Invoice, Payment, CashSession, StockLevel, PurchaseOrder…) hors de ces sites est invisible (filtrée au niveau `db.forTenant(ctx)`) et toute écriture est refusée (`FORBIDDEN_SITE`). Les entités d'organisation (Customer, Vehicle, Product, modèles) restent visibles.

**RG-M01-10 — Site actif.** Au login, `activeSiteId` = dernier site utilisé si toujours autorisé, sinon le premier site autorisé par ordre alphabétique. « Tous les sites » (`activeSiteId = null`) n'est proposé que si l'utilisateur a accès à ≥ 2 sites. Toute création de document exige un `siteId` concret.

**RG-M01-11 — Dernier gérant.** Une organisation a toujours ≥ 1 `Membership` `OWNER` active. Interdit : désactiver, rétrograder ou supprimer le dernier.

**RG-M01-12 — Invitations.** Jeton aléatoire 32 octets (base64url), stocké haché (SHA-256). Validité 7 jours. Une invitation en attente par (organisation, téléphone/email) : en réinviter une nouvelle révoque l'ancienne. Un `MANAGER` avec `member:invite` ne peut inviter que des rôles « inférieurs » : `MECHANIC`, `STOREKEEPER`, `CASHIER`, `ADVISOR` ; seul un `OWNER` invite `OWNER`, `MANAGER`, `ACCOUNTANT`.

**RG-M01-13 — Limites de plan** (valeurs par défaut, configurables dans M15) : `STARTER` 5 utilisateurs actifs, 1 site ; `PRO` 15 utilisateurs, 3 sites ; `NETWORK` illimité. Les `Membership` désactivées ne comptent pas.

**RG-M01-14 — PIN atelier.** 4 chiffres, haché (argon2id), refus des suites triviales (0000, 1234, 1111…). Utilisable uniquement sur un appareil enregistré comme partagé (`TrustedDevice.isSharedWorkshopDevice = true`) et uniquement pour les rôles `MECHANIC`, `STOREKEEPER`, `MANAGER`.

**RG-M01-15 — Audit.** Toute écriture sensible appelle `audit.log({ action, entity, entityId, before, after, reason })`. M01 journalise : `auth.login.success`, `auth.login.failed`, `auth.locked`, `auth.password_reset`, `auth.otp_new_device`, `member.invited`, `member.joined`, `member.role_changed`, `member.permissions_changed`, `member.sites_changed`, `member.deactivated`, `member.reactivated`, `role.permissions_changed`, `site.created`, `site.updated`, `site.deactivated`, `org.updated`, `session.revoked`, `org.switched`. Les champs secrets (hash, jetons) ne sont jamais copiés dans `before/after`. La table `AuditLog` est en ajout seul : RLS + `REVOKE UPDATE, DELETE` pour le rôle applicatif. Rétention : 5 ans minimum (alignée sur la conservation des pièces comptables).

**RG-M01-16 — Onboarding : valeurs semées à la création de l'organisation.**

- `Organization` : `vatRate 18`, `vatEnabled true`, `timezone Africa/Abidjan`, `currency XOF`, `operatingMode` choisi.
- `Site` : horaires par défaut lun-ven 07:30–18:00, sam 08:00–14:00, dimanche fermé ; 2 ponts « Pont 1 », « Pont 2 » (`LIFT`) + « Diagnostic » (`DIAGNOSTIC`), modifiables.
- `ReminderRule` par défaut (VT J-30/J-7/J-0, révision J-15/J-0, créances J+3/J+15/J+30/J+45, RDV J-1, devis, véhicule prêt) — contenu défini par M10.
- `MessageTemplate` par défaut (M11), `InspectionTemplate` « Inspection 30 points » (M04), ~25 `LaborOperation` courantes (M05), `DocumentSequence` initialisées à la demande.
- `ChannelConfig` WhatsApp en mode `wa_link` actif (fonctionne sans compte Meta) et EMAIL `console` désactivé.

**RG-M01-17 — Étapes de l'assistant** (`/bienvenue`, état dans `Organization.settings.onboarding = { step, skipped[], completedAt }`) :

| #   | Étape   | Obligatoire | Contenu                                                                                                                                                                                     |
| --- | ------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Compte  | Oui         | Nom, téléphone et/ou email, mot de passe, vérification OTP (fait à l'inscription)                                                                                                           |
| 2   | Garage  | Oui         | Nom commercial, raison sociale, commune, adresse, téléphone, régime fiscal (`TaxRegime`), assujetti TVA oui/non, RCCM, NCC (facultatifs mais rappelés : « Obligatoires pour la FNE »), logo |
| 3   | Atelier | Oui         | Nom et code du site, horaires (grille 7 jours), ponts (liste éditable avec type), taux horaire MO par défaut (15 000 FCFA/h proposé)                                                        |
| 4   | Mode    | Oui         | « Je gère tout dans AtelierOS » (`FULL`) ou « Je garde mon logiciel, je veux les relances » (`REMINDERS_ONLY`) — explication illustrée                                                      |
| 5   | Équipe  | Non         | Invitations multiples (nom, téléphone, rôle)                                                                                                                                                |
| 6   | Canaux  | Non         | WhatsApp (lien wa.me par défaut / API Meta), SMS, email ; bouton « Envoyer un test à mon numéro »                                                                                           |
| 7   | Données | Non         | Importer un fichier (lien vers M13), saisir un premier client, ou « Charger des données de démonstration » (marquées `source = "demo"`, supprimables en un clic)                            |
| 8   | Terminé | —           | Récapitulatif + 3 actions suggérées selon le mode (FULL : « Créer mon premier OR » ; REMINDERS_ONLY : « Importer mes clients »)                                                             |

En mode `REMINDERS_ONLY`, l'étape 3 ne demande pas les ponts ni le taux horaire, et la navigation masque OR/devis/stock/caisse (M15).

## 5. Machine à états

**Invitation** : `PENDING` → `ACCEPTED` (l'invité termine) · `PENDING` → `REVOKED` (gérant ou nouvelle invitation) · `PENDING` → `EXPIRED` (calculé : `expiresAt < now`, pas de job nécessaire).

**Membership** (via `isActive`) : actif ⇄ désactivé. Désactiver : révoque les sessions de cet utilisateur pour cette organisation, émet `member.deactivated`. Réactiver : contrôle de la limite du plan.

**Compte utilisateur (verrou)** : normal → verrouillé (`lockedUntil > now`) → normal (expiration ou réinitialisation OTP).

## 6. Données

Entités de `02` utilisées : `Organization`, `Site`, `Bay`, `User`, `Membership`, `AuditLog`, `Notification`, `DocumentSequence` (initialisation), `ChannelConfig`, `ReminderRule`, `MessageTemplate`, `InspectionTemplate`, `LaborOperation` (semences).

Better Auth est utilisé **pour l'authentification seulement** (identifiants, mots de passe, OTP, sessions). Les organisations, rôles et permissions sont gérés par AtelierOS (`Organization`, `Membership`) et non par le plugin « organization » de Better Auth. Le modèle `user` de Better Auth est mappé sur `User` ; les tables `Session`, `Account`, `Verification` sont ajoutées (§14).

Contexte serveur (`apps/web/server/context.ts`) :

```ts
type Ctx = {
  user: { id: string; name: string } | null;
  session: {
    id: string;
    activeOrganizationId: string | null;
    activeSiteId: string | null;
    isPinSession: boolean;
  } | null;
  membership: { id: string; role: Role; siteIds: string[] } | null;
  permissions: Set<Permission>;
  allowedSiteIds: string[] | "ALL";
  ip: string;
  userAgent: string;
};
```

## 7. Écrans et interface

| Route                                     | Contenu                                                                                                                                                                                                     | Actions                                                                 | Mobile                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `/(auth)/connexion`                       | Logo, champ unique « Email ou téléphone », mot de passe, « Mot de passe oublié ? », lien « Créer mon garage »                                                                                               | Se connecter ; si OTP nouvel appareil requis → écran code               | Une colonne, clavier numérique si l'entrée commence par un chiffre |
| `/(auth)/inscription`                     | Nom, téléphone, email (facultatif), mot de passe avec jauge de robustesse, case CGU + consentement données                                                                                                  | Créer → écran OTP                                                       | Idem                                                               |
| `/(auth)/verification`                    | 6 cases OTP, compte à rebours de renvoi (60 s), « Recevoir par SMS »                                                                                                                                        | Valider, renvoyer, changer de canal                                     | Saisie auto du code (`autocomplete="one-time-code"`)               |
| `/(auth)/mot-de-passe-oublie`             | Identifiant → OTP ou lien email → nouveau mot de passe                                                                                                                                                      |                                                                         |                                                                    |
| `/(auth)/invitation/[token]`              | « Garage Excellence Auto vous invite comme Mécanicien » ; création du mot de passe ou connexion                                                                                                             | Accepter                                                                |                                                                    |
| `/(auth)/tablette/connexion`              | Grille de photos des membres autorisés sur cet appareil partagé + pavé PIN                                                                                                                                  | Choisir, saisir PIN                                                     | Pensé tablette paysage                                             |
| `/(app)/bienvenue`                        | Assistant en 8 étapes (stepper horizontal sur PC, vertical sur mobile), barre de progression, « Plus tard » sur les étapes facultatives                                                                     | Continuer, Retour, Plus tard                                            | Une étape par écran                                                |
| `/(app)/parametres/equipe`                | Tableau : nom, rôle (badge), sites, téléphone, dernière connexion, statut (Actif / Invité / Désactivé) ; onglet « Invitations en attente »                                                                  | Inviter, modifier, désactiver, renvoyer/révoquer une invitation         | Cartes empilées                                                    |
| `/(app)/parametres/equipe/[membershipId]` | Identité, rôle, sites (cases), permissions effectives groupées par module avec indicateur « par défaut / ajoutée / retirée », coût horaire et compétences (mécaniciens, utilisés par M06), sessions actives | Enregistrer, Déconnecter partout, Définir/réinitialiser PIN, Désactiver |                                                                    |
| `/(app)/parametres/roles`                 | Matrice permissions × rôles (cases), groupée par module, recherche ; colonne `OWNER` grisée (tout coché)                                                                                                    | Enregistrer, Rétablir les défauts                                       | Sélecteur de rôle puis liste                                       |
| `/(app)/parametres/sites`                 | Liste des sites ; fiche site : nom, code, adresse, commune, téléphone, WhatsApp, horaires, ponts (liste réordonnable, type, actif)                                                                          | Ajouter, modifier, désactiver un site/pont                              |                                                                    |
| `/(app)/parametres/journal`               | Tableau paginé (curseur) : date, utilisateur, action (libellé français), document (lien), motif, IP ; panneau latéral avant/après en diff                                                                   | Filtres : utilisateur, action, entité, période, site ; Exporter CSV     | Liste compacte                                                     |
| `/(app)/profil`                           | Nom, avatar, téléphone/email (changement avec OTP), mot de passe, langue                                                                                                                                    |                                                                         |                                                                    |
| `/(app)/profil/securite`                  | Sessions, appareils approuvés                                                                                                                                                                               | Déconnecter, retirer un appareil                                        |                                                                    |

**En-tête global** : sélecteur d'organisation (si > 1), sélecteur de site (si > 1 site autorisé, avec « Tous les sites »), cloche des notifications, menu profil. Navigation filtrée selon les permissions (un `MECHANIC` connecté sur le web est redirigé vers `(tech)`).

**États** : squelettes pendant le chargement ; erreur réseau → bandeau « Connexion perdue, nouvel essai… » ; page 403 « Vous n'avez pas accès à cette page. Demandez l'autorisation à votre gérant. » avec le nom de la permission manquante en petit.

## 8. API

Procédures tRPC (routeur `auth`, `org`, `member`, `site`, `audit`) :

| Procédure                                                          | Entrée                                                                              | Sortie                                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `auth.signUp`                                                      | `{ name, phone?, email?, password, acceptTerms: true }`                             | `{ userId, otpChannel: 'WHATSAPP' \| 'SMS' \| 'EMAIL' }`                                   |
| `auth.sendOtp`                                                     | `{ identifier, purpose: 'VERIFY' \| 'RESET' \| 'NEW_DEVICE' \| 'LOGIN', channel? }` | `{ sentVia, retryAfterSec }`                                                               |
| `auth.verifyOtp`                                                   | `{ identifier, code, purpose }`                                                     | `{ ok, resetToken? }`                                                                      |
| `auth.signIn`                                                      | `{ identifier, password, deviceId }`                                                | `{ status: 'OK' \| 'OTP_REQUIRED' \| 'LOCKED', lockedUntil? }`                             |
| `auth.resetPassword`                                               | `{ resetToken, newPassword }`                                                       | `{ ok }`                                                                                   |
| `auth.pinSignIn`                                                   | `{ deviceId, membershipId, pin }`                                                   | `{ ok }`                                                                                   |
| `auth.signOut`                                                     | —                                                                                   | `{ ok }`                                                                                   |
| `session.list` / `session.revoke`                                  | `{ sessionId }`                                                                     | sessions `{ id, device, ip, city, lastActiveAt, current }[]`                               |
| `session.setActiveOrganization`                                    | `{ organizationId }`                                                                | `{ ok }`                                                                                   |
| `session.setActiveSite`                                            | `{ siteId \| null }`                                                                | `{ ok }`                                                                                   |
| `me.get`                                                           | —                                                                                   | `{ user, organizations[], activeOrganization, membership, permissions[], allowedSites[] }` |
| `onboarding.get`                                                   | —                                                                                   | `{ step, skipped, data }`                                                                  |
| `onboarding.saveStep`                                              | `{ step, data }` (union Zod par étape)                                              | `{ nextStep }`                                                                             |
| `onboarding.loadDemoData` / `onboarding.purgeDemoData`             | —                                                                                   | `{ counts }`                                                                               |
| `org.get` / `org.update`                                           | champs `Organization` (sauf `plan`)                                                 | `Organization`                                                                             |
| `site.list` / `site.create` / `site.update` / `site.deactivate`    | champs `Site` + `bays[]`                                                            | `Site`                                                                                     |
| `member.list`                                                      | `{ status?, role?, siteId?, cursor }`                                               | page de membres                                                                            |
| `member.get`                                                       | `{ membershipId }`                                                                  | membre + permissions effectives annotées                                                   |
| `member.invite`                                                    | `{ name, phone?, email?, role, siteIds, channel }`                                  | `{ invitationId, waLink? }`                                                                |
| `member.resendInvitation` / `member.revokeInvitation`              | `{ invitationId }`                                                                  | `{ ok }`                                                                                   |
| `invitation.preview` (public)                                      | `{ token }`                                                                         | `{ orgName, role, inviterName, expiresAt }`                                                |
| `invitation.accept` (public)                                       | `{ token, password? }`                                                              | `{ ok }`                                                                                   |
| `member.update`                                                    | `{ membershipId, role?, siteIds?, permissions?, hourlyCost?, skills? }`             | membre                                                                                     |
| `member.deactivate`                                                | `{ membershipId, reassignTo?: membershipId, reason }`                               | `{ reassignedCounts }`                                                                     |
| `member.reactivate`                                                | `{ membershipId }`                                                                  | membre                                                                                     |
| `member.setPin`                                                    | `{ membershipId, pin }`                                                             | `{ ok }`                                                                                   |
| `member.revokeAllSessions`                                         | `{ membershipId }`                                                                  | `{ revokedCount }`                                                                         |
| `role.getMatrix` / `role.updatePermissions` / `role.resetDefaults` | `{ role, permissions[] }`                                                           | matrice                                                                                    |
| `device.registerShared`                                            | `{ deviceId, label }`                                                               | `{ ok }`                                                                                   |
| `audit.list`                                                       | `{ userId?, action?, entity?, entityId?, siteId?, from, to, cursor }`               | page `AuditLog`                                                                            |
| `audit.export`                                                     | mêmes filtres                                                                       | `{ fileUrl }` (URL signée, job asynchrone)                                                 |

Middlewares tRPC : `publicProcedure`, `authedProcedure` (session valide), `orgProcedure` (organisation active + `Membership` active + contrôle `x-org-id`), `requirePermission(...perms)`, `requireSite(siteIdFromInput)`.

API REST publique : aucune (l'API `/api/v1` s'authentifie par `ApiKey`, gérée dans M13).

## 9. Automatisations et événements

| Événement émis         | Quand                      | Consommateurs                                                |
| ---------------------- | -------------------------- | ------------------------------------------------------------ |
| `member.invited`       | invitation créée           | M11 (envoi du message)                                       |
| `member.joined`        | invitation acceptée        | M12 (notification gérant)                                    |
| `member.deactivated`   | désactivation              | M06 (retrait du planning), M10 (réaffectation des relances)  |
| `organization.created` | fin étape 2 de l'assistant | semences (RG-M01-16), M17 (profil du garage)                 |
| `site.created`         | création d'un site         | M07 (création des `StockLevel` à la demande), M03 (capacité) |

Tâches worker : `auth.cleanup` (quotidienne 04:00) — purge des `Verification` expirées, des sessions expirées depuis 30 jours, marquage des invitations expirées. Notifications internes : verrouillage d'un compte (aux `OWNER`), nouvelle connexion `OWNER` depuis un nouvel appareil (au titulaire, par WhatsApp/email).

**IA (M17)** : à l'étape « Garage », M17 peut suggérer le code de site et les horaires à partir du nom/commune ; à l'étape « Données », il aide au mapping de l'import (M13). Aucune décision de droits n'est confiée à l'IA.

## 10. Permissions

### 10.1 Catalogue complet (`packages/core/auth/permissions.ts`, constante `PERMISSIONS`)

| Module                         | Permissions                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organisation (M01/M15)         | `org:read`, `org:update`, `site:manage`, `member:read`, `member:invite`, `member:update`, `member:deactivate`, `role:manage`, `audit:read`, `settings:read`, `settings:update`, `settings:channels`, `settings:payments`, `settings:fne`, `settings:billing`                                                                                              |
| Clients / véhicules (M02)      | `customer:read`, `customer:create`, `customer:update`, `customer:delete`, `customer:merge`, `customer:export`, `customer:consent`, `customer:credit`, `vehicle:read`, `vehicle:create`, `vehicle:update`, `vehicle:delete`, `vehicle:transfer`, `vehicle:mileage_correct`                                                                                 |
| RDV (M03)                      | `appointment:read`, `appointment:create`, `appointment:update`, `appointment:cancel`, `planning:manage`                                                                                                                                                                                                                                                   |
| OR (M04)                       | `repair_order:read`, `repair_order:create`, `repair_order:update`, `repair_order:assign`, `repair_order:qc`, `repair_order:deliver`, `repair_order:deliver_unpaid`, `repair_order:cancel`, `repair_order:reopen`, `repair_order:warranty_decide`, `inspection:perform`, `inspection:template_manage`                                                      |
| Devis (M05)                    | `quote:read`, `quote:create`, `quote:update`, `quote:send`, `quote:record_decision`, `quote:discount_override`, `quote:delete`, `labor_catalog:manage`                                                                                                                                                                                                    |
| Atelier (M06)                  | `task:read_own`, `task:read_all`, `time:clock`, `time:edit`, `attendance:manage`, `workshop:view`, `workshop:qc_self`, `partrequest:create`, `workshop:subcontract`, `workshop:productivity`                                                                                                                                                              |
| Stock (M07)                    | `stock:read`, `stock:issue`, `stock:receive`, `stock:adjust`, `stock:transfer`, `product:manage`, `product:view_cost`, `purchase:read`, `purchase:create`, `purchase:approve`, `supplier:manage`, `stock:reserve`, `stock:count`, `stock:count_validate`, `stock:valuation`                                                                               |
| Facturation (M08)              | `invoice:read`, `invoice:create`, `invoice:issue`, `invoice:void`, `invoice:credit_note`, `invoice:price_below_min`, `payment:read`, `payment:create`, `payment:refund`, `cash:operate`, `cash:close`, `cash:expense`, `invoice:edit_due`, `fne:manage`, `payment:void`, `cash:review`, `cash:expense_approve`, `accounting:export` (ajoutés par M08, A5) |
| Créances (M09)                 | `receivable:read`, `receivable:manage`, `receivable:writeoff`, `receivable:dispute`, `receivable:credit_override`                                                                                                                                                                                                                                         |
| Relances / messages (M10, M11) | `reminder:read`, `reminder:approve`, `reminder:rules_manage`, `message:read`, `message:send`, `template:manage`                                                                                                                                                                                                                                           |
| Pilotage (M12)                 | `report:read`, `report:financial`, `dashboard:owner`                                                                                                                                                                                                                                                                                                      |
| Intégrations (M13)             | `import:run`, `integration:manage`                                                                                                                                                                                                                                                                                                                        |
| Assurances (M16)               | `insurance:read`, `insurance:manage`                                                                                                                                                                                                                                                                                                                      |
| IA (M17)                       | `ai:use`, `ai:configure`                                                                                                                                                                                                                                                                                                                                  |

Les autres modules **ne créent pas** de permission sans l'ajouter à ce catalogue (PR modifiant ce fichier + la matrice).

### 10.2 Matrice par défaut rôle → permissions (`DEFAULT_ROLE_PERMISSIONS`)

`OWNER` = tout. Légende : ✓ accordé par défaut.

| Permission                                                                                                                                  | MANAGER | ADVISOR | MECHANIC | STOREKEEPER | CASHIER | ACCOUNTANT                          |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------- | -------- | ----------- | ------- | ----------------------------------- |
| `org:read`, `settings:read`                                                                                                                 | ✓       | ✓       |          |             |         | ✓                                   |
| `org:update`, `settings:update`, `settings:channels`, `settings:payments`, `settings:fne`, `settings:billing`, `role:manage`, `site:manage` |         |         |          |             |         |                                     |
| `member:read`                                                                                                                               | ✓       | ✓       |          |             |         | ✓                                   |
| `member:invite`, `member:update`                                                                                                            | ✓       |         |          |             |         |                                     |
| `member:deactivate`                                                                                                                         |         |         |          |             |         |                                     |
| `audit:read`                                                                                                                                | ✓       |         |          |             |         | ✓                                   |
| `customer:read`                                                                                                                             | ✓       | ✓       | ✓        | ✓           | ✓       | ✓                                   |
| `customer:create`, `customer:update`                                                                                                        | ✓       | ✓       |          |             | ✓       | ✓                                   |
| `customer:delete`, `customer:merge`                                                                                                         | ✓       |         |          |             |         |                                     |
| `customer:export`                                                                                                                           |         |         |          |             |         | ✓                                   |
| `customer:consent`                                                                                                                          | ✓       | ✓       |          |             |         |                                     |
| `customer:credit`                                                                                                                           |         |         |          |             |         | ✓                                   |
| `vehicle:read`                                                                                                                              | ✓       | ✓       | ✓        | ✓           | ✓       | ✓                                   |
| `vehicle:create`, `vehicle:update`                                                                                                          | ✓       | ✓       |          |             |         |                                     |
| `vehicle:delete`, `vehicle:transfer`, `vehicle:mileage_correct`                                                                             | ✓       |         |          |             |         |                                     |
| `appointment:read`                                                                                                                          | ✓       | ✓       | ✓        |             | ✓       |                                     |
| `appointment:create`, `appointment:update`, `appointment:cancel`                                                                            | ✓       | ✓       |          |             |         |                                     |
| `planning:manage`                                                                                                                           | ✓       |         |          |             |         |                                     |
| `repair_order:read`                                                                                                                         | ✓       | ✓       | ✓        | ✓           | ✓       | ✓                                   |
| `repair_order:create`, `repair_order:update`                                                                                                | ✓       | ✓       |          |             |         |                                     |
| `repair_order:assign`, `repair_order:qc`, `repair_order:cancel`, `repair_order:reopen`, `repair_order:warranty_decide`                      | ✓       |         |          |             |         |                                     |
| `repair_order:deliver`                                                                                                                      | ✓       | ✓       |          |             | ✓       |                                     |
| `repair_order:deliver_unpaid`                                                                                                               |         |         |          |             |         |                                     |
| `inspection:perform`                                                                                                                        | ✓       | ✓       | ✓        |             |         |                                     |
| `inspection:template_manage`                                                                                                                | ✓       |         |          |             |         |                                     |
| `quote:read`                                                                                                                                | ✓       | ✓       |          |             | ✓       | ✓                                   |
| `quote:create`, `quote:update`, `quote:send`, `quote:record_decision`                                                                       | ✓       | ✓       |          |             |         |                                     |
| `quote:discount_override`, `quote:delete`, `labor_catalog:manage`                                                                           | ✓       |         |          |             |         |                                     |
| `task:read_own`, `time:clock`                                                                                                               | ✓       |         | ✓        |             |         |                                     |
| `task:read_all`, `time:edit`, `attendance:manage`                                                                                           | ✓       |         |          |             |         |                                     |
| `workshop:view` (M06 : kanban, ponts)                                                                                                       | ✓       | ✓       |          | ✓           |         |                                     |
| `partrequest:create` (M06 : demande de pièce tablette)                                                                                      | ✓       | ✓       | ✓        |             |         |                                     |
| `workshop:subcontract`, `workshop:productivity` (M06)                                                                                       | ✓       |         |          |             |         |                                     |
| `workshop:qc_self` (M06 RG-M06-11 : CQ sur son propre travail)                                                                              |         |         |          |             |         |                                     |
| `stock:read`                                                                                                                                | ✓       | ✓       | ✓        | ✓           |         | ✓                                   |
| `stock:issue`, `stock:receive`, `stock:transfer`, `purchase:read`, `purchase:create`, `supplier:manage`                                     | ✓       |         |          | ✓           |         |                                     |
| `stock:adjust`, `purchase:approve`                                                                                                          | ✓       |         |          |             |         |                                     |
| `product:manage`                                                                                                                            | ✓       |         |          | ✓           |         |                                     |
| `product:view_cost`                                                                                                                         | ✓       |         |          | ✓           |         | ✓                                   |
| `stock:reserve`                                                                                                                             | ✓       | ✓       |          | ✓           |         |                                     |
| `stock:count`                                                                                                                               | ✓       |         |          | ✓           |         |                                     |
| `stock:count_validate`                                                                                                                      | ✓       |         |          |             |         |                                     |
| `stock:valuation`                                                                                                                           | ✓       |         |          |             |         | ✓                                   |
| `invoice:read`, `payment:read`                                                                                                              | ✓       | ✓       |          |             | ✓       | ✓                                   |
| `invoice:create`, `invoice:issue`                                                                                                           | ✓       | ✓       |          |             | ✓       | ✓                                   |
| `invoice:void`, `invoice:credit_note`, `invoice:price_below_min`, `payment:refund`                                                          |         |         |          |             |         | ✓ (`invoice:credit_note` seulement) |
| `payment:create`, `cash:operate`                                                                                                            | ✓       |         |          |             | ✓       |                                     |
| `cash:close`, `cash:expense`                                                                                                                | ✓       |         |          |             | ✓       |                                     |
| `invoice:edit_due`, `fne:manage`, `payment:void`, `accounting:export` (ajoutés par M08)                                                     |         |         |          |             |         | ✓                                   |
| `cash:expense_approve` (RG-M08-30, ajouté par M08)                                                                                          | ✓       |         |          |             |         |                                     |
| `cash:review` (validation d'un écart de caisse, ajouté par M08)                                                                             |         |         |          |             |         |                                     |
| `receivable:read`                                                                                                                           | ✓       | ✓       |          |             | ✓       | ✓                                   |
| `receivable:manage`                                                                                                                         | ✓       | ✓       |          |             |         | ✓                                   |
| `receivable:writeoff`                                                                                                                       |         |         |          |             |         |                                     |
| `receivable:dispute`                                                                                                                        | ✓       |         |          |             |         | ✓                                   |
| `receivable:credit_override` (RG-M09-10, ajouté par M04)                                                                                    | ✓       |         |          |             |         |                                     |
| `reminder:read`                                                                                                                             | ✓       | ✓       |          |             |         | ✓                                   |
| `reminder:approve`                                                                                                                          | ✓       | ✓       |          |             |         | ✓                                   |
| `reminder:rules_manage`, `template:manage`                                                                                                  | ✓       |         |          |             |         |                                     |
| `message:read`, `message:send`                                                                                                              | ✓       | ✓       |          |             | ✓       | ✓                                   |
| `report:read`                                                                                                                               | ✓       |         |          |             |         | ✓                                   |
| `report:financial`, `dashboard:owner`                                                                                                       |         |         |          |             |         | ✓ (`report:financial` seulement)    |
| `import:run`                                                                                                                                | ✓       |         |          |             |         | ✓                                   |
| `integration:manage`                                                                                                                        |         |         |          |             |         |                                     |
| `insurance:read`                                                                                                                            | ✓       | ✓       |          |             |         | ✓                                   |
| `insurance:manage`                                                                                                                          | ✓       | ✓       |          |             |         |                                     |
| `ai:use`                                                                                                                                    | ✓       | ✓       | ✓        | ✓           | ✓       | ✓                                   |
| `ai:configure`                                                                                                                              |         |         |          |             |         |                                     |

### 10.3 Actions du module

| Action                              | Permission                                      |
| ----------------------------------- | ----------------------------------------------- |
| Inviter / modifier un membre        | `member:invite` / `member:update` (+ RG-M01-12) |
| Désactiver un membre                | `member:deactivate`                             |
| Modifier la matrice des rôles       | `role:manage`                                   |
| Créer / modifier un site, des ponts | `site:manage`                                   |
| Consulter / exporter l'audit        | `audit:read`                                    |
| Modifier l'identité du garage       | `org:update`                                    |

## 11. Cas limites et erreurs

| Situation                                                | Comportement                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Téléphone sans WhatsApp à l'inscription                  | Échec WhatsApp ou absence d'accusé en 45 s → SMS automatique ; bouton « Recevoir par SMS » visible dès 20 s.                                                                                                                                                                                                          |
| Aucun réseau SMS (crédit plateforme épuisé)              | Message « Envoi du code impossible pour le moment. Réessayez dans quelques minutes. » + alerte Sentry de niveau critique.                                                                                                                                                                                             |
| Même personne gérant deux garages distincts              | Un seul `User`, deux `Membership` `OWNER` ; le sélecteur d'organisation apparaît.                                                                                                                                                                                                                                     |
| Employé qui change de numéro                             | Changement depuis `/profil` avec OTP sur le nouveau numéro ; si l'ancien est perdu, un `OWNER` peut modifier le téléphone du membre (audit `member.phone_changed`) ; toutes ses sessions sont révoquées.                                                                                                              |
| Invitation envoyée au mauvais numéro                     | Révoquer depuis « Invitations en attente » ; le lien devient invalide immédiatement.                                                                                                                                                                                                                                  |
| Mécanicien invité sans smartphone                        | Le gérant crée le membre avec son numéro (même un téléphone simple : l'OTP part par SMS) et choisit « Accès tablette uniquement » : invitation acceptée par le gérant en présence de l'employé sur la tablette, PIN défini, aucun mot de passe exigé. Au moins un identifiant (`phone` ou `email`) reste obligatoire. |
| Site désactivé avec des OR ouverts                       | Refus : « Ce site a 4 OR ouverts. Clôturez-les ou transférez-les avant de le désactiver. »                                                                                                                                                                                                                            |
| Code de site déjà utilisé                                | « Le code YOP est déjà utilisé par un autre site. »                                                                                                                                                                                                                                                                   |
| Changement du code d'un site                             | Autorisé ; les numéros déjà attribués ne changent pas, seuls les nouveaux utilisent le nouveau code.                                                                                                                                                                                                                  |
| Requête d'un ID d'une autre organisation                 | Réponse `NOT_FOUND` (jamais `FORBIDDEN`) pour ne pas confirmer l'existence.                                                                                                                                                                                                                                           |
| Utilisateur dont toutes les memberships sont désactivées | Après connexion : « Votre accès à Garage Excellence Auto a été désactivé. » ; il peut créer un nouveau garage.                                                                                                                                                                                                        |
| Horloge de tablette fausse                               | Les OTP et expirations sont toujours calculés côté serveur.                                                                                                                                                                                                                                                           |
| Données de démonstration et vraies données mélangées     | « Supprimer les données de démonstration » ne touche que `source = "demo"` et les documents qui en dépendent exclusivement ; refus si une facture émise y est liée.                                                                                                                                                   |

## 12. Tests

**Unitaires (`packages/core/auth`)** : `resolvePermissions` (rôle par défaut, surcharge `RolePermission`, grants, revokes `!`, OWNER = tout, permission inconnue ignorée) ; `canInviteRole` (RG-M01-12) ; `lockoutPolicy` (5 échecs → 15 min, récidive → 1 h, remise à zéro) ; `otpPolicy` (expiration, 3 essais, cadence de renvoi) ; `isTrivialPin` ; `pickActiveSite` (RG-M01-10) ; validation des étapes d'onboarding (schémas Zod).

**Intégration** : isolation multi-locataire (utilisateur de A qui lit/modifie/énumère un ID de B → `NOT_FOUND` sur 10 procédures représentatives, et via RLS en SQL brut) ; portée par site (`CASHIER` limité à COC ne voit pas une facture YOP) ; dernier OWNER protégé ; désactivation révoque les sessions ; création d'organisation transactionnelle avec semences (rollback complet si une semence échoue) ; audit en ajout seul (UPDATE/DELETE refusés par Postgres) ; contrôle `x-org-id` après bascule.

**E2E Playwright** :

1. Inscription par téléphone → OTP (canal `console`, lecture dans `/dev/outbox`) → assistant complet (garage, atelier, mode FULL, invitation d'un mécanicien, saut des canaux, données démo) → tableau de bord.
2. Le mécanicien ouvre le lien d'invitation, crée son mot de passe, arrive sur `(tech)`.
3. Le gérant retire `quote:send` à l'`ADVISOR` ; l'advisor ne voit plus le bouton et l'appel direct à `quote.send` renvoie 403.
4. 5 mauvais mots de passe → verrou → réinitialisation par OTP → connexion.

## 13. Définition de « terminé »

- [ ] Better Auth configuré (email/téléphone + mot de passe, OTP WhatsApp→SMS, sessions) avec mapping sur `User` et tables §14 migrées.
- [ ] `db.forTenant(ctx)` + RLS actifs ; test d'isolation multi-locataire vert.
- [ ] Catalogue `PERMISSIONS` et `DEFAULT_ROLE_PERMISSIONS` exportés depuis `core`, utilisés par `requirePermission` et par le front (masquage).
- [ ] Assistant `/bienvenue` complet, reprenable, avec semences par défaut et données de démonstration supprimables.
- [ ] Écrans équipe, rôles, sites, journal, profil/sécurité livrés, responsive, avec états vides/erreur.
- [ ] Invitation par WhatsApp (API ou wa.me), SMS, email ; PIN atelier sur appareil partagé.
- [ ] Verrouillage, limitation de débit, OTP nouvel appareil ; toutes les actions RG-M01-15 auditées.
- [ ] Libellés dans `messages/fr.json` (y compris libellé français de chaque permission et de chaque action d'audit).
- [ ] Tests unitaires, intégration et 4 scénarios E2E verts en CI.

## 14. Évolutions du modèle de données

```prisma
// --- User : sécurité de connexion ---
model User {
  // champs existants…
  emailVerifiedAt     DateTime?
  phoneVerifiedAt     DateTime?
  failedLoginCount    Int       @default(0)
  lockedUntil         DateTime?
  lockCount           Int       @default(0)   // récidives depuis le dernier succès (RG-M01-05)
  lastActiveOrganizationId String?
  lastActiveSiteId    String?
  // passwordHash : NON utilisé. Better Auth stocke le hash dans Account.password (providerId "credential").
  // Proposition : supprimer User.passwordHash dans une migration ultérieure.
}

// --- Membership : PIN atelier, traçabilité ---
model Membership {
  // champs existants…
  pinHash        String?
  pinFailedCount Int      @default(0)
  invitedById    String?                 // Membership.id
  deactivatedAt  DateTime?
  deactivationReason String?
  // Convention : permissions[] contient "module:action" (ajout) ou "!module:action" (retrait)
}

// --- Organization : onboarding ---
model Organization {
  // champs existants…
  onboardingCompletedAt DateTime?
  // settings.onboarding = { step: Int, skipped: String[] } ; settings.security = { otpOnNewDevice: Role[] }
}

// --- Better Auth (tables d'authentification) ---
model Session {
  id                   String   @id @default(cuid())
  userId               String
  token                String   @unique
  expiresAt            DateTime
  ipAddress            String?
  userAgent            String?
  activeOrganizationId String?
  activeSiteId         String?          // null = « Tous les sites »
  isPinSession         Boolean  @default(false)
  deviceId             String?
  lastActiveAt         DateTime @default(now())
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  @@index([userId])
}

model Account {                          // identifiants Better Auth (credential = mot de passe)
  id           String   @id @default(cuid())
  userId       String
  providerId   String                    // "credential"
  accountId    String
  password     String?                   // hash argon2id
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@unique([providerId, accountId])
}

model Verification {                     // OTP et jetons de réinitialisation (Better Auth)
  id         String   @id @default(cuid())
  identifier String                      // "+2250708123456:RESET"
  value      String                      // code haché
  attempts   Int      @default(0)
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  @@index([identifier])
}

// --- Appareils approuvés / partagés ---
model TrustedDevice {
  id                     String   @id @default(cuid())
  organizationId         String?
  userId                 String?                 // null si appareil partagé d'atelier
  deviceId               String                  // identifiant aléatoire stocké en cookie httpOnly
  label                  String?                 // "Tablette atelier 1"
  isSharedWorkshopDevice Boolean  @default(false)
  siteId                 String?
  expiresAt              DateTime?
  createdAt              DateTime @default(now())
  @@unique([deviceId])
}

// --- Invitations ---
model Invitation {
  id             String   @id @default(cuid())
  organizationId String
  name           String
  email          String?
  phone          String?                 // E.164
  role           Role
  siteIds        String[]
  permissions    String[]
  tokenHash      String   @unique
  channel        Channel?
  status         InvitationStatus @default(PENDING)
  invitedById    String                  // Membership.id
  expiresAt      DateTime
  acceptedAt     DateTime?
  acceptedUserId String?
  createdAt      DateTime @default(now())
  @@index([organizationId, status])
}
enum InvitationStatus { PENDING ACCEPTED REVOKED EXPIRED }

// --- Permissions par défaut d'un rôle, surchargées par l'organisation ---
model RolePermission {
  id             String   @id @default(cuid())
  organizationId String
  role           Role
  permissions    String[]
  updatedById    String?
  updatedAt      DateTime @updatedAt
  @@unique([organizationId, role])
}

// --- AuditLog : contexte complémentaire ---
model AuditLog {
  // champs existants…
  siteId       String?
  membershipId String?
  userAgent    String?
  @@index([organizationId, createdAt])
  @@index([organizationId, action])
}
```

Variables d'environnement ajoutées (canaux plateforme pour les OTP) : `PLATFORM_WHATSAPP_PHONE_ID`, `PLATFORM_WHATSAPP_TOKEN`, `PLATFORM_WHATSAPP_OTP_TEMPLATE`, `PLATFORM_SMS_PROVIDER`, `PLATFORM_SMS_CREDENTIALS`, `PLATFORM_EMAIL_FROM`.
