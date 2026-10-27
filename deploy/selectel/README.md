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

### Short frontend releases (owner policy 2026-10-22)

Use this lane by default for proven client rendering, CSS, button, animation,
gesture, carousel, modal and navigation changes. Client source paths marked R in
`frontend-safe-paths.txt` require an independent semantic review bound to the
exact range; A paths are mechanically eligible. It publishes **only the
static/webapp image**. It does not run a
backend build/promotion, restart workers/scheduler, activate gateway configuration,
apply migrations, create a database dump or rewrite `rollback.env`.

Eligibility is checked against **both actual running backend and webapp commits**,
not only the last merged PR. One shared fail-closed interpreter classifies paths
and reviews exact base-to-candidate ranges. Unresolved unknown paths stop for a ruling. Actual backend/schema/contracts,
authentication/session/ACL, private media/lifecycle, API/platform/offline/cache,
actual dependency/build/deploy safety-logic changes require the normal full release. Read-only metadata preparation does not change release guards. Every R
range must have an independent report and receipt binding its base SHA, candidate
tree, NUL-delimited no-rename Git diff hash (paths, modes and full old/new blob
IDs) and policy hash. The candidate tree and blob IDs bind the complete contents.
The report reviews changed
hunks, imports/interfaces/contracts, auth/access/media/storage/lifecycle, API and
business rules, and backend compatibility; unresolved uncertainty stops for a ruling; confirmed protected risk requires FULL. Same-file
sensitive hunks make that range ineligible. Do not add temporary policy exceptions
to shorten one release. This lane's own implementation and policy changes require
FULL and independent review.

On the host, receipts are accepted only from `/opt/memoly/frontend-reviews`, a
root-owned mode-0700 directory containing root-owned mode-0600 receipt and report
files. An authorized release operator independently checks reviewer provenance
and the full report, then installs both files under the exact fingerprint printed
by `frontend-scope.sh inspect`. This uses the existing root release-operator trust
boundary; the checker validates hashes and scope, not the reasoning behind a
report. Never install a receipt supplied by the candidate checkout or create one
from a candidate-declared approval. A receipt cannot override a D path.
For an assigned task, its authorized lead may install the receipt after the
independent review is complete under the existing release permission; this needs
no additional owner approval or second review. The lead is registering that
independent report, not substituting a self-review.

1. Read actual deployed tags and verify image IDs and OCI revisions. Keep these
   full SHAs in the task evidence. Do not infer them from the server checkout,
   which can include unreleased documentation or tools.

   ```sh
   ssh -o BatchMode=yes -o StrictHostKeyChecking=yes root@app.memoly.ru \
     'docker inspect --format "{{.Config.Image}} {{.Image}}" memoly-backend-1 memoly-static-1'
   ```

2. In the clean task checkout, verify the entire deployed-backend-to-candidate
   diff. Choose a relevant existing short journey and inspect the changed screen.
   For a header/family navigation change, the existing UI v4 journey is:

   ```sh
   bun run verify:local --profile frontend --base '<full deployed backend SHA>' \
     --frontend-base '<full deployed webapp SHA>' [--frontend-review '<receipt directory>'] \
     --journey webapp/e2e/memoly-v4.spec.ts \
     --journey-grep 'feed and family navigation expose working controls'
   ```

   Up to two relevant journey specs may be supplied. The verifier uses an existing
   dedicated Playwright config when available, otherwise the existing MAX config.
   It requires executed passing cases and refuses skipped/unrun/empty results.
   FRONTEND runs frontend typecheck, lint, production build and mapped narrow
   tests; it does not run backend FULL. Document targeted visual/browser acceptance
   and its limits. Use cached local tooling rather than rebuilding the test host.

   For each R range, the independent reviewer supplies a report that addresses
   the actual changed hunks, old/new imports and interfaces/contracts, auth/access,
   media/storage/lifecycle, API/business rules, and compatibility with the deployed
   backend. The reviewer recommends FRONTEND only when that range is client UI.
   Generate the expected bindings from the immutable candidate and each deployed
   base; the command only prints hashes and never creates approval:

   ```sh
   bash deploy/selectel/frontend-scope.sh inspect '<deployed backend SHA>' '<candidate SHA>'
   bash deploy/selectel/frontend-scope.sh inspect '<deployed frontend SHA>' '<candidate SHA>'
   ```

   An authorized root release operator checks the reviewer provenance, report,
   decision and displayed bindings, then installs the report and a receipt with
   `MEMOLY_FRONTEND_REVIEW=1`, `BASE_SHA`, `CANDIDATE_TREE`, `DIFF_SHA256`,
   `POLICY_SHA256`, `REVIEWER_ID`, `DECISION=FRONTEND`, `REPORT_SHA256`, and
   `FINGERPRINT` under the matching `<fingerprint>.report` and
   `<fingerprint>.receipt` names. Install both with owner root, group root and
   mode 0600 in `/opt/memoly/frontend-reviews` (directory owner root, mode 0700).
   If both deployed SHAs are identical, one receipt covers the deduplicated range.
   Do not install a report or receipt from the candidate checkout. Hash validation
   confirms exact bytes and range; the existing authorized operator is the trust
   boundary for the independent provenance and semantic decision.

