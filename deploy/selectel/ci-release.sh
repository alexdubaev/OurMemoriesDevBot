#!/usr/bin/env bash
set -Eeuo pipefail

# Guarded manual entry point for Selectel releases. It performs the host
# checkout and image build on the Selectel machine, preserving the immutable
# source SHA used by the server worktree.

SERVER_ROOT=${SERVER_ROOT:-/opt/memoly}
APP_ROOT=${APP_ROOT:-$SERVER_ROOT/app}
export SERVER_ROOT APP_ROOT
ROLLBACK_ENV=${ROLLBACK_ENV:-$SERVER_ROOT/rollback.env}
FRONTEND_STATE=${FRONTEND_STATE:-$SERVER_ROOT/frontend-recovery.env}
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
RELEASE_MODE=${5:-full}
PROMOTION_STARTED=false
LEGACY_MEMBERSHIP_RUNTIME=false
LEGACY_MM0_RUNTIME=false
QUIESCE_STARTED=false
B2_RUNTIME_SHA=79d85d6456fd46c56d15ff2b6fccba9cedfd4c6c
MM0_RUNTIME_SHA=0074d04c8e7f88b2327b56cea10ca38647d36190
MM0_MIGRATION=20260928100000_mm0_domain_temporal_foundation
ACCEPTED_UI_V4_SHA=afdb408f8bbf22b564c86bb8d33a83261f55cc48
MM0_FORWARD_MARKER=${MM0_FORWARD_MARKER:-$SERVER_ROOT/.selectel-mm0-forward-only}
FORWARD_MARKER=${FORWARD_MARKER:-$SERVER_ROOT/.selectel-b2-forward-only}
MM0_ACTIVE_MARKER=$MM0_FORWARD_MARKER
RESUMING_FORWARD_ONLY=false
RESUMING_MM0=false
MARKER_TARGET_SHA=
PREBUILT_IMAGES=false
RUNNING_BACKEND_IMAGE_TAG=
RUNNING_WEBAPP_IMAGE_TAG=
ROLLBACK_VERIFY_ENV=
FRONTEND_RECOVERY_FILE=$SERVER_ROOT/frontend-recovery.env
FRONTEND_RECOVERY_PRESENT=false
FRONTEND_RECOVERY_SHA256=

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

release_failure() {
    local status=$?
    trap - EXIT
    if [ -n "$ROLLBACK_VERIFY_ENV" ]; then
      rm -f -- "$ROLLBACK_VERIFY_ENV"
      ROLLBACK_VERIFY_ENV=
    fi
    [ "$status" -eq 0 ] && exit 0
    if [ -e "$MM0_FORWARD_MARKER" ] || [ -L "$MM0_FORWARD_MARKER" ]; then
      printf 'ERROR: FORWARD_FIX_REQUIRED: MM0 migration may have applied; old writers must remain stopped.\n' >&2
      if ! FORWARD_MARKER="$MM0_FORWARD_MARKER" MM0_BOUNDARY=true bash "$APP_ROOT/deploy/selectel/redeploy.sh" quiesce-legacy; then
        printf 'ERROR: marker-based quiescence failed; stopping every application writer.\n' >&2
        MM0_BOUNDARY=true bash "$APP_ROOT/deploy/selectel/redeploy.sh" quiesce-all ||
          printf 'ERROR: could not confirm all writers are stopped; immediate operator inspection is required.\n' >&2
      fi
    elif [ "$LEGACY_MEMBERSHIP_RUNTIME" = true ] && [ "$QUIESCE_STARTED" = true ]; then
      if [ "$LEGACY_MM0_RUNTIME" = true ]; then
        printf 'ERROR: FORWARD_FIX_REQUIRED: MM0 migration may have applied; old writers must remain stopped.\n' >&2
      fi
      printf 'ERROR: pre-B2 runtime cannot be restored after this release boundary; keeping legacy writers stopped for forward recovery.\n' >&2
      if ! MM0_BOUNDARY="$LEGACY_MM0_RUNTIME" bash "$APP_ROOT/deploy/selectel/redeploy.sh" quiesce-legacy; then
        MM0_BOUNDARY="$LEGACY_MM0_RUNTIME" bash "$APP_ROOT/deploy/selectel/redeploy.sh" quiesce-all ||
          printf 'ERROR: could not confirm all writers are stopped; immediate operator inspection is required.\n' >&2
      fi
    elif [ "$PROMOTION_STARTED" = true ]; then
      printf 'ERROR: release promotion failed; attempting application rollback.\n' >&2
      if ! bash "$APP_ROOT/deploy/selectel/redeploy.sh" rollback; then
        printf 'ERROR: automatic application rollback failed; a compatible forward fix may be required.\n' >&2
      fi
    fi
    exit "$status"
  }

