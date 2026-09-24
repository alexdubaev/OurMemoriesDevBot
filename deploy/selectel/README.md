# Selectel host deployment ownership

This runbook is the reproducible source for the existing Selectel host at
`/opt/memoly/app`. It fixes the previous `memoly-webapp-1` collision by keeping
the already-running host-port Caddy gateway unmanaged and giving Docker Compose
ownership only of internal services.

## Release entry point

Use this file as the single procedure for the existing host. It is safe for an agent
with no previous chat context because it names the host and server checkout, the
access boundary, the build inputs, the migration gate, and the rollback contract.

### Access and build inputs

- Production is `app.memoly.ru`; run host commands from `/opt/memoly/app`.
- SSH is supplied by the owner through a secure store or an already configured SSH
  agent. Check access without exposing credentials:

  ```sh
  ssh -o BatchMode=yes -o StrictHostKeyChecking=yes root@app.memoly.ru true
  ```

  If this fails, stop and ask the owner to provision the server access. Never look
  for, print, commit, or request a private key in Git or chat.
- A GitHub Environment named `selectel-production` is configured for `main` and
  contains pinned known-hosts, but the owner chose to keep the deploy SSH private
  key outside GitHub. The manual workflow therefore stops before SSH. For the
  current release route, use owner-provisioned SSH access and this runbook. A
  future decision to enable the workflow would use
  the names `SELECTEL_DEPLOY_SSH_PRIVATE_KEY` and `SELECTEL_KNOWN_HOSTS` for those
  environment secrets, and `SELECTEL_HOST`, `SELECTEL_SSH_USER` plus
  `SELECTEL_MAX_BOT_USERNAME` for the environment variables. The current verified
  values are `app.memoly.ru`, `root` and `id911018762027_bot`; the owner must
  recheck them in the Selectel panel. The nonsecret variables are configured in
  GitHub; the key value and its filesystem path never appear in this repository.
- The server stores PostgreSQL environment and MAX secrets under `/opt/memoly/env`
  and `/opt/memoly/secrets`. They are loaded only by the server deployment script;
  they are never copied into an image or committed.
- The server checkout must also have a read-only credential for its canonical GitHub
  origin so the release entry point can run `git fetch origin main` as `memoly`.
  Provision that credential on the host through the owner’s secure access process;
  the GitHub Actions SSH key used to reach Selectel is not forwarded to GitHub.
  Verify it without printing credentials:

  ```sh
  sudo -n -u memoly git -C /opt/memoly/app ls-remote origin refs/heads/main
  ```

- The release preflight requires at least 4 GiB free on the filesystem containing
  `/opt/memoly`. The current host has roughly 2 GiB free, so releases stop at the
  disk check until the owner completes approved host maintenance.
- The current verified public MAX bot username is `id911018762027_bot`. It is a
  build-time frontend value and is not a secret. Pass it as
  `VITE_MAX_BOT_USERNAME`; a reviewed change is required if the public username
  changes. Production uses same-origin API requests, so `VITE_API_URL` is empty.

The reviewed manual workflow `.github/workflows/selectel-release.yml` runs from
`main` with concurrency protection. It sends `deploy/selectel/ci-release.sh` over
strict-host-key SSH; that host entry point fetches the current `origin/main`, checks
out the exact SHA, builds both immutable images with `build-images.sh`, prepares a
server-only rollback backup, and invokes the reviewed `redeploy.sh` actions. It
never receives database or MAX secrets from GitHub and never runs ad-hoc SQL. The
host release lock is held across checkout, image build, migration, promotion, and
smoke; direct `redeploy.sh` actions cannot interleave with that release. If
promotion or public smoke fails after the release starts changing services, the
entry point attempts the prepared application rollback and keeps the original
failure status if rollback also fails.
Dispatch it with the exact current `main` SHA, type `DEPLOY`, and enable the
migration input only when that release contains a pending migration. The workflow
fails closed when the environment variables or secrets are missing. GitHub's
environment branch restriction is `main`; a human required-reviewer rule is not
configured because the private-repository plan rejected that setting.

For a local release, prepare both immutable images from the accepted commit with
the tracked script:

```sh
git status --short
git rev-parse HEAD
git fetch origin main
export SELECTEL_MAX_BOT_USERNAME='id911018762027_bot'
deploy/selectel/build-images.sh '<40-character accepted SHA>'
```

The script requires a clean checkout at the requested SHA, verifies that it is
reachable from the current canonical `origin/main`, and builds from a tracked
archive so ignored files cannot enter the Docker context. The canonical
`alexdubaev/OurMemoriesDevBot` origin. It builds `memoly-backend:<SHA>` from
`backend/Dockerfile` and `memoly-webapp:<SHA>` from
`deploy/selectel/Dockerfile.webapp`, tags both with the full SHA, and verifies their
OCI revision labels. Transfer those two images to the host through the owner’s
approved secure channel. The build script does not connect to production, change
the server, run migrations, or alter rollback state.

The running service SHA may intentionally lag the checkout SHA after documentation
only changes. Promote images only when their exact SHA has been accepted for a
release; do not use `latest`.

With owner-provisioned SSH access, run the same reviewed host entry point manually
from a Bash shell after the target commit is accepted on `main`:

```sh
set -euo pipefail
git fetch origin main
SHA=$(git rev-parse refs/remotes/origin/main)
test "$(git rev-parse HEAD)" = "$SHA"
test -z "$(git status --porcelain)"
git show "$SHA:deploy/selectel/ci-release.sh" |
  ssh -o BatchMode=yes -o StrictHostKeyChecking=yes root@app.memoly.ru \
    bash -s -- "$SHA" DEPLOY false id911018762027_bot
```

Set the third server argument to `true` only for a reviewed release that needs the
guarded migration. This command builds both images on Selectel; no image transfer
is needed. Do not run it until the host GitHub credential, 4 GiB disk gate, and
rollback prerequisites above are satisfied. The local build and image-transfer
sequence below is an alternative when server-side building is unavailable.

### Release sequence and stop conditions

1. Confirm owner-provisioned SSH access and the accepted full SHA.
2. In a clean checkout at that SHA, run `build-images.sh` and deliver both images.
3. On the host, verify the images are present and run `preflight`.
4. Run `migration-status`. If it reports no pending migrations, continue to
   `deploy`. If it reports a pending release migration, run the guarded `migrate`
   action documented below, then check `migration-status` again before `deploy`.
5. Run `deploy`, then perform the public smoke checks.
6. Record the SHA, image IDs/digests, migration result, UTC time, smoke results, and
   rollback tags in a release manifest. Keep the manifest server-side or in the
   approved release system; never include secrets.

Stop before mutation when SSH, canonical origin, clean SHA, either image, Compose,
Caddy ownership, or migration preflight fails. Do not substitute `prisma db push`,
direct SQL, `docker compose up` against the gateway, or an ad-hoc migration command.
If promotion fails after a compatible migration, use the configured immutable
rollback tags and follow the rollback section below. Database rollback is not part
of application rollback.

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
Compose project and readiness checks. It also restores the release-owned Compose
and Caddy files from the protected backup marker created before promotion; a
missing marker stops rollback rather than mixing old images with new configuration.
It leaves both additive MAX migrations in place; database rollback is not part of
application rollback.

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
