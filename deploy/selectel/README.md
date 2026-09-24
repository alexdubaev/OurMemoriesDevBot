# Selectel host deployment ownership

This runbook is the reproducible source for the existing Selectel host at
`/opt/memoly/app`. It fixes the previous `memoly-webapp-1` collision by keeping
the already-running host-port Caddy gateway unmanaged and giving Docker Compose
ownership only of internal services.

## Ownership model

- The configured gateway (`GATEWAY_CONTAINER`, normally `memoly-webapp-1`) is a
  manually managed Caddy container. It owns host ports 80/443 and must have no
  `com.docker.compose.*` labels.
- Its durable edge configuration is the read-only directory bind
  `/opt/memoly/gateway:/etc/caddy`; the active host file is
  `/opt/memoly/gateway/Caddyfile`. Its persistent writable Caddy state remains
  mounted as `memoly_caddy_data:/data` and `memoly_caddy_config:/config`.
- The gateway is attached to the shared `memoly_default` network so that its
  upstreams resolve to Compose services. The normal root is `static:80`; the
  old single-file bind must not return (the obsolete path was
  `/opt/memoly/Caddyfile`).
- The Compose project (`COMPOSE_PROJECT`) owns `backend`, `worker`, `scheduler`,
  and `static` on the external `MEMOLY_EDGE_NETWORK` network.
- `static` is the only frontend service. It publishes no host port and has no
  `container_name`; the gateway routes ordinary traffic to `static:80`.
- The static image must contain the built webapp at `/srv` and Caddy must use
  `Caddyfile.static.template`. The gateway uses
  `Caddyfile.edge.template` and routes API/health/scoped handlers before the
  SPA fallback.

The gateway is never addressed through `docker compose` during ordinary
redeploys. The script refuses a missing gateway, a running gateway with Compose
labels, or a missing network. Ordinary redeploys never delete or rename a
container and never use orphan removal.

## One-time host preparation and reconciliation

Verify the external network and attach the existing gateway during a controlled
maintenance window:

```sh
docker network inspect memoly_default >/dev/null 2>&1 || docker network create memoly_default
docker network connect memoly_default memoly-webapp-1
```

If the historical gateway still has a single-file bind, perform the separately
authorized one-time reconciliation before the next diagnostic deployment. A
container cannot be recreated with the same name while the old container is
retained, so rename it. Keep the old stopped container as the rollback artifact
under that rollback name. Record the timestamp, image, ports, restart policy,
all mounts, environment variable names (never their values), and the
container-side working Caddyfile before stopping it. Keep the backup directory
protected because the copied Caddyfile may contain operational configuration:

```sh
TS=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="/opt/memoly/backups/gateway-reconcile-$TS"
OLD_GATEWAY="memoly-webapp-1-rollback-$TS"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
docker inspect --format '{{.Config.Image}}' \
  memoly-webapp-1 > "$BACKUP_DIR/image.txt"
docker inspect --format '{{json .HostConfig.PortBindings}} {{json .HostConfig.RestartPolicy}} {{json .Mounts}}' \
  memoly-webapp-1 > "$BACKUP_DIR/runtime-metadata.json"
docker inspect --format '{{range .Config.Env}}{{println (index (split . "=") 0)}}{{end}}' \
  memoly-webapp-1 > "$BACKUP_DIR/environment-names.txt"
docker cp memoly-webapp-1:/etc/caddy/Caddyfile "$BACKUP_DIR/Caddyfile.live"
install -d -m 0755 /opt/memoly/gateway
install -m 0644 "$BACKUP_DIR/Caddyfile.live" /opt/memoly/gateway/Caddyfile
printf '%s\n' \
  "docker stop memoly-webapp-1" \
  "docker rm memoly-webapp-1" \
  "docker rename $OLD_GATEWAY memoly-webapp-1" \
  "docker start memoly-webapp-1" > "$BACKUP_DIR/rollback-gateway.sh"
chmod 700 "$BACKUP_DIR/rollback-gateway.sh"
docker stop memoly-webapp-1
docker rename memoly-webapp-1 "$OLD_GATEWAY"
```

Create the replacement `memoly-webapp-1` from the recorded image, environment,
ports, restart policy, and all required mounts, changing only the Caddy config
mount to `/opt/memoly/gateway:/etc/caddy:ro` and retaining
`memoly_caddy_data:/data`, `memoly_caddy_config:/config`, host ports 80/443,
and the `memoly_default` network. Before any manual MAX runtime diagnostic,
require the replacement to pass both the exact mount check and Caddy candidate
validation:

```sh
test "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Type}}|{{.Source}}|{{.RW}}{{end}}{{end}}' memoly-webapp-1)" = \
  "bind|/opt/memoly/gateway|false"
docker exec memoly-webapp-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

If either check fails, stop the replacement and run the exact saved command
`"$BACKUP_DIR/rollback-gateway.sh"`; otherwise keep the old stopped container
until that diagnostic is complete. Do not use this exception during ordinary
redeploys.

Copy `rollback.env.example` to an ignored server-only file such as
`/opt/memoly/rollback.env`, then set the previous accepted immutable tags.
Keep the Compose env files at `/opt/memoly/env/postgres.env` and
`/opt/memoly/env/backend.env`, and keep the three MAX secret files under
`/opt/memoly/secrets/`. Never commit any of these server-only files.

## Promotion

Run from `/opt/memoly/app` after a reviewed checkout has supplied these files:

```sh
export MEMOLY_PRODUCT_SHA='0123456789abcdef0123456789abcdef01234567'
export MEMOLY_BACKEND_IMAGE_TAG="$MEMOLY_PRODUCT_SHA"
export MEMOLY_WEBAPP_IMAGE_TAG="$MEMOLY_PRODUCT_SHA"
export MEMOLY_PUBLIC_HOST='app.memoly.ru'
deploy/selectel/redeploy.sh preflight
deploy/selectel/redeploy.sh migration-status
deploy/selectel/redeploy.sh deploy
```

`preflight` validates gateway ownership, shared-network membership, locally
available immutable images, candidate Caddy configuration, and Compose config.
`deploy` checks migration status, promotes backend and verifies readiness from
inside the backend container, promotes worker and scheduler, promotes internal
static and verifies it from the backend over `http://static:80`, then validates
the candidate again before backing up and overwriting the active gateway
Caddyfile contents in place. The target inode is preserved; the host checksum
must match the candidate and the checksum of the same file inside
`memoly-webapp-1` before Caddy reloads. If activation or reload fails, the
previous contents are restored in place, validated/reloaded, and public health
is checked. It does not run `prisma db push`, pull registry images, or execute
destructive SQL.

If any critical check fails, stop promotion and use the prepared rollback:

```sh
deploy/selectel/redeploy.sh rollback
```

## One-shot database migration

When a release contains a new Prisma migration, run the guarded migration step
before promotion. It takes the same deployment lock, runs the full preflight,
and requires both immutable image tags to equal `MEMOLY_PRODUCT_SHA`:

```sh
cd /opt/memoly/app
export MEMOLY_PRODUCT_SHA='0123456789abcdef0123456789abcdef01234567'
export MEMOLY_BACKEND_IMAGE_TAG="$MEMOLY_PRODUCT_SHA"
export MEMOLY_WEBAPP_IMAGE_TAG="$MEMOLY_PRODUCT_SHA"
export MEMOLY_PUBLIC_HOST='app.memoly.ru'
deploy/selectel/redeploy.sh migrate
```

`migrate` first runs `preflight` and verifies that the backend's `DATABASE_URL`
uses protocol `postgres` or `postgresql`, host `postgres`, effective port
`5432`, and the same database and user named by `POSTGRES_DB` and
`POSTGRES_USER`. It permits at most one `schema=public` query parameter and
rejects fragments or query overrides such as `host` or `port`. A mismatched
target stops before the backup. Before opening a migration job it creates a
fresh PostgreSQL custom-format dump at
`/opt/memoly/backups/postgres-<SHA>-<UTC timestamp>.dump`, sets the directory
to mode `0700` and the dump to mode `0600`, then validates the archive with
`pg_restore --list`. A backup or validation failure stops the command and the
database migration is not attempted. The dump is produced through the
running Compose `postgres` service; database contents and connection secrets
are never printed.

After a validated backup, the script runs the repository's guarded
`bun run db:deploy` in a one-shot `docker compose run --rm --no-deps backend`
container using the target immutable backend image. It then verifies
`prisma migrate status` with that image. It never recreates backend, worker,
scheduler or static and never reloads Caddy. Do not substitute `prisma db
push`, direct SQL, or an ad-hoc migration command. Application promotion is a
separate explicit `deploy` invocation after the migration result has been
reviewed.

Rollback promotes the configured previous backend/webapp tags through the same
Compose project and readiness checks. It leaves both additive MAX migrations in
place; database rollback is not part of application rollback.

## Config validation

Before copying files to the host, run:

```sh
bun test tests/selectel-deployment-ownership.test.mjs
bun test tests/selectel-caddy-activation.test.mjs
bash -n deploy/selectel/redeploy.sh
deploy/selectel/redeploy.sh preflight
```

The final command loads the three server-only MAX secret files, validates the
candidate Caddyfile in the running unmanaged gateway, checks local immutable
images, and runs `docker compose config`. It requires the server's Docker daemon
and must be run on the host before promotion; do not substitute a committed env
file or print secret values.
