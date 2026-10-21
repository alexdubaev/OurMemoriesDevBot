#!/usr/bin/env bash
set -Eeuo pipefail

# This script owns only the internal Compose project. The host-port gateway is
# an existing manually managed Caddy container and must remain outside Compose.

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SERVER_ROOT=${SERVER_ROOT:-/opt/memoly}
APP_ROOT=${APP_ROOT:-$SERVER_ROOT/app}
B2_RUNTIME_SHA=79d85d6456fd46c56d15ff2b6fccba9cedfd4c6c
MM0_RUNTIME_SHA=0074d04c8e7f88b2327b56cea10ca38647d36190
MM0_FORWARD_MARKER=${MM0_FORWARD_MARKER:-$SERVER_ROOT/.selectel-mm0-forward-only}
MM0_SPIKE_CONTAINER=memoly-spike-max-video-backend-1
FORWARD_MARKER=${FORWARD_MARKER:-$SERVER_ROOT/.selectel-b2-forward-only}
COMPOSE_FILE=${COMPOSE_FILE:-"$SERVER_ROOT/compose.yml"}
ROLLBACK_ENV=${ROLLBACK_ENV:-"$SERVER_ROOT/rollback.env"}
COMPOSE_PROJECT=${COMPOSE_PROJECT:-memoly}
GATEWAY_CONTAINER=${GATEWAY_CONTAINER:-memoly-webapp-1}
EDGE_NETWORK=${MEMOLY_EDGE_NETWORK:-memoly_default}
PUBLIC_URL=${PUBLIC_URL:-https://app.memoly.ru}
SERVER_EDGE_CADDYFILE=${SERVER_EDGE_CADDYFILE:-"$SERVER_ROOT/gateway/Caddyfile"}
SERVER_STATIC_CADDYFILE=${SERVER_STATIC_CADDYFILE:-"$SERVER_ROOT/Caddyfile.static"}
CONFIG_BACKUP_MARKER=${CONFIG_BACKUP_MARKER:-"$SERVER_ROOT/.selectel-config-backup"}
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
		local inherited_fd_target expected_lock
		expected_lock=$(readlink -f -- "$SERVER_ROOT/.selectel-deploy.lock") || die "deployment lock path is unavailable"
		inherited_fd_target=$(readlink "/proc/self/fd/$SELECTEL_DEPLOY_LOCK_FD" 2>/dev/null || true)
		[ "$inherited_fd_target" = "$expected_lock" ] || die "inherited deployment lock does not reference the expected lock file"
		{ true >&"$SELECTEL_DEPLOY_LOCK_FD"; } 2>/dev/null || die "inherited deployment lock is not open"
		flock -n "$SELECTEL_DEPLOY_LOCK_FD" || die "inherited deployment lock is not held"
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
	for path in compose.yml Caddyfile Caddyfile.static; do
		[ -f "$BACKUP_DIR/$path" ] || die "deployment backup is missing: $path"
	done
	local marker_tmp="$CONFIG_BACKUP_MARKER.tmp.$$"
	install -m 0600 /dev/null "$marker_tmp"
	printf '%s\n' "$BACKUP_DIR" > "$marker_tmp"
	mv -f -- "$marker_tmp" "$CONFIG_BACKUP_MARKER"
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

validate_rollback_file() {
	[ -f "$ROLLBACK_ENV" ] || die "rollback env is missing: $ROLLBACK_ENV"
	[ ! -L "$ROLLBACK_ENV" ] || die "rollback env must be a regular file: $ROLLBACK_ENV"
	[ "$(stat -c '%u' "$ROLLBACK_ENV")" = 0 ] || die 'rollback env must be owned by root'
	[ "$(stat -c '%a' "$ROLLBACK_ENV")" = 600 ] || die 'rollback env must have mode 0600'
}

configuration_backup_dir() {
	local backup_dir marker_mode
	[ -f "$CONFIG_BACKUP_MARKER" ] || die "configuration backup marker is missing: $CONFIG_BACKUP_MARKER"
	[ ! -L "$CONFIG_BACKUP_MARKER" ] || die 'configuration backup marker must be a regular file'
	[ "$(stat -c '%u' "$CONFIG_BACKUP_MARKER")" = 0 ] || die 'configuration backup marker must be owned by root'
	marker_mode=$(stat -c '%a' "$CONFIG_BACKUP_MARKER")
	[ "$marker_mode" = 600 ] || die 'configuration backup marker must have mode 0600'
	backup_dir=$(<"$CONFIG_BACKUP_MARKER")
	case "$backup_dir" in
		"$SERVER_ROOT/backups/compose.pre-selectel-"*) ;;
		*) die 'configuration backup marker points outside the Selectel backup directory' ;;
	esac
	[ -f "$backup_dir/compose.yml" ] || die 'configuration backup is missing: compose.yml'
	[ -f "$backup_dir/Caddyfile" ] || die 'configuration backup is missing: Caddyfile'
	[ -f "$backup_dir/Caddyfile.static" ] || die 'configuration backup is missing: Caddyfile.static'
	printf '%s\n' "$backup_dir"
}

