# Selectel host deployment ownership

This runbook is the reproducible source for the existing Selectel host at
`/opt/memoly/app`. It fixes the previous `memoly-webapp-1` collision by keeping
the already-running host-port Caddy gateway unmanaged and giving Docker Compose
ownership only of internal services.

**Product invariant: memoLy uses accepted UI v4 only, including recovery. Historical pre-v4 artifacts mentioned below are evidence for data/runtime analysis, never permissible frontend promotion targets. No approval flag overrides this rule.**

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
- GitHub Actions CI/CD is not used. The owner-provisioned SSH access is the
  manual release route; never store private key values or paths in this repository.
- The server stores PostgreSQL environment and MAX secrets under `/opt/memoly/env`
  and `/opt/memoly/secrets`. They are loaded only by the server deployment script;
  they are never copied into an image or committed.
- The server checkout must have a read-only credential for its canonical Git origin
  so the release entry point can run `git fetch origin main` as `memoly`. Provision
  that credential on the host through the owner’s secure access process.
  Verify it without printing credentials:

  ```sh
  sudo -n -u memoly git -C /opt/memoly/app ls-remote origin refs/heads/main
  ```

- Every existing tracked source path in the current and requested revisions, and
  each existing directory leading to those paths, must be owned by `memoly:memoly`.
  The guarded entry point checks this before switching revisions and again after
  checkout. Git operations always run as `memoly`; a failed switch stops the
  release. Build output and runtime/generated state stay outside tracked source.
  If the guard reports a path, inspect that path and repair only the identified
  tracked file or directory through approved host maintenance, then rerun the
  preflight. Do not recursively change ownership of `/opt/memoly`, reset the
  checkout, or clean files to recover a release.

- The release preflight requires at least 4 GiB free on the filesystem containing
  `/opt/memoly`. Measure it before every release; historical free-space values do not prove readiness. If below the floor, stop before mutation and prepare scoped maintenance; never bypass the guard or prune unrelated resources.
- The current verified public MAX bot username is `id911018762027_bot`. It is a
  build-time frontend value and is not a secret. Pass it as
  `VITE_MAX_BOT_USERNAME`; a reviewed change is required if the public username
  changes. Production uses same-origin API requests, so `VITE_API_URL` is empty.

The guarded host entry point `deploy/selectel/ci-release.sh` is invoked manually
through strict-host-key SSH. It fetches the requested SHA, builds immutable images,
prepares a server-only rollback backup, and invokes the reviewed `redeploy.sh`
actions. It never receives database or MAX secrets from GitHub and never runs
ad-hoc SQL. The host release lock is held across checkout, image build, migration,
promotion, and smoke; direct `redeploy.sh` actions cannot interleave with that
release. If promotion or public smoke fails after services begin changing, the
entry point attempts the prepared application rollback and preserves the original
failure status if rollback also fails.
For the first release crossing the B2 membership boundary, the entry point
compares the running backend SHA with the accepted B2 runtime SHA. A pre-B2
backend relies on the one-active-membership index that B2 removes. The entry
point stops the legacy backend, worker, and scheduler before guarded migration;
API and bot processing pause during this monitored window. A root-owned,
mode-0600 forward-only marker is written before the stop. If migration,
promotion, or public smoke fails, the entry point keeps legacy writers stopped
and does not restore the pre-B2 application. A later accepted descendant SHA
can resume the guarded forward fix after inspecting the actual host state.
Do not remove the marker manually; the entry point clears it after successful
public smoke and release manifest creation. Direct rollback refuses pre-B2
images. Activated unread tracking and multiple memberships are assessed against
the specific runtime attestation described below, rather than rejected globally.
Invoke it manually with the exact accepted `main` SHA and explicit `DEPLOY`
confirmation; enable migration only when that release contains a pending migration.
The B7 release has pending B1–B4 migrations and must use the migration input.

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

If the Selectel Docker build is unavailable, the guarded entry point also accepts
prebuilt images. Build the same two images locally with the existing
`deploy/selectel/build-images.sh` command above, capture their immutable IDs, and
transfer only a Docker archive through the owner-approved secure channel:

