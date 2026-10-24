#!/usr/bin/env bash
set -Eeuo pipefail

# This script owns only the internal Compose project. The host-port gateway is
# an existing manually managed Caddy container and must remain outside Compose.

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]:-$0}")" && pwd)
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
	local job_log stage
	preflight
	validate_database_target
	if [ "${MM0_BACKUP_PREPARED:-false}" = true ]; then
		validate_forward_marker
		verify_no_legacy_writers
	else
		backup_database
	fi
	install -d -m 0700 "$SERVER_ROOT/backups" || die 'cannot create database job log directory'
	chmod 0700 "$SERVER_ROOT/backups" || die 'cannot secure database job log directory'
	job_log=$(mktemp "$SERVER_ROOT/backups/selectel-db-deploy.XXXXXXXX.log") || die 'cannot create database job log'
	chmod 0600 "$job_log" || {
		rm -f -- "$job_log"
		die 'cannot secure database job log'
	}
	if ! compose run --rm --no-deps backend bun scripts/deploy-selectel-database.ts >"$job_log" 2>&1; then
		stage='database job failed'
		if grep -Fxq 'Database ownership preflight failed; inspect the documented ownership inventory before retrying.' "$job_log"; then
			stage='database ownership preflight failed'
		elif grep -Fxq 'Database migration failed; schema may already have advanced; inspect migration status before retrying.' "$job_log"; then
			stage='database migration failed'
		elif grep -Fxq 'Database migration was applied, but runtime grants or postconditions failed; inspect the database before retrying.' "$job_log"; then
			stage='post-migration runtime grants or postconditions failed'
		fi
		die "$stage; schema may already have advanced; inspect migration status before retrying; private job log: $(basename "$job_log"); application services were not promoted"
	fi
	if ! migration_status >/dev/null 2>&1; then
		die "database migration applied or status is unavailable; inspect migration status before retrying; application services were not promoted"
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

# Runtime compatibility follows executable production inputs. Frozen artifact/source
# attestations continue to use rollback_runtime_fingerprint above.
rollback_compatibility_fingerprint() {
	local revision=$1
	git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" \
		ls-tree -rz --full-tree --format='%(objectmode) %(objecttype) %(objectname)%x09%(path)' "$revision" -- \
		backend webapp packages package.json bun.lock bunfig.toml |
		grep -zEv $'\t([^/]+/)*[^/]+\\.(test|spec)\\.[^/]+$|\t([^/]+/)*(tests?|e2e|visualtests|test-support)/|\t(webapp|website)/playwright[^/]*$|\tbackend/scripts/(test-integration|test-files|test-unit|test-live)\\.mjs$|\tbackend/src/(race-regression-fixtures|zod-compile\\.probe)\\.ts$|\tbackend/src/modules/memories/infrastructure/comment-test-fixtures\\.ts$|\tbackend/src/outbox/fake-outbox-prisma\\.ts$|\tbackend/src/modules/media/fixtures/|\twebapp/src/dev/(FamilyMaxChannelFixturePage|FamilyHubFixturePage|DesignSystemFixturePage)\\.tsx$|\twebapp/tsconfig\\.e2e\\.json$' |
		sha256sum | awk '{print $1}'
}

