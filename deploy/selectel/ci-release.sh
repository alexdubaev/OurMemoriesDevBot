#!/usr/bin/env bash
set -Eeuo pipefail

# This is the only server-side entry point used by the reviewed GitHub
# workflow. It deliberately performs the host checkout and image build on the
# Selectel machine, so the deployment uses the same immutable source SHA that
# is checked out in the server worktree.

SERVER_ROOT=${SERVER_ROOT:-/opt/memoly}
APP_ROOT=${APP_ROOT:-$SERVER_ROOT/app}
export SERVER_ROOT APP_ROOT
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
PROMOTION_STARTED=false
LEGACY_MEMBERSHIP_RUNTIME=false
QUIESCE_STARTED=false
B2_RUNTIME_SHA=79d85d6456fd46c56d15ff2b6fccba9cedfd4c6c
FORWARD_MARKER=${FORWARD_MARKER:-$SERVER_ROOT/.selectel-b2-forward-only}
RESUMING_FORWARD_ONLY=false
MARKER_TARGET_SHA=
PREBUILT_IMAGES=false

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
  local backend_set=false webapp_set=false
  [ "${SELECTEL_PREBUILT_BACKEND_ID+x}" = x ] && backend_set=true
  [ "${SELECTEL_PREBUILT_WEBAPP_ID+x}" = x ] && webapp_set=true
  [ "$backend_set" = "$webapp_set" ] || die 'prebuilt image IDs must be supplied together'
  if [ "$backend_set" = true ]; then
    [[ "$SELECTEL_PREBUILT_BACKEND_ID" =~ ^sha256:[0-9a-f]{64}$ ]] ||
      die 'SELECTEL_PREBUILT_BACKEND_ID must be a lowercase sha256:64hex image ID'
    [[ "$SELECTEL_PREBUILT_WEBAPP_ID" =~ ^sha256:[0-9a-f]{64}$ ]] ||
      die 'SELECTEL_PREBUILT_WEBAPP_ID must be a lowercase sha256:64hex image ID'
    PREBUILT_IMAGES=true
  fi
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
    # Repair only Git metadata written by the root fallback. Deployment files
    # may intentionally remain root-owned and are handled by this fallback on
    # the next release as needed.
    for path in HEAD index logs/HEAD; do
      [ -e "$APP_ROOT/.git/$path" ] && chown "$APP_USER:$APP_GROUP" "$APP_ROOT/.git/$path"
    done
  fi

  local head status
  head=$(git_root rev-parse HEAD)
  [ "$head" = "$PRODUCT_SHA" ] || die 'server checkout HEAD does not equal requested release SHA'
  status=$(git_root status --porcelain)
  [ -z "$status" ] || die 'server checkout is dirty after release checkout'
}