restore_configuration_backup() {
	local backup_dir
	backup_dir=$(configuration_backup_dir) || die 'configuration backup is unavailable'
	cp -p -- "$backup_dir/compose.yml" "$COMPOSE_FILE"
	cp -p -- "$backup_dir/Caddyfile" "$SERVER_EDGE_CADDYFILE"
	cp -p -- "$backup_dir/Caddyfile.static" "$SERVER_STATIC_CADDYFILE"
	printf 'Restored release-owned Compose and Caddy configuration from %s.\n' "$(basename "$backup_dir")"
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
	if [ "${ROLLBACK_AUTH_GATE:-false}" = true ]; then
		local gated
		gated=$(mktemp)
		awk '
			/^[[:space:]]*handle \/api\/\* \{/ {
				print "\t# rollback_auth_maintenance: old runtime must not reintroduce F12."
				print "\thandle /api/v1/auth/* {"
				print "\t\t@rollback_safe_auth path /api/v1/auth/me /api/v1/auth/logout"
				print "\t\thandle @rollback_safe_auth {"
				print "\t\t\treverse_proxy memoly-backend-1:3000"
				print "\t\t}"
				print "\t\thandle {"
				print "\t\t\trespond \"Authentication temporarily unavailable during safe recovery\" 503"
				print "\t\t}"
				print "\t}"
				inserted=1
			}
			{ print }
			END { if (!inserted) exit 1 }
		' "$EDGE_CANDIDATE" > "$gated" || { rm -f -- "$gated"; die 'cannot render rollback authentication gate'; }
		mv -- "$gated" "$EDGE_CANDIDATE"
	fi
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

validate_forward_marker() {
	[ -f "$FORWARD_MARKER" ] && [ ! -L "$FORWARD_MARKER" ] || die 'forward-only marker is missing or invalid'
	[ "$(stat -c '%u' "$FORWARD_MARKER")" = 0 ] || die 'forward-only marker must be root-owned'
	[ "$(stat -c '%a' "$FORWARD_MARKER")" = 600 ] || die 'forward-only marker must have mode 0600'
	local -a lines
	mapfile -t lines < "$FORWARD_MARKER"
	[ "${#lines[@]}" -eq 3 ] || die 'forward-only marker has an invalid format'
	if [ "$FORWARD_MARKER" = "$MM0_FORWARD_MARKER" ]; then
		[[ "${lines[0]}" =~ ^MM0_FORWARD_ONLY_TARGET=([0-9a-f]{40})$ ]] || die 'MM0 forward-only target is invalid'
	else
		[[ "${lines[0]}" =~ ^B2_FORWARD_ONLY_TARGET=([0-9a-f]{40})$ ]] || die 'B2 forward-only target is invalid'
	fi
	local marker_target=${BASH_REMATCH[1]}
	[[ "${lines[1]}" =~ ^PREVIOUS_BACKEND_IMAGE_TAG=([0-9a-f]{40})$ ]] || die 'B2 previous backend tag is invalid'
	local previous_backend=${BASH_REMATCH[1]}
	[[ "${lines[2]}" =~ ^PREVIOUS_WEBAPP_IMAGE_TAG=([0-9a-f]{40})$ ]] || die 'B2 previous webapp tag is invalid'
	git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" merge-base --is-ancestor "$marker_target" "$MEMOLY_PRODUCT_SHA" ||
		die 'B2 forward-only marker does not match this release lineage'
	local boundary_sha=$B2_RUNTIME_SHA
	[ "$FORWARD_MARKER" = "$MM0_FORWARD_MARKER" ] && boundary_sha=$MM0_RUNTIME_SHA
	if git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" merge-base --is-ancestor "$boundary_sha" "$previous_backend"; then
		die 'forward-only marker does not record a legacy backend'
	fi
}

verify_no_legacy_writers() {
	local service running container image
	for service in backend worker scheduler; do
		running=$(docker ps -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
			--filter "label=com.docker.compose.service=$service")
		for container in $running; do
			image=$(docker inspect --format '{{.Config.Image}}' "$container") || die "cannot verify $service image"
			[ "$image" = "memoly-backend:$MEMOLY_PRODUCT_SHA" ] || die "legacy $service is still running; migration is forbidden"
		done
	done
	if [ "${MM0_BOUNDARY:-false}" = true ] || [ "$FORWARD_MARKER" = "$MM0_FORWARD_MARKER" ]; then
		verify_mm0_spike_stopped
	fi
}

mm0_spike_id() {
	local ids
	ids=$(docker ps -q --filter "name=^/${MM0_SPIKE_CONTAINER}$") || die 'cannot enumerate MAX video spike writer'
	[ "$(printf '%s\n' "$ids" | awk 'NF { count += 1 } END { print count + 0 }')" -le 1 ] ||
		die 'MAX video spike writer identity is ambiguous'
	printf '%s\n' "$ids"
}

mm0_spike_relation() {
	local spike_id=$1 postgres_ids postgres_database spike_target database_script
	# Return only a normalized host/port/database tuple. Credentials never leave either container.
	database_script='const raw = process.env.DATABASE_URL ?? ""; let url; try { url = new URL(raw) } catch { process.exit(2) }; if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hash) process.exit(2); const params = [...url.searchParams.entries()]; if (params.length > 1 || (params.length === 1 && (params[0][0] !== "schema" || params[0][1] !== "public"))) process.exit(2); let database; try { database = decodeURIComponent(url.pathname.slice(1)) } catch { process.exit(2) }; if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(database)) process.exit(2); process.stdout.write(`${url.hostname}|${url.port || "5432"}|${database}`)'
	postgres_ids=$(docker ps -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
		--filter 'label=com.docker.compose.service=postgres') || die 'cannot enumerate production PostgreSQL service'
	[ "$(printf '%s\n' "$postgres_ids" | awk 'NF { count += 1 } END { print count + 0 }')" -eq 1 ] ||
		die 'production PostgreSQL service identity is ambiguous'
	postgres_database=$(docker exec "$postgres_ids" sh -c 'printf "%s" "$POSTGRES_DB"' 2>/dev/null) ||
		die 'cannot determine production PostgreSQL database name'
	[[ "$postgres_database" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] ||
		die 'production PostgreSQL database name is invalid'
	spike_target=$(docker exec "$spike_id" bun -e "$database_script" 2>/dev/null) ||
		die 'cannot determine MAX video spike database target; MM0 migration is forbidden'
	if [ "$spike_target" = "postgres|5432|$postgres_database" ]; then
		printf 'same\n'
	elif [[ "$spike_target" == postgres\|5432\|* ]]; then
		printf 'different\n'
	else
		die 'MAX video spike database relation is ambiguous; MM0 migration is forbidden'
	fi
}

verify_mm0_spike_stopped() {
	local spike_id relation
	spike_id=$(mm0_spike_id) || die 'cannot inspect MAX video spike writer'
	[ -n "$spike_id" ] || return 0
	relation=$(mm0_spike_relation "$spike_id") || die 'cannot classify MAX video spike database target'
	[ "$relation" = different ] || die 'MAX video spike writer still targets the production database; MM0 migration is forbidden'
}

precheck_mm0_spike_relation() {
	local spike_id
	spike_id=$(mm0_spike_id) || die 'cannot inspect MAX video spike writer before MM0 backup'
	[ -n "$spike_id" ] || return 0
	mm0_spike_relation "$spike_id" >/dev/null || die 'cannot classify MAX video spike database target before MM0 migration'
}

quiesce_mm0_spike() {
	local spike_id relation
	spike_id=$(mm0_spike_id) || die 'cannot inspect MAX video spike writer'
	[ -n "$spike_id" ] || return 0
	if relation=$(mm0_spike_relation "$spike_id"); then
		[ "$relation" = different ] && return 0
	elif [ "${1:-}" != emergency ]; then
		die 'cannot classify MAX video spike database target; MM0 migration is forbidden'
	fi
	docker update --restart=no "$spike_id" >/dev/null || die 'cannot disable MAX video spike restart policy'
	docker stop --time 30 "$spike_id" >/dev/null || die 'cannot stop MAX video spike writer'
	spike_id=$(mm0_spike_id) || die 'cannot verify MAX video spike writer is stopped'
	[ -z "$spike_id" ] || die 'MAX video spike writer is still running'
}

guard_membership_transition() {
	[ "${SELECTEL_CI_RELEASE:-false}" = true ] && [[ "${SELECTEL_DEPLOY_LOCK_FD:-}" =~ ^[0-9]+$ ]] ||
		die 'migration and promotion require the guarded ci-release entry point and inherited release lock'
	[[ "$MEMOLY_PRODUCT_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'B2 release guard requires an immutable release SHA'
	[ "$(git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" rev-parse refs/remotes/origin/main)" = "$MEMOLY_PRODUCT_SHA" ] ||
		die 'migration and promotion require the accepted origin/main SHA'
	[ "$(git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" rev-parse HEAD)" = "$MEMOLY_PRODUCT_SHA" ] ||
		die 'migration and promotion require the checked-out release SHA'
	git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" cat-file -e "$MEMOLY_PRODUCT_SHA^{commit}" ||
		die 'B2 release guard cannot verify the target commit'
	git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" cat-file -e "$B2_RUNTIME_SHA^{commit}" ||
		die 'B2 release guard cannot verify the accepted B2 commit'
	if ! git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" merge-base --is-ancestor "$B2_RUNTIME_SHA" "$MEMOLY_PRODUCT_SHA"; then
		die 'target predates the accepted B2 runtime; use a reviewed compatible release'
	fi
	[ "${1:-}" = backup ] && return 0
	if [ -e "$FORWARD_MARKER" ]; then
		validate_forward_marker
		verify_no_legacy_writers
		return 0
	fi
	[ ! -e "$MM0_FORWARD_MARKER" ] || die 'MM0 forward-only release requires guarded forward recovery'
	local service running image tag
	for service in backend worker scheduler; do
		running=$(docker ps -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
			--filter "label=com.docker.compose.service=$service")
		[ "$(printf '%s\n' "$running" | awk 'NF { count += 1 } END { print count + 0 }')" -eq 1 ] ||
			die "B2 release without a forward-only marker requires one running compatible $service"
		image=$(docker inspect --format '{{.Config.Image}}' "$running") || die "cannot inspect $service image"
		case "$image" in
			memoly-backend:*) tag=${image#memoly-backend:} ;;
			*) die "running $service does not use an immutable backend image" ;;
		esac
		[[ "$tag" =~ ^[0-9a-f]{40}$ ]] || die "running $service image tag is invalid"
		git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" merge-base --is-ancestor "$B2_RUNTIME_SHA" "$tag" ||
			die "running $service predates B2; use the guarded ci-release entry point"
		git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" merge-base --is-ancestor "$tag" "$MEMOLY_PRODUCT_SHA" ||
			die "running $service is not an ancestor of this release; downgrade is forbidden"
	done
}

quiesce_legacy_runtime() {
	[[ "$MEMOLY_PRODUCT_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'quiescence requires the accepted immutable release SHA'
	validate_forward_marker
	local service running container image
	for service in backend worker scheduler; do
		running=$(docker ps -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
			--filter "label=com.docker.compose.service=$service")
		for container in $running; do
			image=$(docker inspect --format '{{.Config.Image}}' "$container") || die "cannot inspect $service image"
			if [ "$image" != "memoly-backend:$MEMOLY_PRODUCT_SHA" ]; then
				docker stop --time 30 "$container" >/dev/null || die "cannot stop legacy $service"
			fi
		done
		running=$(docker ps -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
			--filter "label=com.docker.compose.service=$service")
		for container in $running; do
			image=$(docker inspect --format '{{.Config.Image}}' "$container") || die "cannot verify $service image"
			[ "$image" = "memoly-backend:$MEMOLY_PRODUCT_SHA" ] || die "legacy $service is still running; migration is forbidden"
		done
	done
	if [ "${MM0_BOUNDARY:-false}" = true ] || [ "$FORWARD_MARKER" = "$MM0_FORWARD_MARKER" ]; then
		quiesce_mm0_spike
	fi
	printf 'Pre-B2 backend, worker, and scheduler are stopped; compatible target containers, if any, remain running.\n'
}

quiesce_all_writers() {
	[ "${SELECTEL_CI_RELEASE:-false}" = true ] && [[ "${SELECTEL_DEPLOY_LOCK_FD:-}" =~ ^[0-9]+$ ]] ||
		die 'quiesce-all requires the guarded ci-release entry point and inherited release lock'
	local service running container
	for service in backend worker scheduler; do
		running=$(docker ps -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
			--filter "label=com.docker.compose.service=$service") || die "cannot enumerate $service writers"
		for container in $running; do
			docker stop --time 30 "$container" >/dev/null || die "cannot stop $service writer"
		done
		running=$(docker ps -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
			--filter "label=com.docker.compose.service=$service") || die "cannot verify $service writers are stopped"
		[ -z "$running" ] || die "$service writer is still running"
	done
	if [ "${MM0_BOUNDARY:-false}" = true ] || [ "$FORWARD_MARKER" = "$MM0_FORWARD_MARKER" ]; then
		quiesce_mm0_spike emergency
	fi
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
	if [ "${MM0_BACKUP_PREPARED:-false}" = true ]; then
		validate_forward_marker
		verify_no_legacy_writers
	else
		backup_database
	fi
	if ! compose run --rm --no-deps backend bun run db:deploy >/dev/null 2>&1; then
		die "database migration failed; application services were not promoted"
	fi
	if ! migration_status >/dev/null 2>&1; then
		die "database migration status failed; application services were not promoted"
	fi
	printf 'Database migration complete. Application services were not promoted.\n'
}

backup_migration() {
	preflight
	validate_database_target
	if [ "${MM0_BOUNDARY:-false}" = true ]; then precheck_mm0_spike_relation; fi
	backup_database
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

rollback_runtime_fingerprint() {
	local revision=$1
	git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" \
		ls-tree -rz --full-tree --format='%(objectmode) %(objecttype) %(objectname)%x09%(path)' "$revision" -- \
		backend webapp packages package.json bun.lock bunfig.toml |
		grep -zEv $'\tbackend/scripts/([^/]+\\.test\\.ts$|test-support/|test-integration\\.mjs$)' |
		sha256sum | awk '{print $1}'
}

rollback_migration_catalog_checksums() {
	local revision=$1 path name lf_checksum crlf_checksum records='' count=0
	local -a migration_paths=()
	mapfile -t migration_paths < <(git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" \
		ls-tree -r --name-only "$revision" -- backend/prisma/migrations/ |
		grep -E '/migration\.sql$' | LC_ALL=C sort)
	[ "${#migration_paths[@]}" -gt 0 ] || return 1
	for path in "${migration_paths[@]}"; do
		name=${path#backend/prisma/migrations/}
		name=${name%/migration.sql}
		lf_checksum=$(git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" show "$revision:$path" | perl -pe 's/\r?\n/\n/g' | sha256sum | awk '{print $1}') || return 1
		crlf_checksum=$(git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" show "$revision:$path" | perl -pe 's/\r?\n/\n/g; s/\n/\r\n/g' | sha256sum | awk '{print $1}') || return 1
		[[ "$lf_checksum" =~ ^[0-9a-f]{64}$ && "$crlf_checksum" =~ ^[0-9a-f]{64}$ ]] || return 1
		records+="$name:$lf_checksum:$crlf_checksum"$'\n'
		count=$((count + 1))
	done
	[ "$count" -gt 0 ] || return 1
	printf '%s' "$records"
}

rollback_auth_gate_for_verified_pair() {
	local legacy_target=e383d79269a3595f4c6cabedf167335aea042cf3
	local candidate_target=3fce2739205da927b95eb3379b1d066b61282965
	local target=${PREVIOUS_BACKEND_IMAGE_TAG:-} expected_runtime gate source_runtime
	[ "${PREVIOUS_WEBAPP_IMAGE_TAG:-}" = "$target" ] || die 'rollback target pair has no verified runtime compatibility attestation'
	case "$target" in
		"$legacy_target")
			expected_runtime=3d021aa1eb5160c8022ad5da3189ee30d6738bcb967f752458bef38145509857
			gate=true
			;;
		"$candidate_target")
			expected_runtime=5555b4b9419d29b4366f5a70fbdd9537a3ccde3230a0497c41fa392de9038107
			gate=false
			;;
		*) die 'rollback target pair has no verified runtime compatibility attestation' ;;
	esac
	[[ "${MEMOLY_PRODUCT_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || die 'rollback source SHA is unknown'
	[ "$(git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" rev-parse HEAD)" = "$MEMOLY_PRODUCT_SHA" ] ||
		die 'rollback source differs from the checked-out release'
	git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" merge-base --is-ancestor "$target" "$MEMOLY_PRODUCT_SHA" ||
		die 'rollback source is outside the exact target release lineage'
	source_runtime=$(rollback_runtime_fingerprint "$MEMOLY_PRODUCT_SHA") || die 'cannot fingerprint rollback source runtime'
	if [ "$target" = "$candidate_target" ] &&
		[ "$source_runtime" = 5a8c7cfe1839c8ed44434f80ddf7a83e1e9f6c43154a249f3b214ca3d25b5e02 ]; then
		expected_runtime=5a8c7cfe1839c8ed44434f80ddf7a83e1e9f6c43154a249f3b214ca3d25b5e02
	fi
	[ "$source_runtime" = "$expected_runtime" ] || die 'application runtime differs from the verified rollback source'
	printf '%s\n' "$gate"
}

verify_application_rollback() {
	(
	[ ! -e "$FORWARD_MARKER" ] && [ ! -L "$FORWARD_MARKER" ] || die 'B2 forward-only release is unfinished; rollback is forbidden'
	[ ! -e "$MM0_FORWARD_MARKER" ] && [ ! -L "$MM0_FORWARD_MARKER" ] ||
		die 'FORWARD_FIX_REQUIRED: MM0 migration may have applied; rollback is forbidden'
	validate_rollback_file
	# shellcheck disable=SC1090
	set -a
	. "$ROLLBACK_ENV"
	set +a
	[ "${MEMOLY_DB_ROLLBACK_ALLOWED:-false}" = false ] || die "database rollback is forbidden"
	[ -n "${PREVIOUS_BACKEND_IMAGE_TAG:-}" ] || die "previous backend image tag is missing"
	[ -n "${PREVIOUS_WEBAPP_IMAGE_TAG:-}" ] || die "previous webapp image tag is missing"
	git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" merge-base --is-ancestor \
		"$B2_RUNTIME_SHA" "$PREVIOUS_BACKEND_IMAGE_TAG" || die 'rollback target predates the B2 membership runtime; use a compatible forward fix'
	if ! git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" merge-base --is-ancestor "$MM0_RUNTIME_SHA" "$PREVIOUS_BACKEND_IMAGE_TAG"; then
		die 'FORWARD_FIX_REQUIRED: rollback target predates the MM0 runtime and cannot publish against this database'
	fi
	# Exact targets are independently measured; source trees are pinned by content
	# so squash commits do not need to retain unreachable producer objects.
	local legacy_target=e383d79269a3595f4c6cabedf167335aea042cf3
	local candidate_target=3fce2739205da927b95eb3379b1d066b61282965
	local target expected_runtime expected_target_runtime profile=candidate
	case "$PREVIOUS_BACKEND_IMAGE_TAG:$PREVIOUS_WEBAPP_IMAGE_TAG" in
		"$legacy_target:$legacy_target")
			target=$legacy_target
			expected_runtime=3d021aa1eb5160c8022ad5da3189ee30d6738bcb967f752458bef38145509857
			expected_target_runtime=b12190f9bd6e568b544d89d4c4beec8198ad7626b03bdd9164cf76890d440a4e
			;;
		"$candidate_target:$candidate_target")
			target=$candidate_target
			expected_runtime=5555b4b9419d29b4366f5a70fbdd9537a3ccde3230a0497c41fa392de9038107
			expected_target_runtime=3d021aa1eb5160c8022ad5da3189ee30d6738bcb967f752458bef38145509857
			;;
		*) die 'rollback target pair has no verified runtime compatibility attestation' ;;
	esac
	[[ "$MEMOLY_PRODUCT_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'rollback source SHA is unknown'
	for revision in "$target" "$MEMOLY_PRODUCT_SHA"; do
		git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" cat-file -e "$revision^{commit}" 2>/dev/null ||
			die 'rollback compatibility revision is unavailable'
	done
	[ "$(git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" rev-parse HEAD)" = "$MEMOLY_PRODUCT_SHA" ] ||
		die 'rollback source differs from the checked-out release'
	git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" merge-base --is-ancestor "$target" "$MEMOLY_PRODUCT_SHA" ||
		die 'rollback source is outside the exact target release lineage'
	local source_status
	source_status=$(git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" status --porcelain) || die 'cannot inspect rollback source checkout'
	[ -z "$source_status" ] ||
		die 'rollback source checkout is not clean'
	local source_runtime target_runtime
	source_runtime=$(rollback_runtime_fingerprint "$MEMOLY_PRODUCT_SHA") || die 'cannot fingerprint rollback source runtime'
	if [ "$target" = "$candidate_target" ] &&
		[ "$source_runtime" = 5a8c7cfe1839c8ed44434f80ddf7a83e1e9f6c43154a249f3b214ca3d25b5e02 ]; then
		profile=comments
		expected_runtime=5a8c7cfe1839c8ed44434f80ddf7a83e1e9f6c43154a249f3b214ca3d25b5e02
	fi
	[ "$source_runtime" = "$expected_runtime" ] || die 'application runtime differs from the verified rollback source'
	target_runtime=$(rollback_runtime_fingerprint "$target") || die 'cannot fingerprint rollback target runtime'
	[ "$target_runtime" = "$expected_target_runtime" ] || die 'rollback target runtime differs from the verified compatibility target'
	if [ "$profile" = comments ]; then
		git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" diff --quiet "$target" "$MEMOLY_PRODUCT_SHA" -- \
			backend/Dockerfile bunfig.toml \
			deploy/selectel/compose.yml.template deploy/selectel/Dockerfile.webapp \
			deploy/selectel/Caddyfile.edge.template deploy/selectel/Caddyfile.static.template deploy/selectel/in-place-file.sh ||
			die 'rollback schema, dependencies or service configuration are incompatible'
	else
		git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" diff --quiet "$target" "$MEMOLY_PRODUCT_SHA" -- \
			backend/prisma backend/Dockerfile backend/package.json packages/contracts bun.lock bunfig.toml \
			deploy/selectel/compose.yml.template deploy/selectel/Dockerfile.webapp \
			deploy/selectel/Caddyfile.edge.template deploy/selectel/Caddyfile.static.template deploy/selectel/in-place-file.sh ||
			die 'rollback schema, dependencies or service configuration are incompatible'
	fi
	export MEMOLY_BACKEND_IMAGE_TAG="$PREVIOUS_BACKEND_IMAGE_TAG"
	export MEMOLY_WEBAPP_IMAGE_TAG="$PREVIOUS_WEBAPP_IMAGE_TAG"
	case "$MEMOLY_BACKEND_IMAGE_TAG $MEMOLY_WEBAPP_IMAGE_TAG" in
		*__SET_*|*latest*) die "rollback tags must be immutable, not placeholders or latest" ;;
	esac
	load_runtime_secrets
	validate_inputs rollback
	local expected_backend_id expected_webapp_id
	case "$target" in
		"$legacy_target")
			expected_backend_id=sha256:0f461127ce0c7a6438a0fd36b91a1c5252c3f3b35adaf72162f476f1142e93c9
			expected_webapp_id=sha256:3bc840c248da2c13d93f7d307c2f52e1104af43d49bf0bad9c00d11377cc236a
			;;
		"$candidate_target")
			expected_backend_id=sha256:d8fada3265507cc8ee1ae76b83bf851187aaad19c126b3f4fec4cead92c9106c
			expected_webapp_id=sha256:9a31bb3f071ae2f11654671fce4a262a37fb4a039e7d7f3c422ed824a7787a66
			;;
	esac
	[ "$(docker image inspect --format '{{.Id}}' "memoly-backend:$target")" = "$expected_backend_id" ] ||
		die 'rollback backend image differs from the verified production artifact'
	[ "$(docker image inspect --format '{{.Id}}' "memoly-webapp:$target")" = "$expected_webapp_id" ] ||
		die 'rollback webapp image differs from the verified production artifact'
	for image in "memoly-backend:$target" "memoly-webapp:$target"; do
		[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" = "$target" ] ||
			die 'rollback image revision label mismatch'
	done
	configuration_backup_dir >/dev/null || die 'rollback configuration artifacts are unavailable'
	migration_status >/dev/null 2>&1 || die 'rollback target cannot confirm completed migrations'
	# Both capabilities are proven by the current -> old -> current PostgreSQL probe.
	# Missing tables, unknown result types, unfinished migrations and read errors fail closed.
	compose run --rm --no-deps backend bun -e 'import { Client } from "pg"; const client = new Client({ connectionString: process.env.DATABASE_URL }); try { await client.connect(); const result = await client.query("SELECT EXISTS (SELECT 1 FROM families WHERE unread_tracking_activated_at IS NOT NULL) AS unread, EXISTS (SELECT 1 FROM family_members m JOIN families f ON f.id = m.family_id WHERE m.revoked_at IS NULL AND f.status = '\''active'\'' GROUP BY m.user_id HAVING COUNT(*) > 1) AS multiple, EXISTS (SELECT 1 FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS unfinished"); const state=result.rows[0]; const capabilities={unread:true,multiple:true}; const valid=state && typeof state.unread==="boolean" && typeof state.multiple==="boolean" && typeof state.unfinished==="boolean" && !state.unfinished && (!state.unread || capabilities.unread) && (!state.multiple || capabilities.multiple); await client.end(); process.exit(valid ? 0 : 1) } catch { await client.end().catch(() => {}); process.exit(1) }' >/dev/null 2>&1 ||
		die 'rollback data compatibility state is unknown or migration is unfinished'
	if [ "$profile" = comments ]; then
		local expected_migration_checksums
		expected_migration_checksums=$(rollback_migration_catalog_checksums "$MEMOLY_PRODUCT_SHA") ||
			die 'cannot fingerprint the verified comments migration catalog'
		[[ -n "$expected_migration_checksums" ]] || die 'verified comments migration catalog is empty'
		compose run --rm --no-deps -e "MEMOLY_EXPECTED_MIGRATION_CHECKSUMS=$expected_migration_checksums" backend bun -e "$(cat <<'MEMOLY_MIGRATION_HISTORY_JS'
import { Client } from "pg";
const expected = new Map();
for (const line of (process.env.MEMOLY_EXPECTED_MIGRATION_CHECKSUMS ?? "").trim().split("\n")) {
  const [name, lfChecksum, crlfChecksum, ...extra] = line.split(":");
  if (!name || extra.length || !/^\d+_[a-z0-9_]+$/.test(name) ||
      !/^[0-9a-f]{64}$/.test(lfChecksum ?? "") || !/^[0-9a-f]{64}$/.test(crlfChecksum ?? "") ||
      expected.has(name)) process.exit(1);
  expected.set(name, new Set([lfChecksum, crlfChecksum]));
}
const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  if (expected.size === 0) throw new Error("empty expected migration catalog");
  await client.connect();
  const { rows } = await client.query("SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name");
  if (!Array.isArray(rows) || rows.some(row => !row.finished_at && !row.rolled_back_at)) throw new Error("unfinished migration");
  const completed = rows.filter(row => row.finished_at && !row.rolled_back_at);
  if (completed.length !== expected.size) throw new Error("migration count mismatch");
  const seen = new Set();
  for (const row of completed) {
    if (typeof row.migration_name !== "string" || typeof row.checksum !== "string" || seen.has(row.migration_name)) throw new Error("invalid or duplicate migration ledger row");
    const sourceChecksums = expected.get(row.migration_name);
    if (!sourceChecksums || !sourceChecksums.has(row.checksum)) throw new Error("migration ledger differs from source SQL");
    seen.add(row.migration_name);
  }
  if (seen.size !== expected.size) throw new Error("migration names differ from source catalog");
  await client.end();
  process.exit(0);
} catch {
  await client.end().catch(() => {});
  process.exit(1);
}
MEMOLY_MIGRATION_HISTORY_JS
)" >/dev/null 2>&1 ||
			die 'comments rollback requires the exact completed migration history'
	fi
	)
}

rollback() {
	verify_application_rollback || die 'application rollback compatibility could not be verified'
	set -a
	. "$ROLLBACK_ENV"
	set +a
	export MEMOLY_BACKEND_IMAGE_TAG="$PREVIOUS_BACKEND_IMAGE_TAG"
	export MEMOLY_WEBAPP_IMAGE_TAG="$PREVIOUS_WEBAPP_IMAGE_TAG"
	load_runtime_secrets
	gateway_preflight
	if [ "${SELECTEL_CI_RELEASE:-false}" = true ]; then
		restore_configuration_backup
	else
		if [ -f "$CONFIG_BACKUP_MARKER" ]; then
			restore_configuration_backup
		else
			render_edge_candidate
			validate_candidate_caddy
		fi
	fi
	compose config >/dev/null || die 'Compose configuration validation failed before application rollback'
	local gate_policy gate_status
	gate_policy=$(rollback_auth_gate_for_verified_pair) || die 'application rollback gate policy could not be verified'
	# Install and verify this exact pair's gateway policy before promoting application processes.
	ROLLBACK_AUTH_GATE=$gate_policy render_edge_candidate
	activate_gateway
	gate_status=$(curl --silent --show-error --max-time 5 -o /dev/null -w '%{http_code}' "$PUBLIC_URL/api/v1/auth/max") ||
		die 'cannot verify rollback authentication maintenance'
	if [ "$gate_policy" = true ]; then
		[ "$gate_status" = 503 ] || die 'rollback authentication maintenance is not active'
	else
		[ "$gate_status" = 404 ] || die 'normal authentication routing is not active for the verified rollback target'
	fi
	compose up -d --no-deps --force-recreate backend worker scheduler static ||
		die 'application rollback service promotion failed'
	wait_backend_internal
	verify_static_internal
	docker exec "$GATEWAY_CONTAINER" caddy validate --config "$GATEWAY_CADDYFILE" --adapter caddyfile
	docker exec "$GATEWAY_CONTAINER" caddy reload --config "$GATEWAY_CADDYFILE" --adapter caddyfile
	cleanup_candidate
	readiness
	if [ "$gate_policy" = true ]; then
		printf 'Application rollback complete; additive migrations remain applied. Auth maintenance remains until a healthy F12 forward release.\n'
	else
		printf 'Application rollback complete; additive migrations remain applied with normal authentication routing.\n'
	fi
}

read_static_rollback_tag() {
	local line backend_seen=0 webapp_seen=0 database_seen=0
	PREVIOUS_WEBAPP_IMAGE_TAG=
	validate_rollback_file
	while IFS= read -r line || [ -n "$line" ]; do
		case "$line" in
			''|'#'*) ;;
			PREVIOUS_BACKEND_IMAGE_TAG=*)
				[ "$backend_seen" -eq 0 ] || die 'rollback env contains a duplicate previous backend tag'
				[[ "$line" =~ ^PREVIOUS_BACKEND_IMAGE_TAG=([0-9a-f]{40})$ ]] || die 'rollback env previous backend tag is invalid'
				backend_seen=1
				;;
			PREVIOUS_WEBAPP_IMAGE_TAG=*)
				[ "$webapp_seen" -eq 0 ] || die 'rollback env contains a duplicate previous webapp tag'
				[[ "$line" =~ ^PREVIOUS_WEBAPP_IMAGE_TAG=([0-9a-f]{40})$ ]] || die 'rollback env previous webapp tag is invalid'
				PREVIOUS_WEBAPP_IMAGE_TAG=${BASH_REMATCH[1]}
				webapp_seen=1
				;;
			MEMOLY_DB_ROLLBACK_ALLOWED=*)
				[ "$database_seen" -eq 0 ] || die 'rollback env contains a duplicate database rollback setting'
				[ "$line" = 'MEMOLY_DB_ROLLBACK_ALLOWED=false' ] || die 'database rollback must remain disabled'
				database_seen=1
				;;
			*) die 'rollback env contains an unexpected setting' ;;
		esac
	done < "$ROLLBACK_ENV"
	[ "$backend_seen" -eq 1 ] && [ "$webapp_seen" -eq 1 ] && [ "$database_seen" -eq 1 ] ||
		die 'rollback env is missing a required setting'
}