rollback_source_compatibility_profile() {
	local revision=$1 target=$2 candidate_hash reference full_hash profile
	local -a attestations=()
	local -a exact_compatibility_attestations=()
	candidate_hash=$(rollback_compatibility_fingerprint "$revision") || return 1
	case "$target" in
		e383d79269a3595f4c6cabedf167335aea042cf3)
			attestations=("3fce2739205da927b95eb3379b1d066b61282965:3d021aa1eb5160c8022ad5da3189ee30d6738bcb967f752458bef38145509857:candidate") ;;
		3fce2739205da927b95eb3379b1d066b61282965)
			attestations=("39e8af7bb9e9a5949ada3c32dad31d38f9439505:5555b4b9419d29b4366f5a70fbdd9537a3ccde3230a0497c41fa392de9038107:candidate"
				"a353f01a8354e42f71473b1917f99c9a97181680:5a8c7cfe1839c8ed44434f80ddf7a83e1e9f6c43154a249f3b214ca3d25b5e02:comments"
			"91f48719309e20456b1659092a1bf209c3aa3653:9afbb1656016effbac74a367b23a7608494b7834e8091f375d20fea858e4c468:comments") ;;
		4b4edc0992803b84c919aadb835e8d2e21095c51)
			attestations=("91f48719309e20456b1659092a1bf209c3aa3653:9afbb1656016effbac74a367b23a7608494b7834e8091f375d20fea858e4c468:comments"
				"33a0054c3c71372aa5509ee8ebfa4578ad512ea1:ae2c05a046080f4ea72c2ca70db131eaa866c05bf5444e50070f92273f7b0f87:comments") ;;
		33a0054c3c71372aa5509ee8ebfa4578ad512ea1)
			attestations=("dc3201096998f366a88a296d13914abf6047604b:9c848684f56ce26f57af81136d1dfc351d4a1c52776dcfc41d1291e8e46a6fda:comments")
			# The timer callback fix and the exact Storybook security-toolchain
			# upgrade preserve this recovery profile. This content hash is anchored
			# to the same full-attested dc320 source and applies only to target 33a.
			# The diagnostic source pin is separately bound to an exact runtime and
			# executable compatibility fingerprint.
			# The exact Welcome CTA 6 production inputs have their own measured
			# executable fingerprint; this binding remains limited to recovery to 33a.
			# The once-zoom correction also freezes the accepted mixed-media viewer
			# behavior and app-wide zoom guard; it remains limited to recovery to 33a.
			exact_compatibility_attestations=("dc3201096998f366a88a296d13914abf6047604b:9c848684f56ce26f57af81136d1dfc351d4a1c52776dcfc41d1291e8e46a6fda:81b25c411661d27367a817ad8aaacebb1a777dca599867321c9480a5e4771b51:comments"
				"dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92:2be6fc2b96f4731c4ea3821b50f112c01d8e9a62da57eeb6675f8513fd26b088:18d7cd0be088612c52c39ac101c97a81292d4da759bb92e679036b9604be65d5:comments"
				"dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92:2be6fc2b96f4731c4ea3821b50f112c01d8e9a62da57eeb6675f8513fd26b088:98ec68669e8a64cac59ca55bd34e3585cc5fbf24d3c48d6976196118ae1a762a:comments"
				"dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92:2be6fc2b96f4731c4ea3821b50f112c01d8e9a62da57eeb6675f8513fd26b088:a208551a5f5925445d71bedc322d669d04bf76196d90332cc0816e7c7c3a70c6:comments"
				"dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92:2be6fc2b96f4731c4ea3821b50f112c01d8e9a62da57eeb6675f8513fd26b088:b3efa841bf22d2703c462d3fcf58f039c55784a3dc0dd695f3e81ce14dcece04:comments"
				"dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92:2be6fc2b96f4731c4ea3821b50f112c01d8e9a62da57eeb6675f8513fd26b088:7509b439a678bba9bb7b74bfb9edd620623b8f238c2a9c256e1f1da187f9997e:comments"
				"dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92:2be6fc2b96f4731c4ea3821b50f112c01d8e9a62da57eeb6675f8513fd26b088:0236c2944f1e4c978b4da387dbc6758b330cd1f6d36fe54cf84b65eefab3ace0:comments"
				"dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92:2be6fc2b96f4731c4ea3821b50f112c01d8e9a62da57eeb6675f8513fd26b088:b9d96400efdfebbfb0dffe3db83ee813b05012a42c3d15cd8f17d88f88ebfddc:comments"
				"dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92:2be6fc2b96f4731c4ea3821b50f112c01d8e9a62da57eeb6675f8513fd26b088:66c95074db67e743e0a96e9db65c758e13e7ae89de4cbc8cd5a64b67cca17d65:comments"
				"dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92:2be6fc2b96f4731c4ea3821b50f112c01d8e9a62da57eeb6675f8513fd26b088:5ba8daeb5a1d8a3f538f9f24adff103f440afbd7de9fbe0e5b1eee1d772bd8b1:albums"
				"dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92:2be6fc2b96f4731c4ea3821b50f112c01d8e9a62da57eeb6675f8513fd26b088:f4b2ef2d6df8ab0135c24102d56b7facbed4fc09eaf467eb93fef6b55781749f:albums"
				# Exact final wishlist production inputs from 5f0f854e; this permits only
				# the established dc26 baseline paired with the measured executable tree.
				"dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92:2be6fc2b96f4731c4ea3821b50f112c01d8e9a62da57eeb6675f8513fd26b088:9bc6fdc22b85fe68e04ab387c1d9ce3c4f8a01471c177f1b61d9ae07bbde13c8:wishlist"
				# Exact gift URL metadata production inputs from ad7dabc; retains the same
				# dc26 baseline, migration ledger and wishlist recovery profile.
				"dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92:2be6fc2b96f4731c4ea3821b50f112c01d8e9a62da57eeb6675f8513fd26b088:fbffd1ed775d360a0308b39dad80feb903d865c8588b41a5a03bddb4b9c4efc4:wishlist") ;;
		*) return 1 ;;
	esac
	for attestation in "${attestations[@]}"; do
		IFS=: read -r reference full_hash profile <<< "$attestation"
		[ "$(rollback_runtime_fingerprint "$reference")" = "$full_hash" ] || continue
		if [ "$(rollback_compatibility_fingerprint "$reference")" = "$candidate_hash" ]; then
			printf '%s\n' "$profile"
			return 0
		fi
	done
	for attestation in "${exact_compatibility_attestations[@]}"; do
		IFS=: read -r reference full_hash expected_hash profile <<< "$attestation"
		[ "$(rollback_runtime_fingerprint "$reference")" = "$full_hash" ] || continue
		if [ "$candidate_hash" = "$expected_hash" ]; then
			printf '%s\n' "$profile"
			return 0
		fi
	done
	return 1
}

