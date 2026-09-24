#!/usr/bin/env bash
set -Eeuo pipefail

# This script owns only the internal Compose project. The host-port gateway is
# an existing manually managed Caddy container and must remain outside Compose.

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SERVER_ROOT=${SERVER_ROOT:-/opt/memoly}
COMPOSE_FILE=${COMPOSE_FILE:-"$SERVER_ROOT/compose.yml"}
ROLLBACK_ENV=${ROLLBACK_ENV:-"$SERVER_ROOT/rollback.env"}
COMPOSE_PROJECT=${COMPOSE_PROJECT:-memoly}
GATEWAY_CONTAINER=${GATEWAY_CONTAINER:-memoly-webapp-1}
EDGE_NETWORK=${MEMOLY_EDGE_NETWORK:-memoly_default}
PUBLIC_URL=${PUBLIC_URL:-https://app.memoly.ru}
SERVER_EDGE_CADDYFILE=${SERVER_EDGE_CADDYFILE:-"$SERVER_ROOT/gateway/Caddyfile"}
SERVER_STATIC_CADDYFILE=${SERVER_STATIC_CADDYFILE:-"$SERVER_ROOT/Caddyfile.static"}
GATEWAY_CADDYFILE=${GATEWAY_CADDYFILE:-/etc/caddy/Caddyfile}
GATEWAY_CADDY_CONFIG=${GATEWAY_CADDY_CONFIG:-/tmp/memoly-edge-candidate.Caddyfile}
MEMOLY_PUBLIC_HOST=${MEMOLY_PUBLIC_HOST:-}
MEMOLY_PRODUCT_SHA=${MEMOLY_PRODUCT_SHA:-}
export MEMOLY_PRODUCT_SHA
BACKUP_DIR=
EDGE_CANDIDATE=
GATEWAY_BACKUP_FILE=

die() {
	printf 'ERROR: %s\n' "$*" >&2
	exit 1
}

require_command() {
	command -v "$1" >/dev/null 2>&1 || die "required command is missing: $1"
}

acquire_deploy_lock() {
	if [[ "${SELECTEL_DEPLOY_LOCK_FD:-}" =~ ^[0-9]+$ ]]; then
		{ true >&"$SELECTEL_DEPLOY_LOCK_FD"; } 2>/dev/null || die "inherited deployment lock is not open"
		return 0
	fi
	local lock_file="$SERVER_ROOT/.selectel-deploy.lock"
	exec 9>"$lock_file" || die "cannot open deployment lock: $lock_file"
	flock -n 9 || die "another Selectel deployment is already running"
}

compose() {
	docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" "$@"
}

load_secret() {
	local variable=$1 path=$2 value
	[ -r "$path" ] || die "required secret file is missing: $path"
	value=$(<"$path")
	[ -n "$value" ] || die "required secret file is empty: $path"
	export "$variable=$value"
}

load_runtime_secrets() {
	load_secret MAX_BOT_TOKEN "$SERVER_ROOT/secrets/max_bot_token"
	load_secret MAX_WEBHOOK_SECRET "$SERVER_ROOT/secrets/max_webhook_secret"
	load_secret MAX_INBOX_ENCRYPTION_KEY "$SERVER_ROOT/secrets/max_inbox_encryption_key"
}

cleanup_candidate() {
	if [ -n "$EDGE_CANDIDATE" ]; then
		rm -f -- "$EDGE_CANDIDATE"
		EDGE_CANDIDATE=
	fi
}

trap cleanup_candidate EXIT

backup_server_state() {
	local container_ids
	[ -n "$BACKUP_DIR" ] && return 0
	BACKUP_DIR="$SERVER_ROOT/backups/compose.pre-selectel-$(date -u +%Y%m%dT%H%M%SZ)"
	mkdir -p "$BACKUP_DIR"
	for path in "$COMPOSE_FILE" "$SERVER_EDGE_CADDYFILE" "$SERVER_STATIC_CADDYFILE"; do
		[ -f "$path" ] && cp -p "$path" "$BACKUP_DIR/$(basename "$path")"
	done
	[ -f "$SERVER_EDGE_CADDYFILE" ] && GATEWAY_BACKUP_FILE="$BACKUP_DIR/$(basename "$SERVER_EDGE_CADDYFILE")"
	docker ps -a --format '{{.ID}} {{.Names}} {{.Image}} {{.Status}} {{.Ports}}' > "$BACKUP_DIR/container-inventory.txt"
	container_ids=$(docker ps -aq)
	if [ -n "$container_ids" ]; then
		docker inspect --format '{{.Name}} image={{.Config.Image}} restart={{json .HostConfig.RestartPolicy}} networks={{json .NetworkSettings.Networks}} mounts={{range .Mounts}}{{.Source}}:{{.Destination}};{{end}}' $container_ids > "$BACKUP_DIR/container-runtime-inventory.txt"
	else
		: > "$BACKUP_DIR/container-runtime-inventory.txt"
	fi
	printf 'Saved non-secret deployment backup in %s\n' "$BACKUP_DIR"
}

backup_gateway_caddyfile() {
	[ -f "$SERVER_EDGE_CADDYFILE" ] || die "active gateway Caddyfile is missing: $SERVER_EDGE_CADDYFILE"
	[ ! -L "$SERVER_EDGE_CADDYFILE" ] || die "active gateway Caddyfile must be a regular file: $SERVER_EDGE_CADDYFILE"
	[ -n "$BACKUP_DIR" ] || backup_server_state
	GATEWAY_BACKUP_FILE="$BACKUP_DIR/$(basename "$SERVER_EDGE_CADDYFILE")"
	cp -p -- "$SERVER_EDGE_CADDYFILE" "$GATEWAY_BACKUP_FILE"
	[ -f "$GATEWAY_BACKUP_FILE" ] || die "gateway Caddyfile backup is missing"
}

render_edge_candidate() {
	local edge_pattern='\${MEMOLY_PUBLIC_HOST:?set MEMOLY_PUBLIC_HOST}'
	[ -n "$MEMOLY_PUBLIC_HOST" ] || die "MEMOLY_PUBLIC_HOST is not set"
	case "$MEMOLY_PUBLIC_HOST" in
		*[!A-Za-z0-9.-]*) die "MEMOLY_PUBLIC_HOST must be a hostname" ;;
	esac
	cleanup_candidate
	EDGE_CANDIDATE=$(mktemp)
	sed "s|$edge_pattern|$MEMOLY_PUBLIC_HOST|g" "$SCRIPT_DIR/Caddyfile.edge.template" > "$EDGE_CANDIDATE"
}

