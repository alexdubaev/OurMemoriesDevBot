import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = resolve(import.meta.dirname, '..')
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8')

test('Selectel image builder uses its checkout with an explicit safe Git directory', () => {
  const scriptPath = resolve(root, 'deploy/selectel/build-images.sh')
    .replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/mnt/${drive.toLowerCase()}/`)
    .replaceAll('\\', '/')
  const harness = `
set -euo pipefail
temp="$(mktemp -d)"
trap 'rm -rf -- "$temp"' EXIT
repo="$temp/repo"
mkdir -p "$repo/deploy/selectel" "$temp/bin"
tr -d '\\r' < '${scriptPath}' > "$repo/deploy/selectel/build-images.sh"
real_git="$(command -v git)"
"$real_git" init -q "$repo"
"$real_git" -C "$repo" remote add origin git@github.com:alexdubaev/OurMemoriesDevBot.git
"$real_git" -C "$repo" add deploy/selectel/build-images.sh
"$real_git" -C "$repo" -c user.name=Test -c user.email=test@example.com commit -qm initial
sha="$("$real_git" -C "$repo" rev-parse HEAD)"
"$real_git" -C "$repo" update-ref refs/remotes/origin/main "$sha"
cat > "$temp/bin/git" <<'GIT'
#!/usr/bin/env bash
if [ "$1" != -c ] || [ "$2" != "safe.directory=$BUILDER_REPO" ] || [ "$3" != -C ] || [ "$4" != "$BUILDER_REPO" ]; then
  exit 82
fi
shift 4
exec "$REAL_GIT" -c "safe.directory=$BUILDER_REPO" -C "$BUILDER_REPO" "$@"
GIT
cat > "$temp/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
if [ "$1" = build ]; then exit 0; fi
if [ "$1" = image ] && [ "$2" = inspect ]; then
  if [ "$3" = --format ]; then printf '%s\\n' "$EXPECTED_SHA"; fi
  exit 0
fi
exit 83
DOCKER
chmod +x "$temp/bin/git" "$temp/bin/docker"
export BUILDER_REPO="$repo" REAL_GIT="$real_git" EXPECTED_SHA="$sha"
cd "$temp"
PATH="$temp/bin:$PATH" SELECTEL_MAX_BOT_USERNAME=id911018762027_bot bash "$repo/deploy/selectel/build-images.sh" "$sha"
`
  const result = spawnSync('bash', ['-s'], { input: harness, encoding: 'utf8', timeout: 30_000 })
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  assert.match(result.stdout, /Built and verified immutable images/)
})

test('Selectel Compose owns only an internal static service', () => {
  const compose = read('deploy/selectel/compose.yml.template')

  assert.match(compose, /services:\s*[\s\S]*\n\s+static:\s*\n/)
  assert.doesNotMatch(compose, /\n\s+webapp:\s*\n/)
  assert.match(compose, /image:\s*memoly-webapp:\$\{MEMOLY_WEBAPP_IMAGE_TAG(?::-[^}]*)?\}/)
  assert.doesNotMatch(compose, /\n\s+static:[\s\S]*?\n\s+ports:/)
  assert.doesNotMatch(compose, /\n\s+container_name:/)
  assert.match(compose, /\n\s+postgres:\s*\n/)
  assert.match(compose, /\/opt\/memoly\/env\/postgres\.env/)
  assert.match(compose, /\/opt\/memoly\/env\/backend\.env/)
  assert.match(compose, /pg_isready/)
  assert.match(compose, /test:\s*\["CMD-SHELL",\s*"bun -e[\s\S]*health\/ready/)
  assert.match(compose, /interval:\s*15s/)
  assert.match(compose, /retries:\s*12/)
  assert.match(compose, /command:\s*\[\s*["']bun["']\s*,\s*["']src\/worker\.ts["']\s*\]/)
  assert.match(compose, /command:\s*\[\s*["']bun["']\s*,\s*["']src\/scheduler\.ts["']\s*\]/)
  assert.match(compose, /MEMOLY_MAX_BOT_TOKEN|MAX_BOT_TOKEN/)
  assert.match(compose, /MEMOLY_MAX_WEBHOOK_SECRET|MAX_WEBHOOK_SECRET/)
  assert.match(compose, /MEMOLY_MAX_INBOX_ENCRYPTION_KEY|MAX_INBOX_ENCRYPTION_KEY/)
  assert.doesNotMatch(compose, /\.env\.production/)
  assert.match(compose, /name:\s*\$\{MEMOLY_EDGE_NETWORK:-memoly_default\}/)
})

test('edge and static Caddy templates preserve routing ownership', () => {
  const edge = read('deploy/selectel/Caddyfile.edge.template')
  const statik = read('deploy/selectel/Caddyfile.static.template')

  assert.doesNotMatch(edge, /auto_https\s+off/)
  assert.match(edge, /\/api\/spikes\/max-video\//)
  assert.match(edge, /reverse_proxy\s+max-video-spike-backend:3000/)
  assert.match(edge, /\/__spikes\/max-direct-video-upload/)
  assert.match(edge, /@max_direct_video_upload_spike\s+path\s+\/__spikes\/max-direct-video-upload\s+\/__spikes\/max-direct-video-upload\/*/)
  assert.match(edge, /reverse_proxy\s+max-video-spike-frontend:80/)
  assert.match(edge, /\/api\//)
  assert.match(edge, /\/storage\//)
  assert.match(edge, /\/webhooks\/telegram/)
  assert.match(edge, /\/webhooks\/max/)
  for (const path of ['/api/*', '/storage/*', '/webhooks/telegram', '/webhooks/max', '/health/live', '/health/ready']) {
    assert.match(edge, new RegExp(`handle ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{\\s*reverse_proxy\\s+memoly-backend-1:3000`))
  }
  assert.doesNotMatch(edge, /reverse_proxy\s+backend:3000/)
  assert.match(edge, /handle\s*\{[\s\S]*reverse_proxy\s+static:80[\s\S]*\}/)
  assert.doesNotMatch(edge, /\/max-video-upload\//)
  assert.match(statik, /root\s+\*\s+\/srv/)
  assert.match(statik, /try_files\s+\{path\}\s+\/index\.html/)
})

test('redeploy script fails closed and exposes safe promotion phases', () => {
  const script = read('deploy/selectel/redeploy.sh')

  assert.match(script, /docker inspect[\s\S]*com\.docker\.compose\.project/)
  assert.match(script, /gateway.*compose|compose.*gateway/i)
  assert.match(script, /COMPOSE_PROJECT=\$\{COMPOSE_PROJECT:-memoly\}/)
  assert.match(script, /MEMOLY_EDGE_NETWORK:-memoly_default/)
  assert.match(script, /SERVER_ROOT=\$\{SERVER_ROOT:-\/opt\/memoly\}/)
  assert.match(script, /COMPOSE_FILE=\$\{COMPOSE_FILE:-"\$SERVER_ROOT\/compose\.yml"\}/)
  assert.match(script, /SERVER_EDGE_CADDYFILE=\$\{SERVER_EDGE_CADDYFILE:-"\$SERVER_ROOT\/gateway\/Caddyfile"\}/)
  assert.doesNotMatch(script, /SERVER_EDGE_CADDYFILE=\$\{SERVER_EDGE_CADDYFILE:-"\$SERVER_ROOT\/Caddyfile"\}/)
  assert.match(script, /active gateway Caddyfile is missing/)
  assert.match(script, /gateway_mount=.*Mounts/)
  assert.match(script, /bind\|\$SERVER_ROOT\/gateway\|false/)
  assert.match(script, /backups\/compose\.pre-selectel/)
  assert.match(script, /date.*%Y%m%d|date.*%s/)
  assert.match(script, /max_bot_token/)
  assert.match(script, /max_webhook_secret/)
  assert.match(script, /max_inbox_encryption_key/)
  assert.match(script, /GATEWAY_CADDY_CONFIG=\$\{GATEWAY_CADDY_CONFIG:-\/tmp\//)
  assert.match(script, /SERVER_ROOT.*\.selectel-deploy\.lock/)
  assert.match(script, /require_command flock/)
  assert.match(script, /flock -n 9/)
  assert.match(script, /docker cp[\s\S]*GATEWAY_CADDY_CONFIG/)
  assert.match(script, /Caddyfile[\s\S]*reload/)
  assert.match(script, /install[\s\S]*compose\.yml/)
  assert.doesNotMatch(script, /\.env\.production/)
  assert.match(script, /docker compose[\s\S]*config/)
  assert.match(script, /prisma\s+Migrate\s+status|migration status|migrate status/i)
  assert.match(script, /worker/)
  assert.match(script, /scheduler/)
  assert.match(script, /static/)
  assert.match(script, /health\/live/)
  assert.match(script, /health\/ready/)
  assert.match(script, /MEMOLY_PRODUCT_SHA/)
  assert.match(script, /MEMOLY_PRODUCT_SHA=\$\{MEMOLY_PRODUCT_SHA:-\}/)
  assert.match(script, /\$\{#tag\}.*40/)
  assert.match(script, /\*\[!a-f0-9\]\*/)
  assert.match(script, /backend image tag must equal MEMOLY_PRODUCT_SHA/)
  assert.match(script, /webapp image tag must equal MEMOLY_PRODUCT_SHA/)
  assert.match(script, /docker image inspect\s+"memoly-backend:/)
  assert.match(script, /docker image inspect\s+"memoly-webapp:/)
  assert.doesNotMatch(script, /compose pull/)
  assert.match(script, /compose up -d --no-deps --force-recreate backend/)
  assert.match(script, /compose exec -T backend bun -e[\s\S]*127\.0\.0\.1:3000\$\{endpoint\}/)
  assert.match(script, /for endpoint in \/health\/live \/health\/ready/)
  assert.match(script, /http:\/\/static:80/)
  assert.match(script, /activate_gateway/)
  assert.match(script, /reload-gateway.*disabled.*use deploy/i)
  assert.doesNotMatch(script, /Usage: redeploy\.sh .*reload-gateway/)
  assert.match(script, /caddy\s+validate/)
  assert.match(script, /caddy\s+reload/)
  assert.match(script, /in-place-file\.sh" activate/)
  assert.match(script, /in-place-file\.sh" restore/)
  assert.match(script, /gateway-mounted Caddyfile checksum/)
  assert.match(script, /ROLLED_BACK_AFTER_CADDY_ACTIVATION_FAILURE/)
  assert.match(script, /CADDY_ROLLBACK_FAILED_AFTER_ACTIVATION_FAILURE/)
  assert.match(script, /if \[ "\$rollback_ok" -eq 1 \]/)
  assert.doesNotMatch(script, /mv\s+-f\s+"\$edge_tmp"\s+"\$SERVER_EDGE_CADDYFILE"/)
  assert.match(script, /rollback/i)
  assert.match(script, /compose ps --status running --services/)
  assert.match(script, /required Compose service is not running/)
  assert.match(script, /validate_inputs rollback/)
  assert.doesNotMatch(script, /docker\s+rm(?:\s|$)/m)
  assert.doesNotMatch(script, /docker\s+rename(?:\s|$)/m)
  assert.doesNotMatch(script, /--remove-orphans/)

  const deployBody = script.slice(script.indexOf('deploy() {'), script.indexOf('\n}\n\nusage()'))
  const rollbackBody = script.slice(script.indexOf('rollback() {'), script.indexOf('\n}\n\ndeploy()'))
  assert.ok(deployBody.indexOf('wait_backend_internal') < deployBody.indexOf('promote_jobs'))
  assert.ok(deployBody.indexOf('promote_static') < deployBody.indexOf('verify_static_internal'))
  assert.ok(deployBody.indexOf('verify_static_internal') < deployBody.indexOf('activate_gateway'))
  assert.ok(deployBody.indexOf('activate_gateway') < deployBody.indexOf('readiness'))
  const prepareBody = script.slice(script.indexOf('prepare_configuration() {'), script.indexOf('\n}\n\nmigration_status()'))
  assert.ok(prepareBody.indexOf('validate_candidate_caddy') < prepareBody.indexOf('backup_server_state'))
  const activateBody = script.slice(script.indexOf('activate_gateway() {'), script.indexOf('\n}\n\ngateway_public_health()'))
  assert.ok(activateBody.indexOf('validate_candidate_caddy') < activateBody.indexOf('backup_gateway_caddyfile'))
  assert.ok(activateBody.indexOf('backup_gateway_caddyfile') < activateBody.indexOf('in-place-file.sh" activate'))
  assert.ok(rollbackBody.indexOf('verify_static_internal') < rollbackBody.indexOf('render_edge_candidate'))
  assert.ok(rollbackBody.indexOf('render_edge_candidate') < rollbackBody.indexOf('validate_candidate_caddy'))
  assert.ok(rollbackBody.indexOf('validate_candidate_caddy') < rollbackBody.indexOf('activate_gateway'))
  assert.ok(rollbackBody.indexOf('activate_gateway') < rollbackBody.indexOf('readiness'))

  for (const match of script.matchAll(/^\s*compose up .*$/gm)) {
    assert.match(match[0], /--no-deps/)
    assert.match(match[0], /--force-recreate/)
  }
})

test('rollback template keeps additive migrations and uses configured images', () => {
  const rollback = read('deploy/selectel/rollback.env.example')

  assert.match(rollback, /PREVIOUS_BACKEND_IMAGE/)
  assert.match(rollback, /PREVIOUS_WEBAPP_IMAGE/)
  assert.match(rollback, /MEMOLY_DB_ROLLBACK_ALLOWED=false/)
  assert.match(rollback, /no database|forward-only|migrations remain/i)
})

test('one-shot migration backs up and validates before guarded db:deploy', () => {
  const script = read('deploy/selectel/redeploy.sh')
  const migrateBody = script.match(/migrate\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  const backupBody = script.slice(script.indexOf('backup_database() {'), script.indexOf('\n}\n\nmigrate()'))

  assert.match(script, /Usage: redeploy\.sh \{preflight\|migrate\|deploy\|rollback\|migration-status\|quiesce-legacy\}/)
  assert.match(script, /migrate\) require_command docker; migrate/)
  assert.match(backupBody, /timestamp=\$\(date -u \+%Y%m%dT%H%M%SZ\)/)
  assert.match(backupBody, /backups\/postgres-\$\{MEMOLY_PRODUCT_SHA\}-\$\{timestamp\}\.dump/)
  assert.match(backupBody, /install -d -m 0700 "\$SERVER_ROOT\/backups"/)
  assert.match(backupBody, /install -m 0600 \/dev\/null "\$temp_file"/)
  assert.match(backupBody, /pg_dump [^\n]*--format=custom/)
  assert.doesNotMatch(backupBody, /pg_dump [^\n]*--file(?:=|\s)/)
  assert.doesNotMatch(backupBody, /pg_restore --list\s+-/)
  assert.match(backupBody, /\[ ! -s "\$temp_file" \]/)
  assert.match(backupBody, /dd if="\$temp_file" bs=1 count=5/)
  assert.match(backupBody, /\[ "\$magic" != PGDMP \]/)
  assert.match(backupBody, /pg_restore --list >"\$toc_file" <"\$temp_file"/)
  assert.match(backupBody, /\[ ! -s "\$toc_file" \]/)
  assert.match(backupBody, /database backup failed; migration was not attempted/)
  assert.match(backupBody, /database backup validation failed; migration was not attempted/)
  assert.ok(migrateBody.indexOf('preflight') < migrateBody.indexOf('backup_database'))
  assert.ok(migrateBody.indexOf('validate_database_target') < migrateBody.indexOf('backup_database'))
  assert.ok(migrateBody.indexOf('backup_database') < migrateBody.indexOf('bun run db:deploy'))
  assert.ok(migrateBody.indexOf('bun run db:deploy') < migrateBody.indexOf('migration_status'))
  assert.match(migrateBody, /compose run --rm --no-deps backend bun run db:deploy/)
  assert.doesNotMatch(migrateBody, /compose up|promote_backend|promote_jobs|promote_static|activate_gateway/)
  assert.match(script, /backend DATABASE_URL does not target the Compose postgres database/)
  assert.match(script, /postgres\|5432\|\$postgres_database/)
  assert.match(read('deploy/selectel/README.md'), /one-shot database migration/i)
  assert.match(read('deploy/selectel/README.md'), /bun run db:deploy/)
})

test('B2 release quiesces only legacy writers and forbids an automatic pre-B2 rollback', () => {
  const redeploy = read('deploy/selectel/redeploy.sh')
  const release = read('deploy/selectel/ci-release.sh')
  const quiesce = redeploy.match(/quiesce_legacy_runtime\(\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(quiesce)
  const target = 'a'.repeat(40)
  const harness = `
set -euo pipefail
${quiesce}
die() { printf 'DIE:%s\\n' "$*" >&2; exit 1; }
validate_forward_marker() { :; }
MEMOLY_PRODUCT_SHA=${target}
COMPOSE_PROJECT=memoly
LEGACY_RUNNING=true
docker() {
  if [ "$1" = ps ]; then
    if [[ "$*" == *service=backend* ]]; then
      if [ "$LEGACY_RUNNING" = true ]; then printf 'legacy-container\\n'; fi
      printf 'target-container\\n'
    fi
  elif [ "$1" = inspect ]; then
    if [ "${'${@: -1}'}" = legacy-container ]; then printf 'memoly-backend:${'b'.repeat(40)}\\n'
    else printf 'memoly-backend:${target}\\n'; fi
  elif [ "$1" = stop ]; then
    [ "${'${@: -1}'}" = legacy-container ] || exit 80
    LEGACY_RUNNING=false
    printf 'stopped legacy\\n' >> "$STOP_MARKER"
  else
    exit 81
  fi
}
quiesce_legacy_runtime
`
  const marker = resolve(root, 'tests/.selectel-b2-stop-marker')
  const bashMarker = marker.replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/${drive.toLowerCase()}/`).replaceAll('\\', '/')
  rmSync(marker, { force: true })
  const result = spawnSync('bash', ['-s'], {
    input: harness, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, STOP_MARKER: bashMarker },
  })
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  const stopped = readFileSync(marker, 'utf8')
  rmSync(marker, { force: true })
  assert.equal(stopped, 'stopped legacy\n')
  const legacyBranch = release.indexOf('if [ "$LEGACY_MEMBERSHIP_RUNTIME" = true ] && [ "$QUIESCE_STARTED" = true ]; then')
  const rollbackBranch = release.indexOf('elif [ "$PROMOTION_STARTED" = true ]; then')
  assert.ok(legacyBranch >= 0 && legacyBranch < rollbackBranch)
  const releaseSequence = release.slice(release.indexOf('export MEMOLY_PUBLIC_HOST'))
  assert.ok(releaseSequence.indexOf('write_forward_marker') < releaseSequence.indexOf('bash "$APP_ROOT/deploy/selectel/redeploy.sh" quiesce-legacy'))
  assert.ok(releaseSequence.indexOf('quiesce-legacy') < releaseSequence.indexOf('redeploy.sh" migrate'))
  assert.match(redeploy, /rollback target predates the B2 membership runtime/)
  assert.match(redeploy, /rollback is forbidden after unread activation, multiple memberships/)
})

