#!/usr/bin/env bash
set -Eeuo pipefail

FRONTEND_STATE=$SERVER_ROOT/frontend-recovery.env
FRONTEND_PROMOTION_STARTED=false
FRONTEND_OLD_SHA=
FRONTEND_OLD_ID=
FRONTEND_NEW_ID=
FRONTEND_BACKEND_SHA=
FRONTEND_BACKEND_IDS=
FRONTEND_BACKEND_IMAGE_IDS=
FRONTEND_WORKER_IDS=
FRONTEND_WORKER_IMAGE_IDS=
FRONTEND_SCHEDULER_IDS=
FRONTEND_SCHEDULER_IMAGE_IDS=
FRONTEND_GATEWAY_ID=
FRONTEND_GATEWAY_IMAGE_ID=
FRONTEND_CONFIG_SHA256=
FRONTEND_STATE_PHASE=
FRONTEND_TEMP_DIR=
FRONTEND_NEW_SHA=
FRONTEND_MANIFEST=

frontend_die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

frontend_is_root_state() {
  [ -f "$FRONTEND_STATE" ] && [ ! -L "$FRONTEND_STATE" ] || frontend_die 'frontend recovery state is missing or not a regular file'
  [ "$(stat -c '%u' "$FRONTEND_STATE")" = 0 ] && [ "$(stat -c '%a' "$FRONTEND_STATE")" = 600 ] ||
    frontend_die 'frontend recovery state must be root-owned with mode 0600'
}

frontend_load_state() {
  frontend_is_root_state || return 1
  local -a lines
  mapfile -t lines < "$FRONTEND_STATE"
  [ "${#lines[@]}" -eq 17 ] || frontend_die 'frontend recovery state has an invalid line count'
  [[ "${lines[0]}" == FRONTEND_RECOVERY_VERSION=1 ]] || frontend_die 'frontend recovery state version is invalid'
  [[ "${lines[1]}" =~ ^PHASE=(pending|promoted|failed|restored)$ ]] || frontend_die 'frontend recovery state phase is invalid'
  FRONTEND_STATE_PHASE=${BASH_REMATCH[1]}
  [[ "${lines[2]}" =~ ^BACKEND_SHA=([0-9a-f]{40})$ ]] || frontend_die 'frontend recovery backend SHA is invalid'
  FRONTEND_BACKEND_SHA=${BASH_REMATCH[1]}
  [[ "${lines[3]}" =~ ^BACKEND_IDS=([0-9a-f]{64}(,[0-9a-f]{64})*)$ ]] || frontend_die 'frontend backend container IDs are invalid'
  FRONTEND_BACKEND_IDS=${BASH_REMATCH[1]}
  [[ "${lines[4]}" =~ ^BACKEND_IMAGE_IDS=(sha256:[0-9a-f]{64}(,sha256:[0-9a-f]{64})*)$ ]] || frontend_die 'frontend backend image IDs are invalid'
  FRONTEND_BACKEND_IMAGE_IDS=${BASH_REMATCH[1]}
  [[ "${lines[5]}" =~ ^WORKER_IDS=([0-9a-f]{64}(,[0-9a-f]{64})*)$ ]] || frontend_die 'frontend worker container IDs are invalid'
  FRONTEND_WORKER_IDS=${BASH_REMATCH[1]}
  [[ "${lines[6]}" =~ ^WORKER_IMAGE_IDS=(sha256:[0-9a-f]{64}(,sha256:[0-9a-f]{64})*)$ ]] || frontend_die 'frontend worker image IDs are invalid'
  FRONTEND_WORKER_IMAGE_IDS=${BASH_REMATCH[1]}
  [[ "${lines[7]}" =~ ^SCHEDULER_IDS=([0-9a-f]{64}(,[0-9a-f]{64})*)$ ]] || frontend_die 'frontend scheduler container IDs are invalid'
  FRONTEND_SCHEDULER_IDS=${BASH_REMATCH[1]}
  [[ "${lines[8]}" =~ ^SCHEDULER_IMAGE_IDS=(sha256:[0-9a-f]{64}(,sha256:[0-9a-f]{64})*)$ ]] || frontend_die 'frontend scheduler image IDs are invalid'
  FRONTEND_SCHEDULER_IMAGE_IDS=${BASH_REMATCH[1]}
  [[ "${lines[9]}" =~ ^GATEWAY_ID=([0-9a-f]{64})$ ]] || frontend_die 'frontend gateway container ID is invalid'
  FRONTEND_GATEWAY_ID=${BASH_REMATCH[1]}
  [[ "${lines[10]}" =~ ^GATEWAY_IMAGE_ID=(sha256:[0-9a-f]{64})$ ]] || frontend_die 'frontend gateway image ID is invalid'
  FRONTEND_GATEWAY_IMAGE_ID=${BASH_REMATCH[1]}
  [[ "${lines[11]}" =~ ^CONFIG_SHA256=([0-9a-f]{64})$ ]] || frontend_die 'frontend configuration checksum is invalid'
  FRONTEND_CONFIG_SHA256=${BASH_REMATCH[1]}
  [[ "${lines[12]}" =~ ^OLD_FRONTEND_SHA=([0-9a-f]{40})$ ]] || frontend_die 'frontend recovery source SHA is invalid'
  FRONTEND_OLD_SHA=${BASH_REMATCH[1]}
  [[ "${lines[13]}" =~ ^OLD_FRONTEND_IMAGE_ID=(sha256:[0-9a-f]{64})$ ]] || frontend_die 'frontend recovery source image ID is invalid'
  FRONTEND_OLD_ID=${BASH_REMATCH[1]}
  [[ "${lines[14]}" =~ ^NEW_FRONTEND_SHA=([0-9a-f]{40})$ ]] || frontend_die 'frontend candidate SHA is invalid'
  FRONTEND_NEW_SHA=${BASH_REMATCH[1]}
  [[ "${lines[15]}" =~ ^NEW_FRONTEND_IMAGE_ID=(sha256:[0-9a-f]{64})$ ]] || frontend_die 'frontend candidate image ID is invalid'
  FRONTEND_NEW_ID=${BASH_REMATCH[1]}
  [[ "${lines[16]}" =~ ^UTC=([0-9]{8}T[0-9]{6}Z)$ ]] || frontend_die 'frontend recovery timestamp is invalid'
}