validate_candidate_caddy() {
	[ -n "$EDGE_CANDIDATE" ] || die "edge candidate has not been rendered"
	docker cp "$EDGE_CANDIDATE" "$GATEWAY_CONTAINER:$GATEWAY_CADDY_CONFIG"
	docker exec "$GATEWAY_CONTAINER" caddy validate --config "$GATEWAY_CADDY_CONFIG" --adapter caddyfile
}

install_internal_config() {
	local compose_tmp static_tmp
	[ -f "$SCRIPT_DIR/compose.yml.template" ] || die "tracked Compose template is missing"
	[ -f "$SCRIPT_DIR/Caddyfile.static.template" ] || die "tracked static Caddy template is missing"
	compose_tmp="$COMPOSE_FILE.tmp.$$"
	static_tmp="$SERVER_STATIC_CADDYFILE.tmp.$$"
	install -m 0644 "$SCRIPT_DIR/compose.yml.template" "$compose_tmp"
	install -m 0644 "$SCRIPT_DIR/Caddyfile.static.template" "$static_tmp"
	docker compose -f "$compose_tmp" -p "$COMPOSE_PROJECT" config >/dev/null
	mv -f "$compose_tmp" "$COMPOSE_FILE"
	mv -f "$static_tmp" "$SERVER_STATIC_CADDYFILE"
	compose config >/dev/null
}