test('direct B2 migration and promotion reject a running pre-B2 writer', () => {
  const script = read('deploy/selectel/redeploy.sh')
  const guard = script.match(/guard_membership_transition\(\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(guard)
  const target = 'a'.repeat(40)
  const legacy = 'b'.repeat(40)
  const harness = `
set -euo pipefail
${guard}
die() { printf '%s\\n' "$*" >&2; exit 7; }
B2_RUNTIME_SHA=${'c'.repeat(40)}
MEMOLY_PRODUCT_SHA=${target}
APP_ROOT=/mock/app
COMPOSE_PROJECT=memoly
FORWARD_MARKER=/missing-b2-marker
git() {
  if [ "$5" = cat-file ]; then return 0; fi
  if [ "${'${@: -1}'}" = "$MEMOLY_PRODUCT_SHA" ]; then return 0; fi
  return 1
}
docker() {
  if [ "$1" = ps ]; then printf 'legacy-container\\n';
  elif [ "$1" = inspect ]; then printf 'memoly-backend:${legacy}\\n';
  else exit 9; fi
}
guard_membership_transition
`
  const result = spawnSync('bash', ['-s'], { input: harness, encoding: 'utf8', timeout: 30_000 })
  assert.equal(result.status, 7, `${result.stdout}${result.stderr}`)
  assert.match(result.stderr, /predates B2/)
  assert.match(script, /migrate\) require_command docker; guard_membership_transition; migrate/)
  assert.match(script, /deploy\(\) \{\n\tguard_membership_transition/)
  assert.doesNotMatch(read('deploy/selectel/README.md'), /^deploy\/selectel\/redeploy\.sh migrate$/m)
})

test('database target validation rejects URL overrides and accepts the Compose target', () => {
  const script = read('deploy/selectel/redeploy.sh')
  const javascript = script.match(/bun -e '([^']+)'/)?.[1]
  assert.ok(javascript)
  const run = (databaseUrl) => spawnSync(process.platform === 'win32' ? 'bun.exe' : 'bun', ['-e', javascript], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  })

  const accepted = run('postgresql://superuser:secret@postgres:5432/web_app_demo?schema=public')
  assert.equal(accepted.status, 0, `${accepted.stdout}${accepted.stderr}`)
  assert.equal(accepted.stdout, 'postgres|5432|web_app_demo|superuser')
  for (const databaseUrl of [
    'postgresql://superuser:secret@postgres:5432/web_app_demo?host=evil',
    'postgresql://superuser:secret@postgres:5432/web_app_demo?port=6543',
    'postgresql://superuser:secret@postgres:5432/web_app_demo?schema=public&schema=public',
    'postgresql://superuser:secret@postgres:5432/web_app_demo#fragment',
  ]) {
    assert.notEqual(run(databaseUrl).status, 0, databaseUrl)
  }
})

