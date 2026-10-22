import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { bashExecutable, gitBashPath, linuxPath, runLinuxRoot } from './bash-runtime.mjs'

const root = resolve(import.meta.dirname, '..')
const library = gitBashPath(resolve(root, 'deploy/selectel/frontend-release.sh'))
const linuxLibrary = linuxPath(resolve(root, 'deploy/selectel/frontend-release.sh'))
const entrypoint = gitBashPath(resolve(root, 'deploy/selectel/ci-release.sh'))
const appRoot = gitBashPath(root)
const linuxEntrypoint = linuxPath(resolve(root, 'deploy/selectel/ci-release.sh'))
const hex = (char, size) => char.repeat(size)

function runBash(script) {
  return spawnSync(bashExecutable, ['-s'], { input: script, encoding: 'utf8', timeout: 30_000 })
}

function scopeScript(path) {
  return `
set -euo pipefail
APP_ROOT=${appRoot}
SERVER_ROOT=/mock
PRODUCT_SHA=${hex('d', 40)}
FRONTEND_BACKEND_SHA=${hex('b', 40)}
FRONTEND_OLD_SHA=${hex('c', 40)}
ACCEPTED_UI_V4_SHA=${hex('a', 40)}
git_root() {
  if [[ "$1" == merge-base ]]; then return 0; fi
  if [[ "$1" == diff && "$2" == --summary* ]]; then return 0; fi
  if [[ "$1" == diff && "$2" == --name-only* ]]; then printf '%s\\0' ${JSON.stringify(path)}; return 0; fi
  return 90
}
. ${library}
frontend_validate_scope ${hex('b', 40)}
`
}

test('frontend source guard admits vetted presentation and rejects runtime or unknown paths', async () => {
  const allowed = runBash(scopeScript('webapp/src/features/family/FamilyHubPage.tsx'))
  assert.equal(allowed.status, 0, `${allowed.stdout}${allowed.stderr}`)
  const denied = runBash(scopeScript('webapp/src/features/auth/LoginPage.tsx'))
  assert.notEqual(denied.status, 0)
  assert.match(denied.stderr, /refuses sensitive path/)
  const unknown = runBash(scopeScript('webapp/src/features/home/Widget.tsx'))
  assert.notEqual(unknown.status, 0)
  assert.match(unknown.stderr, /refuses unknown path/)
})