rollback_verify_migration_history() {
	local expected_migration_checksums=$1
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
)" >/dev/null 2>&1
}

rollback_verify_albums_migration_history() {
	local phase=$1 baseline_catalog candidate_catalog suffix expected_suffix
	local baseline_count candidate_count baseline_names candidate_names
	case "$phase" in pre-sql|complete) ;; *) return 1 ;; esac
	baseline_catalog=$(rollback_migration_catalog_checksums dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92) || return 1
	candidate_catalog=$(rollback_migration_catalog_checksums "$MEMOLY_PRODUCT_SHA") || return 1
	baseline_count=$(printf '%s\n' "$baseline_catalog" | awk 'NF { count++ } END { print count+0 }')
	candidate_count=$(printf '%s\n' "$candidate_catalog" | awk 'NF { count++ } END { print count+0 }')
	[ "$baseline_count" = 49 ] && { [ "$candidate_count" = 52 ] || [ "$candidate_count" = 53 ]; } || return 1
	baseline_names=$(printf '%s\n' "$baseline_catalog" | cut -d: -f1)
	candidate_names=$(printf '%s\n' "$candidate_catalog" | cut -d: -f1)
	[ "$(printf '%s\n' "$candidate_names" | head -n 49)" = "$baseline_names" ] || return 1
	if [ "$candidate_count" = 52 ]; then
		suffix=$(printf '%s\n' "$candidate_names" | tail -n 3)
		expected_suffix=$(printf '%s\n' \
			20261023110000_memoly_albums \
			20261023120000_album_entry_tombstones_year_uniqueness \
			20261023130000_album_source_operation_receipts)
	else
		suffix=$(printf '%s\n' "$candidate_names" | tail -n 4)
		expected_suffix=$(printf '%s\n' \
			20261023110000_memoly_albums \
			20261023120000_album_entry_tombstones_year_uniqueness \
			20261023130000_album_source_operation_receipts \
			20261023150000_album_private_photos)
	fi
	[ "$suffix" = "$expected_suffix" ] || return 1
	MEMOLY_EXPECTED_BASELINE_MIGRATIONS="$baseline_catalog" \
	MEMOLY_EXPECTED_CANDIDATE_MIGRATIONS="$candidate_catalog" \
	MEMOLY_ALBUMS_LEDGER_PHASE="$phase" compose run --rm --no-deps \
		-e "MEMOLY_EXPECTED_BASELINE_MIGRATIONS=$baseline_catalog" \
		-e "MEMOLY_EXPECTED_CANDIDATE_MIGRATIONS=$candidate_catalog" \
		-e "MEMOLY_ALBUMS_LEDGER_PHASE=$phase" backend bun -e "$(cat <<'MEMOLY_ALBUM_MIGRATION_HISTORY_JS'