3. Squash merge through the normal reviewed PR process. Verify a clean checkout,
   equal complete source and merged trees, unchanged comparison bases/scope and
   dependency/environment inputs, plus no unresolved errors or review findings.
   Record source and final SHAs/trees and the equality check, then transfer the
   source-bound FRONTEND evidence to final main. Do not claim the profile reran on
   final SHA. If an input differs or evidence is stale/incomplete, rerun affected
   checks; do not create a generic PASS cache.

4. From the accepted clean main checkout, invoke the **versioned** host entry point
   with migration `false` and the explicit fifth argument `frontend`:

   The canonical entry point exports the candidate SHA/image tags before rollback
   readiness and the redeploy script loads protected runtime secrets before
   compatibility checks. Do not reconstruct this context with a separate wrapper.

   ```sh
   SHA=$(git rev-parse HEAD)
   git show "$SHA:deploy/selectel/ci-release.sh" |
     ssh -o BatchMode=yes -o StrictHostKeyChecking=yes root@app.memoly.ru \
       bash -s -- "$SHA" DEPLOY false id911018762027_bot frontend
   ```

   The host repeats source/current-main/scope/ownership, host-lock/disk/forward-marker,
   accepted UI v4 and immutable artifact checks. It validates the unchanged migration
   history read-only, captures exact prior webapp recovery identity before promotion,
   and verifies retained backend/worker/scheduler and gateway/config identities.
   Only static is recreated with `--no-deps`. Internal/public readiness and candidate
   artifact checks precede the final protected manifest. Failures after promotion
   restore only the exact prior frontend and keep a failed command status.

5. Confirm the frontend manifest records distinct deployed backend/frontend SHAs,
   exact image IDs, public smoke and frontend recovery readiness. The previously
   designated full application recovery pair remains unchanged. This independent
   frontend recovery proof is not a new exact-source application rollback attestation.
   Do not report the backend at the frontend SHA or claim a newly attested full
   application rollback source.

For recovery after a failed or interrupted frontend promotion, use the same
accepted entry point with `frontend-rollback` as the fifth argument. It restores
only the exact prior image recorded in the protected frontend state after checking
retained backend/config compatibility; it does not accept arbitrary target images
or restore the database. Missing/corrupt state, unknown sources, changed backend or
forward-only markers fail closed. Resolve such a failure through the normal guarded
forward-fix process. The normal `rollback-static` action below retains its older
contract and is not the recovery command for this new lane.

After a successful normal FULL promotion, revision verification, public smoke and
manifest creation, the entry point archives the previous frontend recovery file
under `RELEASES_DIR`. It checks root ownership, mode 0600, regular-file identity and
unchanged checksum, preserving its exact bytes as forensic evidence. FULL does not
parse that payload or use it as recovery authorization; its independently verified
new runtime supersedes even an interrupted frontend record. Failed FULL attempts
leave the live file unchanged. Unsafe filesystem metadata or a changed file fail
closed. This prevents a completed FULL from leaving stale frontend permissions that
would block the next eligible short release.

Documentation-only PRs have no runtime deployment. The initial installation of this
release tooling uses the normal reviewed FULL release; future eligible UI commits
then use the short lane. No product UI change is required merely to install tooling.

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

For a normal release, captured running images and the designated recovery pair
are separate facts. Before replacing `rollback.env`, the entry point checks the
captured pair with the full `rollback-readiness` verifier. If that pair is not an
attested recovery target, it preserves the existing designated pair only after
the same verifier accepts it against the candidate source and current database.
If neither pair passes, it stops before replacing the file or promoting services.
Legacy/forward-only boundary decisions continue to use the captured running pair.
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

Use [the small change workflow](../../docs/development/SMALL_CHANGE_WORKFLOW.md) for known small tasks; protected release changes retain the following exact-source release gates. Before PR merge, run the applicable risk profile once on the complete source tree and record source SHA/tree, comparison bases, commands, result and environment. After squash, transfer source-bound evidence only when the clean complete source and final trees, bases, scope and dependency/environment inputs match and no errors or review findings remain; record the final SHA/tree and equality check without calling it a rerun. Repeat affected checks when evidence or inputs differ. The main/master pre-push hook runs risk-based verification against the remote SHA; PR merge does not invoke local hooks. Eligible reviewed client-UI production releases use FRONTEND under the owner policy of 2026-10-22 and the short procedure below. Actual protected runtime/safety-logic releases require FULL on the complete release source tree, including all changes since the deployed version. Known small non-protected changes use their documented affected checkset before merge. Every actual deployment still runs the complete guards required by its chosen release mode; unknown unresolved risk stops. Production deployment is a separate manual operation under standing owner authorization unless the task limits it. For the normal full release, confirm the accepted clean SHA,
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