activate_gateway() {
	local active_inode_before active_inode_after candidate_sha host_sha container_sha
	[ -n "$EDGE_CANDIDATE" ] || die "edge candidate has not been rendered"
	[ -f "$SERVER_EDGE_CADDYFILE" ] || die "active gateway Caddyfile is missing: $SERVER_EDGE_CADDYFILE"
	[ ! -L "$SERVER_EDGE_CADDYFILE" ] || die "active gateway Caddyfile must be a regular file: $SERVER_EDGE_CADDYFILE"
	validate_candidate_caddy
	backup_gateway_caddyfile
	active_inode_before=$(stat -c '%i' -- "$SERVER_EDGE_CADDYFILE")
	candidate_sha=$(sha256sum "$EDGE_CANDIDATE" | awk '{print $1}')

	if ! bash "$SCRIPT_DIR/in-place-file.sh" activate "$EDGE_CANDIDATE" "$SERVER_EDGE_CADDYFILE"; then
		gateway_activation_failure "in-place Caddyfile activation failed"
		return 1
	fi
	if ! active_inode_after=$(stat -c '%i' -- "$SERVER_EDGE_CADDYFILE"); then
		gateway_activation_failure "cannot inspect active Caddyfile inode after activation"
		return 1
	fi
	if [ "$active_inode_before" != "$active_inode_after" ]; then
		gateway_activation_failure "active Caddyfile inode changed during activation"
		return 1
	fi
	if ! host_sha=$(sha256sum "$SERVER_EDGE_CADDYFILE" | awk '{print $1}'); then
		gateway_activation_failure "cannot checksum active Caddyfile after activation"
		return 1
	fi
	if [ "$host_sha" != "$candidate_sha" ]; then
		gateway_activation_failure "active Caddyfile checksum does not match candidate"
		return 1
	fi
	if ! container_sha=$(docker exec "$GATEWAY_CONTAINER" sha256sum "$GATEWAY_CADDYFILE" | awk '{print $1}'); then
		gateway_activation_failure "cannot checksum mounted Caddyfile inside gateway"
		return 1
	fi
	if [ "$container_sha" != "$host_sha" ]; then
		gateway_activation_failure "gateway-mounted Caddyfile checksum does not match host"
		return 1
	fi
	if ! docker exec "$GATEWAY_CONTAINER" caddy reload --config "$GATEWAY_CADDYFILE" --adapter caddyfile; then
		gateway_activation_failure "Caddy reload failed after activation"
		return 1
	fi
	printf 'Activated gateway Caddyfile in place (inode %s; checksum %s); reload passed.\n' "$active_inode_after" "$host_sha"
}

gateway_public_health() {
	local path
	for path in / /health/live /health/ready; do
		curl --fail --silent --show-error --max-time 5 "${PUBLIC_URL%/}${path}" >/dev/null || return 1
	done
}

gateway_container_matches_host() {
	local host_sha container_sha
	host_sha=$(sha256sum "$SERVER_EDGE_CADDYFILE" | awk '{print $1}')
	container_sha=$(docker exec "$GATEWAY_CONTAINER" sha256sum "$GATEWAY_CADDYFILE" | awk '{print $1}')
	[ "$container_sha" = "$host_sha" ]
}

gateway_activation_failure() {
	local reason=$1 rollback_ok=1
	printf 'ERROR: %s\n' "$reason" >&2
	if [ -z "$GATEWAY_BACKUP_FILE" ] || [ ! -f "$GATEWAY_BACKUP_FILE" ]; then
		printf 'ERROR: gateway rollback backup is unavailable\n' >&2
		rollback_ok=0
	elif ! bash "$SCRIPT_DIR/in-place-file.sh" restore "$GATEWAY_BACKUP_FILE" "$SERVER_EDGE_CADDYFILE"; then
		printf 'ERROR: in-place gateway Caddyfile rollback failed\n' >&2
		rollback_ok=0
	elif ! gateway_container_matches_host; then
		printf 'ERROR: gateway-mounted Caddyfile checksum does not match restored host content\n' >&2
		rollback_ok=0
	elif ! docker exec "$GATEWAY_CONTAINER" caddy validate --config "$GATEWAY_CADDYFILE" --adapter caddyfile; then
		printf 'ERROR: rolled-back gateway Caddyfile validation failed\n' >&2
		rollback_ok=0
	elif ! docker exec "$GATEWAY_CONTAINER" caddy reload --config "$GATEWAY_CADDYFILE" --adapter caddyfile; then
		printf 'ERROR: rolled-back gateway Caddyfile reload failed\n' >&2
		rollback_ok=0
	elif ! gateway_public_health; then
		printf 'ERROR: public health failed after gateway Caddyfile rollback\n' >&2
		rollback_ok=0
	fi
	if [ "$rollback_ok" -eq 1 ]; then
		printf 'ROLLED_BACK_AFTER_CADDY_ACTIVATION_FAILURE\n' >&2
	else
		printf 'CADDY_ROLLBACK_FAILED_AFTER_ACTIVATION_FAILURE\n' >&2
	fi
}