frontend_write_state() {
  local phase=$1 path temporary
  [ "$phase" = pending ] || [ "$phase" = promoted ] || [ "$phase" = failed ] || [ "$phase" = restored ] || frontend_die 'invalid frontend recovery state phase'
  path=$(dirname -- "$FRONTEND_STATE")
  [ -d "$path" ] && [ ! -L "$path" ] && [ "$(stat -c '%u' "$path")" = 0 ] || frontend_die 'frontend recovery state parent must be an existing root-owned directory'
  [ ! -L "$FRONTEND_STATE" ] || frontend_die 'frontend recovery state must not be a symlink'
  temporary="$FRONTEND_STATE.tmp.$$"
  [ ! -e "$temporary" ] && [ ! -L "$temporary" ] || frontend_die 'frontend recovery state temporary path already exists'
  install -m 0600 /dev/null "$temporary"
  cat > "$temporary" <<EOF
FRONTEND_RECOVERY_VERSION=1
PHASE=$phase
BACKEND_SHA=$FRONTEND_BACKEND_SHA
BACKEND_IDS=$FRONTEND_BACKEND_IDS
BACKEND_IMAGE_IDS=$FRONTEND_BACKEND_IMAGE_IDS
WORKER_IDS=$FRONTEND_WORKER_IDS
WORKER_IMAGE_IDS=$FRONTEND_WORKER_IMAGE_IDS
SCHEDULER_IDS=$FRONTEND_SCHEDULER_IDS
SCHEDULER_IMAGE_IDS=$FRONTEND_SCHEDULER_IMAGE_IDS
GATEWAY_ID=$FRONTEND_GATEWAY_ID
GATEWAY_IMAGE_ID=$FRONTEND_GATEWAY_IMAGE_ID
CONFIG_SHA256=$FRONTEND_CONFIG_SHA256
OLD_FRONTEND_SHA=$FRONTEND_OLD_SHA
OLD_FRONTEND_IMAGE_ID=$FRONTEND_OLD_ID
NEW_FRONTEND_SHA=$FRONTEND_NEW_SHA
NEW_FRONTEND_IMAGE_ID=$FRONTEND_NEW_ID
UTC=$(date -u +%Y%m%dT%H%M%SZ)
EOF
  chmod 0600 "$temporary"
  sync -f "$temporary" || frontend_die 'cannot persist frontend recovery state contents'
  mv -f -- "$temporary" "$FRONTEND_STATE"
  sync -f "$path" || frontend_die 'cannot persist frontend recovery state directory entry'
}

frontend_service_identity() {
  local service=$1 output count container image image_tag revision
  output=$(docker ps --no-trunc --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
    --filter "label=com.docker.compose.service=$service" --format '{{.ID}}') || frontend_die "cannot inspect running $service containers"
  count=$(printf '%s\n' "$output" | awk 'NF { n++ } END { print n + 0 }')
  [ "$count" -eq 1 ] || frontend_die "expected exactly one running Compose service: $service"
  container=$(docker inspect --format '{{.Id}}' "$output") || frontend_die "cannot inspect running $service container ID"
  image=$(docker inspect --format '{{.Image}}|{{.Config.Image}}|{{index .Config.Labels "org.opencontainers.image.revision"}}' "$container") || frontend_die "cannot inspect running $service identity"
  IFS='|' read -r image_id image_tag revision <<< "$image"
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || frontend_die "running $service has an invalid image ID"
  case "$service" in
    static) [[ "$image_tag" =~ ^memoly-webapp:[0-9a-f]{40}$ ]] || frontend_die 'running static service lacks an immutable webapp SHA tag' ;;
    *) [[ "$image_tag" =~ ^memoly-backend:[0-9a-f]{40}$ ]] || frontend_die "running $service lacks an immutable backend SHA tag" ;;
  esac
  [ "$revision" = "${image_tag##*:}" ] || frontend_die "running $service OCI revision does not match its immutable image tag"
  printf '%s|%s|%s\n' "$container" "$image_id" "$image_tag"
}

frontend_current_static() {
  local ids count container image_id image_tag revision
  ids=$(docker ps --no-trunc --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
    --filter 'label=com.docker.compose.service=static' --format '{{.ID}}') || frontend_die 'cannot inspect current static container'
  count=$(printf '%s\n' "$ids" | awk 'NF { n++ } END { print n + 0 }')
  [ "$count" -le 1 ] || frontend_die 'multiple running static containers make frontend recovery ambiguous'
  if [ "$count" -eq 0 ]; then printf 'none\n'; return 0; fi
  container=$(docker inspect --format '{{.Id}}' "$ids") || frontend_die 'cannot inspect current static container ID'
  IFS='|' read -r image_id image_tag revision < <(docker inspect --format '{{.Image}}|{{.Config.Image}}|{{index .Config.Labels "org.opencontainers.image.revision"}}' "$container") ||
    frontend_die 'cannot inspect current static identity'
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ && "$image_tag" =~ ^memoly-webapp:[0-9a-f]{40}$ ]] || frontend_die 'current static image identity is invalid'
  [ "$revision" = "${image_tag##*:}" ] || frontend_die 'current static OCI revision does not match its immutable tag'
  printf '%s|%s|%s\n' "$container" "$image_id" "$image_tag"
}

