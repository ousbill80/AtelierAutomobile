# Fiche à remplir — canaux plateforme (email + SMS)

Document à transmettre à la personne qui gère le **serveur AtelierOS**.

Ces canaux servent uniquement aux **codes OTP** (inscription, nouvel appareil, mot de passe oublié).  
Ils sont distincts des canaux de chaque garage (Paramètres → Canaux dans l’application).

---

## 1. Où écrire la configuration

Sur le serveur, dans le fichier `.env` du déploiement (souvent `/opt/atelieros/.env`).

1. Remplir le fichier joint `fiche-canaux-plateforme.env.txt`
2. Copier les lignes remplies dans le `.env` du serveur
3. **Ne jamais** committer ce fichier dans Git ni l’envoyer par email non chiffré avec les vrais mots de passe (préférer un canal sécurisé)
4. Redémarrer web + worker (ou relancer `deploy/deploy.sh` / `scripts/deploy.sh`)

Vérification : `APP_ENV=production` doit être présent, sinon les OTP peuvent passer en mode console.

---

## 2. Email (SMTP)

| Champ AtelierOS            | Signification                              | Exemple                         |
| -------------------------- | ------------------------------------------ | ------------------------------- |
| `host`                     | Serveur SMTP                               | `smtp.votredomaine.ci`          |
| `port`                     | Port                                       | `587` (STARTTLS) ou `465` (TLS) |
| `secure`                   | `true` seulement pour le port 465          | `false` pour 587                |
| `username`                 | Compte SMTP                                | `codes@votredomaine.ci`         |
| `password`                 | Mot de passe SMTP                          | _(secret)_                      |
| `PLATFORM_EMAIL_FROM`      | Adresse d’expédition (doit être autorisée) | `codes@votredomaine.ci`         |
| `PLATFORM_EMAIL_FROM_NAME` | Nom affiché                                | `AtelierOS`                     |

Règles :

- Port **587** → `secure: false`
- Port **465** → `secure: true`
- L’adresse `PLATFORM_EMAIL_FROM` doit être acceptée par le serveur SMTP (SPF/DKIM recommandés sur le domaine)

---

## 3. SMS (SMPP)

| Champ fiche opérateur     | Champ AtelierOS | Exemple                           |
| ------------------------- | --------------- | --------------------------------- |
| host                      | `host`          | IP ou hostname du SMSC            |
| port                      | `port`          | `2775` (souvent)                  |
| Username                  | `systemId`      | identifiant SMPP                  |
| password (souvent 8 car.) | `password`      | _(secret)_                        |
| type                      | `systemType`    | souvent vide ou valeur fournie    |
| expéditeur (nom / n°)     | `sourceAddr`    | `GARAGEKONE` (≤ 11 car.)          |
| source-addr-ton           | `sourceAddrTon` | ex. `5`                           |
| source-addr-npi           | `sourceAddrNpi` | ex. `0`                           |
| dest-addr-ton             | `destAddrTon`   | ex. `1`                           |
| dest-addr-npi             | `destAddrNpi`   | ex. `1`                           |
| TLS                       | `tls`           | `false` sauf indication contraire |

Si TON/NPI sont inconnus : laisser vides. AtelierOS utilise alors :

- expéditeur numérique → TON 1 / NPI 1
- expéditeur alphanumérique → TON 5 / NPI 0
- destinataire → TON 1 / NPI 1

L’IP du serveur AtelierOS doit souvent être **autorisée** (whitelist) chez l’opérateur SMPP.

---

## 4. Checklist côté serveur

- [ ] `APP_ENV=production`
- [ ] Bloc email `PLATFORM_EMAIL_*` rempli **ou** bloc SMS `PLATFORM_SMS_*` rempli (au moins un des deux)
- [ ] JSON sur **une seule ligne**, entre apostrophes
- [ ] Aucun espace collé en trop dans `systemId` / `password` (copier-coller)
- [ ] Web + worker redémarrés
- [ ] Test : inscription ou « mot de passe oublié » → code reçu par email ou SMS

En cas d’échec : logs worker / web (`[auth:otp]`), et test du canal SMS garage dans **Paramètres → Canaux** si le même compte SMPP y est aussi configuré.

---

## 5. Fichiers joints

| Fichier                           | Usage                                        |
| --------------------------------- | -------------------------------------------- |
| `fiche-canaux-plateforme.env.txt` | À remplir puis coller dans le `.env` serveur |
| `fiche-canaux-plateforme.md`      | Ce guide                                     |