For the exact MAX-video retention release profile, `migrate` first verifies the
reviewed migration prefix and a valid backup, then stops backend, worker, and
scheduler under the inherited release lock before running SQL. A migration
failure leaves those writers stopped for forward recovery; the entry point must
not restart an unverified pre-migration runtime. Rollback readiness validates
the exact 56-to-59 migration history and runs the candidate image's read-only
MAX recovery checks without changing services or references. It fails closed if
a held video is already tombstoned for storage cleanup (`deleted_at` set while
`storage_deleted_at` is null), because an older worker deletes objects before
attempting its database update. On an eligible rollback, the guarded
action stops current writers, applies metadata-only recovery with the current
candidate image, verifies no ledger references remain, and only then promotes
the configured previous runtime. Recovery does not call MAX, delete storage,
change quota, or roll back migrations. If recovery fails, the old runtime is not
promoted; the action attempts to restore and verify the current candidate and
returns the original recovery failure status.

The designated MAX recovery target for this migration release is the exact
accepted d299 pair: backend, worker, scheduler and static frontend all use
`d2999cca6e4e5980cc2277de7453440353f5b392`; the pinned image IDs are
`sha256:cb1f1e3aca79452701d7410e5bccef7e93a1eda08de5c36cfab19202f0632309`
for the backend and
`sha256:6d77034ed1be4f8fea0d86ee7f0fb8fdfebb5706c5c4358d8b608d7e32f1e62d`
for the frontend. `prepare_rollback` captures and verifies the running pair
first. When the exact pre-schema-59 pair (`0486e79947f6612d0eed05207c1cd30d0c4ace65`
backend and `0f2e8a432b5712d17b67d63f99439d16f33e7721` frontend) cannot pass
schema-59 readiness for a candidate containing the retention migration, it
verifies this fixed d299 pair through the same readiness checks before
atomically designating it. The earlier 33a pair remains in its historical
profile but is not a MAX recovery target because it would remove the accepted
Android safe-area UI.

The frozen member-avatar frontend has measured executable compatibility
fingerprint `a4d194873593bc2c0770e8ee491e295075cf9f60a39550f3f7bbaaebb55b17f9`
for this same d299 pair and unchanged full-attested runtime fingerprint. This
adds one exact frontend-only avatar projection to the existing `max-video`
recovery profile; the 33a target remains rejected. Backend, schema, dependencies
and contracts remain pinned by the executable fingerprint, and all existing
image, migration, ancestry, lock, configuration and readiness guards still apply.

The Control account-deletion source has a separate `max-video-retirement` profile,
bound to executable fingerprint
`1a4ecd291b67f1f173db203370f1cdd270f0eb6f96365806658f6034dbf452b6`
and the unchanged d299 image pair above. It requires the effective storage driver
to be `filesystem`. Its exact migration catalog extends d299's 59 entries with
`20261025160000_control_user_lifecycle`, `20261025170000_control_durable_purge`
and `20261025180000_control_purge_fences`. Pre-SQL verification accepts only a
completed, checksum-matching prefix of 59–62 entries; complete verification
requires all 62. The older 56–59 profile retains its own reviewed scope.

The same `max-video-retirement` profile also accepts the separately frozen
current Control-deletion production inputs from source
`4d6e1e9822bafb97bd0414f32d01139e1a356dc8`, measured at executable
compatibility fingerprint
`4e1ba54ea6c8f0df481d8adfc5d75378c0545d21922170cb3184551b96d4c02d`. It uses
the unchanged d299 image pair and filesystem-only storage requirement. The
current → d299 → current PostgreSQL compatibility proof passed on this exact
source (1 test, 0 failures, 5 assertions). Both exact source profiles retain
the same target pin, host-input checks, 59–62 migration ledger validation,
recovery readiness, and data safeguards.

The owner-guide runtime source from `7873375d462ba59b6bcc227b58da36feb000bbdd`
is bound to the same d299 pair by executable compatibility fingerprint
`e2375eecbdd2f4942dd996ae88b31a15da95ea9007b32f112c8772c96a38200c`. The
fingerprint was reconstructed over accepted baseline `2fc3abd4d85419ce972bacfceac1ec29c70fdeef`
with the six reviewed production blobs. Its PostgreSQL current → d299 → current
compatibility probe passed for both LF and historical mixed-line-ending
migrations (2 tests, 0 failures, 22 assertions, 22.75 seconds). The frozen
regression accepts only the measured executable input and filesystem storage;
it rejects S3 and backend or UI drift. This is targeted recovery evidence, not a
FULL release-profile result. The existing target, host pins, migration ledger,
and recovery safeguards are unchanged.

The LF/CRLF-compatible recovery source was later proven at `a6fc2b4ecdb0b2886b80a0f201edb74f0ad0f424`, with executable compatibility fingerprint
`ca18410eb5ba4bfaf124251863c4167e68b44549cd013bf39cd73ff5a3daabcc`. Its native PostgreSQL current → d299 → current matrix passed (2 tests, 0 failures, 22 assertions), covering both the all-LF prefix and the historical mixed prefix (24 CRLF, 35 LF). The original 59 ledger rows remained unchanged; SQL-byte drift was rejected. The profile keeps the same d299 target, filesystem driver requirement, host-input checks, and recovery safeguards.

