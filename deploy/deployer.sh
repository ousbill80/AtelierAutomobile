#!/usr/bin/env bash
# =============================================================================
# deploy/deployer.sh — déploiement d'AtelierOS en production, depuis SA machine
# =============================================================================
#
# Adapté du deployer.sh du site ONAD. À exécuter depuis SA PROPRE MACHINE
# (pas sur le serveur), dans le dépôt Git du projet :
#
#     bash deploy/deployer.sh               # déploie la branche courante
#     bash deploy/deployer.sh --simulation  # montre ce qui partirait, n'écrit rien
#
# Le script déploie LA BRANCHE SUR LAQUELLE VOUS ÊTES, telle quelle. Il ne
# récupère rien et ne touche pas à votre historique Git.
#
# Il enchaîne : contrôles préalables, vérification du code (typecheck + lint),
# simulation puis transfert des fichiers par rsync, puis, sur le serveur,
# scripts/deploy-swap.sh : sauvegarde chiffrée de la base, reconstruction des
# images, migrations Prisma, démarrage de la nouvelle version À CÔTÉ de celle
# qui sert (blue-green) et bascule du trafic seulement quand elle est saine.
# Enfin, une vérification du site en ligne.
#
# SERVEUR MUTUALISÉ : les ports 80/443 appartiennent à cei-nginx, le proxy
# commun à plusieurs projets. AtelierOS y tourne avec docker/docker-compose.edge.yml
# (Caddy désactivé). scripts/deploy.sh, prévu pour un serveur dédié, n'y est
# jamais lancé.
# Il s'arrête à la première anomalie, en disant quoi faire.
#
# CE QUE LE SCRIPT NE TOUCHE JAMAIS, sur le serveur :
#   - .env       les secrets de production
#   - backups/   les sauvegardes de la base
#   - les volumes Docker (base, Redis, fichiers MinIO) : ils ne sont pas dans le dossier
# Seuls les chemins de CHEMINS ci-dessous sont transférés ; le script vérifie
# la présence de .env avant et après le rsync.
#
# FILET DE SÉCURITÉ : l'application tourne depuis les images Docker, pas
# depuis les fichiers transférés. Si la reconstruction échoue, la production
# continue sur l'ancienne image. scripts/deploy-swap.sh ne bascule le trafic
# que si /api/health répond.
#
# OPTIONS
#   --simulation              s'arrête avant toute écriture
#   --sans-verification       saute typecheck + lint en local (déconseillé)
#   --accepter-arbre-sale     déploie des modifications non commitées sans demander
#   --accepter-suppressions   autorise rsync à supprimer sur le serveur des fichiers
#                             retirés du dépôt, sans demander
#
# RÉGLAGES (variables d'environnement, valeurs par défaut entre crochets)
#   ATELIER_SSH_HOST    [onad-prod]                     alias SSH du serveur (~/.ssh/config)
#   ATELIER_REMOTE_DIR  [/opt/atelieros]                dossier du projet sur le VPS
#   ATELIER_SITE_URL    [https://atelier.prodestic.net] URL vérifiée à la fin
#   ATELIER_REMOTE_SCRIPT [scripts/deploy-swap.sh]      script lancé sur le serveur
#                         (scripts/deploy-edge.sh : instance unique, 30 à 60 s de coupure)
#
# =============================================================================

set -euo pipefail

SSH_HOST="${ATELIER_SSH_HOST:-onad-prod}"
REMOTE_DIR="${ATELIER_REMOTE_DIR:-/opt/atelieros}"
SITE_URL="${ATELIER_SITE_URL:-https://atelier.prodestic.net}"
REMOTE_SCRIPT="${ATELIER_REMOTE_SCRIPT:-scripts/deploy-swap.sh}"
NODE_ATTENDU=20 # même version majeure que les Dockerfile (node:20-alpine)

# Chemins transférés : tout ce que les Dockerfile (docker/) et les scripts du serveur lisent.
# deploy/ n'y est pas : ce sont les outils de la machine locale, et le compte de
# déploiement ne peut pas créer de dossier à la racine de $REMOTE_DIR.
CHEMINS=(apps packages docker scripts package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc .dockerignore)