```sh
BACKEND_ID=$(docker image inspect --format '{{.Id}}' "memoly-backend:$SHA")
WEBAPP_ID=$(docker image inspect --format '{{.Id}}' "memoly-webapp:$SHA")
[[ "$BACKEND_ID" =~ ^sha256:[0-9a-f]{64}$ && "$WEBAPP_ID" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo 'unexpected local image ID' >&2
  exit 1
}
docker save --output "/secure-transfer/memoly-images-$SHA.tar" \
  "memoly-backend:$SHA" "memoly-webapp:$SHA"
chmod 0600 "/secure-transfer/memoly-images-$SHA.tar"
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes root@app.memoly.ru \
  'install -d -m 0700 -o root -g root /opt/memoly/incoming'
scp -o BatchMode=yes -o StrictHostKeyChecking=yes \
  "/secure-transfer/memoly-images-$SHA.tar" root@app.memoly.ru:/opt/memoly/incoming/
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes root@app.memoly.ru \
  "docker load --input /opt/memoly/incoming/memoly-images-$SHA.tar && \
   rm -f /opt/memoly/incoming/memoly-images-$SHA.tar"
```

The archive must contain no secrets. Before the release, verify on the host that
the loaded tags have exactly the captured IDs:

```sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes root@app.memoly.ru \
  "test \"\$(docker image inspect --format '{{.Id}}' memoly-backend:$SHA)\" = '$BACKEND_ID' && \
   test \"\$(docker image inspect --format '{{.Id}}' memoly-webapp:$SHA)\" = '$WEBAPP_ID'"
```

Invoke the same reviewed entry point with both IDs. For a normal release without
an existing forward-only marker, the entry point verifies the exact SHA tags and
OCI revision labels after checkout and before rollback preparation, quiescence, or
migration, then skips only the server-side `build-images.sh` step. A release with
an existing forward-only marker keeps its immediate legacy-writer quiescence and
forward-recovery sequence.

```sh
git show "$SHA:deploy/selectel/ci-release.sh" |
  ssh -o BatchMode=yes -o StrictHostKeyChecking=yes root@app.memoly.ru \
    "env SELECTEL_PREBUILT_BACKEND_ID=$BACKEND_ID SELECTEL_PREBUILT_WEBAPP_ID=$WEBAPP_ID \
     bash -s -- '$SHA' DEPLOY true id911018762027_bot"
```

Both ID variables are required together and must be lowercase `sha256:` IDs with
64 hexadecimal characters. Do not call `redeploy.sh migrate` or `redeploy.sh deploy`
directly for a B2 transition; the guarded entry point must retain the one-lock
forward-only marker, migration, promotion, and rollback handling.

The running service SHA may intentionally lag the checkout SHA after documentation
only changes. Promote images only when their exact SHA has been accepted for a
release; do not use `latest`.

Before PR merge, run the risk-appropriate FAST, STANDARD, or FULL profile on the exact source SHA and record the reason, commands, result, and environment limits. The main/master pre-push hook runs risk-based verification against the remote SHA; PR merge does not invoke local hooks. Before production deployment, run FULL on the exact final release SHA, including the combined state of all included PRs. This FULL check does not replace the guarded backup, migration, readiness, health, and rollback steps below. Production deployment remains a separate manual operation and requires an explicit owner request. With owner-provisioned SSH access, confirm the accepted clean SHA,
then invoke the reviewed host entry point:

```sh
set -euo pipefail
git fetch origin main
SHA=$(git rev-parse refs/remotes/origin/main)
test "$(git rev-parse HEAD)" = "$SHA"
test -z "$(git status --porcelain)"
git show "$SHA:deploy/selectel/ci-release.sh" |
  ssh -o BatchMode=yes -o StrictHostKeyChecking=yes root@app.memoly.ru \
    bash -s -- "$SHA" DEPLOY true id911018762027_bot
```

Set the third server argument to `true` only for a reviewed release that needs the
guarded migration. This command builds both images on Selectel; no image transfer
is needed. Do not run it until the canonical host Git credential, 4 GiB disk gate, and
rollback prerequisites above are satisfied. The local build and image-transfer
sequence above is an alternative when server-side building is unavailable.
It must not replace the guarded entry point for the first pre-B2 to B2
transition: that transition needs one lock across legacy-writer quiescence,
migration, and promotion. If server-side building is unavailable for B7,
stop and revise the guarded entry point through review before release.

### Release sequence and stop conditions

1. Confirm owner-provisioned SSH access, the accepted full SHA, clean host
   checkout, immutable-image prerequisites, and the migration input.