Grace-trashed archives still require their original objects and normal MAX
metadata recovery. Only a durable irreversible deletion intent for an inactive
family is excluded from that inverse. Recovery refuses an unfinished intent
until its keys are captured and every existing media asset is fenced; storage
failures do not prevent this database-only fencing stage. Filesystem retirement
erases content and retains empty directory barriers plus zero-byte technical
markers, preventing the archived writer from relinking a late upload. Do not
remove these barriers during disk maintenance. Completed queue entries remain
available for bounded cleanup of late temporary files. S3 Control trash/purge is
disabled until equivalent retirement is attested; ordinary reads and restoration
are retained. The compatibility proof runs current → archived d299 → current
against real test PostgreSQL and filesystem storage, including late writes,
partial cleanup, restored grants, retained originals and unchanged migration
history. It does not restore a production database.

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

The guarded rollback supports these exact measured backend + webapp target pairs and source profiles:

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
  `ae2c05a046080f4ea72c2ca70db131eaa866c05bf5444e50070f92273f7b0f87` covers
  the combined COM-UX and MAX-CLOSE runtime source and may use
  only the accepted v4 target `4b4edc0992803b84c919aadb835e8d2e21095c51` and its
  pinned image pair. The fingerprint is content-bound and remains the
  compatibility pin across squash; the producer commit is not required to remain
  reachable. Before publication, the documented FULL run must pass the synthetic
  current → accepted-v4 → current compatibility probe against this combined
  runtime. Record that probe's passing command and result with the release PR;
  the fingerprint alone is not evidence that the probe passed.
- The exact feed-photo comments UI runtime fingerprint
  `9c848684f56ce26f57af81136d1dfc351d4a1c52776dcfc41d1291e8e46a6fda` may use
  only the currently healthy target `33a0054c3c71372aa5509ee8ebfa4578ad512ea1`,
  target fingerprint `ae2c05a046080f4ea72c2ca70db131eaa866c05bf5444e50070f92273f7b0f87`,
  and its exact backend/webapp image IDs `sha256:50ef108db452f8da24a159161edb0510ed3fe5612275ac701bf883327315dfd9` /
  `sha256:63be673e1a57af5faaeafa6b3d3136314808b8826640873f5cafa4f4f9bebe74`.
  The source pin is content-bound and limited to this frontend-only runtime;
  the comments rollback profile still requires exact migration history and all
  existing ancestry, configuration, image-label, and database-state checks.
- The exact album runtime fingerprint
  `5ba8daeb5a1d8a3f538f9f24adff103f440afbd7de9fbe0e5b1eee1d772bd8b1` may use
  only the healthy `33a0054c3c71372aa5509ee8ebfa4578ad512ea1` target and its
  existing pinned image pair. Its migration ledger check is anchored to the
  exact 49-migration `dc26ad9` catalog plus the three reviewed additive album
  migrations, for a total of 52. In the guarded `ci-release` path with
  `RUN_MIGRATION=true`, pre-SQL readiness accepts only a fully completed exact
  ordered prefix of that catalog, from 49 through 52 migrations. Unknown,
  missing, duplicated, checksum-mismatched, unfinished, rolled-back, or
  unrelated rows fail closed. This private phase requires the inherited held
  Selectel deployment lock and is available only to rollback-readiness inside
  that guarded release. Ordinary readiness and application rollback always
  require all 52 migrations completed. After migration, the release clears the
  private phase and reruns full recovery readiness before promotion. Releases
  without migration use normal complete-ledger readiness; B2 and MM0 recovery
  paths keep their existing checks. This exception does not permit database
  rollback or change target, image, ancestry, configuration, backup, lock, or
  data safeguards. The source fingerprint is content-bound across squash, not
  a date or descendant allowlist, and still requires the real synthetic current
  → 33a → current recovery probe.

- The exact private-album-photo runtime fingerprint
  `f4b2ef2d6df8ab0135c24102d56b7facbed4fc09eaf467eb93fef6b55781749f` may use
  only the same healthy `33a0054c3c71372aa5509ee8ebfa4578ad512ea1` target and
  its existing pinned image pair. This executable compatibility fingerprint
  is measured from frozen source `785458f911c2a5e45c830ebbfc4220ab155f27da`
  and anchored to the unchanged full-attested `dc26ad9` reference; it is
  independent of producer commit reachability.
  The recovery catalog remains anchored to the exact 49-migration `dc26ad9`
  baseline and recognizes only either the original three reviewed album
  migrations (52 total) or those same three plus
  `20261023150000_album_private_photos` (53 total). In the guarded
  `ci-release` path with `RUN_MIGRATION=true`, pre-SQL readiness accepts only a
  completed exact ordered prefix from 49 through the selected candidate's full
  catalog. Ordinary readiness, rollback, and post-SQL readiness require all 52
  or all 53 migrations for that exact catalog. Unknown suffixes and all
  incomplete, duplicate, checksum-mismatched, unfinished, rolled-back, or
  unrelated ledger rows fail closed. The existing deployment lock, backup,
  ancestry, image, configuration, recovery, and data safeguards remain
  required; this pin does not authorize database rollback.