validate_inputs() {
  [[ "$PRODUCT_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'release SHA must be a 40-character lowercase Git SHA'
  [ "$DEPLOY_CONFIRMATION" = DEPLOY ] || die 'deployment confirmation must be exactly DEPLOY'
  case "$RELEASE_MODE" in full|frontend|frontend-rollback) ;; *) die 'release mode must be full, frontend, or frontend-rollback' ;; esac
  case "$RUN_MIGRATION" in
    true|false) ;;
    *) die 'migration flag must be true or false' ;;
  esac
  [[ "$MAX_BOT_USERNAME" =~ ^[A-Za-z0-9_]{5,32}$ ]] || die 'MAX bot username has an invalid public username format'
  local backend_set=false webapp_set=false
  [ "${SELECTEL_PREBUILT_BACKEND_ID+x}" = x ] && backend_set=true
  [ "${SELECTEL_PREBUILT_WEBAPP_ID+x}" = x ] && webapp_set=true
  if [ "$RELEASE_MODE" = full ]; then
    [ "$backend_set" = "$webapp_set" ] || die 'prebuilt image IDs must be supplied together'
  else
    [ "$backend_set" = false ] || die 'frontend release modes refuse prebuilt backend image IDs'
  fi
  if [ "$backend_set" = true ]; then
    [[ "$SELECTEL_PREBUILT_BACKEND_ID" =~ ^sha256:[0-9a-f]{64}$ ]] ||
      die 'SELECTEL_PREBUILT_BACKEND_ID must be a lowercase sha256:64hex image ID'
    [[ "$SELECTEL_PREBUILT_WEBAPP_ID" =~ ^sha256:[0-9a-f]{64}$ ]] ||
      die 'SELECTEL_PREBUILT_WEBAPP_ID must be a lowercase sha256:64hex image ID'
    PREBUILT_IMAGES=true
  fi
}

validate_frontend_recovery_path() {
  local canonical frontend_resolved rollback_resolved
  canonical=$SERVER_ROOT/frontend-recovery.env
  [ "$FRONTEND_STATE" = "$canonical" ] || die 'FRONTEND_STATE override is unsupported; use the canonical server-root recovery path'
  frontend_resolved=$(readlink -m -- "$canonical") || die 'cannot resolve canonical frontend recovery path'
  rollback_resolved=$(readlink -m -- "$ROLLBACK_ENV") || die 'cannot resolve application rollback path'
  [ "$frontend_resolved" != "$rollback_resolved" ] ||
    die 'frontend recovery path must not collide with the application rollback file'
}

clear_release_markers() {
  PROMOTION_STARTED=false
  if [ "$LEGACY_MM0_RUNTIME" = true ] && [ "$MM0_ACTIVE_MARKER" = "$MM0_FORWARD_MARKER" ]; then rm -- "$MM0_FORWARD_MARKER"; fi
  if [ "$LEGACY_MEMBERSHIP_RUNTIME" = true ] &&
     { [ "$LEGACY_MM0_RUNTIME" = false ] || [ "$MM0_ACTIVE_MARKER" = "$FORWARD_MARKER" ]; }; then
    rm -- "$FORWARD_MARKER"
  fi
}

git_memoly() {
  sudo -n -u "$APP_USER" git -c safe.directory="$APP_ROOT" -C "$APP_ROOT" "$@"
}

git_root() {
  git -c safe.directory="$APP_ROOT" -C "$APP_ROOT" "$@"
}