test('frontend entrypoint rejects forward markers before image capture or recovery', () => {
  const fixture = mkdtempSync(resolve(root, 'tests', '.frontend-marker-'))
  const marker = resolve(fixture, 'forward.marker')
  writeFileSync(marker, 'synthetic forward-only state\n')
  const script = `
set -- ${hex('d', 40)} DEPLOY false ExampleBot frontend
SERVER_ROOT=${gitBashPath(fixture)} APP_ROOT=${gitBashPath(root)} FORWARD_MARKER=${gitBashPath(marker)}
. ${entrypoint}
require_root() { :; }
require_command() { :; }
flock() { :; }
validate_repository() { :; }
validate_planned_source() { :; }
check_disk_space() { :; }
fetch_and_checkout() { printf 'CHECKOUT\\n'; }
capture_running_images() { printf 'IMAGE-CAPTURE\\n'; }
recover_forward_markers() { printf 'FORWARD-RECOVERY\\n'; }
main
`
  try {
    const result = runBash(script)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /blocked while a backend forward-only marker exists/)
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /IMAGE-CAPTURE|FORWARD-RECOVERY|CHECKOUT/)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('frontend-rollback entrypoint recovers an interrupted promotion using recorded identities only', () => {
  const backend = '7a24e720cd2cf9ecfefa5344539e3d416999ec58'
  const oldFrontend = '0dbc4c486f3a7841ae2d72d7fc617e552d502941'
  const candidate = '92b147a746631212dc5dd778bad6c1436c01873f'
  const result = runBash(`
set -euo pipefail
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/gateway" "$tmp/env" "$tmp/secrets"
server="$tmp"
printf 'services: {}\\n' > "$server/compose.yml"
printf 'static\\n' > "$server/Caddyfile.static"
printf 'gateway\\n' > "$server/gateway/Caddyfile"
printf 'DATABASE_URL=postgresql://memoly:secret@postgres:5432/memoly\\n' > "$server/env/backend.env"
printf 'POSTGRES_DB=memoly\\n' > "$server/env/postgres.env"
printf 'secret\\n' > "$server/secrets/max_bot_token"
printf 'secret\\n' > "$server/secrets/max_webhook_secret"
printf 'secret\\n' > "$server/secrets/max_inbox_encryption_key"
cat > "$tmp/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -eu
events="\${SERVER_ROOT}/docker-events"
printf '%s\\n' "$*" >> "$events"
if [[ "$1" == ps ]]; then
  service=
  for arg in "$@"; do case "$arg" in label=com.docker.compose.service=*) service="\${arg##*=}" ;; esac; done
  if [[ "$service" == static ]]; then
    if [[ -f "\${SERVER_ROOT}/current-static" ]]; then cut -d'|' -f1 "\${SERVER_ROOT}/current-static"; fi
  else
    case "$service" in backend) printf '%s\\n' '${hex('1', 64)}' ;; worker) printf '%s\\n' '${hex('2', 64)}' ;; scheduler) printf '%s\\n' '${hex('3', 64)}' ;; *) exit 20 ;; esac
  fi
  exit 0
fi
if [[ "$1" == inspect ]]; then
  format=$3 target=$4
  if [[ "$target" == memoly-webapp-1 ]]; then printf '%s|%s|true\\n' '${hex('4', 64)}' 'sha256:${hex('5', 64)}'; exit 0; fi
  if [[ "$format" == '{{.Id}}' ]]; then printf '%s\\n' "$target"; exit 0; fi
  if [[ "$target" == '${hex('8', 64)}' ]]; then printf 'sha256:%s|memoly-webapp:%s|%s\\n' '${hex('7', 64)}' '${oldFrontend}' '${oldFrontend}'; exit 0; fi
  case "$target" in
    '${hex('1', 64)}') service=backend ;; '${hex('2', 64)}') service=worker ;; '${hex('3', 64)}') service=scheduler ;;
    *) exit 21 ;;
  esac
  printf 'sha256:%s|memoly-backend:%s|%s\\n' '${hex('6', 64)}' '${backend}' '${backend}'
  exit 0
fi
if [[ "$1" == image && "$2" == inspect ]]; then
  format=$4 tag=$5 sha="\${tag##*:}"
  if [[ "$tag" == memoly-webapp:* ]]; then
    if [[ "$format" == '{{.Id}}' ]]; then
      if [[ "$sha" == '${oldFrontend}' ]]; then printf 'sha256:%s\\n' '${hex('7', 64)}'
      elif [[ "$sha" == '${candidate}' ]]; then printf 'sha256:%s\\n' '${hex('9', 64)}'
      else exit 24; fi
    else printf '%s\\n' "$sha"; fi
    exit 0
  fi
fi
if [[ "$1" == compose ]]; then
  if [[ " $* " == *' up -d --no-deps --force-recreate static '* ]]; then
    sha="\${MEMOLY_WEBAPP_IMAGE_TAG:?}"
    if [[ "$sha" == '${oldFrontend}' ]]; then image='${hex('7', 64)}'; elif [[ "$sha" == '${candidate}' ]]; then image='${hex('9', 64)}'; else exit 25; fi
    printf '%s|sha256:%s|memoly-webapp:%s\\n' '${hex('8', 64)}' "$image" "$sha" > "\${SERVER_ROOT}/current-static"
    exit 0
  fi
  exit 22
fi
if [[ "$1" == exec ]]; then exit 0; fi
exit 23
DOCKER
chmod 0755 "$tmp/bin/docker"
export PATH="$tmp/bin:$PATH" SERVER_ROOT="$server" APP_ROOT='${appRoot}'
export APP_USER=memoly COMPOSE_FILE="$server/compose.yml" COMPOSE_PROJECT=memoly
export RELEASES_DIR="$server/releases" ROLLBACK_ENV="$server/rollback.env"
export PUBLIC_URL=https://example.invalid GATEWAY_CONTAINER=memoly-webapp-1
stat() {
  if [[ "$1" == -c && "$2" == %u ]]; then printf '0\\n'
  elif [[ "$1" == -c && "$2" == %a && "$3" == *frontend-recovery.env ]]; then printf '600\\n'
  else command stat "$@"; fi
}
. '${library}'
FRONTEND_STATE="$server/frontend-recovery.env"
FRONTEND_BACKEND_SHA='${backend}' FRONTEND_BACKEND_IDS='${hex('1', 64)}'
FRONTEND_BACKEND_IMAGE_IDS='sha256:${hex('6', 64)}'
FRONTEND_WORKER_IDS='${hex('2', 64)}' FRONTEND_WORKER_IMAGE_IDS='sha256:${hex('6', 64)}'
FRONTEND_SCHEDULER_IDS='${hex('3', 64)}' FRONTEND_SCHEDULER_IMAGE_IDS='sha256:${hex('6', 64)}'
FRONTEND_GATEWAY_ID='${hex('4', 64)}' FRONTEND_GATEWAY_IMAGE_ID='sha256:${hex('5', 64)}'
FRONTEND_CONFIG_SHA256=$(sha256sum "$COMPOSE_FILE" "$server/Caddyfile.static" "$server/gateway/Caddyfile" \
  "$server/env/backend.env" "$server/env/postgres.env" "$server/secrets/max_bot_token" \
  "$server/secrets/max_webhook_secret" "$server/secrets/max_inbox_encryption_key" | sha256sum | awk '{print $1}')
FRONTEND_OLD_SHA='${oldFrontend}' FRONTEND_OLD_ID='sha256:${hex('7', 64)}'
FRONTEND_NEW_SHA='${candidate}' FRONTEND_NEW_ID='sha256:${hex('9', 64)}'
frontend_write_state pending
set -- '${candidate}' DEPLOY false ExampleBot frontend-rollback
. '${entrypoint}'
require_root() { :; }
require_command() { :; }
flock() { :; }
validate_repository() { :; }
validate_planned_source() { :; }
check_disk_space() { :; }
fetch_and_checkout() { :; }
capture_running_images() { printf 'FULL-CAPTURE\\n'; }
( main )
printf 'EVENTS-BEGIN\\n'
cat "$server/docker-events"
printf 'STATE-BEGIN\\n'
cat "$server/frontend-recovery.env"
`)
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  assert.match(result.stdout, /EVENTS-BEGIN/)
  assert.match(result.stdout, /compose .*up -d --no-deps --force-recreate static/)
  assert.match(result.stdout, /STATE-BEGIN[\s\S]*PHASE=restored/)
  assert.doesNotMatch(result.stdout, /up .* (backend|worker|scheduler)( |$)|FULL-CAPTURE/)
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /FULL-CAPTURE/)
})