2. Invoke the guarded `ci-release.sh` entry point above with that SHA. It owns
   image build, preflight, migration, promotion, and public smoke under one lock.
3. Inspect its release manifest and migration status. Record the SHA, image
   IDs/digests, UTC time, smoke result, and rollback boundary without secrets.

Stop before mutation when SSH, canonical origin, clean SHA, either image, Compose,
Caddy ownership, or migration preflight fails. Do not substitute `prisma db push`,
direct SQL, `docker compose up` against the gateway, or an ad-hoc migration command.
If promotion fails after a compatible migration and the prior runtime is already
B2-compatible, use the configured immutable rollback tags only when the guarded
rollback compatibility check passes. The first pre-B2/MM0 transitions and any
unattested runtime/data combination require forward recovery. Database rollback is not part
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

## Guarded promotion and one-shot database migration

Use the guarded `ci-release.sh` entry point above for the whole B7 release. It holds
one host release lock across checkout, image build, legacy-writer quiescence,
migration, promotion, and public smoke. Do not run `redeploy.sh migrate` and
`redeploy.sh deploy` as separate operator commands for the B2 transition.
Both internal actions require the inherited `ci-release.sh` lock and the exact
checked-out `origin/main` SHA. They also reject a B2 target if a pre-B2 backend,
worker, or scheduler is running without the validated forward-only marker. The
direct `quiesce-legacy` action requires that marker. A target older than a
running compatible service is rejected.

The entry point calls `preflight` to validate gateway ownership, shared-network
membership, immutable images, candidate Caddy configuration, and Compose
config. Its migration action verifies that the backend's `DATABASE_URL`
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

After a validated backup, the internal action runs the repository's guarded
`bun scripts/deploy-selectel-database.ts` in a one-shot `docker compose run --rm --no-deps backend`
container using the target immutable backend image. It then verifies
`prisma migrate status` with that image. It never recreates backend, worker,
scheduler or static and never reloads Caddy. Do not substitute `prisma db
push`, direct SQL, or an ad-hoc migration command.

For the first release containing `20260928100000_mm0_domain_temporal_foundation`,
`ci-release.sh` identifies an old publisher by ancestry against the first
compatible runtime commit `0074d04c8e7f88b2327b56cea10ca38647d36190`.
It validates a backup while the old backend, worker and scheduler are healthy.
It then writes the root-owned mode-0600
`/opt/memoly/.selectel-mm0-forward-only` marker, stops all three old writer
services, and only then invokes the dedicated Selectel database procedure. The MM0 SQL contains multiple DDL
statements without an explicit transaction. A failed migration command has an
unknown database state. Keep the marker and old writers stopped;
`FORWARD_FIX_REQUIRED` means prepare a compatible forward release. Do not
restart the pre-MM0 publisher against this database.
The known `memoly-spike-max-video-backend-1` container is an additional writer
outside the Compose project. The guarded MM0 release compares only normalized
database host, port and name inside the containers, without printing URLs or
credentials. An unclassifiable running spike blocks migration while the old
runtime is still healthy. If it targets the production database, release disables
its restart policy, stops it before MM0 SQL, verifies it stayed stopped, and
leaves it paused after success until a compatible forward fix is reviewed.
An absent spike or one proven to target a different database is untouched.
If marker validation fails during recovery, the release handler stops every
backend, worker and scheduler container in the Compose project, also pauses the
known spike when its database relation is same or unknown, and requires operator
inspection before a forward fix.

If build, preflight or backup validation fails before the marker is written,
the old runtime remains running. An interrupted MM0 release revalidates a fresh
backup before retrying migration. Successful promotion verifies all four running
image tags and OCI revision labels before removing the marker. Direct
`redeploy.sh rollback` still rejects a pre-MM0 backend tag after marker removal.
The earlier B2 boundary retains its own compatibility checks. When an already
armed B2 release crosses MM0, the durable MM0 marker supersedes the B2 marker;
if power fails between those steps, recovery validates both and continues under
the MM0 marker. A pre-MM0 retry target is rejected.

Promotion checks migration status, promotes backend and verifies internal
readiness, promotes worker and scheduler, promotes internal static, then
validates and activates the gateway Caddyfile. If activation or reload fails,
the previous contents are restored and public health is checked. The release
entry point attempts application rollback only when the previous runtime
passes its compatibility guard; the first B2 and MM0 transitions are forward-only.