assert_root_owned_path() {
  local path=$1 kind=$2 missing_final=${3:-false} current=/ part mode write_bits index=0 count
  local -a components=()
  [[ "$path" = /* ]] || die 'fixed control host path must be absolute'
  IFS='/' read -r -a components <<< "${path#/}"
  count=${#components[@]}
  for part in "${components[@]}"; do
    [ -n "$part" ] || continue
    current=${current%/}/$part
    index=$((index + 1))
    if [ -L "$current" ]; then die 'fixed control host path contains a symlink'; fi
    if [ ! -e "$current" ]; then
      [ "$missing_final" = true ] && [ "$index" -eq "$count" ] && return 0
      die 'fixed control host path is missing'
    fi
    [ "$(stat -c '%u' -- "$current")" = 0 ] || die 'fixed control host path is not root-owned'
    mode=$(stat -c '%a' -- "$current") || die 'cannot inspect fixed control host path mode'
    [[ "$mode" =~ ^[0-7]{3,4}$ ]] || die 'fixed control host path mode is invalid'
    write_bits=$((8#$mode & 022))
    [ "$write_bits" -eq 0 ] || die 'fixed control host path is group/world writable'
    if [ "$index" -lt "$count" ]; then
      [ -d "$current" ] || die 'fixed control host path ancestor is not a directory'
    elif [ "$kind" = directory ]; then
      [ -d "$current" ] || die 'fixed control host path is not a directory'
    else
      [ -f "$current" ] || die 'fixed control host path is not a regular file'
    fi
  done
}

ensure_root_directory() {
  local path=$1
  assert_root_owned_path "$path" directory true
  install -d -o root -g root -m 0755 -- "$path" || die 'cannot create the fixed Control host directory'
  assert_root_owned_path "$path" directory
}

assert_root_controlled_interpreter() {
  local interpreter=${1:-/usr/bin/python3} parent target resolved
  parent=$(dirname -- "$interpreter")
  assert_root_owned_path "$parent" directory
  if [ -L "$interpreter" ]; then
    [ "$(stat -c '%u:%g' -- "$interpreter")" = 0:0 ] || die 'Python interpreter link is not root-owned'
    target=$(readlink -- "$interpreter") || die 'cannot inspect Python interpreter link'
    case "$target" in
      python3.[0-9]*|"$parent"/python3.[0-9]*) ;;
      *) die 'Python interpreter link must target a versioned interpreter in its root-controlled directory' ;;
    esac
    resolved=$(readlink -f -- "$interpreter") || die 'cannot resolve Python interpreter executable'
    [[ "$resolved" = "$parent"/python3.[0-9]* ]] || die 'Python interpreter resolves outside its root-controlled directory'
    assert_root_owned_path "$resolved" file
  else
    resolved=$interpreter
    assert_root_owned_path "$resolved" file
  fi
  [ -x "$resolved" ] || die 'Python interpreter executable is not runnable'
}

install_pinned_control_host_inputs() {
  local control_root=$1 systemd_dir=$2 relative source_path target_path mode source_tmp target_tmp
  local -a files=(
    "deploy/selectel/control/sampler.py:$control_root/sampler.py:0644"
    "deploy/selectel/control/memoly-control-sampler.service:$systemd_dir/memoly-control-sampler.service:0644"
    "deploy/selectel/control/memoly-control-sampler.timer:$systemd_dir/memoly-control-sampler.timer:0644"
  )
  for relative in "${files[@]}"; do
    IFS=: read -r source_path target_path mode <<< "$relative"
    assert_root_owned_path "$target_path" file true
    source_tmp=$(mktemp "$control_root/.install-control-XXXXXX") || die 'cannot create a protected sampler install temporary'
    if ! git_root show "$PRODUCT_SHA:$source_path" > "$source_tmp"; then rm -f -- "$source_tmp"; die 'cannot read a pinned Control host input'; fi
    local expected_blob actual_blob
    expected_blob=$(git_root rev-parse "$PRODUCT_SHA:$source_path") || { rm -f -- "$source_tmp"; die 'cannot resolve a pinned Control host input'; }
    actual_blob=$(git_root hash-object -- "$source_tmp") || { rm -f -- "$source_tmp"; die 'cannot hash a pinned Control host input'; }
    [ "$actual_blob" = "$expected_blob" ] || { rm -f -- "$source_tmp"; die 'Control host input differs from the accepted source blob'; }
    target_tmp="${target_path}.tmp.$$"
    assert_root_owned_path "$(dirname -- "$target_path")" directory
    [ ! -L "$target_tmp" ] || { rm -f -- "$source_tmp"; die 'Control host install target is a symlink'; }
    install -o root -g root -m "$mode" -- "$source_tmp" "$target_tmp" || { rm -f -- "$source_tmp"; die 'cannot stage a pinned Control host input'; }
    mv -f -- "$target_tmp" "$target_path" || { rm -f -- "$source_tmp"; die 'cannot install a pinned Control host input'; }
    local installed_blob
    installed_blob=$(git_root hash-object -- "$target_path") || { rm -f -- "$source_tmp"; die 'cannot verify installed Control host input'; }
    [ "$installed_blob" = "$expected_blob" ] || { rm -f -- "$source_tmp"; die 'installed Control host input checksum differs from accepted source'; }
    rm -f -- "$source_tmp"
    assert_root_owned_path "$target_path" file
    [ "$((8#$(stat -c '%a' -- "$target_path")))" -eq "$((8#$mode))" ] || die 'installed Control host input has an unexpected mode'
  done
}

install_control_sampler() {
  local control_root=/opt/memoly/control metrics_dir=/opt/memoly/control/metrics systemd_dir=/etc/systemd/system
  require_command systemctl
  require_command python3
  ensure_root_directory "$control_root"
  ensure_root_directory "$metrics_dir"
  assert_root_owned_path "$systemd_dir" directory
  assert_root_controlled_interpreter /usr/bin/python3
  install_pinned_control_host_inputs "$control_root" "$systemd_dir"
  systemctl daemon-reload || die 'cannot reload the systemd unit catalog for Control sampler'
  systemctl enable --now memoly-control-sampler.timer >/dev/null || die 'cannot enable the Control sampler timer'
  systemctl start memoly-control-sampler.service || die 'initial Control sampler run failed'
  systemctl is-active --quiet memoly-control-sampler.timer || die 'Control sampler timer is not active'
  assert_root_owned_path /opt/memoly/control/metrics/snapshot.json file
  printf 'Pinned Control sampler installed and first snapshot verified.\n'
}

write_control_release_receipt() {
  local backend_sha=$1 static_sha=$2 migration_count=$3 receipt=/opt/memoly/control/release-evidence.json temp timestamp
  [[ "$backend_sha" =~ ^[0-9a-f]{40}$ && "$static_sha" =~ ^[0-9a-f]{40}$ && "$migration_count" =~ ^[0-9]+$ ]] ||
    die 'Control release receipt inputs are invalid'
  ensure_root_directory /opt/memoly/control
  assert_root_owned_path "$receipt" file true
  if [ -e "$receipt" ]; then
    [ "$(stat -c '%a' -- "$receipt")" = 600 ] || die 'existing Control release evidence has an unexpected mode'
  fi
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  temp=$(mktemp /opt/memoly/control/.release-evidence-XXXXXX) || die 'cannot create a protected release evidence temporary'
  chmod 0600 "$temp" || { rm -f -- "$temp"; die 'cannot secure release evidence temporary'; }
  printf '{"backendSha":"%s","staticSha":"%s","migrationCatalogCount":%s,"migrationStatus":"up_to_date","lastSuccessfulReleaseAt":"%s"}\n' \
    "$backend_sha" "$static_sha" "$migration_count" "$timestamp" > "$temp"
  chmod 0600 "$temp"
  mv -f -- "$temp" "$receipt" || { rm -f -- "$temp"; die 'cannot publish successful Control release evidence'; }
  assert_root_owned_path "$receipt" file
  [ "$(stat -c '%a' -- "$receipt")" = 600 ] || die 'published Control release evidence has an unexpected mode'
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

require_release_ownership() {
  [ -n "$APP_GROUP" ] || APP_GROUP=$(id -gn "$APP_USER") || die "cannot determine release group for $APP_USER"
  local expected_uid expected_gid
  expected_uid=$(id -u "$APP_USER") || die "cannot determine release user ID: $APP_USER"
  expected_gid=$(getent group "$APP_GROUP" | cut -d: -f3)
  [[ "$expected_gid" =~ ^[0-9]+$ ]] || die "cannot determine release group ID: $APP_GROUP"

  check_path_owner() {
    local candidate=$1 actual_uid actual_gid
    [ -e "$candidate" ] || [ -L "$candidate" ] || return 0
    read -r actual_uid actual_gid < <(stat -c '%u %g' -- "$candidate" 2>/dev/null) ||
      die "cannot inspect checkout ownership at ${candidate#"$APP_ROOT"/}"
    if [ "$actual_uid" != "$expected_uid" ] || [ "$actual_gid" != "$expected_gid" ]; then
      die "unsafe checkout ownership at ${candidate#"$APP_ROOT"/}: expected $APP_USER:$APP_GROUP"
    fi
  }

  check_tree_paths() {
    local revision=$1 path parent candidate
    if ! git_memoly ls-tree -r --name-only -z "$revision" | while IFS= read -r -d '' path; do
      candidate=$APP_ROOT/$path
      check_path_owner "$candidate"
      parent=$(dirname -- "$candidate")
      while [ "$parent" != "$APP_ROOT" ] && [[ "$parent" == "$APP_ROOT"/* ]]; do
        check_path_owner "$parent"
        parent=$(dirname -- "$parent")
      done
    done; then
      die "cannot inspect tracked paths for checkout ownership: $revision"
    fi
  }

  check_path_owner "$APP_ROOT"
  check_tree_paths HEAD
  check_tree_paths "$PRODUCT_SHA"
}

check_disk_space() {
  local available
  available=$(df -Pk "$SERVER_ROOT" | awk 'NR == 2 { print $4 }')
  [[ "$available" =~ ^[0-9]+$ ]] || die 'cannot determine free disk space'
  [ "$available" -ge "$MIN_FREE_KIB" ] || die "free disk space is below ${MIN_FREE_KIB} KiB; perform approved host maintenance before release"
  printf 'Disk preflight passed: %s KiB available.\n' "$available"
}

validate_planned_source() {
  git_memoly fetch --prune origin main || die 'cannot fetch accepted main from origin'
  local accepted_sha
  accepted_sha=$(git_memoly rev-parse refs/remotes/origin/main 2>/dev/null || true)
  [ "$accepted_sha" = "$PRODUCT_SHA" ] || die "requested SHA is not the current accepted origin/main SHA"
  git_root merge-base --is-ancestor "$ACCEPTED_UI_V4_SHA" "$PRODUCT_SHA" ||
    die 'planned release must contain the accepted UI v4 source'
}

fetch_and_checkout() {
  require_release_ownership
  if ! git_memoly switch --detach "$PRODUCT_SHA" >/dev/null 2>&1; then
    # Git diagnostics can include host paths or remote details; surface only a
    # sanitized failure and leave checkout repair to scoped host maintenance.
    die 'cannot checkout requested release SHA as the release user; inspect checkout ownership and Git state'
  fi

  local head status
  head=$(git_memoly rev-parse HEAD) || die 'cannot inspect server checkout HEAD after switch'
  [ "$head" = "$PRODUCT_SHA" ] || die 'server checkout HEAD does not equal requested release SHA'
  require_release_ownership
  status=$(git_memoly status --porcelain) || die 'cannot inspect server checkout status after switch'
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
  RUNNING_BACKEND_IMAGE_TAG=$(immutable_tag "$backend" memoly-backend)
  RUNNING_WEBAPP_IMAGE_TAG=$(immutable_tag "$static" memoly-webapp)
  PREVIOUS_BACKEND_IMAGE_TAG=$RUNNING_BACKEND_IMAGE_TAG
  PREVIOUS_WEBAPP_IMAGE_TAG=$RUNNING_WEBAPP_IMAGE_TAG
  export PREVIOUS_BACKEND_IMAGE_TAG PREVIOUS_WEBAPP_IMAGE_TAG
}

detect_membership_rollback_boundary() {
  if [ "$RESUMING_FORWARD_ONLY" = true ] && [ "$RESUMING_MM0" = false ]; then
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

detect_mm0_boundary() {
  git_root cat-file -e "$MM0_RUNTIME_SHA^{commit}" 2>/dev/null || die 'accepted MM0 runtime commit is unavailable'
  if git_root merge-base --is-ancestor "$MM0_RUNTIME_SHA" "$PRODUCT_SHA"; then
    git_root cat-file -e "$PRODUCT_SHA:backend/prisma/migrations/$MM0_MIGRATION/migration.sql" 2>/dev/null ||
      die 'MM0-compatible release is missing the MM0 migration SQL'
  fi
  if [ "$RESUMING_MM0" = true ]; then
    git_root merge-base --is-ancestor "$MARKER_TARGET_SHA" "$PRODUCT_SHA" ||
      die 'MM0 forward-only recovery target must descend from the interrupted release'
    LEGACY_MM0_RUNTIME=true
    return
  fi
  if git_root merge-base --is-ancestor "$MM0_RUNTIME_SHA" "$PRODUCT_SHA" &&
     ! git_root merge-base --is-ancestor "$MM0_RUNTIME_SHA" "$PREVIOUS_BACKEND_IMAGE_TAG"; then
    LEGACY_MM0_RUNTIME=true
    printf 'Pre-MM0 runtime detected; the migration boundary requires a validated backup and forward-only recovery.\n'
  fi
}

load_mm0_marker() {
  [ -f "$MM0_FORWARD_MARKER" ] && [ ! -L "$MM0_FORWARD_MARKER" ] || die 'MM0 forward-only marker is invalid'
  [ "$(stat -c '%u' "$MM0_FORWARD_MARKER")" = 0 ] &&
    [ "$(stat -c '%a' "$MM0_FORWARD_MARKER")" = 600 ] || die 'MM0 forward-only marker ownership or mode is invalid'
  local -a lines
  mapfile -t lines < "$MM0_FORWARD_MARKER"
  [ "${#lines[@]}" -eq 3 ] || die 'MM0 forward-only marker format is invalid'
  [[ "${lines[0]}" =~ ^MM0_FORWARD_ONLY_TARGET=([0-9a-f]{40})$ ]] || die 'MM0 marker target is invalid'
  MARKER_TARGET_SHA=${BASH_REMATCH[1]}
  git_root merge-base --is-ancestor "$MM0_RUNTIME_SHA" "$MARKER_TARGET_SHA" ||
    die 'MM0 marker target predates the compatible MM0 runtime'
  [[ "${lines[1]}" =~ ^PREVIOUS_BACKEND_IMAGE_TAG=([0-9a-f]{40})$ ]] || die 'MM0 marker backend is invalid'
  PREVIOUS_BACKEND_IMAGE_TAG=${BASH_REMATCH[1]}
  [[ "${lines[2]}" =~ ^PREVIOUS_WEBAPP_IMAGE_TAG=([0-9a-f]{40})$ ]] || die 'MM0 marker webapp is invalid'
  PREVIOUS_WEBAPP_IMAGE_TAG=${BASH_REMATCH[1]}
  export PREVIOUS_BACKEND_IMAGE_TAG PREVIOUS_WEBAPP_IMAGE_TAG
  RESUMING_FORWARD_ONLY=true
  RESUMING_MM0=true
}

write_mm0_marker() {
  [ ! -e "$MM0_FORWARD_MARKER" ] && [ ! -L "$MM0_FORWARD_MARKER" ] || die 'MM0 forward-only marker already exists'
  local temp="$MM0_FORWARD_MARKER.tmp.$$"
  install -m 0600 /dev/null "$temp"
  printf 'MM0_FORWARD_ONLY_TARGET=%s\nPREVIOUS_BACKEND_IMAGE_TAG=%s\nPREVIOUS_WEBAPP_IMAGE_TAG=%s\n' \
    "$PRODUCT_SHA" "$PREVIOUS_BACKEND_IMAGE_TAG" "$PREVIOUS_WEBAPP_IMAGE_TAG" > "$temp"
  sync -f "$temp" || die 'cannot persist MM0 forward-only marker contents'
  mv -- "$temp" "$MM0_FORWARD_MARKER"
  sync -f "$SERVER_ROOT" || die 'cannot persist MM0 forward-only marker directory entry'
}

verify_promoted_revision() {
  local service image expected revision
  for service in backend worker scheduler static; do
    image=$(service_image "$service")
    case "$service" in
      static) expected="memoly-webapp:$PRODUCT_SHA" ;;
      *) expected="memoly-backend:$PRODUCT_SHA" ;;
    esac
    [ "$image" = "$expected" ] || die "promoted $service image does not match the release SHA"
    revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image" 2>/dev/null) ||
      die "cannot inspect promoted $service revision label"
    [ "$revision" = "$PRODUCT_SHA" ] || die "promoted $service revision label does not match the release SHA"
  done
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
  local timestamp backup temp verify_env candidate_valid=false
  if [ "$LEGACY_MEMBERSHIP_RUNTIME" = false ] && [ "$LEGACY_MM0_RUNTIME" = false ]; then
    verify_env=$(mktemp)
    ROLLBACK_VERIFY_ENV=$verify_env
    install -m 0600 /dev/null "$verify_env"
    awk -v backend="$RUNNING_BACKEND_IMAGE_TAG" -v webapp="$RUNNING_WEBAPP_IMAGE_TAG" '
      BEGIN { backend_seen = 0; webapp_seen = 0 }
      /^PREVIOUS_BACKEND_IMAGE_TAG=/ { print "PREVIOUS_BACKEND_IMAGE_TAG=" backend; backend_seen = 1; next }
      /^PREVIOUS_WEBAPP_IMAGE_TAG=/ { print "PREVIOUS_WEBAPP_IMAGE_TAG=" webapp; webapp_seen = 1; next }
      { print }
      END {
        if (!backend_seen) print "PREVIOUS_BACKEND_IMAGE_TAG=" backend
        if (!webapp_seen) print "PREVIOUS_WEBAPP_IMAGE_TAG=" webapp
      }
    ' "$ROLLBACK_ENV" > "$verify_env"
    chmod 0600 "$verify_env"
    if [ "$RUN_MIGRATION" = true ]; then
      if ROLLBACK_ENV="$verify_env" MEMOLY_PRODUCT_SHA="$PRODUCT_SHA" SELECTEL_ALBUMS_LEDGER_PHASE=pre-sql SELECTEL_WISHLIST_LEDGER_PHASE=pre-sql SELECTEL_CONTROL_LEDGER_PHASE=pre-sql \
        bash "$APP_ROOT/deploy/selectel/redeploy.sh" rollback-readiness >/dev/null 2>&1; then
        candidate_valid=true
      fi
    elif ROLLBACK_ENV="$verify_env" MEMOLY_PRODUCT_SHA="$PRODUCT_SHA" \
      SELECTEL_ALBUMS_LEDGER_PHASE=complete SELECTEL_WISHLIST_LEDGER_PHASE=complete SELECTEL_CONTROL_LEDGER_PHASE=complete bash "$APP_ROOT/deploy/selectel/redeploy.sh" rollback-readiness >/dev/null 2>&1; then
      candidate_valid=true
    fi
    if [ "$candidate_valid" != true ]; then
      # The captured pair can be a healthy running release without being an
      # independently attested recovery target. Keep the already designated
      # recovery only after the same full verifier accepts it against current
      # source and database state.
      if [ "$RUN_MIGRATION" = true ]; then
        if ! SELECTEL_ALBUMS_LEDGER_PHASE=pre-sql SELECTEL_WISHLIST_LEDGER_PHASE=pre-sql SELECTEL_CONTROL_LEDGER_PHASE=pre-sql MEMOLY_PRODUCT_SHA="$PRODUCT_SHA" \
          bash "$APP_ROOT/deploy/selectel/redeploy.sh" rollback-readiness; then
          rm -f -- "$verify_env"
          ROLLBACK_VERIFY_ENV=
          die 'neither the running images nor the designated rollback pair passed recovery verification'
        fi
      elif ! SELECTEL_ALBUMS_LEDGER_PHASE=complete SELECTEL_WISHLIST_LEDGER_PHASE=complete SELECTEL_CONTROL_LEDGER_PHASE=complete MEMOLY_PRODUCT_SHA="$PRODUCT_SHA" \
        bash "$APP_ROOT/deploy/selectel/redeploy.sh" rollback-readiness; then
        rm -f -- "$verify_env"
        ROLLBACK_VERIFY_ENV=
        die 'neither the running images nor the designated rollback pair passed recovery verification'
      fi
      set -a
      # shellcheck disable=SC1090
      . "$ROLLBACK_ENV"
      set +a
      PREVIOUS_BACKEND_IMAGE_TAG=${PREVIOUS_BACKEND_IMAGE_TAG:?designated rollback backend tag is missing}
      PREVIOUS_WEBAPP_IMAGE_TAG=${PREVIOUS_WEBAPP_IMAGE_TAG:?designated rollback webapp tag is missing}
      printf 'Captured running images are not an attested recovery pair; preserving the verified designated rollback pair.\n'
    fi
    rm -f -- "$verify_env"
    ROLLBACK_VERIFY_ENV=
    if [ "$candidate_valid" = true ]; then
      PREVIOUS_BACKEND_IMAGE_TAG=$RUNNING_BACKEND_IMAGE_TAG
      PREVIOUS_WEBAPP_IMAGE_TAG=$RUNNING_WEBAPP_IMAGE_TAG
    fi
  fi
  install -d -m 0700 "$BACKUPS_DIR"
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
  printf 'Rollback prepared: backend=%s webapp=%s.\n' "$PREVIOUS_BACKEND_IMAGE_TAG" "$PREVIOUS_WEBAPP_IMAGE_TAG"
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
  write_control_release_receipt "$PRODUCT_SHA" "$PRODUCT_SHA" "$migration_count"
  printf 'Release manifest written: %s\n' "$(basename "$manifest")"
}

# A successful full release replaces the complete runtime, so any older
# frontend-only recovery record no longer describes the live service. Keep its
# exact bytes as a forensic archive only after the new full runtime is proven
# healthy. Do not parse the record here: backend forward-only recovery owns
# migration safety, and must remain possible even if this unrelated artifact
# contains an interrupted or malformed frontend state.
capture_frontend_recovery_artifact() {
  FRONTEND_RECOVERY_FILE=$SERVER_ROOT/frontend-recovery.env
  FRONTEND_RECOVERY_PRESENT=false
  FRONTEND_RECOVERY_SHA256=
  if [ -e "$FRONTEND_RECOVERY_FILE" ] || [ -L "$FRONTEND_RECOVERY_FILE" ]; then
    [ -f "$FRONTEND_RECOVERY_FILE" ] && [ ! -L "$FRONTEND_RECOVERY_FILE" ] ||
      die 'frontend recovery artifact is not a regular non-symlink file'
    [ "$(stat -c '%u' -- "$FRONTEND_RECOVERY_FILE")" = 0 ] ||
      die 'frontend recovery artifact is not owned by root'
    [ "$(stat -c '%a' -- "$FRONTEND_RECOVERY_FILE")" = 600 ] ||
      die 'frontend recovery artifact must have mode 0600'
    FRONTEND_RECOVERY_SHA256=$(sha256sum -- "$FRONTEND_RECOVERY_FILE" | awk '{print $1}') ||
      die 'cannot checksum frontend recovery artifact'
    [[ "$FRONTEND_RECOVERY_SHA256" =~ ^[0-9a-f]{64}$ ]] || die 'frontend recovery artifact checksum is invalid'
    FRONTEND_RECOVERY_PRESENT=true
  fi
}

verify_frontend_recovery_artifact_unchanged() {
  local expected_present=$FRONTEND_RECOVERY_PRESENT expected_sha256=$FRONTEND_RECOVERY_SHA256
  capture_frontend_recovery_artifact
  [ "$FRONTEND_RECOVERY_PRESENT" = "$expected_present" ] &&
    [ "$FRONTEND_RECOVERY_SHA256" = "$expected_sha256" ] ||
    die 'frontend recovery artifact changed during full release; refusing to archive it'
}

archive_frontend_recovery_artifact() {
  [ "$FRONTEND_RECOVERY_PRESENT" = true ] || return 0
  verify_frontend_recovery_artifact_unchanged
  [ -d "$RELEASES_DIR" ] && [ ! -L "$RELEASES_DIR" ] ||
    die 'release archive directory is missing or unsafe'
  [ "$(stat -c '%u' -- "$RELEASES_DIR")" = 0 ] || die 'release archive directory is not owned by root'

  local archive timestamp actual_sha256
  timestamp=$(date -u +%Y%m%dT%H%M%SZ)
  archive=$RELEASES_DIR/frontend-recovery-${PRODUCT_SHA}-${timestamp}-$$.env
  [ ! -e "$archive" ] && [ ! -L "$archive" ] || die 'frontend recovery archive target already exists'
  sync -f "$FRONTEND_RECOVERY_FILE" || die 'cannot sync frontend recovery artifact before archival'
  sync -f "$RELEASES_DIR" || die 'cannot sync release archive directory before archival'
  mv -- "$FRONTEND_RECOVERY_FILE" "$archive" || die 'cannot archive frontend recovery artifact'

  if ! [ -f "$archive" ] || [ -L "$archive" ] ||
     [ "$(stat -c '%u' -- "$archive" 2>/dev/null || true)" != 0 ] ||
     [ "$(stat -c '%a' -- "$archive" 2>/dev/null || true)" != 600 ]; then
    mv -- "$archive" "$FRONTEND_RECOVERY_FILE" 2>/dev/null ||
      die 'archived frontend recovery artifact is unsafe and could not be restored to its live path'
    die 'archived frontend recovery artifact has unsafe ownership or permissions; original state was restored'
  fi
  if ! actual_sha256=$(sha256sum -- "$archive" | awk '{print $1}') ||
     [ "$actual_sha256" != "$FRONTEND_RECOVERY_SHA256" ]; then
    mv -- "$archive" "$FRONTEND_RECOVERY_FILE" 2>/dev/null ||
      die 'frontend recovery archive checksum changed and original state could not be restored'
    die 'frontend recovery archive checksum changed; original state was restored'
  fi
  FRONTEND_RECOVERY_PRESENT=false
  FRONTEND_RECOVERY_SHA256=
  sync -f "$RELEASES_DIR" || printf 'WARNING: could not sync archive directory after atomic frontend recovery archival.\n' >&2
  sync -f "$SERVER_ROOT" || printf 'WARNING: could not sync server root after atomic frontend recovery archival.\n' >&2
  printf 'Frontend recovery artifact archived: %s\n' "$(basename "$archive")" || true
}

recover_forward_markers() {
  if [ -e "$MM0_FORWARD_MARKER" ] || [ -L "$MM0_FORWARD_MARKER" ]; then
    load_mm0_marker
    if [ -e "$FORWARD_MARKER" ] || [ -L "$FORWARD_MARKER" ]; then
      local mm_target=$MARKER_TARGET_SHA mm_backend=$PREVIOUS_BACKEND_IMAGE_TAG mm_webapp=$PREVIOUS_WEBAPP_IMAGE_TAG
      load_forward_marker
      [ "$PREVIOUS_BACKEND_IMAGE_TAG" = "$mm_backend" ] && [ "$PREVIOUS_WEBAPP_IMAGE_TAG" = "$mm_webapp" ] ||
        die 'B2 and MM0 forward-only markers disagree about previous images'
      git_root merge-base --is-ancestor "$MARKER_TARGET_SHA" "$mm_target" ||
        die 'B2 and MM0 forward-only markers have incompatible release lineages'
      MARKER_TARGET_SHA=$mm_target
      PREVIOUS_BACKEND_IMAGE_TAG=$mm_backend
      PREVIOUS_WEBAPP_IMAGE_TAG=$mm_webapp
      export PREVIOUS_BACKEND_IMAGE_TAG PREVIOUS_WEBAPP_IMAGE_TAG
      rm -- "$FORWARD_MARKER"
    fi
    LEGACY_MM0_RUNTIME=true
    export MEMOLY_PRODUCT_SHA="$MARKER_TARGET_SHA"
    FORWARD_MARKER="$MM0_FORWARD_MARKER" MM0_BOUNDARY=true bash "$APP_ROOT/deploy/selectel/redeploy.sh" quiesce-legacy
  fi
  if [ "$RESUMING_MM0" = false ] && [ -e "$FORWARD_MARKER" ]; then
    load_forward_marker
    MM0_ACTIVE_MARKER=$FORWARD_MARKER
    LEGACY_MEMBERSHIP_RUNTIME=true
    QUIESCE_STARTED=true
    export MEMOLY_PRODUCT_SHA="$MARKER_TARGET_SHA"
    bash "$APP_ROOT/deploy/selectel/redeploy.sh" quiesce-legacy
  fi
}

promote_runtime() {
  PROMOTION_STARTED=true
  if [ "$LEGACY_MM0_RUNTIME" = true ]; then
    FORWARD_MARKER="$MM0_ACTIVE_MARKER" MM0_BOUNDARY=true bash "$APP_ROOT/deploy/selectel/redeploy.sh" deploy
  else
    bash "$APP_ROOT/deploy/selectel/redeploy.sh" deploy
  fi
}

backup_mm0_database() {
  FORWARD_MARKER="$MM0_ACTIVE_MARKER" MM0_BOUNDARY=true bash "$APP_ROOT/deploy/selectel/redeploy.sh" backup-migration
}

main() {
  require_root
  require_command awk
  require_command cp
  require_command date
  require_command df
  require_command docker
  require_command git
  require_command getent
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
  require_command readlink
  require_command sync
  validate_inputs
  validate_frontend_recovery_path
  [ -d "$SERVER_ROOT" ] || die "server root is missing: $SERVER_ROOT"
  exec 9>"$SERVER_ROOT/.selectel-deploy.lock" || die 'cannot open Selectel deployment lock'
  flock -n 9 || die 'another Selectel deployment is already running'
  export SELECTEL_DEPLOY_LOCK_FD=9
  export SELECTEL_CI_RELEASE=true
  if [ "$RELEASE_MODE" = full ]; then trap release_failure EXIT; fi
  validate_repository
  validate_planned_source
  if [ "$RELEASE_MODE" = frontend ] || [ "$RELEASE_MODE" = frontend-rollback ]; then
    if [ -e "$MM0_FORWARD_MARKER" ] || [ -L "$MM0_FORWARD_MARKER" ] ||
       [ -e "$FORWARD_MARKER" ] || [ -L "$FORWARD_MARKER" ]; then
      die 'frontend release modes are blocked while a backend forward-only marker exists'
    fi
    check_disk_space
    fetch_and_checkout
    [ -f "$APP_ROOT/deploy/selectel/frontend-release.sh" ] &&
      [ ! -L "$APP_ROOT/deploy/selectel/frontend-release.sh" ] || die 'frontend release guard script is missing or invalid'
    # The frontend handler installs its own trap and can only restore static.
    # Never install the full release failure trap for this mode.
    # shellcheck disable=SC1090
    . "$APP_ROOT/deploy/selectel/frontend-release.sh"
    frontend_release_main
    local frontend_migration_count
    frontend_migration_count=$(find "$APP_ROOT/backend/prisma/migrations" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | wc -l | tr -d ' ')
    write_control_release_receipt "$FRONTEND_BACKEND_SHA" "$PRODUCT_SHA" "$frontend_migration_count"
    exit 0
  fi
  trap release_failure EXIT
  capture_frontend_recovery_artifact
  recover_forward_markers
  check_disk_space
  verify_rollback_file
  if [ "$RESUMING_FORWARD_ONLY" = false ]; then
    capture_running_images
  fi
  fetch_and_checkout
  verify_frontend_recovery_artifact_unchanged
  install_control_sampler
  validate_prebuilt_images
  detect_membership_rollback_boundary
  detect_mm0_boundary

  if [ "$PREBUILT_IMAGES" = false ]; then
    SELECTEL_MAX_BOT_USERNAME="$MAX_BOT_USERNAME" bash "$APP_ROOT/deploy/selectel/build-images.sh" "$PRODUCT_SHA"
    require_release_ownership
    local post_build_status
    post_build_status=$(git_memoly status --porcelain) || die 'cannot inspect application checkout after image build preparation'
    [ -z "$post_build_status" ] || die 'application checkout changed during image build preparation'
  fi
  if [ "$RESUMING_FORWARD_ONLY" = false ]; then prepare_rollback; fi

  export MEMOLY_PRODUCT_SHA="$PRODUCT_SHA"
  export MEMOLY_BACKEND_IMAGE_TAG="$PRODUCT_SHA"
  export MEMOLY_WEBAPP_IMAGE_TAG="$PRODUCT_SHA"
  export MEMOLY_PUBLIC_HOST=${MEMOLY_PUBLIC_HOST:-app.memoly.ru}
  bash "$APP_ROOT/deploy/selectel/redeploy.sh" preflight
  if [ "$LEGACY_MM0_RUNTIME" = true ] && [ "$RUN_MIGRATION" = true ]; then
    backup_mm0_database
  fi
  if [ "$LEGACY_MM0_RUNTIME" = true ] && [ "$RUN_MIGRATION" = false ]; then
    bash "$APP_ROOT/deploy/selectel/redeploy.sh" migration-status ||
      die 'pending MM0 migration requires the guarded migration input before quiescing old writers'
  fi
  if [ "$LEGACY_MEMBERSHIP_RUNTIME" = true ] && [ "$LEGACY_MM0_RUNTIME" = false ]; then
    if [ "$RUN_MIGRATION" = false ]; then
      bash "$APP_ROOT/deploy/selectel/redeploy.sh" migration-status ||
        die 'pending migrations require the guarded migration input before crossing the B2 runtime boundary'
    fi
    if [ "$RESUMING_FORWARD_ONLY" = false ]; then write_forward_marker; fi
    QUIESCE_STARTED=true
    bash "$APP_ROOT/deploy/selectel/redeploy.sh" quiesce-legacy
  fi
  if [ "$LEGACY_MM0_RUNTIME" = true ]; then
    if [ "$RESUMING_MM0" = false ]; then
      write_mm0_marker
      MM0_ACTIVE_MARKER=$MM0_FORWARD_MARKER
      if [ "$RESUMING_FORWARD_ONLY" = true ]; then rm -- "$FORWARD_MARKER"; fi
    fi
    QUIESCE_STARTED=true
    FORWARD_MARKER="$MM0_ACTIVE_MARKER" MM0_BOUNDARY=true bash "$APP_ROOT/deploy/selectel/redeploy.sh" quiesce-legacy
  fi
  if [ "$RUN_MIGRATION" = true ]; then
    if [ "$LEGACY_MM0_RUNTIME" = true ]; then
      FORWARD_MARKER="$MM0_ACTIVE_MARKER" MM0_BOUNDARY=true MM0_BACKUP_PREPARED=true bash "$APP_ROOT/deploy/selectel/redeploy.sh" migrate
    else
      bash "$APP_ROOT/deploy/selectel/redeploy.sh" migrate
    fi
  fi
  bash "$APP_ROOT/deploy/selectel/redeploy.sh" migration-status
  if [ "$RUN_MIGRATION" = true ] && [ "$LEGACY_MEMBERSHIP_RUNTIME" = false ] && [ "$LEGACY_MM0_RUNTIME" = false ]; then
    SELECTEL_ALBUMS_LEDGER_PHASE=complete SELECTEL_WISHLIST_LEDGER_PHASE=complete SELECTEL_CONTROL_LEDGER_PHASE=complete MEMOLY_PRODUCT_SHA="$PRODUCT_SHA" \
      bash "$APP_ROOT/deploy/selectel/redeploy.sh" rollback-readiness ||
      die 'complete post-migration recovery verification failed before promotion'
  fi
  verify_frontend_recovery_artifact_unchanged
  promote_runtime
  verify_promoted_revision
  public_smoke
  write_release_manifest
  clear_release_markers
  archive_frontend_recovery_artifact
}

if [[ "${BASH_SOURCE[0]:-$0}" == "$0" ]]; then
  main "$@"
fi