import { Client } from "pg";
function parse(value) {
  const result = [];
  const seen = new Set();
  for (const line of (value ?? "").trim().split("\n")) {
    const [name, lfChecksum, crlfChecksum, ...extra] = line.split(":");
    if (!name || extra.length || !/^\d+_[a-z0-9_]+$/.test(name) ||
        !/^[0-9a-f]{64}$/.test(lfChecksum ?? "") || !/^[0-9a-f]{64}$/.test(crlfChecksum ?? "") || seen.has(name))
      throw new Error("invalid expected migration catalog");
    seen.add(name);
    result.push({ name, checksums: new Set([lfChecksum, crlfChecksum]) });
  }
  return result;
}
const baseline = parse(process.env.MEMOLY_EXPECTED_BASELINE_MIGRATIONS);
const candidate = parse(process.env.MEMOLY_EXPECTED_CANDIDATE_MIGRATIONS);
const phase = process.env.MEMOLY_ALBUMS_LEDGER_PHASE;
if (baseline.length !== 49 || ![52, 53].includes(candidate.length) ||
    candidate.slice(0, 49).some((row, index) => row.name !== baseline[index].name ||
      ![...row.checksums].some(checksum => baseline[index].checksums.has(checksum))) ||
    !["pre-sql", "complete"].includes(phase)) process.exit(1);
const minimum = phase === "pre-sql" ? 49 : candidate.length;
const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const { rows } = await client.query("SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name");
  if (!Array.isArray(rows) || rows.length < minimum || rows.length > candidate.length || rows.some(row => !row.finished_at || row.rolled_back_at))
    throw new Error("invalid album migration ledger state");
  const seen = new Set();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const expected = candidate[index];
    if (!expected || typeof row.migration_name !== "string" || typeof row.checksum !== "string" ||
        row.migration_name !== expected.name || !expected.checksums.has(row.checksum) || seen.has(row.migration_name))
      throw new Error("migration ledger is not an exact catalog prefix");
    seen.add(row.migration_name);
  }
  await client.end();
  process.exit(0);
} catch {
  await client.end().catch(() => {});
  process.exit(1);
}
MEMOLY_ALBUM_MIGRATION_HISTORY_JS
)" >/dev/null 2>&1
}

rollback_verify_wishlist_migration_history() {
	local phase=$1 baseline_revision=b4cdbbc49500d0850a64075d1bfba683a9bd22ad
	local baseline_catalog candidate_catalog baseline_count candidate_count
	case "$phase" in pre-sql|complete) ;; *) return 1 ;; esac
	baseline_catalog=$(rollback_migration_catalog_checksums "$baseline_revision") || return 1
	candidate_catalog=$(rollback_migration_catalog_checksums "$MEMOLY_PRODUCT_SHA") || return 1
	baseline_count=$(printf '%s\n' "$baseline_catalog" | awk 'NF { count++ } END { print count+0 }')
	candidate_count=$(printf '%s\n' "$candidate_catalog" | awk 'NF { count++ } END { print count+0 }')
	[ "$baseline_count" = 53 ] && [ "$candidate_count" = 55 ] || return 1
	MEMOLY_EXPECTED_BASELINE_MIGRATIONS="$baseline_catalog" \
	MEMOLY_EXPECTED_CANDIDATE_MIGRATIONS="$candidate_catalog" \
	MEMOLY_WISHLIST_LEDGER_PHASE="$phase" compose run --rm --no-deps \
		-e "MEMOLY_EXPECTED_BASELINE_MIGRATIONS=$baseline_catalog" \
		-e "MEMOLY_EXPECTED_CANDIDATE_MIGRATIONS=$candidate_catalog" \
		-e "MEMOLY_WISHLIST_LEDGER_PHASE=$phase" backend bun -e "$(cat <<'MEMOLY_WISHLIST_MIGRATION_HISTORY_JS'