test('backup failure exits before db:deploy in the executable migration flow', () => {
  const script = read('deploy/selectel/redeploy.sh')
  const backupStart = script.indexOf('backup_database() {')
  const backupEnd = script.indexOf('\n}\n\nmigrate()', backupStart) + 2
  const backup = script.slice(backupStart, backupEnd)
  const migrate = script.match(/migrate\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  const harness = `
${backup}
${migrate}
preflight() { :; }
validate_database_target() { :; }
migration_status() { :; }
die() { printf 'DIE:%s\\n' "$*" >&2; exit 1; }
compose() {
  if [[ "$*" == *pg_dump* ]]; then return 42; fi
  if [[ "$*" == *db:deploy* ]]; then printf '%s' called > "$DB_DEPLOY_MARKER"; fi
  return 0
}
SERVER_ROOT=/tmp/memoly-selectel-test
mkdir -p "$SERVER_ROOT"
trap 'rm -rf -- "$SERVER_ROOT"' EXIT
DB_DEPLOY_MARKER="$SERVER_ROOT/db-deploy-called"
MEMOLY_PRODUCT_SHA=227e2149e66e3c3ac75ac235eb201f8154d7ceb3
migrate
`
  const harnessPath = resolve(root, 'tests/.selectel-backup-harness.sh')
  const bashHarnessPath = harnessPath.replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll('\\', '/')
  writeFileSync(harnessPath, harness)
  const result = spawnSync('bash', [bashHarnessPath], { encoding: 'utf8', timeout: 30_000 })
  rmSync(harnessPath, { force: true })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /database backup failed; migration was not attempted/, `${result.stdout}${result.stderr}`)
  assert.doesNotMatch(result.stderr, /secret|DATABASE_URL|web_app_demo/)
  assert.doesNotMatch(result.stdout, /db-deploy-called/)
  assert.match(harness, /DB_DEPLOY_MARKER/)
})