# Jamais transférés (ni supprimés côté serveur : rsync protège les fichiers exclus).
EXCLUSIONS=(
  --exclude='.DS_Store'
  --exclude='node_modules'
  --exclude='.next'
  --exclude='.turbo'
  --exclude='.data'
  --exclude='dist'
  --exclude='*.tsbuildinfo'
  --exclude='next-env.d.ts'
  --include='.env.example'
  --exclude='.env'
  --exclude='.env.*'
  --exclude='*.log'
)

# Pages vérifiées en fin de déploiement.
PAGES=(/api/health /connexion)

SIMULATION=0
SANS_VERIFICATION=0
ARBRE_SALE_OK=0
SUPPRESSIONS_OK=0
for argument in "$@"; do
  case "$argument" in
    --simulation) SIMULATION=1 ;;
    --sans-verification) SANS_VERIFICATION=1 ;;
    --accepter-arbre-sale) ARBRE_SALE_OK=1 ;;
    --accepter-suppressions) SUPPRESSIONS_OK=1 ;;
    -h | --help)
      sed -n '2,49p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Option inconnue : $argument (voir --help)" >&2
      exit 2
      ;;
  esac
done

# -----------------------------------------------------------------------------
# Affichage
# -----------------------------------------------------------------------------
if [ -t 1 ]; then
  GRAS=$'\033[1m'
  VERT=$'\033[32m'
  ROUGE=$'\033[31m'
  JAUNE=$'\033[33m'
  FIN=$'\033[0m'
else
  GRAS=""
  VERT=""
  ROUGE=""
  JAUNE=""
  FIN=""
fi
numero=0
etape() {
  numero=$((numero + 1))
  printf '\n%s[%d] %s%s\n' "$GRAS" "$numero" "$1" "$FIN"
}
ok() { printf '    %s✓%s %s\n' "$VERT" "$FIN" "$1"; }
alerte() { printf '    %s!%s %s\n' "$JAUNE" "$FIN" "$1"; }
abandon() {
  printf '\n%s✗ %s%s\n\n' "$ROUGE" "$1" "$FIN" >&2
  exit 1
}
confirmer() {
  # $1 = question ; renvoie 0 si oui. Sans terminal, refuse.
  [ -t 0 ] || return 1
  printf '    %s [o/N] ' "$1"
  read -r reponse
  case "$reponse" in
    [oO] | [oO][uU][iI] | [yY]) return 0 ;;
    *) return 1 ;;
  esac
}

TRAVAIL="$(mktemp -d)"
trap 'rm -rf "$TRAVAIL"' EXIT

# -----------------------------------------------------------------------------
# 1. Vérifications préalables, côté machine locale
# -----------------------------------------------------------------------------
etape "Vérifications préalables"

command -v git >/dev/null || abandon "git est introuvable."
command -v rsync >/dev/null || abandon "rsync est introuvable."
command -v ssh >/dev/null || abandon "ssh est introuvable."
command -v curl >/dev/null || abandon "curl est introuvable."

RACINE="$(git rev-parse --show-toplevel 2>/dev/null)" ||
  abandon "Ce script doit être lancé depuis le dépôt Git du projet."
cd "$RACINE"
ok "dépôt : $RACINE"

[ -f docker/docker-compose.prod.yml ] ||
  abandon "docker/docker-compose.prod.yml absent : ce dépôt n'est pas celui d'AtelierOS."

# Le script du serveur et la surcharge « edge » doivent être dans le dépôt :
# sinon le rsync --delete les effacerait du serveur.
for requis in "$REMOTE_SCRIPT" docker/docker-compose.edge.yml; do
  [ -f "$requis" ] ||
    abandon "« $requis » est absent du dépôt. Le transfert l'effacerait du serveur. Récupérez-le d'abord : scp $SSH_HOST:$REMOTE_DIR/$requis $requis"
done
ok "$REMOTE_SCRIPT et docker/docker-compose.edge.yml présents"

ACTUELLE="$(git rev-parse --abbrev-ref HEAD)"
VERSION="$(git rev-parse --short HEAD)"
ok "branche déployée : $ACTUELLE ($VERSION)"