- The exact gift-wishlist runtime fingerprint
  `9bc6fdc22b85fe68e04ab387c1d9ce3c4f8a01471c177f1b61d9ae07bbde13c8`, measured
  from producer `5f0f854e0843e87bf7d5634114b641b61cbc98f9`, may use only the same
  healthy `33a0054c3c71372aa5509ee8ebfa4578ad512ea1` target and its existing
  pinned image pair. The pin is anchored to the unchanged full-attested `dc26ad9`
  source and authorizes only the exact executable input fingerprint. Its ledger
  is the exact 53-migration `b4cdbbc` catalog plus
  `20261023120000_gift_wishlist` and
  `20261024120000_gift_photo_recovery_guard` (55 total). Guarded pre-SQL
  readiness accepts only completed 53, 54, or 55 migration states; ordinary,
  rollback, and post-SQL readiness require all 55. Unknown, missing, duplicate,
  checksum-mismatched, unfinished, rolled-back, or unrelated rows fail closed.
  Pre-SQL readiness remains restricted to the inherited deployment lock in the
  guarded release path. This pin does not authorize database rollback and still
  requires the synthetic current → 33a → current compatibility probe.
  The probe was run with `bun test backend/scripts/wishlist-release-compatibility.integration.test.ts`
  against a uniquely created `*_test` child database: 1 test passed with 45 assertions.
  It verified the frozen cleanup leaves registered gift-photo metadata, bytes,
  family accounting, and outbox unchanged with the guard, while the disposable
  unprotected control reproduces a tombstone, an unavailable photo, and queued
  `media:delete` work while the original storage bytes remain present.

- The exact memoLy Control executable compatibility fingerprint
  `b975c2a1a84bffe4a431408ac10da4cdabfbe343135d237abc2f5a6e4f0ec538` is
  measured from the finalized executable source reconstructed over accepted
  source `a7e1e0781d51ceb58fb1f7784c1a69f9c066fca4` and is anchored to the unchanged
  full-attested `dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92` runtime fingerprint
  `2be6fc2b96f4731c4ea3821b50f112c01d8e9a62da57eeb6675f8513fd26b088`. The
  refreshed exact profile regression verifies this fingerprint against frozen
  committed production blobs, including the Control UI's public auth entrypoint.
  This profile is accepted only for the designated
  healthy `33a0054c3c71372aa5509ee8ebfa4578ad512ea1`
  backend/webapp image pair. The exact candidate was reconstructed over the
  accepted source with committed production blobs, and source, migration SQL,
  Compose, and static Caddy changes each invalidate this permission. Recovery
  readiness also verifies that the installed root-owned sampler, systemd unit,
  and timer have their exact pinned bytes and protected modes; absent, changed,
  symlinked, or writable artifacts fail before service mutation. The candidate
  ledger is exactly the 56-migration baseline plus
  `20261025100000_control_observability` (57 total). Only the inherited-lock
  guarded pre-SQL phase accepts the exact completed 56 baseline or completed
  57 candidate; ordinary readiness, rollback, and post-SQL readiness require
  all 57. Unknown, missing, duplicate, checksum-mismatched, unfinished,
  rolled-back, or unrelated rows fail closed. No recovery profile authorizes
  database rollback.

  The guarded release copies the accepted sampler blob to root-owned
  `/opt/memoly/control/sampler.py` and installs the pinned service and timer
  under `/etc/systemd/system` while holding the deployment lock. The service
  runs `/usr/bin/python3 -B`; the literal interpreter link and resolved
  executable must remain root-controlled. The root-owned Control directory and
  metrics directory are mode 0755, and the snapshot is mode 0644. Backend and
  scheduler receive only the metrics directory read-only. The sampler never
  runs from the memoly-owned checkout and no container receives write access.
  Its 0600 release receipt records the last successful release only. Backup
  evidence records structural archive/TOC validation; `restoreTestAt` remains
  null because no restore test is performed. The synthetic current → archived
  33a → current PostgreSQL compatibility probe passed against the isolated
  `*_test` database. This targeted evidence does not replace the separately
  required FULL profile on the final release SHA.