test('frontend entrypoint supports two static releases, failed-promotion restore, and guarded operator rollback', { timeout: 60_000 }, () => {
  const result = runBash(`
set -Eeuo pipefail
root='${appRoot}'
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git -c core.autocrlf=false clone --quiet --shared "$root" "$tmp/app"
app="$tmp/app"
git -C "$app" config user.name 'Frontend release fixture'
git -C "$app" config user.email 'frontend-fixture@example.invalid'
printf '\\n/* synthetic presentation release one */\\n' >> "$app/webapp/src/components/ui-v2/ChildHeaderV2.css"
git -C "$app" add webapp/src/components/ui-v2/ChildHeaderV2.css
git -C "$app" commit -qm 'test: frontend fixture one'
t1=$(git -C "$app" rev-parse HEAD)
printf '\\n/* synthetic presentation release two */\\n' >> "$app/webapp/src/components/ui-v2/ChildHeaderV2.css"
git -C "$app" add webapp/src/components/ui-v2/ChildHeaderV2.css
git -C "$app" commit -qm 'test: frontend fixture two'
t2=$(git -C "$app" rev-parse HEAD)
printf '\\n/* synthetic presentation release three */\\n' >> "$app/webapp/src/components/ui-v2/ChildHeaderV2.css"
git -C "$app" add webapp/src/components/ui-v2/ChildHeaderV2.css
git -C "$app" commit -qm 'test: frontend fixture three'
t3=$(git -C "$app" rev-parse HEAD)
base=$(git -C "$app" rev-parse HEAD~3)
mkdir -p "$tmp/bin" "$tmp/server/gateway" "$tmp/server/env" "$tmp/server/secrets" "$tmp/server/releases" "$tmp/image-tree/assets/brand" "$tmp/image-tree/assets"
server="$tmp/server"
base_image=$(printf '%s000000000000000000000000' "$base")
printf '%s|sha256:%s|memoly-webapp:%s\\n' "$base_image" "$base_image" "$base" > "$server/current-static"
printf 'services: {}\\n' > "$server/compose.yml"
printf 'static\\n' > "$server/Caddyfile.static"
printf 'gateway\\n' > "$server/gateway/Caddyfile"
printf 'DATABASE_URL=postgresql://memoly:secret@postgres:5432/memoly\\n' > "$server/env/backend.env"
printf 'POSTGRES_DB=memoly\\n' > "$server/env/postgres.env"
printf 'secret\\n' > "$server/secrets/max_bot_token"
printf 'secret\\n' > "$server/secrets/max_webhook_secret"
printf 'secret\\n' > "$server/secrets/max_inbox_encryption_key"
cat > "$tmp/image-tree/index.html" <<'HTML'
<html><script src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css"></html>
HTML
printf 'manifest\\n' > "$tmp/image-tree/manifest.webmanifest"
printf 'icon192\\n' > "$tmp/image-tree/assets/brand/pwa-memoly-192.webp"
printf 'icon512\\n' > "$tmp/image-tree/assets/brand/pwa-memoly-512.webp"
printf 'javascript\\n' > "$tmp/image-tree/assets/app.js"
printf 'css\\n' > "$tmp/image-tree/assets/app.css"
cat > "$tmp/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$SERVER_ROOT/docker-events"
image_id() { printf '%s000000000000000000000000' "$1"; }
if [[ "$1" == ps ]]; then
  service=
  for arg in "$@"; do case "$arg" in label=com.docker.compose.service=*) service="\${arg##*=}" ;; esac; done
  case "$service" in
    backend) printf '%s\\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' ;;
    worker) printf '%s\\n' 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' ;;
    scheduler) printf '%s\\n' 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' ;;
    static) [[ ! -f "$SERVER_ROOT/current-static" ]] || cut -d'|' -f1 "$SERVER_ROOT/current-static" ;;
    *) exit 40 ;;
  esac
  exit 0
fi
if [[ "$1" == inspect ]]; then
  format=$3 target=$4
  if [[ "$target" == memoly-webapp-1 ]]; then printf '%s|%s|true\\n' 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'; exit 0; fi
  if [[ "$format" == '{{.Id}}' ]]; then printf '%s\\n' "$target"; exit 0; fi
  if [[ -f "$SERVER_ROOT/current-static" ]] && [[ "$target" == "$(cut -d'|' -f1 "$SERVER_ROOT/current-static")" ]]; then cut -d'|' -f2- "$SERVER_ROOT/current-static" | awk -F'|' '{tag=$2; sub(/^memoly-webapp:/,"",tag); print $1 "|" $2 "|" tag}'; exit 0; fi
  case "$target" in
    aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc)
      printf 'sha256:%s|memoly-backend:%s|%s\\n' 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' "$BACKEND_SHA" "$BACKEND_SHA"; exit 0 ;;
    *) exit 41 ;;
  esac
fi
if [[ "$1" == image && "$2" == inspect ]]; then
  format=$4 tag=$5 sha="\${tag##*:}"
  if [[ "$tag" == memoly-webapp:* ]]; then
    id=$(image_id "$sha")
    if [[ "$format" == '{{.Id}}' ]]; then printf 'sha256:%s\\n' "$id"; else printf '%s\\n' "$sha"; fi
    exit 0
  fi
fi
if [[ "$1" == create ]]; then printf 'static-inspection\\n'; exit 0; fi
if [[ "$1" == cp ]]; then cp -R "$IMAGE_TREE/." "$3/"; exit 0; fi
if [[ "$1" == rm ]]; then exit 0; fi
if [[ "$1" == exec ]]; then exit 0; fi
if [[ "$1" == compose ]]; then
  if [[ " $* " == *' up -d --no-deps --force-recreate static '* ]]; then
    sha="\${MEMOLY_WEBAPP_IMAGE_TAG:?}" id=$(image_id "$sha")
    container=$(printf '%s000000000000000000000000' "$sha")
    printf '%s|sha256:%s|memoly-webapp:%s\\n' "$container" "$id" "$sha" > "$SERVER_ROOT/current-static"
    [[ "\${PROMOTION_FAIL_SHA:-}" != "$sha" ]] || exit 42
    exit 0
  fi
  exit 43
fi
exit 44
DOCKER
cat > "$tmp/bin/curl" <<'CURL'
#!/usr/bin/env bash
set -eu
url="\${@: -1}"
path="\${url#https://app.memoly.ru}"
case "$path" in
  /) source="$IMAGE_TREE/index.html"; type=text/html ;;
  /health/live|/health/ready) source=; type=application/json ;;
  /manifest.webmanifest) source="$IMAGE_TREE/manifest.webmanifest"; type=application/manifest+json ;;
  /assets/brand/pwa-memoly-192.webp) source="$IMAGE_TREE/assets/brand/pwa-memoly-192.webp"; type=image/webp ;;
  /assets/brand/pwa-memoly-512.webp) source="$IMAGE_TREE/assets/brand/pwa-memoly-512.webp"; type=image/webp ;;
  /assets/app.js) source="$IMAGE_TREE/assets/app.js"; type=application/javascript ;;
  /assets/app.css) source="$IMAGE_TREE/assets/app.css"; type=text/css ;;
  *) exit 50 ;;
esac
body= headers= status_only=false
while (($#)); do case "$1" in -D) headers=$2; shift 2 ;; -o) body=$2; shift 2 ;; -w) status_only=true; shift 2 ;; *) shift ;; esac; done
[[ -z "$headers" ]] || printf 'HTTP/1.1 200 OK\\nContent-Type: %s\\n' "$type" > "$headers"
if [[ -n "$body" ]]; then
  if [[ -n "$source" ]]; then cp "$source" "$body"; else printf '{}\\n' > "$body"; fi
elif [[ -n "$source" ]]; then cat "$source"; else printf '{}\\n'; fi
[[ "$status_only" != true ]] || printf '200'
CURL
chmod 0755 "$tmp/bin/docker" "$tmp/bin/curl"
export PATH="$tmp/bin:$PATH" APP_ROOT="$app" SERVER_ROOT="$server" IMAGE_TREE="$tmp/image-tree"
export APP_USER=memoly COMPOSE_FILE="$server/compose.yml" COMPOSE_PROJECT=memoly
export RELEASES_DIR="$server/releases" ROLLBACK_ENV="$server/rollback.env"
export PUBLIC_URL=https://app.memoly.ru GATEWAY_CONTAINER=memoly-webapp-1 BACKEND_SHA="$base"
stat() { if [[ "$1" == -c && "$2" == %u ]]; then printf '0\\n'; elif [[ "$1" == -c && "$2" == %a && "$3" == *frontend-recovery.env ]]; then printf '600\\n'; else command stat "$@"; fi; }
set -- "$t1" DEPLOY false ExampleBot frontend
. '${entrypoint}'
require_root() { :; }
require_command() { :; }
flock() { :; }
validate_repository() { :; }
validate_planned_source() { :; }
check_disk_space() { :; }
fetch_and_checkout() { :; }
capture_running_images() { printf 'FULL-CAPTURE\\n'; }
bash() { if [[ "$1" == */build-images.sh ]]; then printf 'BUILD:%s\\n' "$*" >> "$SERVER_ROOT/build-events"; else command bash "$@"; fi; }
( main )
PRODUCT_SHA=$t2
( main )
PROMOTION_FAIL_SHA=$t3
export PROMOTION_FAIL_SHA
PRODUCT_SHA=$t3
if ( main ); then printf 'third promotion unexpectedly passed\\n' >&2; exit 60; fi
rm -f "$SERVER_ROOT/current-static"
PRODUCT_SHA=$t3 RELEASE_MODE=frontend-rollback
( main )
printf 'EVENTS-BEGIN\\n'
cat "$SERVER_ROOT/docker-events"
printf 'BUILDS-BEGIN\\n'
cat "$SERVER_ROOT/build-events"
printf 'BASE=%s\\n' "$base"
printf 'SECOND=%s\\n' "$t2"
printf 'MANIFESTS=%s\\n' "$(find "$RELEASES_DIR" -maxdepth 1 -type f -name 'frontend-*.env' | wc -l)"
printf 'STATE-BEGIN\\n'
cat "$SERVER_ROOT/frontend-recovery.env"
printf 'STATIC-BEGIN\\n'
cat "$SERVER_ROOT/current-static"
`)
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  assert.match(result.stdout, /MANIFESTS=2/)
  assert.match(result.stdout, /PHASE=restored/)
  const backend = result.stdout.match(/BASE=([0-9a-f]{40})/)?.[1]
  assert.ok(backend, 'fixture prints its retained backend SHA')
  const second = result.stdout.match(/SECOND=([0-9a-f]{40})/)?.[1]
  assert.ok(second, 'fixture prints the second successful frontend SHA')
  assert.ok(result.stdout.includes(`memoly-webapp:${second}`), 'operator rollback restores the exact prior successful frontend tag')
  assert.ok(result.stdout.includes(`BACKEND_SHA=${backend}`), 'frontend recovery retains the backend SHA unchanged')
  assert.match(result.stdout, /BUILD:.*--frontend-only/)
  assert.doesNotMatch(result.stdout, /FULL-CAPTURE|up -d.*(backend|worker|scheduler)/)
  assert.match(result.stderr, /frontend promotion failed; restoring the recorded previous static image/)
})