for chemin in "${CHEMINS[@]}"; do
  [ -e "$chemin" ] || abandon "Le chemin « $chemin » est absent. Transfert interrompu par précaution."
done
ok "les ${#CHEMINS[@]} chemins à transférer sont présents"

# Modifications non commitées : rsync transfère l'arbre de travail, donc elles
# PARTIRAIENT en production, sans trace de la version en ligne.
SALE="$(git status --porcelain -- "${CHEMINS[@]}")"
if [ -n "$SALE" ]; then
  printf '    %s!%s modifications non commitées (elles seront déployées) :\n' "$JAUNE" "$FIN"
  printf '%s\n' "$SALE" | sed 's/^/      /'
  if [ "$ARBRE_SALE_OK" -eq 1 ]; then
    alerte "acceptées via --accepter-arbre-sale"
    VERSION="${VERSION}-modifie"
  elif confirmer "Déployer quand même ? Rien ne tracera cette version."; then
    ok "poursuite à votre demande"
    VERSION="${VERSION}-modifie"
  else
    abandon "Déploiement annulé. Commitez votre travail (git add -A && git commit), puis relancez."
  fi
else
  ok "arbre de travail propre"
fi

if command -v node >/dev/null; then
  NODE_MAJEUR="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
  if [ "$NODE_MAJEUR" = "$NODE_ATTENDU" ]; then
    ok "Node $(node -v)"
  else
    alerte "Node $(node -v) en local, alors que la production utilise Node $NODE_ATTENDU"
  fi
else
  alerte "Node est introuvable : la vérification du code sera impossible"
fi

# -----------------------------------------------------------------------------
# 2. Vérifications préalables, côté serveur
# -----------------------------------------------------------------------------
etape "Accès au serveur ($SSH_HOST)"

ssh -o BatchMode=yes -o ConnectTimeout=15 "$SSH_HOST" true 2>/dev/null ||
  abandon "Connexion SSH impossible vers « $SSH_HOST ». Vérifiez ~/.ssh/config et votre clé, ou définissez ATELIER_SSH_HOST."
ok "connexion SSH établie"

# Garde-fou : sans ces éléments, on ne parle pas au bon serveur ou au bon
# dossier, et un rsync --delete y ferait des dégâts.
ssh "$SSH_HOST" "cd '$REMOTE_DIR' && test -f .env && test -f docker/docker-compose.prod.yml && test -f docker/docker-compose.edge.yml" 2>/dev/null ||
  abandon "Dans « $REMOTE_DIR » sur $SSH_HOST, il manque .env, docker/docker-compose.prod.yml ou docker/docker-compose.edge.yml. Transfert interrompu : ce n'est pas l'installation attendue (voir ATELIER_REMOTE_DIR)."
ok "$REMOTE_DIR : .env, docker-compose.prod.yml et docker-compose.edge.yml sont en place"

# Droits d'écriture : rsync doit créer des fichiers temporaires dans chaque
# dossier modifié. Sans ce contrôle, l'échec n'apparaît qu'en plein transfert.
SANS_DROITS="$(ssh "$SSH_HOST" "cd '$REMOTE_DIR' && for d in apps/web apps/web/messages apps/web/src packages packages/core/src packages/integrations/src docker scripts; do [ -w \"\$d\" ] || echo \"\$d\"; done" 2>/dev/null || echo "?")"
if [ -n "$SANS_DROITS" ]; then
  printf '    %s✗%s pas de droit d'"'"'écriture pour le compte de « %s » sur :\n' "$ROUGE" "$FIN" "$SSH_HOST"
  printf '%s\n' "$SANS_DROITS" | sed "s#^#      $REMOTE_DIR/#"
  abandon "Le transfert échouerait. Demandez au responsable du serveur un compte qui peut écrire dans $REMOTE_DIR (ATELIER_SSH_HOST=...), ou les droits d'écriture pour ce compte."
fi
ok "droits d'écriture sur $REMOTE_DIR"

ssh "$SSH_HOST" "docker compose version >/dev/null 2>&1" ||
  abandon "« docker compose » n'est pas utilisable par votre compte sur le serveur (il faut appartenir au groupe docker)."
