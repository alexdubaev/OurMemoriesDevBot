#!/usr/bin/env bash
set -Eeuo pipefail

# This is the only server-side entry point used by the reviewed GitHub
# workflow. It deliberately performs the host checkout and image build on the
# Selectel machine, so the deployment uses the same immutable source SHA that
# is checked out in the server worktree.

SERVER_ROOT=${SERVER_ROOT:-/opt/memoly}
APP_ROOT=${APP_ROOT:-$SERVER_ROOT/app}
ROLLBACK_ENV=${ROLLBACK_ENV:-$SERVER_ROOT/rollback.env}
RELEASES_DIR=${RELEASES_DIR:-$SERVER_ROOT/releases}
BACKUPS_DIR=${BACKUPS_DIR:-$SERVER_ROOT/backups}
COMPOSE_FILE=${COMPOSE_FILE:-$SERVER_ROOT/compose.yml}
COMPOSE_PROJECT=${COMPOSE_PROJECT:-memoly}
APP_USER=${APP_USER:-memoly}
APP_GROUP=${APP_GROUP:-}
PUBLIC_URL=${PUBLIC_URL:-https://app.memoly.ru}
MIN_FREE_KIB=${MIN_FREE_KIB:-4194304}
PRODUCT_SHA=${1:-}
DEPLOY_CONFIRMATION=${2:-}
RUN_MIGRATION=${3:-false}
MAX_BOT_USERNAME=${4:-}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command is missing: $1"
}

require_root() {
  [ "$(id -u)" -eq 0 ] || die 'the Selectel release entry point must run as root'
}

validate_inputs() {
  [[ "$PRODUCT_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'release SHA must be a 40-character lowercase Git SHA'
  [ "$DEPLOY_CONFIRMATION" = DEPLOY ] || die 'deployment confirmation must be exactly DEPLOY'
  case "$RUN_MIGRATION" in
    true|false) ;;
    *) die 'migration flag must be true or false' ;;
  esac
  [[ "$MAX_BOT_USERNAME" =~ ^[A-Za-z0-9_]{5,32}$ ]] || die 'MAX bot username has an invalid public username format'
}

git_memoly() {
  sudo -n -u "$APP_USER" git -c safe.directory="$APP_ROOT" -C "$APP_ROOT" "$@"
}

git_root() {
  git -c safe.directory="$APP_ROOT" -C "$APP_ROOT" "$@"
}

validate_repository() {
  [ -d "$APP_ROOT/.git" ] || die "application checkout is missing: $APP_ROOT"
  local origin status
  origin=$(git_memoly config --get remote.origin.url || true)
  case "$origin" in
    https://github.com/alexdubaev/OurMemoriesDevBot.git|git@github.com:alexdubaev/OurMemoriesDevBot.git) ;;
    *) die 'application checkout does not use the canonical OurMemoriesDevBot origin' ;;
  esac
  status=$(git_memoly status --porcelain) || die 'cannot inspect application checkout status'
  [ -z "$status" ] || die 'application checkout must be clean before release'
}

check_disk_space() {
  local available
  available=$(df -Pk "$SERVER_ROOT" | awk 'NR == 2 { print $4 }')
  [[ "$available" =~ ^[0-9]+$ ]] || die 'cannot determine free disk space'
  [ "$available" -ge "$MIN_FREE_KIB" ] || die "free disk space is below ${MIN_FREE_KIB} KiB; perform approved host maintenance before release"
  printf 'Disk preflight passed: %s KiB available.\n' "$available"
}

fetch_and_checkout() {
  git_memoly fetch --prune origin main || die 'cannot fetch accepted main from origin'
  local accepted_sha
  accepted_sha=$(git_memoly rev-parse refs/remotes/origin/main 2>/dev/null || true)
  [ "$accepted_sha" = "$PRODUCT_SHA" ] || die "requested SHA is not the current accepted origin/main SHA"

  if ! git_memoly switch --detach "$PRODUCT_SHA" >/dev/null 2>&1; then
    # The historical host checkout may contain root-owned deployment files.
    # A root fallback is allowed only after the clean status check above.
    git_root switch --detach "$PRODUCT_SHA" >/dev/null 2>&1 || die 'cannot checkout requested release SHA'
    [ -n "$APP_GROUP" ] || APP_GROUP=$(id -gn "$APP_USER")
    while IFS= read -r -d '' path; do
      chown "$APP_USER:$APP_GROUP" "$APP_ROOT/$path"
    done < <(git_root ls-files -z)
    for path in HEAD index logs/HEAD packed-refs FETCH_HEAD; do
      [ -e "$APP_ROOT/.git/$path" ] && chown "$APP_USER:$APP_GROUP" "$APP_ROOT/.git/$path"
    done
  fi

  local head status
  head=$(git_root rev-parse HEAD)
  [ "$head" = "$PRODUCT_SHA" ] || die 'server checkout HEAD does not equal requested release SHA'
  status=$(git_root status --porcelain)
  [ -z "$status" ] || die 'server checkout is dirty after release checkout'
}

compose() {
  docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" "$@"
}