test('frontend recovery state preserves existing server-root permissions', () => {
  const result = runLinuxRoot(`
set -euo pipefail
SERVER_ROOT=/mock
. ${linuxLibrary}
tmp=$(mktemp -d)
chmod 0755 "$tmp"
FRONTEND_STATE="$tmp/frontend-recovery.env"
FRONTEND_BACKEND_SHA=${hex('b', 40)}
FRONTEND_BACKEND_IDS=${hex('1', 64)}
FRONTEND_BACKEND_IMAGE_IDS=sha256:${hex('2', 64)}
FRONTEND_WORKER_IDS=${hex('3', 64)}
FRONTEND_WORKER_IMAGE_IDS=sha256:${hex('4', 64)}
FRONTEND_SCHEDULER_IDS=${hex('5', 64)}
FRONTEND_SCHEDULER_IMAGE_IDS=sha256:${hex('6', 64)}
FRONTEND_GATEWAY_ID=${hex('7', 64)}
FRONTEND_GATEWAY_IMAGE_ID=sha256:${hex('8', 64)}
FRONTEND_CONFIG_SHA256=${hex('9', 64)}
FRONTEND_OLD_SHA=${hex('c', 40)}
FRONTEND_OLD_ID=sha256:${hex('a', 64)}
FRONTEND_NEW_SHA=${hex('d', 40)}
FRONTEND_NEW_ID=sha256:${hex('f', 64)}
frontend_write_state pending
printf 'parent=%s file=%s owner=%s\\n' "$(stat -c %a "$tmp")" "$(stat -c %a "$FRONTEND_STATE")" "$(stat -c %u "$FRONTEND_STATE")"
rm -rf "$tmp"
`)
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  assert.match(result.stdout, /parent=755 file=600 owner=0/)
})