import { Client } from "pg";
function parse(value) {
  const result = [];
  const byName = new Map();
  for (const line of (value ?? "").trim().split("\n")) {
    const [name, lfChecksum, crlfChecksum, ...extra] = line.split(":");
    if (!name || extra.length || !/^\d+_[a-z0-9_]+$/.test(name) ||
        !/^[0-9a-f]{64}$/.test(lfChecksum ?? "") || !/^[0-9a-f]{64}$/.test(crlfChecksum ?? "") || byName.has(name))
      throw new Error("invalid expected migration catalog");
    const row = { name, checksums: new Set([lfChecksum, crlfChecksum]) };
    result.push(row);
    byName.set(name, row);
  }
  return { result, byName };
}
const { result: baseline, byName: baselineByName } = parse(process.env.MEMOLY_EXPECTED_BASELINE_MIGRATIONS);
const { result: candidate, byName: candidateByName } = parse(process.env.MEMOLY_EXPECTED_CANDIDATE_MIGRATIONS);
const phase = process.env.MEMOLY_WISHLIST_LEDGER_PHASE;
const giftName = "20261023120000_gift_wishlist";
const guardName = "20261024120000_gift_photo_recovery_guard";
if (baseline.length !== 53 || candidate.length !== 55 || !["pre-sql", "complete"].includes(phase) ||
    candidate.some(row => !baselineByName.has(row.name) && row.name !== giftName && row.name !== guardName) ||
    [...baselineByName.keys()].some(name => {
      const base = baselineByName.get(name), next = candidateByName.get(name);
      return !next || ![...next.checksums].some(checksum => base.checksums.has(checksum));
    }) || !candidateByName.has(giftName) || !candidateByName.has(guardName) ||
    candidateByName.get(giftName).name !== giftName || candidateByName.get(guardName).name !== guardName)
  process.exit(1);
const baselineNames = new Set(baselineByName.keys());
const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const { rows } = await client.query("SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name");
  if (!Array.isArray(rows) || rows.some(row => !row.finished_at || row.rolled_back_at))
    throw new Error("unfinished or rolled-back wishlist migration");
  const count = rows.length;
  const permittedCount = phase === "complete" ? [55] : [53, 54, 55];
  if (!permittedCount.includes(count)) throw new Error("wishlist migration count mismatch");
  const includeGift = count >= 54;
  const includeGuard = count === 55;
  const expectedNames = new Set([...baselineNames, ...(includeGift ? [giftName] : []), ...(includeGuard ? [guardName] : [])]);
  if (expectedNames.size !== count) throw new Error("wishlist ledger has an unexpected migration set");
  const seen = new Set();
  for (const row of rows) {
    if (typeof row.migration_name !== "string" || typeof row.checksum !== "string" || seen.has(row.migration_name) ||
        !expectedNames.has(row.migration_name)) throw new Error("wishlist ledger contains an invalid or duplicate migration");
    const expected = candidateByName.get(row.migration_name);
    const base = baselineByName.get(row.migration_name);
    const checksums = base ? base.checksums : expected?.checksums;
    if (!checksums?.has(row.checksum)) throw new Error("wishlist ledger checksum differs from source SQL");
    seen.add(row.migration_name);
  }
  if (seen.size !== expectedNames.size) throw new Error("wishlist ledger is incomplete");
  await client.end();
  process.exit(0);
} catch {
  await client.end().catch(() => {});
  process.exit(1);
}
MEMOLY_WISHLIST_MIGRATION_HISTORY_JS
)" >/dev/null 2>&1
}