gateway_preflight() {
	local status labels networks gateway_mount
	status=$(docker inspect --format '{{.State.Status}}' "$GATEWAY_CONTAINER" 2>/dev/null) || die "configured gateway is missing: $GATEWAY_CONTAINER"
	[ "$status" = running ] || die "configured gateway is not running: $GATEWAY_CONTAINER ($status)"
	[ -f "$SERVER_EDGE_CADDYFILE" ] || die "active gateway Caddyfile is missing: $SERVER_EDGE_CADDYFILE"
	[ ! -L "$SERVER_EDGE_CADDYFILE" ] || die "active gateway Caddyfile must be a regular file: $SERVER_EDGE_CADDYFILE"

	labels=$(docker inspect --format '{{json .Config.Labels}}' "$GATEWAY_CONTAINER")
	case "$labels" in
		*com.docker.compose.project*|*com.docker.compose.service*)
			die "gateway has Compose ownership labels; refuse deployment until ownership is unambiguous"
			;;
	esac

	docker network inspect "$EDGE_NETWORK" >/dev/null 2>&1 || die "configured edge network is missing: $EDGE_NETWORK"
	networks=$(docker inspect --format '{{json .NetworkSettings.Networks}}' "$GATEWAY_CONTAINER")
	case "$networks" in
		*"\"$EDGE_NETWORK\""*) ;;
		*) die "gateway is not attached to edge network: $EDGE_NETWORK" ;;
	esac
	gateway_mount=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Type}}|{{.Source}}|{{.RW}}{{end}}{{end}}' "$GATEWAY_CONTAINER")
	[ "$gateway_mount" = "bind|$SERVER_ROOT/gateway|false" ] || die "gateway must use the read-only directory bind $SERVER_ROOT/gateway:/etc/caddy:ro"
}

validate_inputs() {
	local mode=${1:-current}
	[ -f "$COMPOSE_FILE" ] || die "Compose template is missing: $COMPOSE_FILE"
	[ -n "${MEMOLY_BACKEND_IMAGE_TAG:-}" ] || die "MEMOLY_BACKEND_IMAGE_TAG is not set"
	[ -n "${MEMOLY_WEBAPP_IMAGE_TAG:-}" ] || die "MEMOLY_WEBAPP_IMAGE_TAG is not set"
	for tag_name in MEMOLY_BACKEND_IMAGE_TAG MEMOLY_WEBAPP_IMAGE_TAG; do
		local tag=${!tag_name}
		[ "${#tag}" -eq 40 ] || die "$tag_name must be a 40-character lowercase Git SHA"
		case "$tag" in
			*[!a-f0-9]*) die "$tag_name must be a 40-character lowercase Git SHA" ;;
		esac
	done
	if [ "$mode" = current ]; then
		[ -n "$MEMOLY_PRODUCT_SHA" ] || die "MEMOLY_PRODUCT_SHA is not set"
		[ "${#MEMOLY_PRODUCT_SHA}" -eq 40 ] || die "MEMOLY_PRODUCT_SHA must be a 40-character lowercase Git SHA"
		case "$MEMOLY_PRODUCT_SHA" in
			*[!a-f0-9]*) die "MEMOLY_PRODUCT_SHA must be a 40-character lowercase Git SHA" ;;
		esac
		[ "$MEMOLY_BACKEND_IMAGE_TAG" = "$MEMOLY_PRODUCT_SHA" ] || die "backend image tag must equal MEMOLY_PRODUCT_SHA"
		[ "$MEMOLY_WEBAPP_IMAGE_TAG" = "$MEMOLY_PRODUCT_SHA" ] || die "webapp image tag must equal MEMOLY_PRODUCT_SHA"
	fi
	docker image inspect "memoly-backend:$MEMOLY_BACKEND_IMAGE_TAG" >/dev/null 2>&1 || die "immutable backend image is not present locally: memoly-backend:$MEMOLY_BACKEND_IMAGE_TAG"
	docker image inspect "memoly-webapp:$MEMOLY_WEBAPP_IMAGE_TAG" >/dev/null 2>&1 || die "immutable webapp image is not present locally: memoly-webapp:$MEMOLY_WEBAPP_IMAGE_TAG"
}

preflight() {
	require_command docker
	load_runtime_secrets
	validate_inputs
	gateway_preflight
	[ -f "$SCRIPT_DIR/Caddyfile.edge.template" ] || die "edge Caddy template is missing"
	[ -f "$SCRIPT_DIR/Caddyfile.static.template" ] || die "static Caddy template is missing"
	render_edge_candidate
	validate_candidate_caddy
	cleanup_candidate
	compose config >/dev/null
	printf 'Preflight passed: gateway is unmanaged, edge network is shared, candidate Caddy is valid.\n'
}

prepare_configuration() {
	render_edge_candidate
	validate_candidate_caddy
	backup_server_state
	install_internal_config
	printf 'Installed tracked Compose and static Caddy configuration after backup; live edge Caddy remains unchanged.\n'
}