test('frontend recovery refuses corrupt state before any runtime command', () => {
  const result = runLinuxRoot(`
set -euo pipefail
SERVER_ROOT=/mock
. ${linuxLibrary}
tmp=$(mktemp -d)
FRONTEND_STATE="$tmp/state"
printf 'FRONTEND_RECOVERY_VERSION=1\\nPHASE=pending\\ncorrupt\\n' > "$FRONTEND_STATE"
chmod 0600 "$FRONTEND_STATE"
docker() { printf 'DOCKER-MUTATION\\n'; }
frontend_load_state
`)
  assert.notEqual(result.status, 0)
  assert.doesNotMatch(result.stdout, /DOCKER-MUTATION/)
  assert.match(result.stderr, /invalid line count/)
})

test('a successful full release archives opaque frontend recovery bytes exactly', () => {
  const result = runLinuxRoot(`
set -euo pipefail
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
SERVER_ROOT="$tmp"
RELEASES_DIR="$tmp/releases"
mkdir -m 0700 "$RELEASES_DIR"
PRODUCT_SHA=${hex('d', 40)}
. ${linuxEntrypoint}
for phase in pending malformed; do
  FRONTEND_RECOVERY_FILE="$SERVER_ROOT/frontend-recovery.env"
  if [[ "$phase" == pending ]]; then
    printf 'FRONTEND_RECOVERY_VERSION=1\\nPHASE=pending\\nopaque=keep-me\\n' > "$FRONTEND_RECOVERY_FILE"
  else
    printf 'not a parseable frontend state\\n' > "$FRONTEND_RECOVERY_FILE"
    PRODUCT_SHA=${hex('e', 40)}
  fi
  chmod 0600 "$FRONTEND_RECOVERY_FILE"
  cp "$FRONTEND_RECOVERY_FILE" "$tmp/expected-$phase"
  capture_frontend_recovery_artifact
  archive_frontend_recovery_artifact
  test ! -e "$FRONTEND_RECOVERY_FILE"
  archive=$(find "$RELEASES_DIR" -maxdepth 1 -type f -name "frontend-recovery-$PRODUCT_SHA-*.env" -print -quit)
  test -n "$archive"
  cmp "$tmp/expected-$phase" "$archive"
  test "$(stat -c '%u:%a' "$archive")" = 0:600
done
printf 'ARCHIVES=%s\\n' "$(find "$RELEASES_DIR" -maxdepth 1 -type f -name 'frontend-recovery-*.env' | wc -l)"
`)
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  assert.match(result.stdout, /ARCHIVES=2/)
})