rollback_migration_catalog_checksums() {
	local revision=$1 path name lf_checksum crlf_checksum records='' count=0
	local -a migration_paths=()
	require_command perl
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

require_accepted_ui_target() {
	local target=$1 accepted_ui_v4=afdb408f8bbf22b564c86bb8d33a83261f55cc48
	git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" cat-file -e "$target^{commit}" 2>/dev/null ||
		die 'UI rollback target is unavailable; use a compatible v4 forward fix'
	git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" merge-base --is-ancestor "$accepted_ui_v4" "$target" ||
		die 'UI rollback target predates accepted v4; UI downgrade is forbidden, use a compatible v4 forward fix'
}

rollback_auth_gate_for_verified_pair() {
	local legacy_target=e383d79269a3595f4c6cabedf167335aea042cf3
	local candidate_target=3fce2739205da927b95eb3379b1d066b61282965
	local accepted_v4_target=4b4edc0992803b84c919aadb835e8d2e21095c51
	local healthy_target=33a0054c3c71372aa5509ee8ebfa4578ad512ea1
	local new_comments_runtime=9afbb1656016effbac74a367b23a7608494b7834e8091f375d20fea858e4c468
	local com_ux_runtime=ae2c05a046080f4ea72c2ca70db131eaa866c05bf5444e50070f92273f7b0f87
	local feed_photo_runtime=9c848684f56ce26f57af81136d1dfc351d4a1c52776dcfc41d1291e8e46a6fda
	local target=${PREVIOUS_BACKEND_IMAGE_TAG:-} gate
	[ "${PREVIOUS_WEBAPP_IMAGE_TAG:-}" = "$target" ] || die 'rollback target pair has no verified runtime compatibility attestation'
	case "$target" in
		"$legacy_target")
			gate=true
			;;
		"$candidate_target")
			gate=false
			;;
		"$accepted_v4_target")
		gate=false
			;;
		"$healthy_target")
		gate=false
			;;
		*) die 'rollback target pair has no verified runtime compatibility attestation' ;;
	esac
	[[ "${MEMOLY_PRODUCT_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || die 'rollback source SHA is unknown'
	[ "$(git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" rev-parse HEAD)" = "$MEMOLY_PRODUCT_SHA" ] ||
		die 'rollback source differs from the checked-out release'
	git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" merge-base --is-ancestor "$target" "$MEMOLY_PRODUCT_SHA" ||
		die 'rollback source is outside the exact target release lineage'
	rollback_source_compatibility_profile "$MEMOLY_PRODUCT_SHA" "$target" >/dev/null ||
		die 'application runtime differs from the verified rollback source'
	printf '%s\n' "$gate"
}

verify_application_rollback() {
	local migration_phase=${1:-complete}
	case "$migration_phase" in complete|pre-sql) ;; *) die 'unknown application rollback verification phase' ;; esac
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
	local accepted_v4_target=4b4edc0992803b84c919aadb835e8d2e21095c51
	local healthy_target=33a0054c3c71372aa5509ee8ebfa4578ad512ea1
	local new_comments_runtime=9afbb1656016effbac74a367b23a7608494b7834e8091f375d20fea858e4c468
	local com_ux_runtime=ae2c05a046080f4ea72c2ca70db131eaa866c05bf5444e50070f92273f7b0f87
	local feed_photo_runtime=9c848684f56ce26f57af81136d1dfc351d4a1c52776dcfc41d1291e8e46a6fda
	local target expected_target_runtime profile=candidate
	case "$PREVIOUS_BACKEND_IMAGE_TAG:$PREVIOUS_WEBAPP_IMAGE_TAG" in
		"$legacy_target:$legacy_target")
			target=$legacy_target
			expected_target_runtime=b12190f9bd6e568b544d89d4c4beec8198ad7626b03bdd9164cf76890d440a4e
			;;
		"$candidate_target:$candidate_target")
			target=$candidate_target
			expected_target_runtime=3d021aa1eb5160c8022ad5da3189ee30d6738bcb967f752458bef38145509857
			;;
		"$accepted_v4_target:$accepted_v4_target")
			target=$accepted_v4_target
			expected_target_runtime=5a8c7cfe1839c8ed44434f80ddf7a83e1e9f6c43154a249f3b214ca3d25b5e02
			profile=comments
			;;
		"$healthy_target:$healthy_target")
			target=$healthy_target
			expected_target_runtime=$com_ux_runtime
			profile=comments
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
	local target_runtime
	profile=$(rollback_source_compatibility_profile "$MEMOLY_PRODUCT_SHA" "$target") ||
		die 'application runtime differs from the verified rollback source'
	target_runtime=$(rollback_runtime_fingerprint "$target") || die 'cannot fingerprint rollback target runtime'
	[ "$target_runtime" = "$expected_target_runtime" ] || die 'rollback target runtime differs from the verified compatibility target'
	if [ "$profile" = comments ] || [ "$profile" = albums ] || [ "$profile" = wishlist ]; then
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
		"$accepted_v4_target")
		expected_backend_id=sha256:400f49886253aeb1d23d3688de5d5cce20fba3b4b1c20a82a9d6453ecb7d2bdc
			expected_webapp_id=sha256:70682430fd480dfddb3d3df0431665ea71d8018c0a0993993b8ffb6360baadf9
			;;
		"$healthy_target")
			expected_backend_id=sha256:50ef108db452f8da24a159161edb0510ed3fe5612275ac701bf883327315dfd9
			expected_webapp_id=sha256:63be673e1a57af5faaeafa6b3d3136314808b8826640873f5cafa4f4f9bebe74
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
	if { [ "$profile" = albums ] || [ "$profile" = wishlist ]; } && [ "$migration_phase" = pre-sql ]; then
		# The exact prefix ledger check below is the pre-SQL migration gate. Prisma
		# migrate status intentionally reports a pending reviewed additive suffix.
		:
	else
		migration_status >/dev/null 2>&1 || die 'rollback target cannot confirm completed migrations'
	fi
	# Both capabilities are proven by the current -> old -> current PostgreSQL probe.
	# Missing tables, unknown result types, unfinished migrations and read errors fail closed.
	compose run --rm --no-deps backend bun -e 'import { Client } from "pg"; const client = new Client({ connectionString: process.env.DATABASE_URL }); try { await client.connect(); const result = await client.query("SELECT EXISTS (SELECT 1 FROM families WHERE unread_tracking_activated_at IS NOT NULL) AS unread, EXISTS (SELECT 1 FROM family_members m JOIN families f ON f.id = m.family_id WHERE m.revoked_at IS NULL AND f.status = '\''active'\'' GROUP BY m.user_id HAVING COUNT(*) > 1) AS multiple, EXISTS (SELECT 1 FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS unfinished"); const state=result.rows[0]; const capabilities={unread:true,multiple:true}; const valid=state && typeof state.unread==="boolean" && typeof state.multiple==="boolean" && typeof state.unfinished==="boolean" && !state.unfinished && (!state.unread || capabilities.unread) && (!state.multiple || capabilities.multiple); await client.end(); process.exit(valid ? 0 : 1) } catch { await client.end().catch(() => {}); process.exit(1) }' >/dev/null 2>&1 ||
		die 'rollback data compatibility state is unknown or migration is unfinished'
	if [ "$profile" = comments ]; then
		local expected_migration_checksums
		expected_migration_checksums=$(rollback_migration_catalog_checksums "$MEMOLY_PRODUCT_SHA") ||
			die 'cannot fingerprint the verified comments migration catalog'
		[[ -n "$expected_migration_checksums" ]] || die 'verified comments migration catalog is empty'
		rollback_verify_migration_history "$expected_migration_checksums" ||
			die 'comments rollback requires the exact completed migration history'
	elif [ "$profile" = albums ]; then
		rollback_verify_albums_migration_history "$migration_phase" ||
			die 'albums rollback requires the exact reviewed migration history for this phase'
	elif [ "$profile" = wishlist ]; then
		rollback_verify_wishlist_migration_history "$migration_phase" ||
			die 'wishlist rollback requires the exact reviewed migration history for this phase'
	fi
	)
}

