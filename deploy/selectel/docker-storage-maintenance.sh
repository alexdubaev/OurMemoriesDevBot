#!/usr/bin/env bash
set -Eeuo pipefail

# Host maintenance only: no application promotion, SQL, image/volume pruning,
# container stop/recreate, or change to the filesystem-only d299 rollback gate.
ROOT=/opt/memoly
APP=$ROOT/app
DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
operation=${1:-plan}
source_sha=${2:-}
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
case "$operation" in plan|apply) ;; *) die 'usage: docker-storage-maintenance.sh plan | apply ACCEPTED_SHA MAINTAIN' ;; esac
[ "$(id -u)" = 0 ] || die 'existing root maintenance access required'
for command in docker dockerd systemctl python3 flock git curl stat readlink sed awk; do command -v "$command" >/dev/null || die "missing command: $command"; done
exec 9>"$ROOT/.selectel-deploy.lock"
flock -n 9 || die 'another release owns the host lock; no change made'
[ "$(systemctl show docker -p KillMode --value)" = process ] || die 'Docker service stop semantics are not verified'
[ -z "$(systemctl show docker -p ExecStop --value)" ] && [ -z "$(systemctl show docker -p ExecStopPost --value)" ] || die 'unexpected Docker stop hooks'
[ "$(docker info --format '{{.Swarm.LocalNodeState}}')" = inactive ] || die 'standalone Docker required'
[ "$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')" -ge 4194304 ] || die 'less than the existing 4 GiB disk floor'
server_version=$(docker version --format '{{.Server.Version}}')
binary_version=$(dockerd --version | sed -E 's/^Docker version ([^,]+),.*/\1/')
[ "$server_version" = "$binary_version" ] || die 'installed daemon version differs; this operation must not perform an upgrade'
daemon_pid=$(systemctl show docker -p MainPID --value)
[ "$(readlink -f "/proc/$daemon_pid/exe")" = "$(readlink -f "$(command -v dockerd)")" ] || die 'running daemon binary differs from the installed executable'
curl -fsS --max-time 10 https://app.memoly.ru/health/ready >/dev/null || die 'production not ready before maintenance'

snapshot() {
 python3 - <<'PY'
import subprocess,json
ids=subprocess.check_output(['docker','ps','-aq'],text=True).split()
rows=json.loads(subprocess.check_output(['docker','inspect',*ids],text=True)) if ids else []
print(json.dumps(sorted([{'id':x['Id'],'image':x['Image'],'running':x['State']['Running'],'pid':x['State']['Pid'],'started':x['State']['StartedAt'],'restarts':x['RestartCount']} for x in rows],key=lambda x:x['id']),sort_keys=True))
PY
}
if [ "$operation" = plan ]; then
 docker info --format 'liveRestore={{.LiveRestoreEnabled}}'
 printf 'Proposed: native builder GC target 2GB; live restore enabled; one protected daemon restart, no container/image/volume deletion.\n'
 exit 0
fi
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] && [ "${3:-}" = MAINTAIN ] || die 'accepted SHA and MAINTAIN required'
remote=$(git -c safe.directory="$APP" -C "$APP" remote get-url origin)
case "$remote" in git@github.com:alexdubaev/OurMemoriesDevBot.git|https://github.com/alexdubaev/OurMemoriesDevBot.git) ;; *) die 'unknown repository' ;; esac
git -c safe.directory="$APP" -C "$APP" merge-base --is-ancestor "$source_sha" origin/main || die 'maintenance source is not accepted main'
for path in docker-storage-maintenance.sh storage-daemon-config.py; do
 expected=$(git -c safe.directory="$APP" -C "$APP" rev-parse "$source_sha:deploy/selectel/$path")
 actual=$(git -c safe.directory="$APP" -C "$APP" hash-object "$DIR/$path")
 [ "$actual" = "$expected" ] || die 'maintenance executable differs from accepted source'
done
python3 - <<'PY'
from pathlib import Path
import stat
p=Path('/etc/docker/daemon.json')
for item in [Path('/etc'),Path('/etc/docker'),p]:
 s=item.lstat()
 if item.is_symlink() or s.st_uid!=0 or s.st_mode & 0o022:raise RuntimeError('unsafe Docker configuration path')
if not p.is_file() or p.stat().st_nlink!=1:raise RuntimeError('Docker configuration must be a regular unlinked file')
PY
umask 077
state=$(mktemp -d "$ROOT/diagnostics/docker-storage-XXXXXXXX")
snapshot > "$state/containers.before.json"
docker image inspect --format '{{.Id}}' memoly-backend:d2999cca6e4e5980cc2277de7453440353f5b392 memoly-webapp:d2999cca6e4e5980cc2277de7453440353f5b392 > "$state/recovery-images.before"
cp /etc/docker/daemon.json "$state/daemon.before.json"
python3 "$DIR/storage-daemon-config.py" /etc/docker/daemon.json "$state/daemon.candidate.json"
dockerd --validate --config-file "$state/daemon.candidate.json" > "$state/validate.log" 2>&1 || die 'candidate rejected; live configuration unchanged'
if cmp -s "$state/daemon.before.json" "$state/daemon.candidate.json" && [ "$(docker info --format '{{.LiveRestoreEnabled}}')" = true ]; then
 printf 'Requested policy already installed; no restart performed.\n'; exit 0
fi
# Docker reads this regular file on reload; no container bind-mount requires its
# inode. Atomic replacement prevents an interrupted write corrupting live config.
python3 "$DIR/storage-daemon-config.py" --activate "$state/daemon.candidate.json" /etc/docker/daemon.json
cmp -s "$state/daemon.candidate.json" /etc/docker/daemon.json || die 'activated config differs from validated candidate'
systemctl reload docker || die 'reload failed; validated config and private backup retained for recovery'
[ "$(docker info --format '{{.LiveRestoreEnabled}}')" = true ] || die 'live restore did not activate; daemon restart refused'
snapshot > "$state/containers.after-reload.json"
cmp "$state/containers.before.json" "$state/containers.after-reload.json" || die 'container state changed during reload; restart refused'
# Same daemon version, network and storage options. Live restore is verified
# before restarting the daemon to release stale BuildKit references.
[ "$(dockerd --version | sed -E 's/^Docker version ([^,]+),.*/\1/')" = "$server_version" ] || die 'daemon changed during maintenance; restart refused'
systemctl restart docker || die 'daemon restart failed; preserve live-restore protection and investigate the saved state'
ready=false
for attempt in $(seq 1 30); do
 if docker info >/dev/null 2>&1; then ready=true;break;fi
 sleep 1
done
[ "$ready" = true ] || die 'Docker control plane did not recover'
[ "$(docker info --format '{{.LiveRestoreEnabled}}')" = true ] || die 'live restore not retained'
snapshot > "$state/containers.after.json"
cmp "$state/containers.before.json" "$state/containers.after.json" || die 'container identity, PID or restart count changed; inspect saved state'
docker image inspect --format '{{.Id}}' memoly-backend:d2999cca6e4e5980cc2277de7453440353f5b392 memoly-webapp:d2999cca6e4e5980cc2277de7453440353f5b392 > "$state/recovery-images.after"
cmp "$state/recovery-images.before" "$state/recovery-images.after" || die 'recovery image identity changed'
curl -fsS --max-time 10 https://app.memoly.ru/health/ready >/dev/null || die 'public readiness failed after maintenance'
printf 'PASS: native GC target 2GB, live restore active, all container IDs/PIDs/restart counts unchanged. Evidence: %s\n' "$state"