test('full release archival refuses changed or unsafe frontend recovery artifacts without removing them', () => {
  const result = runLinuxRoot(`
set -euo pipefail
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
SERVER_ROOT="$tmp"
RELEASES_DIR="$tmp/releases"
mkdir -m 0700 "$RELEASES_DIR"
PRODUCT_SHA=${hex('d', 40)}
. ${linuxEntrypoint}
FRONTEND_RECOVERY_FILE="$SERVER_ROOT/frontend-recovery.env"
printf 'PHASE=pending\\n' > "$FRONTEND_RECOVERY_FILE"
chmod 0600 "$FRONTEND_RECOVERY_FILE"
capture_frontend_recovery_artifact
printf 'changed\\n' > "$FRONTEND_RECOVERY_FILE"
if ( verify_frontend_recovery_artifact_unchanged ); then exit 70; fi
test -f "$FRONTEND_RECOVERY_FILE"
printf 'CHANGED-PRESERVED\\n'
chmod 0640 "$FRONTEND_RECOVERY_FILE"
if ( capture_frontend_recovery_artifact ); then exit 71; fi
test -f "$FRONTEND_RECOVERY_FILE"
printf 'UNSAFE-PRESERVED\\n'
`)
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  assert.match(result.stdout, /CHANGED-PRESERVED/)
  assert.match(result.stdout, /UNSAFE-PRESERVED/)
  assert.match(result.stderr, /changed during full release|mode 0600/)
})