ok "docker compose utilisable"

# -----------------------------------------------------------------------------
# 3. Vérification du code, en local
# -----------------------------------------------------------------------------
# Le build Docker refait le travail côté serveur (et un échec y laisse la
# production intacte), mais une erreur de type apparaît ici en une ou deux
# minutes au lieu de dix, sans avoir rien transféré.
if [ "$SANS_VERIFICATION" -eq 1 ]; then
  etape "Vérification du code ignorée (--sans-verification)"
  alerte "une erreur ne sera détectée qu'à la reconstruction sur le serveur"
elif ! command -v pnpm >/dev/null; then
  etape "Vérification du code impossible"
  alerte "pnpm est introuvable ; installez-le pour bénéficier de cette vérification"
else
  etape "Vérification du code : typecheck + lint (quelques minutes)"
  if [ ! -d node_modules ]; then
    printf '    installation des dépendances…\n'
    pnpm install --frozen-lockfile >"$TRAVAIL/install.log" 2>&1 ||
      {
        tail -30 "$TRAVAIL/install.log" >&2
        abandon "pnpm install a échoué."
      }
  fi
  if pnpm turbo run typecheck lint >"$TRAVAIL/verification.log" 2>&1; then
    ok "typecheck et lint réussis"
  else
    grep -E "error|Error|Failed" "$TRAVAIL/verification.log" | head -30 >&2 || true
    cp "$TRAVAIL/verification.log" ./verification-echec.log 2>/dev/null || true
    abandon "Le code ne passe pas typecheck/lint : rien n'a été envoyé au serveur. Journal complet : ./verification-echec.log"
  fi
fi

# -----------------------------------------------------------------------------
# 4. Simulation du transfert — aucune écriture
# -----------------------------------------------------------------------------
# -rlz sans -t ni -p : le compte de déploiement n'est pas propriétaire des fichiers
# du serveur ; il peut en changer le contenu, pas la date ni les droits. La
# comparaison se fait par contenu (--checksum), les dates sont donc inutiles.
etape "Simulation du transfert"

rsync -rlzn --checksum --relative --omit-dir-times --delete --itemize-changes "${EXCLUSIONS[@]}" \
  "${CHEMINS[@]}" "$SSH_HOST:$REMOTE_DIR/" >"$TRAVAIL/simulation.txt" 2>&1 ||
  {
    cat "$TRAVAIL/simulation.txt" >&2
    abandon "La simulation rsync a échoué."
  }

SUPPRESSIONS="$(grep '^\*deleting' "$TRAVAIL/simulation.txt" || true)"
if [ -n "$SUPPRESSIONS" ]; then
  printf '    %s!%s fichiers présents sur le serveur mais plus dans le dépôt (ils seraient supprimés) :\n' "$JAUNE" "$FIN"
  printf '%s\n' "$SUPPRESSIONS" | head -40 | sed 's/^/      /'
  if [ "$SIMULATION" -eq 1 ]; then
    alerte "simulation : rien ne sera supprimé"
  elif [ "$SUPPRESSIONS_OK" -eq 1 ]; then
    alerte "suppressions acceptées via --accepter-suppressions"
  elif confirmer "Supprimer ces fichiers sur le serveur ?"; then
    ok "suppressions acceptées"
  else
    abandon "Déploiement annulé : vérifiez ces fichiers à la main avant d'insister."
  fi
else
  ok "aucune suppression prévue"
fi

NB_FICHIERS="$(grep -c '^<f' "$TRAVAIL/simulation.txt" || true)"
ok "${NB_FICHIERS:-0} fichier(s) à transférer"
if [ "${NB_FICHIERS:-0}" -eq 0 ] && [ "$SIMULATION" -eq 0 ]; then
  alerte "le serveur a déjà ces fichiers — la reconstruction va tout de même être relancée"
fi

if [ "$SIMULATION" -eq 1 ]; then
  cp "$TRAVAIL/simulation.txt" ./simulation-deploiement.txt
  printf '\n%sSimulation terminée : rien n'"'"'a été écrit.%s\n' "$GRAS" "$FIN"
  printf 'Détail complet : ./simulation-deploiement.txt\n\n'
  exit 0