migration_status() {
	compose run --rm --no-deps backend bunx prisma migrate status
}

validate_database_target() {
	local backend_target postgres_database postgres_user
	backend_target=$(compose run --rm --no-deps backend bun -e 'const raw = process.env.DATABASE_URL ?? ""; let url; try { url = new URL(raw) } catch { process.exit(2) }; const fail = () => process.exit(2); if (!(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "postgres" && (url.port || "5432") === "5432" && url.hash === "")) fail(); const params = [...url.searchParams.entries()]; if (params.length > 1 || (params.length === 1 && (params[0][0] !== "schema" || params[0][1] !== "public"))) fail(); let database; let username; try { database = decodeURIComponent(url.pathname.replace(/^\//, "")); username = decodeURIComponent(url.username) } catch { fail() }; if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(database) || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(username)) fail(); process.stdout.write(`${url.hostname}|${url.port || "5432"}|${database}|${username}`)' 2>/dev/null) || die "cannot inspect backend database target"
	postgres_database=$(compose exec -T postgres sh -c 'printf "%s" "$POSTGRES_DB"' 2>/dev/null) || die "cannot inspect Compose PostgreSQL target"
	postgres_user=$(compose exec -T postgres sh -c 'printf "%s" "$POSTGRES_USER"' 2>/dev/null) || die "cannot inspect Compose PostgreSQL user"
	[ "$backend_target" = "postgres|5432|$postgres_database|$postgres_user" ] || die "backend DATABASE_URL does not target the Compose postgres database; migration was not attempted"
}

backup_database() {
	local timestamp dump_file temp_file toc_file magic
	install -d -m 0700 "$SERVER_ROOT/backups" || die "cannot create database backup directory"
	chmod 0700 "$SERVER_ROOT/backups" || die "cannot secure database backup directory"
	timestamp=$(date -u +%Y%m%dT%H%M%SZ)
	dump_file="$SERVER_ROOT/backups/postgres-${MEMOLY_PRODUCT_SHA}-${timestamp}.dump"
	temp_file="${dump_file}.tmp.$$"
	[ ! -e "$dump_file" ] && [ ! -L "$dump_file" ] || die "database backup already exists: $(basename "$dump_file")"
	install -m 0600 /dev/null "$temp_file" || die "cannot create database backup file"
	if ! compose exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --host=127.0.0.1 --username="$POSTGRES_USER" --format=custom --dbname="$POSTGRES_DB"' >"$temp_file" 2>/dev/null; then
		rm -f -- "$temp_file"
		die "database backup failed; migration was not attempted"
	fi
	chmod 0600 "$temp_file" || {
		rm -f -- "$temp_file"
		die "cannot secure database backup file"
	}
	if [ ! -s "$temp_file" ]; then
		rm -f -- "$temp_file"
		die "database backup validation failed; migration was not attempted"
	fi
	magic=$(dd if="$temp_file" bs=1 count=5 2>/dev/null) || {
		rm -f -- "$temp_file"
		die "database backup validation failed; migration was not attempted"
	}
	if [ "$magic" != PGDMP ]; then
		rm -f -- "$temp_file"
		die "database backup validation failed; migration was not attempted"
	fi
	toc_file="${temp_file}.toc"
	install -m 0600 /dev/null "$toc_file"
	if ! compose exec -T postgres pg_restore --list >"$toc_file" <"$temp_file" 2>/dev/null || [ ! -s "$toc_file" ]; then
		rm -f -- "$temp_file"
		rm -f -- "$toc_file"
		die "database backup validation failed; migration was not attempted"
	fi
	rm -f -- "$toc_file"
	mv -- "$temp_file" "$dump_file" || {
		rm -f -- "$temp_file"
		die "cannot finalize database backup file; migration was not attempted"
	}
	printf 'Database backup created and validated: %s\n' "$(basename "$dump_file")"
}

migrate() {
	preflight
	validate_database_target
	backup_database
	if ! compose run --rm --no-deps backend bun run db:deploy >/dev/null 2>&1; then
		die "database migration failed; application services were not promoted"
	fi
	if ! migration_status >/dev/null 2>&1; then
		die "database migration status failed; application services were not promoted"
	fi
	printf 'Database migration complete. Application services were not promoted.\n'
}

promote_backend() {
	compose up -d --no-deps --force-recreate backend
}

promote_jobs() {
	compose up -d --no-deps --force-recreate worker scheduler
}