service_image() {
  local service=$1 image_ids image_count image
  image_ids=$(docker ps \
    --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
    --filter "label=com.docker.compose.service=$service" \
    --format '{{.ID}}')
  image_count=$(printf '%s\n' "$image_ids" | awk 'NF { count += 1 } END { print count + 0 }')
  [ "$image_count" -eq 1 ] || die "expected exactly one running Compose service: $service"
  image=$image_ids
  [ -n "$image" ] || die "running Compose service is missing: $service"
  docker inspect --format '{{.Config.Image}}' "$image"
}

immutable_tag() {
  local image=$1 prefix=$2 tag
  case "$image" in
    "$prefix:"*) tag=${image#"$prefix:"} ;;
    *) die "running service image is not $prefix:<sha>: $image" ;;
  esac
  [[ "$tag" =~ ^[0-9a-f]{40}$ ]] || die "running service image tag is not an immutable SHA: $image"
  printf '%s\n' "$tag"
}

capture_running_images() {
  local backend_worker backend_scheduler backend static
  backend=$(service_image backend)
  backend_worker=$(service_image worker)
  backend_scheduler=$(service_image scheduler)
  static=$(service_image static)
  [ "$backend" = "$backend_worker" ] || die 'running backend and worker image tags do not match'
  [ "$backend" = "$backend_scheduler" ] || die 'running backend and scheduler image tags do not match'
  PREVIOUS_BACKEND_IMAGE_TAG=$(immutable_tag "$backend" memoly-backend)
  PREVIOUS_WEBAPP_IMAGE_TAG=$(immutable_tag "$static" memoly-webapp)
  export PREVIOUS_BACKEND_IMAGE_TAG PREVIOUS_WEBAPP_IMAGE_TAG
}

verify_rollback_file() {
  [ -f "$ROLLBACK_ENV" ] || die "server rollback file is missing: $ROLLBACK_ENV"
  [ ! -L "$ROLLBACK_ENV" ] || die 'server rollback file must not be a symlink'
  grep -q '^MEMOLY_DB_ROLLBACK_ALLOWED=false$' "$ROLLBACK_ENV" || die 'database rollback must remain disabled'
}

prepare_rollback() {
  verify_rollback_file
  install -d -m 0700 "$BACKUPS_DIR"
  local timestamp backup temp
  timestamp=$(date -u +%Y%m%dT%H%M%SZ)
  backup="$BACKUPS_DIR/rollback-env.before-${PRODUCT_SHA}-${timestamp}"
  [ ! -e "$backup" ] || die "rollback backup already exists: $(basename "$backup")"
  cp -p -- "$ROLLBACK_ENV" "$backup"
  chmod 0600 "$backup"
  temp="$ROLLBACK_ENV.tmp.$$"
  install -m 0600 /dev/null "$temp"
  awk -v backend="$PREVIOUS_BACKEND_IMAGE_TAG" -v webapp="$PREVIOUS_WEBAPP_IMAGE_TAG" '
    BEGIN { backend_seen = 0; webapp_seen = 0 }
    /^PREVIOUS_BACKEND_IMAGE_TAG=/ { print "PREVIOUS_BACKEND_IMAGE_TAG=" backend; backend_seen = 1; next }
    /^PREVIOUS_WEBAPP_IMAGE_TAG=/ { print "PREVIOUS_WEBAPP_IMAGE_TAG=" webapp; webapp_seen = 1; next }
    { print }
    END {
      if (!backend_seen) print "PREVIOUS_BACKEND_IMAGE_TAG=" backend
      if (!webapp_seen) print "PREVIOUS_WEBAPP_IMAGE_TAG=" webapp
    }
  ' "$ROLLBACK_ENV" > "$temp"
  chmod 0600 "$temp"
  mv -- "$temp" "$ROLLBACK_ENV"
  printf 'Rollback prepared from running images: backend=%s webapp=%s.\n' "$PREVIOUS_BACKEND_IMAGE_TAG" "$PREVIOUS_WEBAPP_IMAGE_TAG"
}