frontend_capture_runtime() {
  local backend worker scheduler static gateway compose_sha static_caddy edge_caddy
  backend=$(frontend_service_identity backend)
  worker=$(frontend_service_identity worker)
  scheduler=$(frontend_service_identity scheduler)
  if [ "${1:-}" = no-static ]; then static=none; else static=$(frontend_service_identity static); fi
  IFS='|' read -r FRONTEND_BACKEND_IDS FRONTEND_BACKEND_IMAGE_IDS backend_tag <<< "$backend"
  IFS='|' read -r FRONTEND_WORKER_IDS FRONTEND_WORKER_IMAGE_IDS worker_tag <<< "$worker"
  IFS='|' read -r FRONTEND_SCHEDULER_IDS FRONTEND_SCHEDULER_IMAGE_IDS scheduler_tag <<< "$scheduler"
  if [ "$static" = none ]; then
    static_id=none static_image_id=none static_tag=none
  else
    IFS='|' read -r static_id static_image_id static_tag <<< "$static"
  fi
  [ "$backend_tag" = "$worker_tag" ] && [ "$backend_tag" = "$scheduler_tag" ] || frontend_die 'backend, worker, and scheduler tags do not match'
  [ "$FRONTEND_BACKEND_IMAGE_IDS" = "$FRONTEND_WORKER_IMAGE_IDS" ] && [ "$FRONTEND_BACKEND_IMAGE_IDS" = "$FRONTEND_SCHEDULER_IMAGE_IDS" ] || frontend_die 'backend, worker, and scheduler image IDs do not match'
  FRONTEND_BACKEND_SHA=${backend_tag#memoly-backend:}
  if [ "$static_tag" != none ]; then
    FRONTEND_OLD_SHA=${static_tag#memoly-webapp:}
    FRONTEND_OLD_ID=$static_image_id
  fi
  gateway=$(docker inspect --format '{{.Id}}|{{.Image}}|{{.State.Running}}' "${GATEWAY_CONTAINER:-memoly-webapp-1}") || frontend_die 'cannot inspect unmanaged gateway identity'
  IFS='|' read -r FRONTEND_GATEWAY_ID FRONTEND_GATEWAY_IMAGE_ID gateway_running <<< "$gateway"
  [[ "$FRONTEND_GATEWAY_ID" =~ ^[0-9a-f]{64}$ && "$FRONTEND_GATEWAY_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] || frontend_die 'gateway identity is invalid'
  [ "$gateway_running" = true ] || frontend_die 'unmanaged gateway is not running'
  for path in "$COMPOSE_FILE" "$SERVER_ROOT/Caddyfile.static" "$SERVER_ROOT/gateway/Caddyfile" \
    "$SERVER_ROOT/env/backend.env" "$SERVER_ROOT/env/postgres.env" \
    "$SERVER_ROOT/secrets/max_bot_token" "$SERVER_ROOT/secrets/max_webhook_secret" "$SERVER_ROOT/secrets/max_inbox_encryption_key"; do
    [ -f "$path" ] && [ ! -L "$path" ] || frontend_die "release configuration is missing or not regular: $(basename "$path")"
  done
  FRONTEND_CONFIG_SHA256=$(sha256sum "$COMPOSE_FILE" "$SERVER_ROOT/Caddyfile.static" "$SERVER_ROOT/gateway/Caddyfile" \
    "$SERVER_ROOT/env/backend.env" "$SERVER_ROOT/env/postgres.env" \
    "$SERVER_ROOT/secrets/max_bot_token" "$SERVER_ROOT/secrets/max_webhook_secret" "$SERVER_ROOT/secrets/max_inbox_encryption_key" | sha256sum | awk '{print $1}')
  [[ "$FRONTEND_CONFIG_SHA256" =~ ^[0-9a-f]{64}$ ]] || frontend_die 'cannot checksum release configuration'
  export FRONTEND_STATIC_CONTAINER=$static_id FRONTEND_STATIC_IMAGE_ID=$static_image_id
}

frontend_assert_runtime_unchanged() {
  local backend worker scheduler gateway config
  backend=$(frontend_service_identity backend)
  worker=$(frontend_service_identity worker)
  scheduler=$(frontend_service_identity scheduler)
  IFS='|' read -r backend_id backend_image backend_tag <<< "$backend"
  IFS='|' read -r worker_id worker_image worker_tag <<< "$worker"
  IFS='|' read -r scheduler_id scheduler_image scheduler_tag <<< "$scheduler"
  [ "$backend_id" = "$FRONTEND_BACKEND_IDS" ] && [ "$backend_image" = "$FRONTEND_BACKEND_IMAGE_IDS" ] && [ "$backend_tag" = "memoly-backend:$FRONTEND_BACKEND_SHA" ] || frontend_die 'backend identity changed during frontend release'
  [ "$worker_id" = "$FRONTEND_WORKER_IDS" ] && [ "$worker_image" = "$FRONTEND_WORKER_IMAGE_IDS" ] && [ "$worker_tag" = "memoly-backend:$FRONTEND_BACKEND_SHA" ] || frontend_die 'worker identity changed during frontend release'
  [ "$scheduler_id" = "$FRONTEND_SCHEDULER_IDS" ] && [ "$scheduler_image" = "$FRONTEND_SCHEDULER_IMAGE_IDS" ] && [ "$scheduler_tag" = "memoly-backend:$FRONTEND_BACKEND_SHA" ] || frontend_die 'scheduler identity changed during frontend release'
  gateway=$(docker inspect --format '{{.Id}}|{{.Image}}|{{.State.Running}}' "${GATEWAY_CONTAINER:-memoly-webapp-1}") || frontend_die 'cannot reinspect unmanaged gateway identity'
  [ "$gateway" = "$FRONTEND_GATEWAY_ID|$FRONTEND_GATEWAY_IMAGE_ID|true" ] || frontend_die 'unmanaged gateway identity changed during frontend release'
  config=$(sha256sum "$COMPOSE_FILE" "$SERVER_ROOT/Caddyfile.static" "$SERVER_ROOT/gateway/Caddyfile" \
    "$SERVER_ROOT/env/backend.env" "$SERVER_ROOT/env/postgres.env" \
    "$SERVER_ROOT/secrets/max_bot_token" "$SERVER_ROOT/secrets/max_webhook_secret" "$SERVER_ROOT/secrets/max_inbox_encryption_key" | sha256sum | awk '{print $1}')
  [ "$config" = "$FRONTEND_CONFIG_SHA256" ] || frontend_die 'release configuration changed during frontend release'
}

frontend_validate_scope() {
  local scope="$APP_ROOT/deploy/selectel/frontend-scope.sh" range_base runtime_changes
  local -a scope_bases=("$FRONTEND_BACKEND_SHA")
  [ "$FRONTEND_OLD_SHA" = "$FRONTEND_BACKEND_SHA" ] || scope_bases+=("$FRONTEND_OLD_SHA")
  [ -f "$scope" ] && [ ! -L "$scope" ] || frontend_die 'shared frontend scope interpreter is missing or invalid'
  git_root merge-base --is-ancestor "$FRONTEND_BACKEND_SHA" "$PRODUCT_SHA" || frontend_die 'candidate must descend from the retained backend SHA'
  git_root merge-base --is-ancestor "$FRONTEND_OLD_SHA" "$PRODUCT_SHA" || frontend_die 'candidate must descend from the currently active frontend SHA'
  git_root merge-base --is-ancestor "$ACCEPTED_UI_V4_SHA" "$FRONTEND_BACKEND_SHA" || frontend_die 'retained backend does not contain accepted UI v4'
  git_root merge-base --is-ancestor "$ACCEPTED_UI_V4_SHA" "$FRONTEND_OLD_SHA" || frontend_die 'active frontend predates accepted UI v4'
  git_root merge-base --is-ancestor "$ACCEPTED_UI_V4_SHA" "$PRODUCT_SHA" || frontend_die 'candidate predates accepted UI v4'
  runtime_changes=$(git_root diff --name-only "$FRONTEND_OLD_SHA" "$PRODUCT_SHA" -- webapp/src/ webapp/public/) || frontend_die 'cannot inspect frontend runtime changes'
  [ -n "$runtime_changes" ] || frontend_die 'frontend release requires a production frontend input change against the active frontend'
  for range_base in "${scope_bases[@]}"; do
    (cd -- "$APP_ROOT" && bash "$scope" verify "$range_base" "$PRODUCT_SHA" server) || frontend_die "frontend review scope failed for deployed base $range_base"
  done
}

frontend_verify_migration_catalog() {
  local changes checksums
  changes=$(git_root diff --name-only "$FRONTEND_BACKEND_SHA" "$PRODUCT_SHA" -- backend/prisma/migrations/) || frontend_die 'cannot compare migration catalog'
  [ -z "$changes" ] || frontend_die 'frontend release candidate changes the backend migration catalog'
  checksums=$(rollback_migration_catalog_checksums "$FRONTEND_BACKEND_SHA") || frontend_die 'cannot load retained backend migration checksums'
  docker exec -e "MEMOLY_EXPECTED_MIGRATION_CHECKSUMS=$checksums" "$FRONTEND_BACKEND_IDS" bun -e "$(cat <<'MEMOLY_FRONTEND_MIGRATION_JS'
import { Client } from "pg";
const expected = new Map();
for (const line of (process.env.MEMOLY_EXPECTED_MIGRATION_CHECKSUMS ?? "").trim().split("\n")) {
  const [name, lf, crlf, ...extra] = line.split(":");
  if (!name || extra.length || !/^\d+_[a-z0-9_]+$/.test(name) || !/^[0-9a-f]{64}$/.test(lf ?? "") || !/^[0-9a-f]{64}$/.test(crlf ?? "") || expected.has(name)) process.exit(1);
  expected.set(name, new Set([lf, crlf]));
}
const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  if (!expected.size) throw new Error("empty catalog");
  await client.connect();
  const { rows } = await client.query("SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name");
  const completed = rows.filter(row => row.finished_at && !row.rolled_back_at);
  if (rows.some(row => !row.finished_at && !row.rolled_back_at) || completed.length !== expected.size) throw new Error("migration state mismatch");
  const seen = new Set();
  for (const row of completed) {
    if (typeof row.migration_name !== "string" || typeof row.checksum !== "string" || seen.has(row.migration_name) || !expected.get(row.migration_name)?.has(row.checksum)) throw new Error("migration checksum mismatch");
    seen.add(row.migration_name);
  }
  if (seen.size !== expected.size) throw new Error("migration names mismatch");
  await client.end();
  process.exit(0);
} catch { await client.end().catch(() => {}); process.exit(1); }
MEMOLY_FRONTEND_MIGRATION_JS
)" >/dev/null 2>&1 || frontend_die 'read-only database migration history does not match the unchanged backend catalog'
}

frontend_static_bytes() {
  local image=$1 target=$2 container
  mkdir -p -- "$target"
  container=$(docker create "$image") || frontend_die 'cannot inspect immutable webapp image bytes'
  if ! docker cp "$container:/srv/." "$target" >/dev/null; then docker rm "$container" >/dev/null 2>&1 || true; frontend_die 'cannot read immutable webapp static files'; fi
  docker rm "$container" >/dev/null || frontend_die 'cannot remove static-inspection container'
  for relative in index.html manifest.webmanifest assets/brand/pwa-memoly-192.webp assets/brand/pwa-memoly-512.webp; do
    [ -s "$target/$relative" ] || frontend_die "candidate image is missing required static file: $relative"
  done
}

frontend_image_id() {
  local sha=$1 tag="memoly-webapp:$1" id revision
  id=$(docker image inspect --format '{{.Id}}' "$tag" 2>/dev/null) || frontend_die "immutable webapp image is missing: $tag"
  revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$tag" 2>/dev/null) || frontend_die "cannot inspect webapp image revision: $tag"
  [ "$revision" = "$sha" ] || frontend_die "webapp image revision label mismatch: $tag"
  [[ "$id" =~ ^sha256:[0-9a-f]{64}$ ]] || frontend_die 'webapp image ID is invalid'
  printf '%s\n' "$id"
}

frontend_internal_smoke() {
  local container=$1
  docker exec "$container" /bin/sh -c 'wget -q -O /dev/null http://127.0.0.1/ && test -s /srv/index.html && test -s /srv/manifest.webmanifest' >/dev/null 2>&1 ||
    frontend_die 'internal static HTTP or artifact health check failed'
}

frontend_public_smoke() {
  local candidate=$1 relative local_sum public_sum path count=0
  public_smoke
  for relative in index.html manifest.webmanifest assets/brand/pwa-memoly-192.webp assets/brand/pwa-memoly-512.webp; do
    local_sum=$(sha256sum "$candidate/$relative" | awk '{print $1}')
    case "$relative" in
      index.html) public_sum=$PUBLIC_INDEX_SHA256; path=/ ;;
      manifest.webmanifest) public_sum=$PUBLIC_MANIFEST_SHA256; path=/manifest.webmanifest ;;
      assets/brand/pwa-memoly-192.webp) public_sum=$PUBLIC_ICON_192_SHA256; path=/assets/brand/pwa-memoly-192.webp ;;
      assets/brand/pwa-memoly-512.webp) public_sum=$PUBLIC_ICON_512_SHA256; path=/assets/brand/pwa-memoly-512.webp ;;
    esac
    [ "$local_sum" = "$public_sum" ] || frontend_die "public static bytes do not match candidate image: $path"
  done
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    case "$path" in /assets/*.js|/assets/*.css) ;;
      *) frontend_die 'candidate index contains an unrecognized static bundle path' ;;
    esac
    local_sum=$(sha256sum "$candidate/${path#/}" | awk '{print $1}')
    public_sum=$(curl --fail --silent --show-error --max-time 10 "${PUBLIC_URL%/}$path" | sha256sum | awk '{print $1}') || frontend_die "public bundle smoke failed: $path"
    [ "$local_sum" = "$public_sum" ] || frontend_die "public bundle bytes do not match candidate image: $path"
    count=$((count + 1))
  done < <(grep -oE '/assets/[^" ]+\.(js|css)' "$candidate/index.html" | sort -u)
  [ "$count" -gt 0 ] || frontend_die 'candidate index does not reference a verifiable JavaScript or CSS bundle'
}

frontend_write_manifest() {
  local timestamp manifest current_id previous_id
  timestamp=$(date -u +%Y%m%dT%H%M%SZ)
  manifest="$RELEASES_DIR/frontend-${PRODUCT_SHA}-${timestamp}.env"
  FRONTEND_MANIFEST=$manifest
  if [ -e "$RELEASES_DIR" ] || [ -L "$RELEASES_DIR" ]; then
    [ -d "$RELEASES_DIR" ] && [ ! -L "$RELEASES_DIR" ] && [ "$(stat -c '%u' "$RELEASES_DIR")" = 0 ] ||
      frontend_die 'frontend release manifest directory must be an existing root-owned directory'
  else
    mkdir -m 0700 -- "$RELEASES_DIR" || frontend_die 'cannot create frontend release manifest directory'
  fi
  current_id=$(frontend_image_id "$PRODUCT_SHA")
  previous_id=$FRONTEND_OLD_ID
  install -m 0600 /dev/null "$manifest"
  cat > "$manifest" <<EOF
RELEASE_KIND=frontend
BACKEND_SHA=$FRONTEND_BACKEND_SHA
FRONTEND_SHA=$PRODUCT_SHA
BACKEND_CONTAINER_ID=$FRONTEND_BACKEND_IDS
BACKEND_IMAGE_ID=$FRONTEND_BACKEND_IMAGE_IDS
WORKER_CONTAINER_ID=$FRONTEND_WORKER_IDS
WORKER_IMAGE_ID=$FRONTEND_WORKER_IMAGE_IDS
SCHEDULER_CONTAINER_ID=$FRONTEND_SCHEDULER_IDS
SCHEDULER_IMAGE_ID=$FRONTEND_SCHEDULER_IMAGE_IDS
GATEWAY_CONTAINER_ID=$FRONTEND_GATEWAY_ID
GATEWAY_IMAGE_ID=$FRONTEND_GATEWAY_IMAGE_ID
FRONTEND_IMAGE_ID=$current_id
PREVIOUS_FRONTEND_SHA=$FRONTEND_OLD_SHA
PREVIOUS_FRONTEND_IMAGE_ID=$previous_id
FRONTEND_RECOVERY_READY=true
PUBLIC_SMOKE=passed
PUBLIC_INDEX_SHA256=$PUBLIC_INDEX_SHA256
PUBLIC_MANIFEST_SHA256=$PUBLIC_MANIFEST_SHA256
PUBLIC_ICON_192_SHA256=$PUBLIC_ICON_192_SHA256
PUBLIC_ICON_512_SHA256=$PUBLIC_ICON_512_SHA256
CONFIG_SHA256=$FRONTEND_CONFIG_SHA256
UTC=$timestamp
EOF
  chmod 0600 "$manifest"
}

frontend_restore_static() {
  local current static_id current_id
  current=$(frontend_current_static) || return 1
  if [ "$current" != none ]; then IFS='|' read -r static_id current_id _ <<< "$current"; else current_id=none; fi
  if [ "$current_id" = "$FRONTEND_OLD_ID" ]; then
    frontend_internal_smoke "$static_id" || return 1
    frontend_assert_runtime_unchanged || return 1
    FRONTEND_PROMOTION_STARTED=false
    frontend_write_state restored || return 1
    return 0
  fi
  [ "$current_id" = none ] || [ "$current_id" = "$FRONTEND_NEW_ID" ] || frontend_die 'current static image is neither recorded recovery image'
  MEMOLY_BACKEND_IMAGE_TAG=$FRONTEND_BACKEND_SHA MEMOLY_WEBAPP_IMAGE_TAG=$FRONTEND_OLD_SHA \
    docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" up -d --no-deps --force-recreate static >/dev/null || return 1
  current=$(frontend_current_static) || return 1
  [ "$current" != none ] || return 1
  IFS='|' read -r static_id current_id _ <<< "$current"
  [ "$current_id" = "$FRONTEND_OLD_ID" ] || return 1
  frontend_internal_smoke "$static_id" || return 1
  frontend_assert_runtime_unchanged || return 1
  FRONTEND_PROMOTION_STARTED=false
  frontend_write_state restored || return 1
}

frontend_failure() {
  local status=$?
  trap - EXIT
  [ -z "$FRONTEND_TEMP_DIR" ] || rm -rf -- "$FRONTEND_TEMP_DIR"
  if [ "$status" -ne 0 ] && [ -n "$FRONTEND_MANIFEST" ]; then rm -f -- "$FRONTEND_MANIFEST"; fi
  if [ "$status" -ne 0 ] && [ "$FRONTEND_PROMOTION_STARTED" = true ]; then
    printf 'ERROR: frontend promotion failed; restoring the recorded previous static image.\n' >&2
    if frontend_restore_static; then
      frontend_write_state failed || true
    else
      printf 'ERROR: automatic static restoration failed; frontend recovery state was retained for operator recovery.\n' >&2
      frontend_write_state failed || true
    fi
  fi
  exit "$status"
}

frontend_run_rollback() {
  frontend_load_state
  [ "$FRONTEND_STATE_PHASE" != restored ] || frontend_die 'frontend recovery marker already records a completed restoration'
  . "$APP_ROOT/deploy/selectel/redeploy.sh"
  load_runtime_secrets
  local expected_backend_sha=$FRONTEND_BACKEND_SHA expected_backend_ids=$FRONTEND_BACKEND_IDS
  local expected_backend_images=$FRONTEND_BACKEND_IMAGE_IDS expected_worker_ids=$FRONTEND_WORKER_IDS
  local expected_worker_images=$FRONTEND_WORKER_IMAGE_IDS expected_scheduler_ids=$FRONTEND_SCHEDULER_IDS
  local expected_scheduler_images=$FRONTEND_SCHEDULER_IMAGE_IDS expected_gateway_id=$FRONTEND_GATEWAY_ID expected_image
  local expected_gateway_image=$FRONTEND_GATEWAY_IMAGE_ID expected_config=$FRONTEND_CONFIG_SHA256
  local previous_sha=$FRONTEND_OLD_SHA previous_image=$FRONTEND_OLD_ID candidate_sha=$FRONTEND_NEW_SHA candidate_image=$FRONTEND_NEW_ID
  frontend_capture_runtime no-static
  [ "$FRONTEND_BACKEND_SHA" = "$expected_backend_sha" ] || frontend_die 'retained backend SHA changed since frontend recovery was recorded'
  [ "$FRONTEND_BACKEND_IDS" = "$expected_backend_ids" ] && [ "$FRONTEND_BACKEND_IMAGE_IDS" = "$expected_backend_images" ] || frontend_die 'backend identity changed since frontend recovery was recorded'
  [ "$FRONTEND_WORKER_IDS" = "$expected_worker_ids" ] && [ "$FRONTEND_WORKER_IMAGE_IDS" = "$expected_worker_images" ] || frontend_die 'worker identity changed since frontend recovery was recorded'
  [ "$FRONTEND_SCHEDULER_IDS" = "$expected_scheduler_ids" ] && [ "$FRONTEND_SCHEDULER_IMAGE_IDS" = "$expected_scheduler_images" ] || frontend_die 'scheduler identity changed since frontend recovery was recorded'
  [ "$FRONTEND_GATEWAY_ID" = "$expected_gateway_id" ] && [ "$FRONTEND_GATEWAY_IMAGE_ID" = "$expected_gateway_image" ] || frontend_die 'gateway identity changed since frontend recovery was recorded'
  [ "$FRONTEND_CONFIG_SHA256" = "$expected_config" ] || frontend_die 'release configuration changed since frontend recovery was recorded'
  FRONTEND_BACKEND_SHA=$expected_backend_sha FRONTEND_BACKEND_IDS=$expected_backend_ids FRONTEND_BACKEND_IMAGE_IDS=$expected_backend_images
  FRONTEND_WORKER_IDS=$expected_worker_ids FRONTEND_WORKER_IMAGE_IDS=$expected_worker_images
  FRONTEND_SCHEDULER_IDS=$expected_scheduler_ids FRONTEND_SCHEDULER_IMAGE_IDS=$expected_scheduler_images
  FRONTEND_GATEWAY_ID=$expected_gateway_id FRONTEND_GATEWAY_IMAGE_ID=$expected_gateway_image FRONTEND_CONFIG_SHA256=$expected_config
  FRONTEND_OLD_SHA=$previous_sha FRONTEND_OLD_ID=$previous_image FRONTEND_NEW_SHA=$candidate_sha FRONTEND_NEW_ID=$candidate_image
  for sha in "$FRONTEND_OLD_SHA" "$FRONTEND_NEW_SHA"; do
    git_root merge-base --is-ancestor "$ACCEPTED_UI_V4_SHA" "$sha" || frontend_die 'recorded frontend image predates accepted UI v4'
    git_root merge-base --is-ancestor "$sha" "$PRODUCT_SHA" || frontend_die 'recorded frontend image is not in the verified rollback lineage'
    if [ "$sha" = "$FRONTEND_OLD_SHA" ]; then expected_image=$FRONTEND_OLD_ID; else expected_image=$FRONTEND_NEW_ID; fi
    [ "$(frontend_image_id "$sha")" = "$expected_image" ] || frontend_die 'recorded frontend image ID no longer matches its immutable tag'
  done
  frontend_assert_runtime_unchanged
  local current static_id current_id
  current=$(frontend_current_static)
  if [ "$current" != none ]; then
    IFS='|' read -r static_id current_id _ <<< "$current"
    [ "$current_id" = "$FRONTEND_OLD_ID" ] || [ "$current_id" = "$FRONTEND_NEW_ID" ] || frontend_die 'current static image is outside the recorded recovery pair'
  fi
  frontend_restore_static
}

frontend_run_release() {
  [ "$RUN_MIGRATION" = false ] || frontend_die 'frontend releases cannot request database migration'
  [ -z "${SELECTEL_PREBUILT_BACKEND_ID:-}" ] || frontend_die 'frontend releases cannot accept a prebuilt backend image ID'
  if [ -e "$MM0_FORWARD_MARKER" ] || [ -L "$MM0_FORWARD_MARKER" ] || [ -e "$FORWARD_MARKER" ] || [ -L "$FORWARD_MARKER" ]; then
    frontend_die 'frontend release is blocked by an active backend forward-only marker'
  fi
  frontend_capture_runtime
  [ "$(frontend_image_id "$FRONTEND_OLD_SHA")" = "$FRONTEND_OLD_ID" ] || frontend_die 'active static tag image ID differs from the running static container'
  [ -z "${SELECTEL_PREBUILT_WEBAPP_ID:-}" ] || frontend_die 'frontend release mode builds and verifies its own webapp image; prebuilt image IDs are refused'
  if [ "${FRONTEND_OLD_SHA}" = "$PRODUCT_SHA" ]; then
    local active_backend_sha=$FRONTEND_BACKEND_SHA active_backend_ids=$FRONTEND_BACKEND_IDS active_backend_images=$FRONTEND_BACKEND_IMAGE_IDS
    local active_worker_ids=$FRONTEND_WORKER_IDS active_worker_images=$FRONTEND_WORKER_IMAGE_IDS
    local active_scheduler_ids=$FRONTEND_SCHEDULER_IDS active_scheduler_images=$FRONTEND_SCHEDULER_IMAGE_IDS
    local active_gateway_id=$FRONTEND_GATEWAY_ID active_gateway_image=$FRONTEND_GATEWAY_IMAGE_ID active_config=$FRONTEND_CONFIG_SHA256
    local active_static_id=$FRONTEND_OLD_ID active_static_container=$FRONTEND_STATIC_CONTAINER
    [ -e "$FRONTEND_STATE" ] && [ ! -L "$FRONTEND_STATE" ] || frontend_die 'same-SHA retry requires a valid frontend recovery state'
    frontend_load_state
    [ "$FRONTEND_STATE_PHASE" = promoted ] && [ "$FRONTEND_BACKEND_SHA" = "$active_backend_sha" ] &&
      [ "$FRONTEND_BACKEND_IDS" = "$active_backend_ids" ] && [ "$FRONTEND_BACKEND_IMAGE_IDS" = "$active_backend_images" ] &&
      [ "$FRONTEND_WORKER_IDS" = "$active_worker_ids" ] && [ "$FRONTEND_WORKER_IMAGE_IDS" = "$active_worker_images" ] &&
      [ "$FRONTEND_SCHEDULER_IDS" = "$active_scheduler_ids" ] && [ "$FRONTEND_SCHEDULER_IMAGE_IDS" = "$active_scheduler_images" ] &&
      [ "$FRONTEND_GATEWAY_ID" = "$active_gateway_id" ] && [ "$FRONTEND_GATEWAY_IMAGE_ID" = "$active_gateway_image" ] &&
      [ "$FRONTEND_CONFIG_SHA256" = "$active_config" ] && [ "$FRONTEND_NEW_SHA" = "$PRODUCT_SHA" ] &&
      [ "$FRONTEND_NEW_ID" = "$active_static_id" ] || frontend_die 'same-SHA retry does not match the proven current frontend recovery state'
    frontend_assert_runtime_unchanged
    frontend_internal_smoke "$active_static_container"
    FRONTEND_OLD_SHA=$active_backend_sha FRONTEND_OLD_ID=$active_static_id
    FRONTEND_BACKEND_SHA=$active_backend_sha FRONTEND_BACKEND_IDS=$active_backend_ids FRONTEND_BACKEND_IMAGE_IDS=$active_backend_images
    FRONTEND_WORKER_IDS=$active_worker_ids FRONTEND_WORKER_IMAGE_IDS=$active_worker_images
    FRONTEND_SCHEDULER_IDS=$active_scheduler_ids FRONTEND_SCHEDULER_IMAGE_IDS=$active_scheduler_images
    FRONTEND_GATEWAY_ID=$active_gateway_id FRONTEND_GATEWAY_IMAGE_ID=$active_gateway_image FRONTEND_CONFIG_SHA256=$active_config
    FRONTEND_NEW_SHA=$PRODUCT_SHA FRONTEND_NEW_ID=$active_static_id
    FRONTEND_TEMP_DIR=$(mktemp -d)
    frontend_static_bytes "memoly-webapp:$PRODUCT_SHA" "$FRONTEND_TEMP_DIR/candidate"
    frontend_public_smoke "$FRONTEND_TEMP_DIR/candidate"
    rm -rf -- "$FRONTEND_TEMP_DIR"
    FRONTEND_TEMP_DIR=
    printf 'Frontend release is already active and its recovery state is verified: backend=%s frontend=%s.\n' "$active_backend_sha" "$PRODUCT_SHA"
    return 0
  fi
  frontend_validate_scope
  local FRONTEND_BACKEND_SHA_CAPTURED=$FRONTEND_BACKEND_SHA
  local FRONTEND_BACKEND_IDS_CAPTURED=$FRONTEND_BACKEND_IDS
  local FRONTEND_BACKEND_IMAGE_IDS_CAPTURED=$FRONTEND_BACKEND_IMAGE_IDS
  local FRONTEND_WORKER_IDS_CAPTURED=$FRONTEND_WORKER_IDS
  local FRONTEND_WORKER_IMAGE_IDS_CAPTURED=$FRONTEND_WORKER_IMAGE_IDS
  local FRONTEND_SCHEDULER_IDS_CAPTURED=$FRONTEND_SCHEDULER_IDS
  local FRONTEND_SCHEDULER_IMAGE_IDS_CAPTURED=$FRONTEND_SCHEDULER_IMAGE_IDS
  local FRONTEND_GATEWAY_ID_CAPTURED=$FRONTEND_GATEWAY_ID
  local FRONTEND_GATEWAY_IMAGE_ID_CAPTURED=$FRONTEND_GATEWAY_IMAGE_ID
  local FRONTEND_CONFIG_SHA256_CAPTURED=$FRONTEND_CONFIG_SHA256
  local FRONTEND_OLD_SHA_CAPTURED=$FRONTEND_OLD_SHA FRONTEND_OLD_ID_CAPTURED=$FRONTEND_OLD_ID
  if [ -e "$FRONTEND_STATE" ] || [ -L "$FRONTEND_STATE" ]; then
    if ! (
      frontend_load_state
      [ "$FRONTEND_STATE_PHASE" = promoted ] || [ "$FRONTEND_STATE_PHASE" = restored ] || exit 1
      [ "$FRONTEND_BACKEND_SHA" = "$FRONTEND_BACKEND_SHA_CAPTURED" ] &&
        [ "$FRONTEND_BACKEND_IDS" = "$FRONTEND_BACKEND_IDS_CAPTURED" ] &&
        [ "$FRONTEND_BACKEND_IMAGE_IDS" = "$FRONTEND_BACKEND_IMAGE_IDS_CAPTURED" ] &&
        [ "$FRONTEND_WORKER_IDS" = "$FRONTEND_WORKER_IDS_CAPTURED" ] &&
        [ "$FRONTEND_WORKER_IMAGE_IDS" = "$FRONTEND_WORKER_IMAGE_IDS_CAPTURED" ] &&
        [ "$FRONTEND_SCHEDULER_IDS" = "$FRONTEND_SCHEDULER_IDS_CAPTURED" ] &&
        [ "$FRONTEND_SCHEDULER_IMAGE_IDS" = "$FRONTEND_SCHEDULER_IMAGE_IDS_CAPTURED" ] &&
        [ "$FRONTEND_GATEWAY_ID" = "$FRONTEND_GATEWAY_ID_CAPTURED" ] &&
        [ "$FRONTEND_GATEWAY_IMAGE_ID" = "$FRONTEND_GATEWAY_IMAGE_ID_CAPTURED" ] &&
        [ "$FRONTEND_CONFIG_SHA256" = "$FRONTEND_CONFIG_SHA256_CAPTURED" ] || exit 1
      if [ "$FRONTEND_STATE_PHASE" = promoted ]; then
        [ "$FRONTEND_NEW_SHA" = "$FRONTEND_OLD_SHA_CAPTURED" ] && [ "$FRONTEND_NEW_ID" = "$FRONTEND_OLD_ID_CAPTURED" ] || exit 1
      else
        [ "$FRONTEND_OLD_SHA" = "$FRONTEND_OLD_SHA_CAPTURED" ] && [ "$FRONTEND_OLD_ID" = "$FRONTEND_OLD_ID_CAPTURED" ] || exit 1
      fi
    ); then
      frontend_die 'existing frontend recovery state is corrupt, unresolved, or does not match the live runtime'
    fi
  fi
  . "$APP_ROOT/deploy/selectel/redeploy.sh"
  load_runtime_secrets
  frontend_verify_migration_catalog
  SELECTEL_MAX_BOT_USERNAME="$MAX_BOT_USERNAME" bash "$APP_ROOT/deploy/selectel/build-images.sh" "$PRODUCT_SHA" --frontend-only
  FRONTEND_NEW_ID=$(frontend_image_id "$PRODUCT_SHA")
  FRONTEND_NEW_SHA=$PRODUCT_SHA
  [[ "$FRONTEND_NEW_ID" =~ ^sha256:[0-9a-f]{64}$ ]] || frontend_die 'candidate static image ID is invalid'
  FRONTEND_TEMP_DIR=$(mktemp -d)
  frontend_static_bytes "memoly-webapp:$PRODUCT_SHA" "$FRONTEND_TEMP_DIR/candidate"
  frontend_assert_runtime_unchanged
  current=$(frontend_current_static)
  [ "$current" != none ] || frontend_die 'active static service disappeared before promotion'
  IFS='|' read -r _ current_id current_tag <<< "$current"
  [ "$current_id" = "$FRONTEND_OLD_ID" ] && [ "$current_tag" = "memoly-webapp:$FRONTEND_OLD_SHA" ] || frontend_die 'active static image changed before promotion'
  frontend_write_state pending
  FRONTEND_PROMOTION_STARTED=true
  export MEMOLY_PRODUCT_SHA="$PRODUCT_SHA"
  MEMOLY_BACKEND_IMAGE_TAG="$FRONTEND_BACKEND_SHA" MEMOLY_WEBAPP_IMAGE_TAG="$PRODUCT_SHA" \
    docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" up -d --no-deps --force-recreate static >/dev/null || frontend_die 'static service promotion failed'
  local current static_id current_id
  current=$(frontend_current_static)
  [ "$current" != none ] || frontend_die 'promoted static service is not running'
  IFS='|' read -r static_id current_id _ <<< "$current"
  [ "$current_id" = "$FRONTEND_NEW_ID" ] || frontend_die 'promoted static container does not use the candidate image ID'
  frontend_internal_smoke "$static_id"
  frontend_assert_runtime_unchanged
  frontend_public_smoke "$FRONTEND_TEMP_DIR/candidate"
  frontend_write_manifest
  frontend_write_state promoted
  FRONTEND_PROMOTION_STARTED=false
  rm -rf -- "$FRONTEND_TEMP_DIR"
  FRONTEND_TEMP_DIR=
  printf 'Frontend release passed: backend=%s frontend=%s recovery=ready.\n' "$FRONTEND_BACKEND_SHA" "$PRODUCT_SHA"
}

frontend_release_main() {
  trap frontend_failure EXIT
  require_command sha256sum
  require_command grep
  require_command sort
  require_command xargs
  if [ "$RELEASE_MODE" = frontend-rollback ]; then frontend_run_rollback; else frontend_run_release; fi
}