- The exact stage-1 several-children production fingerprint
  `cb65bc32b8265b0dc431b1a115ff1e192299f41812232773a2194f8fc894bc05` is anchored
  to the full-attested `dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92` runtime and may
  use only the healthy `33a0054c3c71372aa5509ee8ebfa4578ad512ea1` target and its
  existing pinned image pair. Its literal 76-blob source fixture is reconstructed
  from the stable `954640d` production baseline; the measured compatibility hash
  is checked against that fixture, and child-runtime or child-UI drift is rejected.
  The exact child migration ledger is the 53-migration `b4cdbbc` baseline plus
  `20261023120000_gift_wishlist`, `20261024120000_gift_photo_recovery_guard`,
  and `20261024100000_memory_child_tags` (56 total). For this exact source,
  guarded pre-SQL readiness accepts only the exact completed 53, 54, 55, or 56
  migration states; ordinary, rollback, and post-SQL readiness require all 56.
  The deployed 55-migration ledger remains valid despite its guard migration
  sorting after the child migration in the candidate catalog. The legacy exact
  55-migration source keeps its existing pre-SQL and complete-ledger rules.
  Unknown, missing, duplicate, checksum-mismatched, unfinished, rolled-back, or
  unrelated ledger rows fail closed. Pre-SQL readiness remains under the held
  host lock in the guarded release path; the profile does not authorize database
  rollback.

  The synthetic current → frozen 33a → current PostgreSQL probe passed against
  a uniquely created `*_test` child database: 1 test, 21 expectations, exit code
  0 on source `9d7b1a0a648fc6069d4b5f9cc638594015381e35`. It ran with
  `bun test backend/scripts/children-release-compatibility.integration.test.ts`
  in an isolated Linux environment with Bun and `bunx` on PATH. The probe verifies the frozen runtime can read a
  tagged multi-child photo with an attachment-level tag, create and read a legacy
  child-linked note, and filter the feed without changing either new child tag.
  Returning to current code preserves both tags, attachment, deleted-profile
  timestamp, migration ledger and rollback-era memory, and a new current-runtime
  write receives its expected child tag. This targeted compatibility probe is
  evidence for the exact source pin, not a FULL release-profile result.

- Candidate `a33d220a2edd5c5c883770f793e398fc30752a3d` has measured executable
  compatibility fingerprint
  `e0654e5c48ee35800754e7d784ad3b0af1bd5ff5cb7a860e4f3a063ee8609b67` for the
  same healthy `33a0054c3c71372aa5509ee8ebfa4578ad512ea1` target, the unchanged
  full-attested `dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92` anchor/runtime
  fingerprint, and the existing `wishlist` recovery profile. The only
  production-input difference from the running `ab6b9a55` source is the pinned
  `webapp/src/features/albums/albums.css` blob
  `294d51e2f3a46d5e61c890c00c47601bd95dd268`, which adds one album-local portal
  layering rule; backend, dependencies, schema and contracts are unchanged.
  The exact final candidate passed the FULL profile in 533.6 seconds after the
  source passed FULL in 531.9 seconds. Each run passed safety (127 checks),
  contracts (72), backend (166), web (142), site (4), PostgreSQL (412 tests),
  and MAX/Web/PWA journeys (60); the database suite reported 41 suites and
  3,632 assertions. The synthetic current → frozen 33a → current album probe
  passed 31 assertions, alongside wishlist-photo (45) and comments (12) probes.
  The first normal FULL deployment built candidate images but stopped before
  promotion because this exact fingerprint was not yet registered. Production
  remains on `ab6b9a5`, and `rollback.env` remains pinned to `33a0054`. This
  registration permits only the measured fingerprint under the existing
  target, image, ledger, configuration, ancestry, marker and recovery guards;
  it does not change the recovery policy or authorize database rollback.

The runtime fingerprint hashes deterministic NUL-delimited Git tree records
for the backend, webapp, packages, root manifest, and Bun lock/config files,
excluding only the existing backend test/support paths. It survives squash
without depending on producer commit reachability; it is not a date/descendant
allowlist. The exact target SHA, immutable image IDs and OCI revision labels remain
required. Any other source or target requires new compatibility evidence and a
reviewed attestation. Schema, dependency, service configuration, migration,
database, and protected-artifact checks remain fail-closed.

Rollback source verification keeps two distinct measurements. The immutable full
runtime fingerprint pins each reviewed artifact/source reference and is checked
against its existing constant before that reference can authorize compatibility.
The separate compatibility fingerprint compares the candidate with that
full-attested source using executable product inputs. It omits test files,
test-only support fixtures and runners, Playwright/E2E/visual test trees, the
three dev-only visual fixture pages, and the E2E-only TypeScript config. Production source, contracts, migrations, build and
runtime configuration, manifests, dependencies, protected Selectel files, and
the UI-v4 ancestry and artifact checks remain covered. A test refactor therefore
does not rotate an immutable artifact pin, while any production-input drift still
fails the compatibility comparison.

The native browser avatar-timer fix and exact Storybook 10.6.2 security update
have one additional exact executable compatibility hash,
`81b25c411661d27367a817ad8aaacebb1a777dca599867321c9480a5e4771b51`, for
recovery to `33a0054c3c71372aa5509ee8ebfa4578ad512ea1` only. It is anchored to
the unchanged full-attested `dc320109` source above. The positive fixture reads
immutable Git blobs for the reviewed timer fix, root manifest and Bun lockfile;
it does not read changing application files as historical inputs. Existing
recovery image IDs, source pins, migration/configuration checks and v4 ancestry
remain mandatory.