public_smoke() {
  local smoke_dir path expected_type status body headers
  smoke_dir=$(mktemp -d)
  for path in / /health/live /health/ready /manifest.webmanifest /assets/brand/pwa-memoly-192.webp /assets/brand/pwa-memoly-512.webp; do
    body="$smoke_dir/body"
    headers="$smoke_dir/headers"
    case "$path" in
      /) expected_type='text/html' ;;
      /health/*) expected_type='application/json' ;;
      /manifest.webmanifest) expected_type='application/manifest+json' ;;
      *) expected_type='image/webp' ;;
    esac
    if ! status=$(curl --fail --silent --show-error --max-time 10 -D "$headers" -o "$body" -w '%{http_code}' "${PUBLIC_URL%/}$path"); then
      rm -rf -- "$smoke_dir"
      die "public smoke failed: $path"
    fi
    [ "$status" = 200 ] || { rm -rf -- "$smoke_dir"; die "public smoke returned HTTP $status: $path"; }
    grep -Eiq "^content-type:[[:space:]]*${expected_type}(;|[[:space:]]|$)" "$headers" || {
      rm -rf -- "$smoke_dir"
      die "public smoke returned an unexpected content type: $path"
    }
    case "$path" in
      /) PUBLIC_INDEX_SHA256=$(sha256sum "$body" | awk '{print $1}') ;;
      /manifest.webmanifest) PUBLIC_MANIFEST_SHA256=$(sha256sum "$body" | awk '{print $1}') ;;
      /assets/brand/pwa-memoly-192.webp) PUBLIC_ICON_192_SHA256=$(sha256sum "$body" | awk '{print $1}') ;;
      /assets/brand/pwa-memoly-512.webp) PUBLIC_ICON_512_SHA256=$(sha256sum "$body" | awk '{print $1}') ;;
    esac
  done
  rm -rf -- "$smoke_dir"
  printf 'Public smoke passed: root, health, manifest, and PWA icons.\n'
}

write_release_manifest() {
  local timestamp manifest backend_id webapp_id migration_result app_version migration_set migration_count
  timestamp=$(date -u +%Y%m%dT%H%M%SZ)
  manifest="$RELEASES_DIR/selectel-${PRODUCT_SHA}-${timestamp}.env"
  install -d -m 0700 "$RELEASES_DIR"
  backend_id=$(docker image inspect --format '{{.Id}}' "memoly-backend:$PRODUCT_SHA")
  webapp_id=$(docker image inspect --format '{{.Id}}' "memoly-webapp:$PRODUCT_SHA")
  migration_result=$([ "$RUN_MIGRATION" = true ] && printf applied || printf checked)
  app_version=$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$APP_ROOT/package.json" | head -n 1)
  [ -n "$app_version" ] || die 'application version is missing from package.json'
  migration_set=$(find "$APP_ROOT/backend/prisma/migrations" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort | tail -n 1)
  migration_count=$(find "$APP_ROOT/backend/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
  [ -n "$migration_set" ] || die 'migration set is missing'
  install -m 0600 /dev/null "$manifest"
  cat > "$manifest" <<EOF
APP_VERSION=$app_version
RELEASE_SHA=$PRODUCT_SHA
BACKEND_IMAGE_ID=$backend_id
WEBAPP_IMAGE_ID=$webapp_id
MIGRATION=$migration_result
MIGRATION_COUNT=$migration_count
MIGRATION_LATEST=$migration_set
MIGRATION_STATUS=up_to_date
PREVIOUS_BACKEND_IMAGE_TAG=$PREVIOUS_BACKEND_IMAGE_TAG
PREVIOUS_WEBAPP_IMAGE_TAG=$PREVIOUS_WEBAPP_IMAGE_TAG
ENVIRONMENT=selectel-production
PUBLIC_HOST=${PUBLIC_URL#https://}
PUBLIC_SMOKE=passed
PUBLIC_INDEX_SHA256=$PUBLIC_INDEX_SHA256
PUBLIC_MANIFEST_SHA256=$PUBLIC_MANIFEST_SHA256
PUBLIC_ICON_192_SHA256=$PUBLIC_ICON_192_SHA256
PUBLIC_ICON_512_SHA256=$PUBLIC_ICON_512_SHA256
UTC=$timestamp
EOF
  chmod 0600 "$manifest"
  printf 'Release manifest written: %s\n' "$(basename "$manifest")"
}

main() {
  require_root
  require_command awk
  require_command cp
  require_command date
  require_command df
  require_command docker
  require_command git
  require_command id
  require_command install
  require_command sudo
  require_command mv
  require_command flock
  require_command curl
  require_command sed
  require_command find
  require_command sha256sum
  validate_inputs
  [ -d "$SERVER_ROOT" ] || die "server root is missing: $SERVER_ROOT"
  exec 8>"$SERVER_ROOT/.selectel-ci-release.lock" || die 'cannot open Selectel CI release lock'
  flock -n 8 || die 'another Selectel CI release is already running'
  check_disk_space
  validate_repository
  verify_rollback_file
  capture_running_images
  fetch_and_checkout

  SELECTEL_MAX_BOT_USERNAME="$MAX_BOT_USERNAME" bash "$APP_ROOT/deploy/selectel/build-images.sh" "$PRODUCT_SHA"
  prepare_rollback

  export MEMOLY_PRODUCT_SHA="$PRODUCT_SHA"
  export MEMOLY_BACKEND_IMAGE_TAG="$PRODUCT_SHA"
  export MEMOLY_WEBAPP_IMAGE_TAG="$PRODUCT_SHA"
  export MEMOLY_PUBLIC_HOST=${MEMOLY_PUBLIC_HOST:-app.memoly.ru}
  bash "$APP_ROOT/deploy/selectel/redeploy.sh" preflight
  if [ "$RUN_MIGRATION" = true ]; then
    bash "$APP_ROOT/deploy/selectel/redeploy.sh" migrate
  fi
  bash "$APP_ROOT/deploy/selectel/redeploy.sh" migration-status
  bash "$APP_ROOT/deploy/selectel/redeploy.sh" deploy
  public_smoke
  write_release_manifest
}

main "$@"
