# COM-4 — comments acceptance and release readiness

Snapshot: 2026-10-21. Product baseline: `11a283605181a09835b734eb3156a815aacbc507`
(COM-1 #187, COM-2 #190, COM-3 #191). This record supplements
[the Selectel runbook](../../deploy/selectel/README.md); it does not authorize a release.

## Delivery decision

**Production rollout is BLOCKED by the existing release/rollback preconditions.**
The comments migration, deployment and real-family writes have not been performed.
Local acceptance results and the exact checked source/tree are recorded in the COM-4 PR.
A passing local gate must not be presented as passing production readiness.

## Read-only production snapshot

SSH metadata and `prisma migrate status` were read on 2026-10-21 at 04:02 UTC;
backup metadata was checked at 04:14 UTC. No environment secrets or family rows were read.

| Component | Actual revision | Immutable image ID |
| --- | --- | --- |
| API | `4ce200620bf87d1ba5605aee73f5442fe50ccdb4` | `sha256:7c5b652dabaa67f7aed21a9c9d8ba034409beceec7b62b1a9ebe8edeaf1b9e1d` |
| Worker and scheduler | `af606f93ed5e91ff4f7a50c96b6444bfb386adb5` | `sha256:69dfb8b676c4262cd885e2f481c5080bdf0cfc81c718e39c1caf3d14aa3621cd` |
| Static frontend | `a52ba972018a5f56bfe098b81489cd8889d760d4` | `sha256:cd480ed4537cbb86b666b05f287546b73f1b15b6f0424c96042fc5d1fbc7ff04` |

All four containers were running; OCI revision labels matched their tags. The clean
production checkout `/opt/memoly/app` was `af606f93ed5e91ff4f7a50c96b6444bfb386adb5`.
Production reported 48 migrations and an up-to-date schema for its old runtime;
the candidate has 49, including `20261020173000_memory_comments`.

Free space was **6,305,386,496 bytes (5.87 GiB)**, above the mandatory 4 GiB guard.
This is a time-specific observation, not a reservation for a future build. Recheck
before release; never bypass the guard or prune unrelated resources.
Buildx 0.37.1 and Compose 5.5.1 were available. No active release lock or B2/MM0
forward-only marker was observed. The gateway configuration bind remained read-only.

The protected backup directory was root-owned mode 0700. There were 15 existing
custom PostgreSQL dumps; the newest was the 2026-10-17 archive (365,448 bytes,
mode 0600). `pg_restore --list` succeeded without restoring or querying production.
This proves archive readability, not freshness or a tested production restore.
A fresh validated backup remains mandatory inside an authorized release.

`rollback.env` and the configuration-backup marker were root-owned mode 0600.
The referenced Compose/Caddy backup files existed. The configured backend/frontend
rollback pair was `3fce2739205da927b95eb3379b1d066b61282965`; both images existed:

- backend: `sha256:d8fada3265507cc8ee1ae76b83bf851187aaad19c126b3f4fec4cead92c9106c`;
- frontend: `sha256:9a31bb3f071ae2f11654671fce4a262a37fb4a039e7d7f3c422ed824a7787a66`.

## Proven barriers and safe recovery boundary

1. `ci-release.sh:capture_running_images` requires API, worker and scheduler image
   tags to match. The actual `4ce2006` / `af606f9` split fails that precondition.
2. `detect_membership_rollback_boundary` requires the running backend commit to be
   an ancestor of the accepted candidate. `git merge-base --is-ancestor 4ce2006…
   11a2836…` returned 1. The production frontend producer SHA is also outside that
   accepted lineage; no retagging is permitted to conceal this.
3. `prepare_rollback` records the *running* images. For this host that would be the
   mixed `4ce2006:a52ba97` pair, replacing the saved `3fce273:3fce273` pair.
   `redeploy.sh:verify_application_rollback` has no attestation for that mixed pair,
   and its existing exact source fingerprints/schema/dependency equality do not
   attest the comments candidate against the saved older pair either.

Image availability and a synthetic old-runtime schema test do not resolve those
release-protocol requirements. No release command, rollback-readiness one-shot,
configuration write, service recreation or permission change was run on the host.
Prebuilding images still meets the same guards; frontend-only delivery omits the
required API/migration; neither is a safe workaround.

The missing authority is **a separate controlled production-baseline reconciliation
and its reviewed recovery procedure**, followed by explicit permission for the
comments rollout. An engineer must design and locally verify that maintenance:
record each current service image/configuration, select a compatible accepted
runtime for all API/jobs, attest the exact source/target schema and runtime pair,
retain a recovery route for interruption, and use the release lock, fresh backup,
disk and ownership guards. Updating jobs or inventing a new mixed-service rollback
protocol here would exceed this task's read-only production boundary. Do not solve
it by disabling an ancestry/ownership/rollback guard, fabricating labels, manually
writing a forward-only marker, or editing the saved rollback target without proof.

## Local acceptance and reproduction

Use a clean native Linux filesystem (WSL2 Ubuntu ext4 was used), Bun 1.4.0,
Node 24.15.0, Chromium and task-owned PostgreSQL databases ending in `_test`.
Use separate ports, Compose project, storage and network; do not use production.
The frozen historical runtime probes require the exact Git objects below. In a
fresh canonical clone, fetch them explicitly before running the required tests:

```sh
git fetch origin 4ce200620bf87d1ba5605aee73f5442fe50ccdb4
git fetch origin 3fce2739205da927b95eb3379b1d066b61282965
# Existing measured rollback suite also requires its historical source:
git fetch origin 39e8af7bb9e9a5949ada3c32dad31d38f9439505
bun install --frozen-lockfile
bun run --cwd backend test:integration -- src/modules/memories/comments.integration.test.ts src/modules/memories/comments-idempotency.integration.test.ts src/modules/memories/comments-mutations.integration.test.ts src/modules/memories/comments-races.integration.test.ts
bun run --cwd backend test:integration -- scripts/comments-release-compatibility.integration.test.ts
bunx playwright test --config webapp/e2e/comments.playwright.config.ts
bun run verify:local --profile full
```

Set matching explicit `DATABASE_URL` / `TEST_DATABASE_URL` to the isolated test DB;
use the repository E2E port/Compose environment for the browser run. The compatibility
probe installs each historical runtime's frozen dependencies and generates its own
old Prisma client. It does not substitute the current generated client or alter the
accepted migration. Actual current UI/API checks and controlled mock error/privacy
checks are separate evidence. The latter cannot establish backend correctness.

## Rollout after the blockers and authorization are resolved

1. Capture fresh production checkout/service SHA, OCI labels/image IDs, migration
   status, disk bytes, forward markers, backup/configuration ownership and lock state.
   Confirm the separately reconciled baseline and measured rollback pair still match.
2. Freeze the accepted release SHA and tree; retain its FULL log/exit and review.
   Build immutable `memoly-backend:$SHA` and `memoly-webapp:$SHA` from the clean
   accepted archive using `build-images.sh`, with the existing public MAX bot
   username. Record image IDs/digests/OCI revisions; never deliver mutable `latest`.
3. Confirm the exact compatible rollback images and protected configuration backup.
   Under the normal deployment lock, validate preflight and create/validate a fresh
   custom PostgreSQL backup. Stop on disk/ownership/migration/recovery failures.
4. Invoke the approved `ci-release.sh` entry point from the accepted commit, with
   `DEPLOY` and the explicitly approved pending-migration flag. Its single release
   job applies the additive comments migration and checks status. Do not use db push,
   startup migrations, manual SQL or a second migration runner.
5. Promote the compatible backend API, then worker/scheduler using the same backend
   image as required by the existing runbook, then static frontend and gateway
   readiness. Jobs are part of that guarded promotion; MAX webhook/channel bindings
   are not reconfigured. A frontend-only deploy is insufficient.
6. Run the runbook technical smoke and verify all four active SHAs, immutable image
   identities, 49-migration status, health and release manifest. Check comments only
   in an explicitly authorized pilot family; this task did not create one on production.

## Rollback without losing comments

The current guards do **not** yet authorize a candidate-to-production-baseline rollback.
After a separately reviewed exact-pair attestation, use only the existing guarded
application rollback with its validated images/configuration backup and readiness
checks. Restore compatible code/configuration while keeping the expanded schema.
Never DROP the comments table, execute a down migration, restore an older database
backup automatically or delete post-release comments. If a rollback guard rejects
recovery, stop that action and use the reviewed compatible forward-fix procedure;
do not override it. Local runtime roundtrip evidence is distinct from a production
rollback rehearsal, which was not performed.

## Physical acceptance after an authorized release

On a real iPhone/MAX, the owner should check:

1. Open comments under both a photo and a video.
2. Send, edit and delete a comment; confirm list and counter updates.
3. Confirm personal avatar and family name, including beneath a MAX-channel post.
4. Check the on-screen keyboard, multiline input and explicit Send.
5. Close with Back/UI and confirm feed position and selected attachment survive.
6. Check long-press reactions, carousel/fullscreen and video playback/stop.
7. Briefly interrupt the network and retry without a duplicate or lost draft.
8. With Viewer, check comments work and media-upload permissions remain absent.

Physical iPhone/MAX acceptance has not been performed. Browser emulation and
synthetic screenshots are not evidence of a physical keyboard/MAX check.

PRODUCTION MIGRATION: NONE

PRODUCTION DEPLOY: NONE

REAL FAMILY DATA CHANGES: NONE