The exact comments diagnostic production snapshot `dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92`
has full runtime fingerprint
`2be6fc2b96f4731c4ea3821b50f112c01d8e9a62da57eeb6675f8513fd26b088` and
compatibility fingerprint
`18d7cd0be088612c52c39ac101c97a81292d4da759bb92e679036b9604be65d5` for
recovery to `33a0054c3c71372aa5509ee8ebfa4578ad512ea1` only. The regression
fixture checks read-only readiness, preservation of the designated pair when
the running `f6` pair is not an attested recovery target, and rejection of a
production-source mutation before service changes. Unknown targets still fail
closed. Existing source ancestry, target/image IDs and labels, migration history,
schema, dependency, protected-artifact and service-configuration checks remain
required; this pin does not authorize arbitrary descendants or future source
changes.

The exact family media UI source measured on release candidate
`c1b50d4113192115bdd19906faa91e0c05fcf8ac` has runtime fingerprint
`39c68e0616088b22d463e29e691a90b2def319b1a56f496d23bc699df6044ed7` and
executable compatibility fingerprint
`98ec68669e8a64cac59ca55bd34e3585cc5fbf24d3c48d6976196118ae1a762a` for
recovery to `33a0054c3c71372aa5509ee8ebfa4578ad512ea1` only. Its exact Git
blobs are pinned in `tests/selectel-release-exit.test.mjs`; the profile is
anchored to the full-attested `dc26ad9` diagnostic source. The fixture verifies
read-only readiness and designated-pair preservation, then refuses executable
source drift before any service mutation. Database compatibility was verified
by an actual PostgreSQL current → frozen 33a → current roundtrip (8 tests, 50
assertions), run with:

```bash
bun run --cwd backend test:integration -- scripts/comments-release-compatibility.integration.test.ts
```

That probe checks preserved data, family ACLs, comments and unread state,
sessions, outbox, migrations and grants. This is technical recovery evidence;
the exact UI image IDs, OCI labels, accepted-UI ancestry, migration and
configuration checks remain required, and no database rollback is authorized.

For source SHA `6a15a9ee19e59437de9c3863084c02a0437a8f69`, the measured runtime
fingerprint is `fc6192f557002dfd54b1e22fa74bdd69f3ac52a21ef5c9b794c650fe0e2fc4b3`
and the executable compatibility fingerprint is
`a208551a5f5925445d71bedc322d669d04bf76196d90332cc0816e7c7c3a70c6`. The actual
`current → frozen 33a → current` PostgreSQL proof passed 8/8 tests and 50/50
expectations with exit code 0 in 31.35 s. The exact compatibility profile reuses
the established `comments` recovery checks and remains scoped to the 33a target,
the full-attested `dc26ad9` runtime, and the frozen media plus family-navigation
source blobs.

The shared-header and child-avatar production source frozen for candidate
`b95786a7abad26fba2305ad4afae13f2bd0b0fe3` has executable compatibility
fingerprint
`b3efa841bf22d2703c462d3fcf58f039c55784a3dc0dd695f3e81ce14dcece04` for the
same designated `33a0054c3c71372aa5509ee8ebfa4578ad512ea1` recovery target only.
Its 13 changed production Git blobs are pinned in
`tests/selectel-release-exit.test.mjs`; the exact profile remains anchored to
the full-attested `dc26ad9` diagnostic runtime. The focused guard regression
checks readiness, designated-pair preservation, and drift rejection before
service mutation. This source binding does not establish database compatibility:
the documented synthetic PostgreSQL current → frozen 33a → current probe must
also pass for the final source SHA before release.

The final single-source child-avatar runtime frozen for candidate
`e28bdfc605a1b3fd4d39b75f3f3fe3af7a56d274` has executable compatibility
fingerprint
`7509b439a678bba9bb7b74bfb9edd620623b8f238c2a9c256e1f1da187f9997e` for the
same designated `33a0054c3c71372aa5509ee8ebfa4578ad512ea1` recovery target only.
Its exact production Git blobs, including the final `ChildAvatar.tsx` blob, are
pinned in `tests/selectel-release-exit.test.mjs`; the executable profile remains
anchored to full-attested source `dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92`.
The focused regression checks read-only readiness, designated-pair preservation,
and rejection of executable drift before service mutation. This source binding
does not establish database compatibility. Run the synthetic PostgreSQL current
→ frozen 33a → current compatibility probe against this exact candidate SHA
before release; its result is not recorded by this source attestation.