rollback() {
	verify_application_rollback complete || die 'application rollback compatibility could not be verified'
	set -a
	. "$ROLLBACK_ENV"
	set +a
	require_accepted_ui_target "$PREVIOUS_WEBAPP_IMAGE_TAG"
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
	require_accepted_ui_target "$PREVIOUS_WEBAPP_IMAGE_TAG"
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
	read_static_rollback_tag
	require_accepted_ui_target "$PREVIOUS_WEBAPP_IMAGE_TAG"
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
	local migration_phase=complete lock_path fd_target requested_phase=${SELECTEL_WISHLIST_LEDGER_PHASE:-${SELECTEL_ALBUMS_LEDGER_PHASE:-complete}}
	case "$requested_phase" in
		complete) ;;
		pre-sql)
			[ "${SELECTEL_CI_RELEASE:-false}" = true ] || die 'pre-SQL migration readiness is restricted to the guarded CI release'
			[[ "${SELECTEL_DEPLOY_LOCK_FD:-}" =~ ^[0-9]+$ ]] || die 'pre-SQL album readiness requires the inherited deploy lock'
			lock_path=$(readlink -f -- "$SERVER_ROOT/.selectel-deploy.lock") || die 'deployment lock path is unavailable'
			fd_target=$(readlink "/proc/self/fd/$SELECTEL_DEPLOY_LOCK_FD" 2>/dev/null || true)
			[ "$fd_target" = "$lock_path" ] || die 'pre-SQL migration readiness lock does not reference the expected lock file'
			{ true >&"$SELECTEL_DEPLOY_LOCK_FD"; } 2>/dev/null || die 'pre-SQL migration readiness lock is not open'
			flock -n "$SELECTEL_DEPLOY_LOCK_FD" || die 'pre-SQL migration readiness lock is not held'
			migration_phase=pre-sql
			;;
		*) die 'unknown migration ledger readiness phase' ;;
	esac
	verify_application_rollback "$migration_phase" || die 'application rollback compatibility could not be verified'
	set -a
	. "$ROLLBACK_ENV"
	set +a
	require_accepted_ui_target "$PREVIOUS_WEBAPP_IMAGE_TAG"
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
	trap cleanup_candidate EXIT
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

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
	main "$@"
fi
