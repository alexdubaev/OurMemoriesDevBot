# COM-4 — comments acceptance and release readiness

Snapshot: 2026-10-21. Product baseline: `11a283605181a09835b734eb3156a815aacbc507`
(COM-1 #187, COM-2 #190, COM-3 #191). This record supplements
[the Selectel runbook](../../deploy/selectel/README.md); it does not authorize a release.

## Attestation update — 2026-10-21

The guarded recovery path now has one additional exact, locally measured profile:
the COM-4 runtime fingerprint
`5a8c7cfe1839c8ed44434f80ddf7a83e1e9f6c43154a249f3b214ca3d25b5e02` may restore
the configured #180 pair `3fce2739205da927b95eb3379b1d066b61282965` across API,
worker, scheduler and static. That pair retains its measured image IDs, OCI revision
labels, target fingerprint and protected configuration requirements. The #180
Prisma CLI `migrate status` returned exit 0 on the isolated database after all 49
candidate migrations, and the actual old runtime read and wrote the expanded schema
in the candidate → old → candidate roundtrip. Runtime source, schema, contracts,
dependencies, and lockfile remain pinned by the exact measured fingerprint. The
guard also verifies the complete migration names and checksums against SQL files
from that pinned source and rejects unfinished, unknown or unreadable history.

This closes the missing exact-pair compatibility attestation described in the
initial snapshot. The accepted source for this guard work is
`a353f01a8354e42f71473b1917f99c9a97181680`; the runtime fingerprint excludes the
bounded deployment, test and documentation paths, so these changes do not alter the
measured product runtime. The production recovery was subsequently authorized and
completed as recorded below. It did not run the comments migration or deploy
comments code.

## Delivery decision

**The production baseline is normalized; the comments rollout has not been authorized.**
The original mixed-image barriers were resolved by the approved guarded recovery.
The comments migration, comments deployment and real-family writes have not been
performed. The rollout still requires final FULL verification, immutable image
build and a separate explicit owner approval.

## Historical read-only production snapshot — 2026-10-21 04:02 UTC

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

## Current normalized production baseline — 2026-10-21 06:30:32 UTC

With the owner's authorization for a fresh backup and the existing guarded rollback
only, the lead completed recovery with exit code 0. API/backend, worker, scheduler
and static frontend now all run revision
`3fce2739205da927b95eb3379b1d066b61282965`; their immutable image IDs are backend
`sha256:d8fada3265507cc8ee1ae76b83bf851187aaad19c126b3f4fec4cead92c9106c` and
frontend `sha256:9a31bb3f071ae2f11654671fce4a262a37fb4a039e7d7f3c422ed824a7787a66`.
The `/`, `/health/live` and `/health/ready` endpoints returned HTTP 200, and Prisma
reported 48 migrations with status PASS. The host checkout remains the clean,
unchanged `af606f93ed5e91ff4f7a50c96b6444bfb386adb5`.

The fresh custom PostgreSQL dump was validated as PGDMP and by `pg_restore --list`:
`/opt/memoly/backups/com4-maintenance-20261021T062914Z`, 396,176 bytes. The backup
directory was root-owned mode 0700 and the dump mode 0600. Free space at completion
was 6,313,857,024 bytes. No database restore, comments migration, comments code
deployment or direct family-data write occurred. The older 04:02 mixed-service table
above is historical and no longer describes the running baseline.

The mixed-image, ancestry and rollback-target barriers in the historical snapshot
were resolved by normalizing all four services to the existing measured #180 pair.
The current baseline is eligible for the separately guarded comments release
process, subject to final FULL verification, immutable image build, and explicit
owner approval. This completed recovery does not authorize the comments release.

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

Two additional mixed-version browser sessions passed against isolated PostgreSQL:
the built production frontend source `a52ba972018a5f56bfe098b81489cd8889d760d4`
authenticated, created/loaded a publication and remained usable with the current
API after a comment was saved; the current built frontend against actual old API
`4ce200620bf87d1ba5605aee73f5442fe50ccdb4` displayed a retryable comments error
for the real missing endpoint while retaining the feed. These were local source
builds, not production containers or a physical MAX session. Their scripts/logs
are retained with the COM-4 evidence. Application runtime files in accepted main
were unchanged by the test/documentation-only COM-4 diff.

## Comments rollout after final gates and separate authorization

1. Recheck production checkout/service SHA, OCI labels/image IDs, migration
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

The exact COM-4-to-#180 recovery pair is now measured and guarded. If a comments
release is later approved and requires rollback, use only the existing guarded
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

APPROVED BASELINE ROLLBACK: COMPLETED (exit 0)

PRODUCTION MIGRATION: NONE

COMMENTS PRODUCTION DEPLOY: NONE

PRODUCTION DATABASE RESTORE: NONE

REAL FAMILY DATA CHANGES: NONE
