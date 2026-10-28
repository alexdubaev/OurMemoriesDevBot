#!/usr/bin/env bash
# Explicit root-only integration check. Never selects the default Docker socket.
set -Eeuo pipefail
[ "$(id -u)" = 0 ] || { echo 'root required for isolated dockerd'; exit 1; }
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
state=$(mktemp -d /tmp/memoly-docker-test-XXXXXXXX)
socket="unix://$state/docker.sock"
pid=
cleanup() {
 if [ -S "$state/docker.sock" ]; then docker -H "$socket" rm -f probe >/dev/null 2>&1 || true; fi
 if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then kill -TERM "$pid"; wait "$pid" || true; fi
 # Keep diagnostic files on failure; no default-engine or recursive deletion.
 echo "Isolated daemon evidence: $state"
}
trap cleanup EXIT
printf '{}\n' > "$state/daemon.json"
start() {
 dockerd --data-root "$state/data" --exec-root "$state/exec" --pidfile "$state/daemon.pid" \
   --host "$socket" --bridge none --iptables=false --ip-forward=false --ip-masq=false \
   --config-file "$state/daemon.json" >> "$state/daemon.log" 2>&1 &
 pid=$!
 for attempt in $(seq 1 60); do
   if docker -H "$socket" info >/dev/null 2>&1; then return; fi
   kill -0 "$pid" 2>/dev/null || { tail -30 "$state/daemon.log"; return 1; }
   sleep 1
 done
 return 1
}
snapshot() { docker -H "$socket" inspect --format '{{.Id}} {{.Image}} {{.State.Pid}} {{.State.StartedAt}} {{.RestartCount}} {{.State.Running}}' probe; }
start
docker -H "$socket" pull busybox:1.37.0 > "$state/pull.log"
docker -H "$socket" run -d --name probe --network none busybox:1.37.0 sleep 600 > "$state/container.id"
snapshot > "$state/before"
container_pid=$(docker -H "$socket" inspect --format '{{.State.Pid}}' probe)
python3 "$repo/deploy/selectel/storage-daemon-config.py" "$state/daemon.json" "$state/candidate.json"
dockerd --validate --config-file "$state/candidate.json"
python3 "$repo/deploy/selectel/storage-daemon-config.py" --activate "$state/candidate.json" "$state/daemon.json"
kill -HUP "$pid"
for attempt in $(seq 1 20); do
 [ "$(docker -H "$socket" info --format '{{.LiveRestoreEnabled}}')" = true ] && break
 sleep 1
done
[ "$(docker -H "$socket" info --format '{{.LiveRestoreEnabled}}')" = true ]
snapshot > "$state/reload"
cmp "$state/before" "$state/reload"
kill -TERM "$pid"
wait "$pid"
pid=
kill -0 "$container_pid"
start
snapshot > "$state/after"
cmp "$state/before" "$state/after"
[ "$(docker -H "$socket" info --format '{{.LiveRestoreEnabled}}')" = true ]
echo 'PASS: actual isolated daemon reload/restart preserved container ID, image, PID, start time and restart count.'