Rollback promotes the configured previous backend/webapp tags through the same
Compose project and readiness checks. It also restores the release-owned Compose
and Caddy files from the protected backup marker created before promotion; a
missing marker stops rollback rather than mixing old images with new configuration.
It leaves both additive MAX migrations in place; database rollback is not part of
application rollback.

For a UI-only rollback, run `bash deploy/selectel/redeploy.sh rollback-static` on the
host. The action uses the normal deployment lock and reads the previous webapp
SHA from the root-owned mode-0600 `/opt/memoly/rollback.env`. It requires the
running backend, worker, scheduler, and static services to be unique and to match
their immutable image tags, image IDs, and OCI revision labels. The saved webapp
SHA must be an ancestor of the running backend, with identical backend,
contracts, root package/build configuration and lockfile, and Selectel
Compose/Caddy templates. It
recreates only `static`, checks internal and public readiness, and retains the
running backend, jobs, database, and gateway. If static promotion or readiness
fails, it attempts to restore and verify the static image that was running when
the command began. B2/MM0 forward-only markers block this action; use the guarded
forward-recovery release flow instead.

## Measured application rollback compatibility

The guarded rollback supports two exact measured backend + webapp pairs:

- `e383d79269a3595f4c6cabedf167335aea042cf3`, with its exact production image
  IDs pinned in `verify_application_rollback`, target fingerprint
  `b12190f9bd6e568b544d89d4c4beec8198ad7626b03bdd9164cf76890d440a4e`, and
  source fingerprint `3d021aa1eb5160c8022ad5da3189ee30d6738bcb967f752458bef38145509857`
  measured from integration `d4b69a5ce73a03eceb632f23fb9eb17801343ff9`.