function fullEntryScript({ failSmoke = false, unsafeMode = false, pathCase = 'canonical' } = {}) {
  return `
set -euo pipefail
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
SERVER_ROOT="$tmp"
APP_ROOT="$tmp/app"
RELEASES_DIR="$tmp/releases"
mkdir -p "$APP_ROOT" "$RELEASES_DIR"
chmod 0700 "$RELEASES_DIR"
mkdir -p "$APP_ROOT/deploy/selectel"
printf 'PHASE=pending\\nopaque=full-entry-test\\n' > "$SERVER_ROOT/frontend-recovery.env"
chmod ${unsafeMode ? '0640' : '0600'} "$SERVER_ROOT/frontend-recovery.env"
${pathCase === 'custom'
    ? 'FRONTEND_STATE="$SERVER_ROOT/custom-recovery.env" ROLLBACK_ENV="$SERVER_ROOT/rollback.env"'
    : pathCase === 'rollback-override'
      ? 'FRONTEND_STATE="$SERVER_ROOT/rollback.env" ROLLBACK_ENV="$SERVER_ROOT/rollback.env"'
      : pathCase === 'collision'
        ? 'ROLLBACK_ENV="$SERVER_ROOT/./frontend-recovery.env"'
        : ''}
touch "$SERVER_ROOT/events"
set -- ${hex('d', 40)} DEPLOY false ExampleBot full
. ${linuxEntrypoint}
eval "$(declare -f archive_frontend_recovery_artifact | sed '1s/^archive_frontend_recovery_artifact/archive_frontend_recovery_artifact_impl/')"
archive_frontend_recovery_artifact() {
  archive_frontend_recovery_artifact_impl
  printf 'ARCHIVE\\n' >> "$SERVER_ROOT/events"
}
require_root() { :; }
require_command() { :; }
validate_inputs() { :; }
validate_repository() { :; }
validate_planned_source() { :; }
flock() { :; }
recover_forward_markers() { printf 'FORWARD\\n' >> "$SERVER_ROOT/events"; }
check_disk_space() { :; }
verify_rollback_file() { :; }
capture_running_images() { :; }
fetch_and_checkout() { :; }
validate_prebuilt_images() { :; }
detect_membership_rollback_boundary() { :; }
detect_mm0_boundary() { :; }
git_memoly() { :; }
require_release_ownership() { :; }
prepare_rollback() { :; }
promote_runtime() { PROMOTION_STARTED=true; printf 'PROMOTE\\n' >> "$SERVER_ROOT/events"; }
verify_promoted_revision() { printf 'REVISION\\n' >> "$SERVER_ROOT/events"; }
public_smoke() {
  printf 'SMOKE\\n' >> "$SERVER_ROOT/events"
  ${failSmoke ? "die 'synthetic smoke failure'" : 'return 0'}
}
write_release_manifest() { printf 'MANIFEST\\n' >> "$SERVER_ROOT/events"; }
clear_release_markers() { printf 'CLEAR\\n' >> "$SERVER_ROOT/events"; PROMOTION_STARTED=false; }
bash() { printf 'COMMAND:%s\\n' "$*" >> "$SERVER_ROOT/events"; }
if ( main ); then
  printf 'ENTRY=success\\n'
else
  printf 'ENTRY=failed\\n'
fi
if [[ -e "$SERVER_ROOT/frontend-recovery.env" ]]; then printf 'LIVE=present\\n'; else printf 'LIVE=absent\\n'; fi
if [[ -e "$SERVER_ROOT/.selectel-deploy.lock" ]]; then printf 'LOCK=opened\\n'; else printf 'LOCK=untouched\\n'; fi
printf 'ARCHIVES=%s\\n' "$(find "$RELEASES_DIR" -maxdepth 1 -type f -name 'frontend-recovery-*.env' | wc -l)"
cat "$SERVER_ROOT/events"
`
}

