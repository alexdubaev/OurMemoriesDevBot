#!/usr/bin/env bash
set -Eeuo pipefail

# Narrow, reversible switch for the isolated minimal-feed static experiment.
SERVER_ROOT=/opt/memoly
APP_ROOT=$SERVER_ROOT/app
RELEASE_ROOT=$SERVER_ROOT/experiments/minimal-feed/releases
GATEWAY_CONTAINER=memoly-webapp-1
EDGE_NETWORK=memoly_default
GATEWAY_FILE=$SERVER_ROOT/gateway/Caddyfile
GATEWAY_MOUNT=/etc/caddy/Caddyfile
PUBLIC_URL=https://app.memoly.ru
PREFIX=/__experiments/minimal-feed
BEGIN_MARKER='# BEGIN CODEX MINIMAL-FEED EXPERIMENT'
END_MARKER='# END CODEX MINIMAL-FEED EXPERIMENT'
ACTIVE_BACKUP=
ACTIVE_CANDIDATE=

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
require() { command -v "$1" >/dev/null 2>&1 || die "required command is missing: $1"; }
root_only_file() {
	[ -f "$1" ] && [ ! -L "$1" ] && [ "$(stat -c '%u' "$1")" = 0 ] || die "expected a root-owned regular file: $1"
	local mode
	mode=$(stat -c '%a' "$1")
	(( (8#$mode & 0022) == 0 )) || die "file is group/other writable: $1"
}
root_only_dir() {
	[ -d "$1" ] && [ ! -L "$1" ] && [ "$(stat -c '%u' "$1")" = 0 ] || die "expected a root-owned directory: $1"
	local mode
	mode=$(stat -c '%a' "$1")
	(( (8#$mode & 0022) == 0 )) || die "directory is group/other writable: $1"
}
sha_file() { sha256sum -- "$1" | awk '{print $1}'; }
cleanup() {
	[ -z "$ACTIVE_CANDIDATE" ] || rm -f -- "$ACTIVE_CANDIDATE"
}
trap cleanup EXIT

host_preflight() {
	[ "$(id -u)" -eq 0 ] || die 'run as root'
	[ "$(uname -s)" = Linux ] || die 'this helper is supported only on the Selectel Linux host'
	[ "$(readlink -f -- "$SERVER_ROOT")" = "$SERVER_ROOT" ] || die 'unexpected Selectel root path'
	[ "$(readlink -f -- "$APP_ROOT")" = "$APP_ROOT" ] || die 'unexpected application checkout path'
	[ -f "$APP_ROOT/deploy/selectel/in-place-file.sh" ] && [ -r "$APP_ROOT/deploy/selectel/in-place-file.sh" ] && [ ! -L "$APP_ROOT/deploy/selectel/in-place-file.sh" ] || die 'existing in-place-file helper is unavailable'
	[ "$(stat -c '%u' "$APP_ROOT/deploy/selectel/in-place-file.sh")" = "$(id -u memoly)" ] || die 'existing in-place-file helper must remain owned by the memoly checkout user'
	local helper_mode
	helper_mode=$(stat -c '%a' "$APP_ROOT/deploy/selectel/in-place-file.sh")
	(( (8#$helper_mode & 0022) == 0 )) || die 'existing in-place-file helper is group/other writable'
	{ [ -e /opt/memoly/.selectel-b2-forward-only ] || [ -L /opt/memoly/.selectel-b2-forward-only ]; } && die 'B2 forward-only marker is present; stop before changing gateway config'
	{ [ -e /opt/memoly/.selectel-mm0-forward-only ] || [ -L /opt/memoly/.selectel-mm0-forward-only ]; } && die 'MM0 forward-only marker is present; stop before changing gateway config'
	[ -f "$GATEWAY_FILE" ] && [ ! -L "$GATEWAY_FILE" ] || die 'active gateway Caddyfile must be a regular file'
	local labels network mount
	[ "$(docker inspect --format '{{.State.Status}}' "$GATEWAY_CONTAINER")" = running ] || die 'gateway is not running'
	labels=$(docker inspect --format '{{json .Config.Labels}}' "$GATEWAY_CONTAINER")
	case "$labels" in *com.docker.compose.project*|*com.docker.compose.service*) die 'gateway has Compose ownership labels';; esac
	network=$(docker inspect --format '{{json .NetworkSettings.Networks}}' "$GATEWAY_CONTAINER")
	case "$network" in *'"memoly_default"'*) ;; *) die 'gateway is not attached to memoly_default';; esac
	mount=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Type}}|{{.Source}}|{{.RW}}{{end}}{{end}}' "$GATEWAY_CONTAINER")
	[ "$mount" = "bind|$SERVER_ROOT/gateway|false" ] || die 'gateway must mount /opt/memoly/gateway:/etc/caddy:ro'
	docker network inspect "$EDGE_NETWORK" >/dev/null 2>&1 || die 'memoly_default network is unavailable'
	local available
	available=$(df -Pk "$SERVER_ROOT" | awk 'NR==2 {print $4}')
	[ "$available" -ge 4194304 ] || die 'less than 4 GiB is available on the Selectel filesystem'
}

active_state() {
	python3 - "$GATEWAY_FILE" "$BEGIN_MARKER" "$END_MARKER" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
with open(p, newline='') as stream:
    text = stream.read()
begin, end = sys.argv[2:]
if text.count(begin) != text.count(end) or text.count(begin) > 1:
    raise SystemExit('ERROR: experiment route markers are malformed or duplicated')
if begin not in text:
    print('off')
    raise SystemExit(0)
block = text.split(begin, 1)[1].split(end, 1)[0]
import re
matches = re.findall(r'memoly-minimal-feed-([0-9a-f]{40}):80', block)
if len(matches) != 1:
    raise SystemExit('ERROR: cannot identify the active experiment SHA from its route')
mode_matches = re.findall(r'^# CODEX MINIMAL-FEED MODE: (root|prefix)$', block, re.M)
if len(mode_matches) > 1:
    raise SystemExit('ERROR: experiment route has multiple mode markers')
# Routes created by the previous helper version were prefix-only.
mode = mode_matches[0] if mode_matches else 'prefix'
print(matches[0], mode)
PY
}

route_candidate() {
	local target=$1 mode=$2 output=$3
	python3 - "$GATEWAY_FILE" "$output" "$BEGIN_MARKER" "$END_MARKER" "$target" "$mode" <<'PY'
import pathlib, sys
source, destination, begin, end, target, mode = sys.argv[1:]
with open(source, newline='') as stream:
    text = stream.read()
if text.count(begin) != text.count(end) or text.count(begin) > 1:
    raise SystemExit('ERROR: existing experiment route markers are malformed or duplicated')
block = ''
if target != 'off':
    if mode == 'root':
        block = (f'{begin}\n# CODEX MINIMAL-FEED MODE: root\n'
                 f'\t@minimal_feed_{target} path / /__experiments/minimal-feed/*\n'
                 f'\thandle @minimal_feed_{target} {{\n'
                 f'\t\treverse_proxy memoly-minimal-feed-{target}:80\n\t}}\n{end}\n')
    else:
        block = (f'{begin}\n# CODEX MINIMAL-FEED MODE: prefix\n'
                 f'\thandle /__experiments/minimal-feed/* {{\n'
                 f'\t\treverse_proxy memoly-minimal-feed-{target}:80\n\t}}\n{end}\n')
if begin in text:
    start = text.index(begin)
    after = text.index(end, start) + len(end)
    if text[after:after + 1] == '\n':
        after += 1
    text = text[:start] + block + text[after:]
else:
    if target == 'off':
        pass
    else:
        anchor = '\t# Host ports stay on the stable gateway; normal traffic goes to internal static:80.\n'
        if text.count(anchor) != 1:
            raise SystemExit('ERROR: expected exactly one stable gateway route anchor')
        text = text.replace(anchor, block + anchor, 1)
with open(destination, 'w', newline='') as stream:
    stream.write(text)
PY
}

normal_services_snapshot() {
	local ids
	ids=$(docker ps -q --filter label=com.docker.compose.project=memoly)
	[ -n "$ids" ] || die 'normal memoly Compose services are not running'
	docker inspect --format '{{.Name}} {{.Image}}' $ids | LC_ALL=C sort
}
root_html_hash() { curl --fail --silent --show-error --compressed --max-time 10 "$PUBLIC_URL/" | sha256sum | awk '{print $1}'; }
canonical_root_hash() {
	docker exec memoly-static-1 sha256sum /srv/index.html | awk '{print $1}'
}
check_normal_health() {
	local path
	for path in /health/live /health/ready; do
		curl --fail --silent --show-error --max-time 10 "$PUBLIC_URL$path" >/dev/null || return 1
	done
}
gateway_hash_matches() {
	local host_hash mounted_hash
	host_hash=$(sha_file "$GATEWAY_FILE") || return 1
	mounted_hash=$(docker exec "$GATEWAY_CONTAINER" sha256sum "$GATEWAY_MOUNT" | awk '{print $1}') || return 1
	[ "$host_hash" = "$mounted_hash" ]
}
validate_gateway_candidate() {
	docker cp "$ACTIVE_CANDIDATE" "$GATEWAY_CONTAINER:/tmp/minimal-feed-candidate-$$.Caddyfile" >/dev/null || return 1
	docker exec "$GATEWAY_CONTAINER" caddy validate --config "/tmp/minimal-feed-candidate-$$.Caddyfile" --adapter caddyfile || return 1
}
install_gateway_candidate() {
	local inode_before inode_after expected actual backup_dir
	validate_gateway_candidate || return 1
	mkdir -p "$SERVER_ROOT/backups" || return 1
	root_only_dir "$SERVER_ROOT/backups" || return 1
	backup_dir=$(mktemp -d "$SERVER_ROOT/backups/minimal-feed-$(date -u +%Y%m%dT%H%M%SZ).XXXXXXXX") || return 1
	chmod 700 "$backup_dir" || return 1
	ACTIVE_BACKUP=$backup_dir/Caddyfile
	install -o root -g root -m 0600 "$GATEWAY_FILE" "$ACTIVE_BACKUP" || return 1
	inode_before=$(stat -c '%i' "$GATEWAY_FILE") || return 1
	bash "$APP_ROOT/deploy/selectel/in-place-file.sh" activate "$ACTIVE_CANDIDATE" "$GATEWAY_FILE" || return 1
	inode_after=$(stat -c '%i' "$GATEWAY_FILE") || return 1
	[ "$inode_before" = "$inode_after" ] || return 1
	expected=$(sha_file "$ACTIVE_CANDIDATE") || return 1
	actual=$(sha_file "$GATEWAY_FILE") || return 1
	[ "$expected" = "$actual" ] && gateway_hash_matches || return 1
	docker exec "$GATEWAY_CONTAINER" caddy validate --config "$GATEWAY_MOUNT" --adapter caddyfile || return 1
	docker exec "$GATEWAY_CONTAINER" caddy reload --config "$GATEWAY_MOUNT" --adapter caddyfile || return 1
}
restore_gateway() {
	local expected_root=$1 restored_root
	[ -n "$ACTIVE_BACKUP" ] && [ -f "$ACTIVE_BACKUP" ] || { printf 'ERROR: gateway backup is unavailable\n' >&2; return 1; }
	bash "$APP_ROOT/deploy/selectel/in-place-file.sh" restore "$ACTIVE_BACKUP" "$GATEWAY_FILE" || return 1
	gateway_hash_matches || return 1
	docker exec "$GATEWAY_CONTAINER" caddy validate --config "$GATEWAY_MOUNT" --adapter caddyfile || return 1
	docker exec "$GATEWAY_CONTAINER" caddy reload --config "$GATEWAY_MOUNT" --adapter caddyfile || return 1
	check_normal_health || return 1
	restored_root=$(root_html_hash) || return 1
	[ "$restored_root" = "$expected_root" ] || return 1
}
rollback_failure() {
	local why=$1 previous_root=$2
	printf 'ERROR: %s\n' "$why" >&2
	if [ -z "$ACTIVE_BACKUP" ] || [ ! -f "$ACTIVE_BACKUP" ]; then
		printf 'NO_GATEWAY_CHANGE_MADE\n' >&2
	elif restore_gateway "$previous_root"; then printf 'ROLLED_BACK_AFTER_EXPERIMENT_FAILURE\n' >&2
	else printf 'GATEWAY_ROLLBACK_FAILED_AFTER_EXPERIMENT_FAILURE\n' >&2; fi
	exit 1
}

validate_artifact() {
	local sha=$1 release=$RELEASE_ROOT/$1 file_count
	[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die 'activate requires a full 40-character lowercase Git SHA'
	root_only_dir /opt/memoly/experiments
	root_only_dir /opt/memoly/experiments/minimal-feed
	root_only_dir "$RELEASE_ROOT"
	root_only_dir "$release"
	root_only_dir "$release/dist"
	root_only_file "$release/SHA256SUMS"
	local dir
	while IFS= read -r -d '' dir; do root_only_dir "$dir"; done < <(find "$release/dist" -mindepth 1 -type d -print0)
	while IFS= read -r -d '' file; do root_only_file "$file"; done < <(find "$release/dist" -type f -print0)
	if find "$release/dist" -type l -print -quit | grep -q .; then die 'artifact contains a symlink'; fi
	local js css line checksum path
	local -A manifest_paths=()
	mapfile -t js < <(find "$release/dist/assets" -maxdepth 1 -type f -name 'index-*.js' -printf '%P\n' 2>/dev/null | LC_ALL=C sort)
	mapfile -t css < <(find "$release/dist/assets" -maxdepth 1 -type f -name 'diagnostic-feed-*.css' -printf '%P\n' 2>/dev/null | LC_ALL=C sort)
	[ -f "$release/dist/diagnostic.html" ] && [ "${#js[@]}" -eq 1 ] && [ "${#css[@]}" -eq 1 ] || die 'artifact must contain diagnostic.html and exactly one expected JS and CSS asset'
	file_count=$(find "$release/dist" -type f | wc -l)
	[ "$file_count" -eq 3 ] || die 'artifact must contain exactly the three approved files'
	(
		cd "$release"
		[ "$(wc -l < SHA256SUMS)" -eq 3 ] || die 'SHA256SUMS must contain exactly three entries'
		while IFS= read -r line; do
			[[ "$line" =~ ^[0-9a-f]{64}'  'dist/(diagnostic\.html|assets/index-[A-Za-z0-9_-]+\.js|assets/diagnostic-feed-[A-Za-z0-9_-]+\.css)$ ]] || die 'SHA256SUMS contains an unexpected entry'
			checksum=${line:0:64}
			path=${line:66}
			[[ -z "${manifest_paths[$path]+present}" ]] || die "SHA256SUMS contains a duplicate entry: $path"
			manifest_paths["$path"]=$checksum
		done < SHA256SUMS
		[ -n "${manifest_paths[dist/diagnostic.html]+present}" ] || die 'SHA256SUMS omits dist/diagnostic.html'
		[ -n "${manifest_paths[dist/assets/${js[0]}]+present}" ] || die "SHA256SUMS omits dist/assets/${js[0]}"
		[ -n "${manifest_paths[dist/assets/${css[0]}]+present}" ] || die "SHA256SUMS omits dist/assets/${css[0]}"
		[ "${#manifest_paths[@]}" -eq 3 ] || die 'SHA256SUMS must contain exactly the three unique artifact paths'
		sha256sum --check --status SHA256SUMS || die 'artifact checksum verification failed'
	)
}

prepare_release() {
	local sha=$1 mode=$2 release=$RELEASE_ROOT/$1 metadata=$RELEASE_ROOT/$1/release.env image_id current_image
	validate_artifact "$sha"
	root_only_dir "$RELEASE_ROOT/$sha"
	if [ -e "$metadata" ]; then
		root_only_file "$metadata"
		# shellcheck disable=SC1090
		source "$metadata"
		[ "${SOURCE_SHA:-}" = "$sha" ] || die 'release metadata SHA mismatch'
		[[ "${STATIC_IMAGE_ID:-}" =~ ^sha256:[0-9a-f]{64}$ ]] || die 'recorded static image ID is invalid'
		local checksum path key
		while read -r checksum path; do
			key=ARTIFACT_$(basename "$path" | tr '.-' '__')
			[ "${!key:-}" = "$checksum" ] || die "release manifest checksum does not match $path"
		done < "$release/SHA256SUMS"
	else
		current_image=$(docker inspect --format '{{.Image}}' memoly-static-1) || die 'cannot inspect current static service image'
		[[ "$current_image" =~ ^sha256:[0-9a-f]{64}$ ]] || die 'current static image ID is invalid'
		STATIC_IMAGE_ID=$current_image
		SOURCE_SHA=$sha
		{
			printf 'SOURCE_SHA=%s\nSTATIC_IMAGE_ID=%s\n' "$sha" "$STATIC_IMAGE_ID"
			while read -r checksum path; do printf 'ARTIFACT_%s=%s\n' "$(basename "$path" | tr '.-' '__')" "$checksum"; done < "$release/SHA256SUMS"
			printf 'PREPARED_AT_UTC=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
		} > "$metadata.tmp.$$"
		install -o root -g root -m 0600 "$metadata.tmp.$$" "$metadata"
		rm -f -- "$metadata.tmp.$$"
	fi
	STATIC_IMAGE_ID=${STATIC_IMAGE_ID:-}
	local config=$release/Caddyfile
	if [ ! -e "$config" ]; then
		install -o root -g root -m 0600 /dev/null "$config"
		cat > "$config" <<'EOF'
# CODEX MINIMAL-FEED ROOT SUPPORT v1
:80 {
	@minimal_feed_root path /
	handle @minimal_feed_root {
		root * /srv
		header Cache-Control "no-store"
		rewrite * /diagnostic.html
		file_server
	}
	handle_path /__experiments/minimal-feed/* {
		root * /srv
		header Cache-Control "no-store"
		file_server
	}
	handle {
		respond "not found" 404
	}
}
EOF
		chmod 600 "$config"
	fi
	root_only_file "$config"
	if [ "$mode" = root ] && ! grep -Fq '# CODEX MINIMAL-FEED ROOT SUPPORT v1' "$config"; then
		die 'this release sidecar predates root-mode support; use a fresh reviewed artifact SHA'
	fi
	image_id=$(awk -F= '$1=="STATIC_IMAGE_ID" {print $2}' "$metadata")
	[[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || die 'release manifest has no valid static image ID'
	local name=memoly-minimal-feed-$sha state existing_image existing_dist existing_config existing_labels existing_networks readonly_root
	if docker inspect "$name" >/dev/null 2>&1; then
		state=$(docker inspect --format '{{.State.Status}}' "$name") || die 'cannot inspect existing experiment container state'
		existing_image=$(docker inspect --format '{{.Image}}' "$name") || die 'cannot inspect existing experiment image'
		existing_dist=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/srv"}}{{.Type}}|{{.Source}}|{{.Destination}}|{{.RW}}{{end}}{{end}}' "$name") || die 'cannot inspect experiment dist mount'
		existing_config=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Type}}|{{.Source}}|{{.Destination}}|{{.RW}}{{end}}{{end}}' "$name") || die 'cannot inspect experiment Caddyfile mount'
		existing_labels=$(docker inspect --format '{{index .Config.Labels "memoly.experiment"}} {{index .Config.Labels "memoly.source-sha"}}' "$name") || die 'cannot inspect experiment labels'
		existing_networks=$(docker inspect --format '{{json .NetworkSettings.Networks}}' "$name") || die 'cannot inspect experiment network'
		readonly_root=$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$name") || die 'cannot inspect experiment root filesystem mode'
		[ "$state" = running ] && [ "$existing_image" = "$image_id" ] &&
			[ "$existing_dist" = "bind|$release/dist|/srv|false" ] &&
			[ "$existing_config" = "bind|$config|/etc/caddy/Caddyfile|false" ] &&
			[ "$existing_labels" = "minimal-feed $sha" ] && [ "$readonly_root" = true ] || die 'existing experiment container does not match its immutable release record'
		case "$existing_networks" in *'"memoly_default"'*) ;; *) die 'existing experiment container is not attached to memoly_default';; esac
	else
		docker run --detach --name "$name" --restart unless-stopped --network "$EDGE_NETWORK" \
			--label memoly.experiment=minimal-feed --label "memoly.source-sha=$sha" \
			--read-only --tmpfs /config:rw,noexec,nosuid,size=16m --tmpfs /data:rw,noexec,nosuid,size=16m --tmpfs /tmp:rw,noexec,nosuid,size=16m \
			--mount "type=bind,src=$release/dist,dst=/srv,readonly" \
			--mount "type=bind,src=$config,dst=/etc/caddy/Caddyfile,readonly" \
			"$image_id" >/dev/null
	fi
	docker exec "$name" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null || die 'experiment Caddyfile validation failed'
}

verify_experiment() {
	local sha=$1 mode=$2 release=$RELEASE_ROOT/$1 expected actual path header_file root_header
	expected=$(sha_file "$release/dist/diagnostic.html")
	actual=$(fetch_hash "$PUBLIC_URL$PREFIX/diagnostic.html") || return 1
	[ "$expected" = "$actual" ] || return 1
	local -a files
	mapfile -t files < <(find "$release/dist/assets" -maxdepth 1 -type f -print | LC_ALL=C sort)
	for path in "${files[@]}"; do
		expected=$(sha_file "$path")
		actual=$(fetch_hash "$PUBLIC_URL$PREFIX/${path#"$release/dist/"}") || return 1
		[ "$expected" = "$actual" ] || return 1
	done
	header_file=$(mktemp)
	curl --fail --silent --show-error --max-time 10 -D "$header_file" -o /dev/null "$PUBLIC_URL$PREFIX/diagnostic.html" || { rm -f "$header_file"; return 1; }
	grep -Eiq '^Cache-Control:.*no-store' "$header_file" || { rm -f "$header_file"; return 1; }
	rm -f "$header_file"
	if [ "$mode" = root ]; then
		expected=$(sha_file "$release/dist/diagnostic.html")
		actual=$(fetch_hash "$PUBLIC_URL/") || return 1
		[ "$expected" = "$actual" ] || return 1
		actual=$(fetch_hash "$PUBLIC_URL/?minimal-feed-smoke=1") || return 1
		[ "$expected" = "$actual" ] || return 1
		root_header=$(mktemp)
		curl --fail --silent --show-error --max-time 10 -D "$root_header" -o /dev/null "$PUBLIC_URL/" || { rm -f "$root_header"; return 1; }
		grep -Eiq '^Cache-Control:.*no-store' "$root_header" || { rm -f "$root_header"; return 1; }
		if grep -Eiq '^Location:' "$root_header"; then rm -f "$root_header"; return 1; fi
		rm -f "$root_header"
	fi
}
fetch_hash() {
	local url=$1 attempt hash
	for attempt in {1..15}; do
		if hash=$(curl --fail --silent --show-error --compressed --max-time 5 "$url" | sha256sum | awk '{print $1}'); then
			printf '%s\n' "$hash"
			return 0
		fi
		sleep 1
	done
	return 1
}

switch_route() {
	local target=$1 mode=${2:-prefix} root_before canonical_root expected_root services_before services_after current
	root_before=$(root_html_hash) || die 'cannot snapshot current root HTML'
	canonical_root=$(canonical_root_hash) || die 'cannot read the canonical root from memoly-static-1'
	check_normal_health || die 'normal public health checks failed before activation'
	services_before=$(normal_services_snapshot)
	current=$(active_state) || die 'cannot read current experiment route'
	if [ "$target" = off ] && [ "$current" = off ]; then printf 'off\n'; return 0; fi
	expected_root=$canonical_root
	if [ "$target" != off ]; then
		prepare_release "$target" "$mode"
		if [ "$mode" = root ]; then expected_root=$(sha_file "$RELEASE_ROOT/$target/dist/diagnostic.html"); fi
	fi
	mkdir -p "$SERVER_ROOT/backups"
	root_only_dir "$SERVER_ROOT/backups"
	ACTIVE_CANDIDATE=$(mktemp "$SERVER_ROOT/backups/minimal-feed-candidate.XXXXXXXX")
	chmod 600 "$ACTIVE_CANDIDATE"
	route_candidate "$target" "$mode" "$ACTIVE_CANDIDATE"
	if ! install_gateway_candidate; then rollback_failure 'gateway candidate could not be safely installed and reloaded' "$root_before"; fi
	if [ "$target" != off ] && ! verify_experiment "$target" "$mode"; then rollback_failure 'experiment HTML, assets, or no-store smoke check failed' "$root_before"; fi
	root_after=$(root_html_hash) || rollback_failure 'root HTML failed after route change' "$root_before"
	[ "$expected_root" = "$root_after" ] || rollback_failure 'root HTML does not match the intended experiment or canonical static page' "$root_before"
	check_normal_health || rollback_failure 'normal /health/live or /health/ready failed after route change' "$root_before"
	services_after=$(normal_services_snapshot) || rollback_failure 'cannot verify normal service image IDs after route change' "$root_before"
	[ "$services_before" = "$services_after" ] || rollback_failure 'normal service image IDs changed during experiment route change' "$root_before"
	if [ "$target" = off ]; then printf 'off\n'; else printf '%s %s\n' "$target" "$mode"; fi
}

usage() { printf 'Usage: %s {status|activate <40-char-sha> [prefix|root]|off}\n' "$0" >&2; }
[ "$#" -ge 1 ] || { usage; exit 2; }
action=$1
mode=prefix
case "$action" in status|off) [ "$#" -eq 1 ] || { usage; exit 2; } ;; activate)
	[ "$#" -eq 2 ] || [ "$#" -eq 3 ] || { usage; exit 2; }
	if [ "$#" -eq 3 ]; then mode=$3; fi
	case "$mode" in prefix|root) ;; *) usage; exit 2 ;; esac
	;; *) usage; exit 2 ;; esac
for command_name in awk curl df docker find flock grep install mktemp python3 readlink sha256sum stat; do require "$command_name"; done
host_preflight
root_only_file "$SERVER_ROOT/.selectel-deploy.lock"
exec 9>"$SERVER_ROOT/.selectel-deploy.lock"
flock -n 9 || die 'another Selectel deployment is running'
if [ "$action" = status ]; then active_state; exit 0; fi
switch_route "${2:-off}" "$mode"