- `3fce2739205da927b95eb3379b1d066b61282965` (#180), with backend image ID
  `sha256:d8fada3265507cc8ee1ae76b83bf851187aaad19c126b3f4fec4cead92c9106c`,
  webapp image ID
  `sha256:9a31bb3f071ae2f11654671fce4a262a37fb4a039e7d7f3c422ed824a7787a66`,
  target fingerprint `3d021aa1eb5160c8022ad5da3189ee30d6738bcb967f752458bef38145509857`,
  and source fingerprint `5555b4b9419d29b4366f5a70fbdd9537a3ccde3230a0497c41fa392de9038107`
  measured from candidate `39e8af7bb9e9a5949ada3c32dad31d38f9439505`.
- The exact COM-4 comments runtime fingerprint
  `5a8c7cfe1839c8ed44434f80ddf7a83e1e9f6c43154a249f3b214ca3d25b5e02` may use
  the same #180 image pair after the real current → #180 → current PostgreSQL
  integration probe verifies the additive comments API roundtrip. This profile
  keeps the exact #180 target, image IDs, OCI labels, ancestry, clean checkout,
  protected configuration backup, and all other rollback checks. Its source
  fingerprint pins schema, migrations, contracts, manifests and lockfile; only
  those exact measured source contents may differ from #180. The measured
  `backend/package.json` delta is the pinned Hono patch update from `4.13.7` to
  `4.13.11`; it is accepted only for this exact source fingerprint and integration
  evidence. Backend and webapp Dockerfiles, Bun config and Selectel Compose/Caddy
  files must still match. Before any service change, rollback-readiness also compares every
  completed `_prisma_migrations` name and checksum with the catalog derived from
  the checked-out source SQL. For each exact migration, it accepts Prisma's LF
  or CRLF checksum; SQL-content changes, missing/extra migrations, unfinished
  rows, and query errors still fail closed. It does not run a migration or
  restore database contents.
- The exact COM-UX runtime fingerprint
  `80865362ae71492127ac1cd83a7f7b68707e737120cc60580a1d39c3860ad4b5` covers
  the combined COM-UX and MAX-CLOSE runtime source and may use
  only the accepted v4 target `4b4edc0992803b84c919aadb835e8d2e21095c51` and its
  pinned image pair. The fingerprint is content-bound and remains the
  compatibility pin across squash; the producer commit is not required to remain
  reachable. Before publication, the documented FULL run must pass the synthetic
  current → accepted-v4 → current compatibility probe against this combined
  runtime. Record that probe's passing command and result with the release PR;
  the fingerprint alone is not evidence that the probe passed.

The runtime fingerprint hashes deterministic NUL-delimited Git tree records
for the backend, webapp, packages, root manifest, and Bun lock/config files,
excluding only the existing backend test/support paths. It survives squash
without depending on producer commit reachability; it is not a date/descendant
allowlist. The exact target SHA, immutable image IDs and OCI revision labels remain
required. Any other source or target requires new compatibility evidence and a
reviewed attestation. Schema, dependency, service configuration, migration,
database, and protected-artifact checks remain fail-closed.

The PostgreSQL roundtrip probe runs the new, old, then new actual application
modules on one synthetic `*_test` database and separate storage. It exercises
activated unread state, multiple active families, Owner/Full/Viewer boundaries,
memory reads/writes/ordinals, invite acceptance, outbox publication, private media,
revoked sessions and an independent device. No production data is used. The SQL
compatibility read remains mandatory; read errors and unfinished migrations
still forbid restoration. B2/MM0 forward-only markers remain unconditional blocks.
For the COM-4 profile, the frozen #180 Prisma CLI also successfully reports
`migrate status` against the completed 49-migration test database after the
additive comments migration. Production's captured baseline remains at 48; this
test result is compatibility evidence, not a production migration or deployment.

Normal compatible promotion creates and validates a fresh PostgreSQL custom dump
using the existing backup procedure, in addition to the protected configuration
backup, before changing application services. Dumps are recovery artifacts only;
application rollback never restores or edits database contents.

The legacy `e383…` runtime reintroduces F12 for newly issued browser sessions. That
exact pair first installs and verifies a temporary gateway maintenance gate:
`/api/v1/auth/*` returns 503 except `me` and `logout`, then restores backend,
worker, scheduler and static. The measured #180 pair uses normal authentication
routing after a read-only `GET /api/v1/auth/max` returns the expected 404.
Gate policy is derived from the validated pair and cannot be selected by an
operator environment variable.

After deployment, `bash deploy/selectel/redeploy.sh rollback-readiness` runs the
same locked, read-only compatibility check without promoting or restoring services.

The failure-branch regression invokes the real `ci-release.sh` failure handler and
`redeploy.sh rollback` for both pairs, verifies pair-specific gateway policy before
service restoration, restoration of all four services, and retention of the original
failed-release exit status. Docker and database failures remain fail-closed. Production readiness must also confirm
that the attested images and configuration backup actually exist on that host.

## B7 unread activation after a healthy compatible release

Keep `MULTI_FAMILY_ACTIVATION` off while the B1–B4 migrations and B1–B6 runtime
are first deployed and checked. Only activate the production families in the
owner-approved target set. Place their UUIDs, one per line, in a root-owned
mode-0600 file outside the checkout; do not put family IDs in command arguments,
Git, or release logs. With the accepted backend image selected by
`MEMOLY_PRODUCT_SHA` and `MEMOLY_BACKEND_IMAGE_TAG`, feed that file to
`bun scripts/activate-unread-tracking.ts` in a one-shot backend container.
Run without `--apply` first to validate the input, then use `--apply` after
reviewing the target count. The script reports counts only. Each family gets
its own short transaction with `families FOR UPDATE`; repeat runs leave an
existing activation timestamp and publication boundary unchanged. A failure
stops the run, and the same approved list can resume without resetting prior
families. Do not scan or backfill historical Memories. Turn on the multi-family
gate only after every target family and the authenticated smoke checks pass.

```sh
(
set +x
set -e
export MAX_BOT_TOKEN="$(cat /opt/memoly/secrets/max_bot_token)"
export MAX_WEBHOOK_SECRET="$(cat /opt/memoly/secrets/max_webhook_secret)"
export MAX_INBOX_ENCRYPTION_KEY="$(cat /opt/memoly/secrets/max_inbox_encryption_key)"
export B7_FAMILY_IDS_FILE=/opt/memoly/activation/approved-family-ids.txt
export MEMOLY_PRODUCT_SHA='<accepted full deployed SHA>'
export MEMOLY_BACKEND_IMAGE_TAG="$MEMOLY_PRODUCT_SHA"
export MEMOLY_WEBAPP_IMAGE_TAG="$MEMOLY_PRODUCT_SHA"
docker compose -f /opt/memoly/compose.yml -p memoly run -T --rm --no-deps backend \
  bun scripts/activate-unread-tracking.ts < "$B7_FAMILY_IDS_FILE"
)
```

Stop after the no-write validation. Check that its count matches the approved
target list and that the compatible runtime, migrations, health, and gates still
match the release record. Only then run this separate activation command:

```sh
(
set +x
set -e
export MAX_BOT_TOKEN="$(cat /opt/memoly/secrets/max_bot_token)"
export MAX_WEBHOOK_SECRET="$(cat /opt/memoly/secrets/max_webhook_secret)"
export MAX_INBOX_ENCRYPTION_KEY="$(cat /opt/memoly/secrets/max_inbox_encryption_key)"
export B7_FAMILY_IDS_FILE=/opt/memoly/activation/approved-family-ids.txt
export MEMOLY_PRODUCT_SHA='<accepted full deployed SHA>'
export MEMOLY_BACKEND_IMAGE_TAG="$MEMOLY_PRODUCT_SHA"
export MEMOLY_WEBAPP_IMAGE_TAG="$MEMOLY_PRODUCT_SHA"
docker compose -f /opt/memoly/compose.yml -p memoly run -T --rm --no-deps backend \
  bun scripts/activate-unread-tracking.ts --apply < "$B7_FAMILY_IDS_FILE"
)
```

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

## Existing MAX migration, interrupted jobs and accepted UI

For the existing MAX-only host, `migrate` selects `deploy-selectel-database.ts`,
not the Yandex/DigitalOcean password-bootstrap entrypoint. It requires
`MAX_ENABLED=true` and refuses any admin seed before connecting. It retains
migration-owner inventory, Prisma's real migration ledger and atomic runtime
DML/default PUBLIC ACL hardening. No password administrator is created or
required. Provider bootstrap requirements remain in [DEPLOYMENT.md](../../docs/DEPLOYMENT.md).

The job's unique `selectel-db-deploy.*.log` remains server-private (directory 0700,
file 0600); console output contains only fixed stage diagnostics and its basename.
A post-migration failure does **not** mean SQL was undone. Inspect the exact job,
ledger/status and active images before retrying. Completed Prisma migrations are
retained; a retry uses the same guarded entrypoint and a new validated backup.
Never delete ledger rows, reapply SQL manually, restore a backup automatically or
use the no-migration flag to avoid an unmet required postcondition. When the
schema is demonstrably current and all procedure postconditions have passed,
the normal checked-schema update remains available.