fi

# -----------------------------------------------------------------------------
# 5. Transfert réel
# -----------------------------------------------------------------------------
etape "Transfert des fichiers"

rsync -rlz --checksum --relative --omit-dir-times --delete --itemize-changes --stats "${EXCLUSIONS[@]}" \
  "${CHEMINS[@]}" "$SSH_HOST:$REMOTE_DIR/" >"$TRAVAIL/transfert.txt" 2>&1 ||
  {
    cp "$TRAVAIL/transfert.txt" ./transfert-echec.log 2>/dev/null || true
    grep -iE 'rsync:|error|denied|failed' "$TRAVAIL/transfert.txt" | head -30 >&2
    abandon "Le transfert a échoué. Journal complet copié dans ./transfert-echec.log"
  }
grep 'Number of files transferred' "$TRAVAIL/transfert.txt" | sed 's/^/    /' || true
ok "transfert terminé"

ssh "$SSH_HOST" "cd '$REMOTE_DIR' && test -f .env" ||
  abandon "ALERTE : .env a disparu après le transfert. Restaurez-le immédiatement et prévenez le responsable du serveur."
ok ".env toujours en place"

# -----------------------------------------------------------------------------
# 6. Déploiement sur le serveur ($REMOTE_SCRIPT)
# -----------------------------------------------------------------------------
# Sauvegarde chiffrée, reconstruction des images, migrations, nouvelle version
# démarrée à côté de l'ancienne, bascule du trafic seulement si elle est saine,
# puis worker. Sortie affichée en direct.
etape "Sauvegarde, images, migrations et bascule sur le serveur (plusieurs minutes)"

if ssh "$SSH_HOST" "cd '$REMOTE_DIR' && ATELIEROS_VERSION='$VERSION' bash '$REMOTE_SCRIPT'" 2>&1 |
  tee "$TRAVAIL/deploy.log"; then
  ok "$REMOTE_SCRIPT terminé"
else
  cp "$TRAVAIL/deploy.log" ./deploiement-echec.log 2>/dev/null || true
  printf '\n%sSi la nouvelle version n'"'"'est pas devenue saine, rien n'"'"'a basculé : l'"'"'ancienne sert toujours.%s\n' "$JAUNE" "$FIN" >&2
  abandon "Le déploiement sur le serveur a échoué. Journal complet copié dans ./deploiement-echec.log"
fi

# -----------------------------------------------------------------------------
# 7. Vérification du site
# -----------------------------------------------------------------------------
etape "Vérification du site en ligne"

ECHECS=0
for page in "${PAGES[@]}"; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$SITE_URL$page" || echo "000")"
  if [ "$CODE" = "200" ]; then
    printf '    %s✓%s %-30s %s\n' "$VERT" "$FIN" "$page" "$CODE"
  else
    printf '    %s✗%s %-30s %s\n' "$ROUGE" "$FIN" "$page" "$CODE"
    ECHECS=$((ECHECS + 1))
  fi
done

printf '\n'
if [ "$ECHECS" -eq 0 ]; then
  printf '%s%s✓ Déploiement %s terminé — %s est à jour.%s\n\n' "$GRAS" "$VERT" "$VERSION" "$SITE_URL" "$FIN"
else
  printf '%s%s✗ %d page(s) ne répondent pas correctement.%s\n\n' "$GRAS" "$ROUGE" "$ECHECS" "$FIN"
  cat <<AIDE
Pour diagnostiquer :
  ssh $SSH_HOST "cd $REMOTE_DIR && docker compose --env-file .env -f docker/docker-compose.prod.yml -f docker/docker-compose.edge.yml ps"
  ssh $SSH_HOST "cd $REMOTE_DIR && docker logs --tail 50 atelieros-prod-web-blue-1"   # ou -green-1

Les sauvegardes de la base sont dans $REMOTE_DIR/backups/ (chiffrées,
voir docs/exploitation.md pour la restauration). Prévenez le responsable du
serveur avant de restaurer : toute donnée saisie depuis le déploiement serait perdue.
AIDE
  exit 1
fi