inspect_running_service_image() {
	local service=$1 expected_prefix=$2 running details image tag container_id image_id revision
	running=$(docker ps -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
		--filter "label=com.docker.compose.service=$service") || die "cannot enumerate running $service service"
	[ "$(printf '%s\n' "$running" | awk 'NF { count += 1 } END { print count + 0 }')" -eq 1 ] ||
		die "running $service service identity is missing or ambiguous"
	details=$(docker inspect --format '{{.Config.Image}}|{{.Image}}' "$running") || die "cannot inspect running $service image"
	image=${details%%|*}
	container_id=${details#*|}
	case "$image" in
		"$expected_prefix:"*) tag=${image#"$expected_prefix:"} ;;
		*) die "running $service does not use an immutable $expected_prefix image" ;;
	esac
	[[ "$tag" =~ ^[0-9a-f]{40}$ ]] || die "running $service image tag is invalid"
	[[ "$container_id" =~ ^sha256:[0-9a-f]{64}$ ]] || die "running $service container image ID is invalid"
	image_id=$(docker image inspect --format '{{.Id}}' "$image") || die "cannot inspect tagged $service image"
	[ "$image_id" = "$container_id" ] || die "running $service image ID does not match its immutable tag"
	revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image") ||
		die "cannot inspect $service image revision label"
	[ "$revision" = "$tag" ] || die "running $service image revision label does not match its tag"
	printf '%s\n' "$tag"
}