The cropped-channel avatar sizing source frozen for candidate
`3559ff6e65fbb93804b882cd4a53b6d7717b140d` has executable compatibility
fingerprint
`0236c2944f1e4c978b4da387dbc6758b330cd1f6d36fe54cf84b65eefab3ace0` for the
same designated `33a0054c3c71372aa5509ee8ebfa4578ad512ea1` recovery target only.
Its exact production Git blobs, including the scoped channel-avatar grid sizing
in `memoly-feed.css` and pinned `bun.lock`, are pinned in
`tests/selectel-release-exit.test.mjs`; the profile remains anchored to the
full-attested `dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92` runtime. Astro is
pinned to `7.3.3` to address
[GHSA-98hj-9722-w3j8](https://github.com/withastro/astro/security/advisories/GHSA-98hj-9722-w3j8)
and
[GHSA-mpr7-6m5w-76rw](https://github.com/withastro/astro/security/advisories/GHSA-mpr7-6m5w-76rw).
The focused regression checks read-only readiness, designated-pair
preservation, and rejection of executable drift before service mutation. This
source binding does not establish database compatibility; run the synthetic
PostgreSQL current → frozen 33a → current compatibility probe against the exact
release SHA before release.

The Welcome CTA 6 source frozen for release candidate
`9c6d6071a2b614e073a5f765810d55281b723ef5` has executable compatibility
fingerprint
`b9d96400efdfebbfb0dffe3db83ee813b05012a42c3d15cd8f17d88f88ebfddc` for the
same designated `33a0054c3c71372aa5509ee8ebfa4578ad512ea1` recovery target only.
Its five exact production Git blobs—the Bun lock, webapp manifest, Comfortaa
OFL license, welcome component, and welcome CSS—are pinned in
`tests/selectel-release-exit.test.mjs`. The profile is anchored to the
full-attested `dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92` runtime. Its focused
guard regression verifies read-only readiness and designated-pair preservation,
then rejects a welcome-source change before service mutation.

Database compatibility was separately verified by the synthetic PostgreSQL
current → frozen 33a → current probe: 1 selected test, 7 filtered, 12 assertions,
exit code 0 in 36.02 seconds. It ran against a dedicated `*_test` database on
loopback port 15489; the local `TEST_DATABASE_URL` value is not recorded here:

```sh
env NODE_ENV=test CHECKPOINT_DISABLE=1 DATABASE_URL="$TEST_DATABASE_URL" bun test backend/scripts/comments-release-compatibility.integration.test.ts --test-name-pattern 'current candidate and permitted rollback preserve comments and unread behavior' --timeout 360000
```

This is narrow recovery evidence, not a FULL test-suite result or a deployment
approval. The guarded release stopped before promotion; the production services
and database were not changed.

The once-per-account welcome and page-zoom correction frozen for candidate
`c93fc3e37bdcf98b7eab2fd47da8f554668edd17` has executable compatibility
fingerprint
`66c95074db67e743e0a96e9db65c758e13e7ae89de4cbc8cd5a64b67cca17d65` for the
same designated `33a0054c3c71372aa5509ee8ebfa4578ad512ea1` recovery target only.
Its six exact production blobs—the accepted mixed-media viewer source and CSS,
welcome gate, global touch policy, entrypoint, and zoom guard—are frozen in
`tests/selectel-release-exit.test.mjs` and anchored to the full-attested
`dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92` runtime. The focused regression
checks read-only recovery readiness and preservation of the designated pair,
then rejects app and zoom-guard drift before service mutation. It does not
change the recovery target, service configuration, or database rules.
The frozen viewer source includes the accepted reduced-motion fix from #220.

The code fix follows the server's atomic account claim instead of forcing the
welcome splash on every launch. It also restores startup gesture prevention and
the root `pan-x pan-y` policy while preserving local media gestures. Historically,
the app-wide gesture guard and root touch policy were removed in #185; their
older tests had been deleted earlier in #157. Production-entry Playwright
coverage now includes a trusted Chromium CDP touch pinch: after a 1.6× pinch,
`visualViewport.scale` remains 1, while ordinary single-touch and wheel input
remain uncanceled.

Against an isolated synthetic PostgreSQL `*_test` database, the selected run
passed 4/4 tests with 58 assertions and exit code 0 in 39.54 seconds: three
welcome-account tests and one current → frozen 33a → current application
roundtrip. The roundtrip completed in 34.98 seconds. The webapp production
build passed. These checks are scoped recovery evidence; the full suite remains
waived for this task, and no production deployment was performed.

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

For the schema-59 MAX migration, backend, worker and scheduler are stopped before
SQL because the previous runtime cannot safely write against the expanded
reference schema. If promotion is interrupted after the 59-migration ledger is
complete, keep those writers stopped. The guarded application rollback verifies
the complete ledger and exact pinned compatible recovery pair, applies only the
MAX metadata inverse, starts that backend and waits for internal readiness before
checking normal auth routing, then starts worker, scheduler and static. The SQL
schema remains at 59. Once the compatible pair is healthy, retry the same guarded
full release; it rechecks the ledger and recovery readiness before promotion.
Never restart the prior incompatible writers, edit `rollback.env`, fabricate a
forward-only marker or alter the migration ledger.

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


### Local release metadata preparation

For review preparation only, the local `teamlead-development` skill includes `scripts/prepare-selectel-release.mjs` (use the installed skill path). Example: `node <skill-path>/scripts/prepare-selectel-release.mjs --repo <checkout> --base <full-base-sha> [--candidate <full-candidate-sha>]`. The helper reads the accepted `origin/main` fingerprint function and produces exact source-bound metadata without modifying Git or touching the host. Its output is preparation only: it is not approval, a gate, a patch, a deployment, or a compatibility decision. All existing review and release safeguards still apply.