promote_static() {
	compose up -d --no-deps --force-recreate static
}

wait_backend_internal() {
	local endpoint attempts
	for endpoint in /health/live /health/ready; do
		attempts=${1:-30}
		while [ "$attempts" -gt 0 ]; do
			if compose exec -T backend bun -e "const r = await fetch('http://127.0.0.1:3000${endpoint}'); process.exit(r.ok ? 0 : 1)" >/dev/null 2>&1; then
				break
			fi
			attempts=$((attempts - 1))
			sleep 2
		done
		[ "$attempts" -gt 0 ] || die "backend internal readiness check failed: $endpoint"
	done
}

verify_static_internal() {
	compose exec -T backend bun -e "const r = await fetch('http://static:80/'); process.exit(r.ok ? 0 : 1)" >/dev/null 2>&1 || die "static internal readiness check failed"
}

wait_public() {
	local path=$1 attempts=${2:-30} url
	url="${PUBLIC_URL%/}${path}"
	while [ "$attempts" -gt 0 ]; do
		if curl --fail --silent --show-error --max-time 5 "$url" >/dev/null; then
			return 0
		fi
		attempts=$((attempts - 1))
		sleep 2
	done
	die "public readiness check failed: $url"
}

readiness() {
	local running service
	running=$(compose ps --status running --services)
	for service in backend worker scheduler static; do
		case $'\n'"$running"$'\n' in
			*$'\n'"$service"$'\n'*) ;;
			*) die "required Compose service is not running: $service" ;;
		esac
	done
	wait_public /health/live
	wait_public /health/ready
	wait_public /
}

rollback() {
	[ -f "$ROLLBACK_ENV" ] || die "rollback env is missing: $ROLLBACK_ENV"
	# shellcheck disable=SC1090
	set -a
	. "$ROLLBACK_ENV"
	set +a
	[ "${MEMOLY_DB_ROLLBACK_ALLOWED:-false}" = false ] || die "database rollback is forbidden"
	[ -n "${PREVIOUS_BACKEND_IMAGE_TAG:-}" ] || die "previous backend image tag is missing"
	[ -n "${PREVIOUS_WEBAPP_IMAGE_TAG:-}" ] || die "previous webapp image tag is missing"
	export MEMOLY_BACKEND_IMAGE_TAG="$PREVIOUS_BACKEND_IMAGE_TAG"
	export MEMOLY_WEBAPP_IMAGE_TAG="$PREVIOUS_WEBAPP_IMAGE_TAG"
	case "$MEMOLY_BACKEND_IMAGE_TAG $MEMOLY_WEBAPP_IMAGE_TAG" in
		*__SET_*|*latest*) die "rollback tags must be immutable, not placeholders or latest" ;;
	esac
	load_runtime_secrets
	validate_inputs rollback
	gateway_preflight
	compose config >/dev/null
	compose up -d --no-deps --force-recreate backend worker scheduler static
	wait_backend_internal
	verify_static_internal
	render_edge_candidate
	validate_candidate_caddy
	activate_gateway
	cleanup_candidate
	readiness
	printf 'Application rollback complete; additive migrations remain applied.\n'
}

deploy() {
	preflight
	prepare_configuration
	migration_status
	promote_backend
	wait_backend_internal
	promote_jobs
	promote_static
	verify_static_internal
	activate_gateway
	readiness
	printf 'Promotion complete. Previous images remain available for rollback.\n'
}

usage() {
	cat <<'EOF'
Usage: redeploy.sh {preflight|migrate|deploy|rollback|migration-status}

Environment: SERVER_ROOT COMPOSE_FILE ROLLBACK_ENV COMPOSE_PROJECT
GATEWAY_CONTAINER MEMOLY_EDGE_NETWORK MEMOLY_PRODUCT_SHA MEMOLY_BACKEND_IMAGE_TAG MEMOLY_WEBAPP_IMAGE_TAG PUBLIC_URL
EOF
}

main() {
	local action=${1:-}
	require_command curl
	require_command flock
	acquire_deploy_lock
	case "$action" in
		preflight) preflight ;;
		deploy) deploy ;;
		rollback) rollback ;;
		migration-status) require_command docker; load_runtime_secrets; validate_inputs; migration_status ;;
		migrate) require_command docker; migrate ;;
		reload-gateway) die "reload-gateway is disabled; use deploy so static readiness gates edge activation" ;;
		*) usage; exit 2 ;;
	esac
}

main "$@"