rollback_static() {
	local service backend_tag static_tag image_id image_revision actual_static_tag
	[ ! -e "$FORWARD_MARKER" ] && [ ! -L "$FORWARD_MARKER" ] ||
		die 'B2 forward-only marker exists; static rollback is forbidden during forward recovery'
	[ ! -e "$MM0_FORWARD_MARKER" ] && [ ! -L "$MM0_FORWARD_MARKER" ] ||
		die 'MM0 forward-only marker exists; static rollback is forbidden during forward recovery'
	read_static_rollback_tag
	backend_tag=$(inspect_running_service_image backend memoly-backend)
	for service in worker scheduler; do
		local service_tag
		service_tag=$(inspect_running_service_image "$service" memoly-backend)
		[ "$service_tag" = "$backend_tag" ] || die "running $service image differs from the backend image"
	done
	static_tag=$(inspect_running_service_image static memoly-webapp)
	[ "$static_tag" != "$PREVIOUS_WEBAPP_IMAGE_TAG" ] || die 'requested static rollback is already active'
	git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" cat-file -e "$backend_tag^{commit}" 2>/dev/null ||
		die 'running backend SHA is unavailable in the checkout; static rollback compatibility cannot be verified'
	git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" cat-file -e "$PREVIOUS_WEBAPP_IMAGE_TAG^{commit}" 2>/dev/null ||
		die 'previous webapp SHA is unavailable in the checkout; static rollback compatibility cannot be verified'
	git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" merge-base --is-ancestor "$PREVIOUS_WEBAPP_IMAGE_TAG" "$backend_tag" ||
		die 'previous webapp SHA is not an ancestor of the running backend'
	if ! git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" diff --quiet \
		"$PREVIOUS_WEBAPP_IMAGE_TAG" "$backend_tag" -- \
		backend packages/contracts package.json bun.lock bunfig.toml \
		deploy/selectel/compose.yml.template \
		deploy/selectel/Caddyfile.edge.template \
		deploy/selectel/Caddyfile.static.template; then
		die 'backend, contracts, root package/build config, lockfile, or Compose/Caddy templates changed since the previous webapp'
	fi
	docker image inspect "memoly-webapp:$PREVIOUS_WEBAPP_IMAGE_TAG" >/dev/null 2>&1 ||
		die 'previous immutable webapp image is not present locally'
	image_id=$(docker image inspect --format '{{.Id}}' "memoly-webapp:$PREVIOUS_WEBAPP_IMAGE_TAG") ||
		die 'cannot inspect previous webapp image ID'
	[[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || die 'previous webapp image ID is invalid'
	image_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
		"memoly-webapp:$PREVIOUS_WEBAPP_IMAGE_TAG") || die 'cannot inspect previous webapp revision label'
	[ "$image_revision" = "$PREVIOUS_WEBAPP_IMAGE_TAG" ] || die 'previous webapp revision label does not match its tag'

	gateway_preflight
	load_runtime_secrets
	export MEMOLY_BACKEND_IMAGE_TAG="$backend_tag"
	export MEMOLY_WEBAPP_IMAGE_TAG="$PREVIOUS_WEBAPP_IMAGE_TAG"
	compose config >/dev/null || die 'Compose configuration validation failed before static rollback'
	if ( compose up -d --no-deps --force-recreate static &&
		actual_static_tag=$(inspect_running_service_image static memoly-webapp) &&
		[ "$actual_static_tag" = "$PREVIOUS_WEBAPP_IMAGE_TAG" ] &&
		verify_static_internal && wait_public / ); then
		printf 'UI-only rollback complete: static=%s backend=%s; backend, worker, scheduler, database, and gateway were retained.\n' \
			"$PREVIOUS_WEBAPP_IMAGE_TAG" "$backend_tag"
		return 0
	fi
	printf 'ERROR: static rollback promotion or readiness failed; restoring the previous static image %s.\n' "$static_tag" >&2
	export MEMOLY_WEBAPP_IMAGE_TAG="$static_tag"
	if ! ( compose up -d --no-deps --force-recreate static &&
		actual_static_tag=$(inspect_running_service_image static memoly-webapp) &&
		[ "$actual_static_tag" = "$static_tag" ] &&
		verify_static_internal && wait_public / ); then
		die 'static rollback failed and restoration of the previously running static image also failed'
	fi
	die 'static rollback failed; previously running static image was restored'
}

deploy() {
	guard_membership_transition
	preflight
	backup_server_state
	if [ "${MM0_BOUNDARY:-false}" != true ] && [ ! -e "$FORWARD_MARKER" ]; then
		verify_application_rollback || die 'application recovery readiness failed before promotion'
		validate_database_target
		backup_database
	fi
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

rollback_readiness() {
	verify_application_rollback || die 'application rollback compatibility could not be verified'
	printf 'Application rollback readiness verified; no services were changed.\n'
}

usage() {
	cat <<'EOF'
Usage: redeploy.sh {preflight|backup-migration|migrate|deploy|rollback|rollback-readiness|rollback-static|migration-status|quiesce-legacy|quiesce-all}

Environment: SERVER_ROOT COMPOSE_FILE ROLLBACK_ENV COMPOSE_PROJECT
GATEWAY_CONTAINER MEMOLY_EDGE_NETWORK MEMOLY_PRODUCT_SHA MEMOLY_BACKEND_IMAGE_TAG MEMOLY_WEBAPP_IMAGE_TAG PUBLIC_URL
EOF
}

main() {
	local action=${1:-}
	require_command curl
	require_command flock
	require_command git
	require_command readlink
	require_command stat
	acquire_deploy_lock
	case "$action" in
		preflight) preflight ;;
		deploy) deploy ;;
		rollback) rollback ;;
		rollback-readiness) require_command docker; rollback_readiness ;;
		rollback-static) require_command docker; rollback_static ;;
		migration-status) require_command docker; load_runtime_secrets; validate_inputs; migration_status ;;
		backup-migration) require_command docker; guard_membership_transition backup; backup_migration ;;
		quiesce-legacy) require_command docker; quiesce_legacy_runtime ;;
		quiesce-all) require_command docker; quiesce_all_writers ;;
		migrate) require_command docker; guard_membership_transition; migrate ;;
		reload-gateway) die "reload-gateway is disabled; use deploy so static readiness gates edge activation" ;;
		*) usage; exit 2 ;;
	esac
}

main "$@"