validate_prebuilt_images() {
  [ "$PREBUILT_IMAGES" = true ] || return 0
  local backend_image="memoly-backend:$PRODUCT_SHA" webapp_image="memoly-webapp:$PRODUCT_SHA"
  local backend_id webapp_id backend_revision webapp_revision
  backend_id=$(docker image inspect --format '{{.Id}}' "$backend_image" 2>/dev/null) ||
    die "prebuilt backend image tag is missing: $backend_image"
  [ "$backend_id" = "$SELECTEL_PREBUILT_BACKEND_ID" ] ||
    die 'prebuilt backend image ID does not match SELECTEL_PREBUILT_BACKEND_ID'
  backend_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$backend_image" 2>/dev/null) ||
    die "cannot inspect prebuilt backend image revision: $backend_image"
  [ "$backend_revision" = "$PRODUCT_SHA" ] ||
    die "prebuilt backend image revision label does not match release SHA: $backend_image"

  webapp_id=$(docker image inspect --format '{{.Id}}' "$webapp_image" 2>/dev/null) ||
    die "prebuilt webapp image tag is missing: $webapp_image"
  [ "$webapp_id" = "$SELECTEL_PREBUILT_WEBAPP_ID" ] ||
    die 'prebuilt webapp image ID does not match SELECTEL_PREBUILT_WEBAPP_ID'
  webapp_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$webapp_image" 2>/dev/null) ||
    die "cannot inspect prebuilt webapp image revision: $webapp_image"
  [ "$webapp_revision" = "$PRODUCT_SHA" ] ||
    die "prebuilt webapp image revision label does not match release SHA: $webapp_image"
  printf 'Prebuilt immutable images verified for %s.\n' "$PRODUCT_SHA"
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

detect_membership_rollback_boundary() {
  if [ "$RESUMING_FORWARD_ONLY" = true ]; then
    git_root merge-base --is-ancestor "$MARKER_TARGET_SHA" "$PRODUCT_SHA" ||
      die 'forward-only recovery target must descend from the interrupted release'
    LEGACY_MEMBERSHIP_RUNTIME=true
    printf 'Resuming the recorded B2 forward-only release boundary.\n'
    return
  fi
  git_root cat-file -e "$PREVIOUS_BACKEND_IMAGE_TAG^{commit}" 2>/dev/null ||
    die 'running backend SHA is not available in the canonical checkout; cannot assess rollback compatibility'
  git_root merge-base --is-ancestor "$PREVIOUS_BACKEND_IMAGE_TAG" "$PRODUCT_SHA" ||
    die 'running backend SHA is not an ancestor of the requested release'
  git_root merge-base --is-ancestor "$B2_RUNTIME_SHA" "$PRODUCT_SHA" ||
    die 'requested release does not contain the accepted B2 runtime'
  if ! git_root merge-base --is-ancestor "$B2_RUNTIME_SHA" "$PREVIOUS_BACKEND_IMAGE_TAG"; then
    LEGACY_MEMBERSHIP_RUNTIME=true
    printf 'Pre-B2 runtime detected; release will quiesce legacy writers before migration and use forward-only recovery.\n'
  fi
}

load_forward_marker() {
  [ -f "$FORWARD_MARKER" ] || die 'forward-only marker is not a regular file'
  [ ! -L "$FORWARD_MARKER" ] || die 'forward-only marker must not be a symlink'
  [ "$(stat -c '%u' "$FORWARD_MARKER")" = 0 ] || die 'forward-only marker must be owned by root'
  [ "$(stat -c '%a' "$FORWARD_MARKER")" = 600 ] || die 'forward-only marker must have mode 0600'
  local -a lines
  mapfile -t lines < "$FORWARD_MARKER"
  [ "${#lines[@]}" -eq 3 ] || die 'forward-only marker has an invalid format'
  [[ "${lines[0]}" =~ ^B2_FORWARD_ONLY_TARGET=([0-9a-f]{40})$ ]] || die 'forward-only target is invalid'
  MARKER_TARGET_SHA=${BASH_REMATCH[1]}
  [[ "${lines[1]}" =~ ^PREVIOUS_BACKEND_IMAGE_TAG=([0-9a-f]{40})$ ]] || die 'forward-only backend tag is invalid'
  PREVIOUS_BACKEND_IMAGE_TAG=${BASH_REMATCH[1]}
  [[ "${lines[2]}" =~ ^PREVIOUS_WEBAPP_IMAGE_TAG=([0-9a-f]{40})$ ]] || die 'forward-only webapp tag is invalid'
  PREVIOUS_WEBAPP_IMAGE_TAG=${BASH_REMATCH[1]}
  export PREVIOUS_BACKEND_IMAGE_TAG PREVIOUS_WEBAPP_IMAGE_TAG
  RESUMING_FORWARD_ONLY=true
}

write_forward_marker() {
  [ ! -e "$FORWARD_MARKER" ] || die 'forward-only marker already exists'
  local temp="$FORWARD_MARKER.tmp.$$"
  install -m 0600 /dev/null "$temp"
  printf 'B2_FORWARD_ONLY_TARGET=%s\nPREVIOUS_BACKEND_IMAGE_TAG=%s\nPREVIOUS_WEBAPP_IMAGE_TAG=%s\n' \
    "$PRODUCT_SHA" "$PREVIOUS_BACKEND_IMAGE_TAG" "$PREVIOUS_WEBAPP_IMAGE_TAG" > "$temp"
  mv -- "$temp" "$FORWARD_MARKER"
}

verify_rollback_file() {
  [ -f "$ROLLBACK_ENV" ] || die "server rollback file is missing: $ROLLBACK_ENV"
  [ ! -L "$ROLLBACK_ENV" ] || die 'server rollback file must not be a symlink'
  [ "$(stat -c '%u' "$ROLLBACK_ENV")" = 0 ] || die 'server rollback file must be owned by root'
  [ "$(stat -c '%a' "$ROLLBACK_ENV")" = 600 ] || die 'server rollback file must have mode 0600'
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
    actual_type=$(awk -F: 'tolower($1) == "content-type" { value = $2; sub(/^[[:space:]]*/, "", value); sub(/[;].*$/, "", value); gsub(/[[:space:]]/, "", value); print tolower(value); exit }' "$headers")
    [ "$actual_type" = "$expected_type" ] || {
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
  require_command stat
  validate_inputs
  [ -d "$SERVER_ROOT" ] || die "server root is missing: $SERVER_ROOT"
  exec 9>"$SERVER_ROOT/.selectel-deploy.lock" || die 'cannot open Selectel deployment lock'
  flock -n 9 || die 'another Selectel deployment is already running'
  export SELECTEL_DEPLOY_LOCK_FD=9
  export SELECTEL_CI_RELEASE=true

  release_failure() {
    local status=$?
    trap - EXIT
    [ "$status" -eq 0 ] && exit 0
    if [ "$LEGACY_MEMBERSHIP_RUNTIME" = true ] && [ "$QUIESCE_STARTED" = true ]; then
      printf 'ERROR: pre-B2 runtime cannot be restored after this release boundary; keeping legacy writers stopped for forward recovery.\n' >&2
      if ! bash "$APP_ROOT/deploy/selectel/redeploy.sh" quiesce-legacy; then
        printf 'ERROR: could not confirm legacy writers are stopped; immediate operator inspection is required.\n' >&2
      fi
    elif [ "$PROMOTION_STARTED" = true ]; then
      printf 'ERROR: release promotion failed; attempting application rollback.\n' >&2
      if ! bash "$APP_ROOT/deploy/selectel/redeploy.sh" rollback; then
        printf 'ERROR: automatic application rollback failed; manual rollback is required.\n' >&2
      fi
    fi
    exit "$status"
  }
  trap release_failure EXIT

  validate_repository
  if [ -e "$FORWARD_MARKER" ]; then
    load_forward_marker
    LEGACY_MEMBERSHIP_RUNTIME=true
    QUIESCE_STARTED=true
    export MEMOLY_PRODUCT_SHA="$MARKER_TARGET_SHA"
    bash "$APP_ROOT/deploy/selectel/redeploy.sh" quiesce-legacy
  fi
  check_disk_space
  verify_rollback_file
  if [ "$RESUMING_FORWARD_ONLY" = false ]; then
    capture_running_images
  fi
  fetch_and_checkout
  validate_prebuilt_images
  detect_membership_rollback_boundary

  if [ "$PREBUILT_IMAGES" = false ]; then
    SELECTEL_MAX_BOT_USERNAME="$MAX_BOT_USERNAME" bash "$APP_ROOT/deploy/selectel/build-images.sh" "$PRODUCT_SHA"
  fi
  if [ "$RESUMING_FORWARD_ONLY" = false ]; then prepare_rollback; fi

  export MEMOLY_PRODUCT_SHA="$PRODUCT_SHA"
  export MEMOLY_BACKEND_IMAGE_TAG="$PRODUCT_SHA"
  export MEMOLY_WEBAPP_IMAGE_TAG="$PRODUCT_SHA"
  export MEMOLY_PUBLIC_HOST=${MEMOLY_PUBLIC_HOST:-app.memoly.ru}
  bash "$APP_ROOT/deploy/selectel/redeploy.sh" preflight
  if [ "$LEGACY_MEMBERSHIP_RUNTIME" = true ]; then
    if [ "$RUN_MIGRATION" = false ]; then
      bash "$APP_ROOT/deploy/selectel/redeploy.sh" migration-status ||
        die 'pending migrations require the guarded migration input before crossing the B2 runtime boundary'
    fi
    if [ "$RESUMING_FORWARD_ONLY" = false ]; then write_forward_marker; fi
    QUIESCE_STARTED=true
    bash "$APP_ROOT/deploy/selectel/redeploy.sh" quiesce-legacy
  fi
  if [ "$RUN_MIGRATION" = true ]; then
    bash "$APP_ROOT/deploy/selectel/redeploy.sh" migrate
  fi
  bash "$APP_ROOT/deploy/selectel/redeploy.sh" migration-status
  PROMOTION_STARTED=true
  bash "$APP_ROOT/deploy/selectel/redeploy.sh" deploy
  public_smoke
  write_release_manifest
  PROMOTION_STARTED=false
  if [ "$LEGACY_MEMBERSHIP_RUNTIME" = true ]; then rm -- "$FORWARD_MARKER"; fi
}

main "$@"