test('full ci-release archives frontend state only after all full-release success gates', () => {
  const success = runLinuxRoot(fullEntryScript())
  assert.equal(success.status, 0, `${success.stdout}${success.stderr}`)
  assert.match(success.stdout, /ENTRY=success\nLIVE=absent\nARCHIVES=1/)
  assert.ok(success.stdout.indexOf('REVISION') < success.stdout.indexOf('SMOKE'))
  assert.ok(success.stdout.indexOf('SMOKE') < success.stdout.indexOf('MANIFEST'))
  assert.ok(success.stdout.indexOf('MANIFEST') < success.stdout.indexOf('CLEAR'))
  const successEvents = success.stdout.split(/\r?\n/)
  assert.ok(successEvents.indexOf('CLEAR') < successEvents.indexOf('ARCHIVE'))

  const failed = runLinuxRoot(fullEntryScript({ failSmoke: true }))
  assert.equal(failed.status, 0, `${failed.stdout}${failed.stderr}`)
  assert.match(failed.stdout, /ENTRY=failed\nLIVE=present\nARCHIVES=0/)
  assert.doesNotMatch(failed.stdout, /MANIFEST|Frontend recovery artifact archived/)

  const unsafe = runLinuxRoot(fullEntryScript({ unsafeMode: true }))
  assert.equal(unsafe.status, 0, `${unsafe.stdout}${unsafe.stderr}`)
  assert.match(unsafe.stdout, /ENTRY=failed\nLIVE=present\nARCHIVES=0/)
  assert.doesNotMatch(unsafe.stdout, /FORWARD|PROMOTE|REVISION|SMOKE|MANIFEST/)

  for (const pathCase of ['custom', 'rollback-override', 'collision']) {
    const pathRefusal = runLinuxRoot(fullEntryScript({ pathCase }))
    assert.equal(pathRefusal.status, 0, `${pathRefusal.stdout}${pathRefusal.stderr}`)
    assert.match(pathRefusal.stdout, /ENTRY=failed\nLIVE=present\nLOCK=untouched\nARCHIVES=0/)
    assert.doesNotMatch(pathRefusal.stdout, /FORWARD|PROMOTE|REVISION|SMOKE|MANIFEST/)
  }
})

test('frontend recovery restores only the exact recorded static image when static is absent', () => {
  const result = runBash(`
set -euo pipefail
SERVER_ROOT=/mock
. ${library}
COMPOSE_FILE=/mock/compose.yml COMPOSE_PROJECT=memoly SERVER_ROOT=/mock
FRONTEND_BACKEND_SHA=${hex('b', 40)} FRONTEND_OLD_SHA=${hex('c', 40)}
FRONTEND_OLD_ID=sha256:${hex('a', 64)} FRONTEND_NEW_ID=sha256:${hex('f', 64)}
FRONTEND_BACKEND_IDS=${hex('1', 64)} FRONTEND_BACKEND_IMAGE_IDS=sha256:${hex('2', 64)}
FRONTEND_WORKER_IDS=${hex('3', 64)} FRONTEND_WORKER_IMAGE_IDS=sha256:${hex('4', 64)}
FRONTEND_SCHEDULER_IDS=${hex('5', 64)} FRONTEND_SCHEDULER_IMAGE_IDS=sha256:${hex('6', 64)}
FRONTEND_GATEWAY_ID=${hex('7', 64)} FRONTEND_GATEWAY_IMAGE_ID=sha256:${hex('8', 64)}
FRONTEND_CONFIG_SHA256=${hex('9', 64)}
CURRENT=none
frontend_current_static() { printf '%s\\n' "$CURRENT"; }
frontend_internal_smoke() { printf 'STATIC-SMOKE:%s\\n' "$1"; }
frontend_assert_runtime_unchanged() { printf 'RETAINED-BACKEND-CHECK\\n'; }
frontend_write_state() { printf 'STATE:%s\\n' "$1"; }
docker() {
  printf 'DOCKER:backend=%s webapp=%s %s\\n' "\${MEMOLY_BACKEND_IMAGE_TAG:-}" "\${MEMOLY_WEBAPP_IMAGE_TAG:-}" "$*" >&2
  if [[ "$*" == *' up -d --no-deps --force-recreate static' ]]; then
    CURRENT='${hex('e', 64)}|sha256:${hex('a', 64)}|memoly-webapp:${hex('c', 40)}'
    return 0
  fi
  return 80
}
frontend_restore_static
`)
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  assert.match(result.stderr, new RegExp(`DOCKER:backend=${hex('b', 40)} webapp=${hex('c', 40)} compose.*up -d --no-deps --force-recreate static`))
  assert.match(result.stdout, /STATE:restored/)
  assert.doesNotMatch(result.stdout, /up -d.*(backend|worker|scheduler)/)
})