Normal release source must contain the accepted v4 commit
`afdb408f8bbf22b564c86bb8d33a83261f55cc48`. This is checked after a read-only fetch
and before checkout, config changes, resumed writer quiescence or promotion.
Backend reconciliation first investigates preserving the active v4 static and
proves API/schema compatibility; unknown mixed runtimes fail closed. Do not run
the old all-service rollback merely to satisfy a convenient baseline.

The additional measured rollback pair is the already accepted v4 release
`4b4edc0992803b84c919aadb835e8d2e21095c51`:

- backend/worker/scheduler image ID `sha256:400f49886253aeb1d23d3688de5d5cce20fba3b4b1c20a82a9d6453ecb7d2bdc`;
- frontend image ID `sha256:70682430fd480dfddb3d3df0431665ea71d8018c0a0993993b8ffb6360baadf9`.

Its attestation is restricted to the exact new database-procedure runtime tree,
current comments migration catalog, unchanged relevant schema/dependencies/config,
protected artifacts and matching immutable image labels/IDs. It does not permit
arbitrary future product changes. Real synthetic current → v4 → current and
current → older runtime → current probes verify data preservation. Historical pre-v4 pairs may be assessed for backend/data evidence only; their frontend cannot be promoted.

`rollback-readiness` is a read-only technical compatibility assessment. It never
makes a historical artifact an allowed product version. Actual `rollback` and
`rollback-static` require the target to contain accepted UI v4 before any
configuration or service mutation. There is no approval file, flag, maintenance
consent or emergency exception that authorizes pre-v4 UI in memoLy. Preserve v4;
if no compatible v4 rollback exists, prepare a safe compatible forward recovery.
Missing compatible recovery remains a pre-release blocker. Database, immutable
image, configuration and forward-only safeguards remain mandatory.

Incident evidence and limits of historical logs are in the single
[postmortem](../../docs/RELEASE_POSTMORTEM_2026-10-21.md). This documentation and
its local tests do not authorize a production release.