test('empty dump output fails validation before db:deploy', () => {
  const script = read('deploy/selectel/redeploy.sh')
  const backupStart = script.indexOf('backup_database() {')
  const backupEnd = script.indexOf('\n}\n\nmigrate()', backupStart) + 2
  const backup = script.slice(backupStart, backupEnd)
  const migrate = script.match(/migrate\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  const harness = `
${backup}
${migrate}
preflight() { :; }
validate_database_target() { :; }
migration_status() { :; }
die() { printf 'DIE:%s\n' "$*" >&2; exit 1; }
compose() {
  if [[ "$*" == *pg_dump* ]]; then return 0; fi
  if [[ "$*" == *db:deploy* ]]; then printf '%s' called > "$DB_DEPLOY_MARKER"; fi
  return 0
}
SERVER_ROOT=/tmp/memoly-selectel-test
mkdir -p "$SERVER_ROOT"
trap 'rm -rf -- "$SERVER_ROOT"' EXIT
DB_DEPLOY_MARKER="$SERVER_ROOT/db-deploy-called"
MEMOLY_PRODUCT_SHA=91735e8b1c52cdcd42c0051dad945d96aa9f0db2
migrate
`
  const harnessPath = resolve(root, 'tests/.selectel-empty-backup-harness.sh')
  const bashHarnessPath = harnessPath.replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll('\\', '/')
  writeFileSync(harnessPath, harness)
  const result = spawnSync('bash', [bashHarnessPath], { encoding: 'utf8', timeout: 30_000 })
  rmSync(harnessPath, { force: true })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /database backup validation failed; migration was not attempted/, `${result.stdout}${result.stderr}`)
  assert.doesNotMatch(result.stdout, /db-deploy-called/)
})

test('Selectel runbook documents the durable directory-mounted gateway model', () => {
  const readme = read('deploy/selectel/README.md')

  assert.match(readme, /memoly-webapp-1/)
  assert.match(readme, /host ports 80\/443/)
  assert.match(readme, /memoly_default/)
  assert.match(readme, /\/opt\/memoly\/gateway\s*:\s*\/etc\/caddy/)
  assert.match(readme, /read-only directory bind/i)
  assert.match(readme, /memoly_caddy_data:\/data/)
  assert.match(readme, /memoly_caddy_config:\/config/)
  assert.match(readme, /one-time reconciliation/i)
  assert.match(readme, /old stopped container.*rollback artifact/i)
  assert.match(readme, /environment-names\.txt/)
  assert.match(readme, /index \(split \. "="\) 0/)
  assert.doesNotMatch(readme, /docker inspect memoly-webapp-1\s*>\s*"\$BACKUP_DIR\/container\.inspect\.json"/)
  assert.match(readme, /caddy validate --config \/etc\/caddy\/Caddyfile/)
  assert.match(readme, /normal root.*static:80/i)
  assert.match(readme, /old single-file bind.*must not return/i)
})
