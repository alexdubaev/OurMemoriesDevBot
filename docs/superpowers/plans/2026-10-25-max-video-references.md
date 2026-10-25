# MAX video references implementation plan

> **For agentic workers:** execute the assigned bounded task; the lead owns architectural and security rulings. Use the repository's one scoped independent review and one bounded fix pass.

**Goal:** keep new MAX videos on MAX and switch exactly verified existing videos without deleting recovery assets or changing Memory identity or metadata.

**Architecture:** extend the existing provider reference and authenticated playback paths. One inbound source owns references keyed by attachment position. New mixed ingestion stores photos only and publishes all references in the same Memory transaction. Existing videos retain their MediaAsset IDs and links; a same-ID MAX reference takes precedence in projections, with a durable retention/recovery ledger preventing cleanup.

**Tech stack:** existing Bun/Hono/Prisma/PostgreSQL, React/Vite, MAX API and private storage abstraction.

**Spec:** owner's task MIGRATE-ALL-MEMOLY-VIDEOS-TO-MAX-REFERENCES and `docs/mvp/plans/media-polish-max-backup/01_LOCKED_OWNER_DECISIONS.md`.

## Global constraints

- Base: `92a4fb7d732339927fb3ac0c38c8bbe18f655ad4`; branch `feat/max-only-video-storage`; own external worktree `D:/codex/TG_OurMemoriesDevBot/worktrees/max-only-video-storage`.
- Production baseline: backend/worker/scheduler `ccd3b911222d00769a099b998d8eef2665acd9d4`; frontend `a7e1e0781d51ceb58fb1f7784c1a69f9c066fca4`. Re-read before release.
- FULL release only. No hosted CI/Actions: repository policy defines local `bun run verify:local --profile full` as the mandatory gate.
- Preserve UI v4, ACL, 1–10 attachments, 250,000,000-byte video limit, exact order and timestamps. No resolution cap.
- No MAX repost, duplicate Memory, old-object deletion, quota decrement, production-file test fixtures or destructive migration.
- Only exact durable provider identity permits migration; unavailable/unconfirmed entries remain on legacy playback.
- Read-only inventory found the actual production driver is filesystem, not S3. Use provider-neutral storage operations; do not relocate storage.

## Review focus

- Same source with two/four videos, mixed positions and concurrent replays creates one Memory and stable distinct references.
- Provider message/channel/attachment mismatch, revoked membership and cross-family requests fail closed.
- Migration leaves Memory rows, child tags, comments/reactions/seen, album source IDs/order and quota unchanged.
- Memory deletion, queued media deletion, orphan cleanup and historical runtime cleanup cannot delete retained legacy bytes.
- Poster reuse and recovery preserve attachment IDs and avoid duplicate carousel/album entries.

## MV1 — reference model and new ingestion

Allowed: minimal Prisma migration/schema; MAX infrastructure; trusted source publisher; affected integration fixtures/tests. No manifests, lockfile or release tooling.

- [x] Establish synthetic PostgreSQL baseline on owned loopback `*_test` database.
- [x] Replace inbound source-wide uniqueness with `(source_id, attachment_position)`; retain family/source/memory foreign keys and memory-position uniqueness.
- [x] Extend trusted source publication with validated contiguous ordered private/external positions, retaining existing ordinary-source behavior.
- [x] Replace mixed full-video download with verified metadata/reference creation and poster enqueue inside publication transaction.
- [x] Verify single/two/four videos, alternating mixed media, identity rejection, timestamp preservation, replay/concurrency and existing direct-session creation; assert no full-video storage writes.

## MV2 — non-destructive migration and recovery

Allowed: retention additive schema/migration; MAX migration service/CLI and tests; media cleanup gates; Memory/album/poster projection changes; documentation.

- [x] Add durable retention/recovery ledger with same-family MediaAsset FK, original mapping and immutable source evidence; database guard plus delete-worker checks retain legacy originals, variants and quota, including after Memory deletion.
- [x] Create new reference with the existing MediaAsset UUID, retaining original MemoryMedia and source attachments. Projection substitutes exactly matching reference at the same position; old attachment/tag IDs stay unchanged.
- [x] Reuse the existing preview poster through the existing authenticated media endpoint, with display/preview-aware poster projections. Do not regenerate available posters.
- [x] Existing album source identities remain stable; resolve migrated private-source IDs to MAX attachment projection and suppress duplicate picker items.
- [x] Implement bounded read-only plan, reverified atomic apply and explicit recovery. All provider probes use message/channel/sender/attachment identity, metadata and bounded HEAD/Range only. No provider writes or video-file reads.
- [x] Synthetic real-DB/storage tests: stable Memory row and related state, order, migration replay/concurrency, unavailable skip, wrong identity refusal, retained cleanup/delete, album/edit/poster playback and recovery to legacy.

MV1 checkpoint: `30a50e2eab3dd56fcf36c9806f67d1d1ee1ac142`. Targeted capture, forward import, child tags and direct uploads passed (168 tests total). MV2 checkpoint: `797ef4b96f0e2017b235f3fad2e02d762e4cdb01`; migration/recovery integration passed 2 tests / 68 assertions, media access 12 / 167; schema validation and backend typecheck passed. The retention migration also holds all existing non-deleted-storage videos and old-worker MAX inserts independently of whether they can be mapped.

At 2026-10-25T12:03Z a parallel accepted release moved all four production services to `0486e79947f6612d0eed05207c1cd30d0c4ace65` with 57 completed migrations. Its only change from the starting main is a Control browser test; preserve it during reconciliation. The guarded recovery target remains the existing immutable `33a0054` pair. Release compatibility work must prove the registered-reference inverse, fail closed for held tombstoned assets, and quiesce old writers after validated backup before applying the new SQL.

At 12:50Z the accepted Android safe-area release moved the frontend to `0f2e8a432b5712d17b67d63f99439d16f33e7721`, retaining backend/worker/scheduler `0486e799`. Both accepted main changes are merged into this task. The MAX release now attests the exact working mixed recovery pair `0486e799` backend plus `0f2e8a43` frontend, including each immutable image ID and revision label; it refuses the older 33a pair for this candidate. The real frozen-0486 database roundtrip and exact-pair release regressions pass. Independent implementation review and the focused recovery-pair review found no P0/P1/P2; subsequent changes only repair synthetic test fixtures exposed by the 59-migration catalog and retention guard.

## MV3 — verification and delivery

- [x] Inspect actual complete diff and targeted evidence; run one fresh scoped independent Luna High review and one bounded fix pass.
- [ ] Reconcile fresh origin/main using merge if necessary, then exact-source FULL and dependency/security checks; publish evidence in one PR and squash merge with expected HEAD.
- [ ] Confirm final main tree/source, perform required exact-release FULL and guarded Selectel release, preserving all accumulated changes and applicable recovery requirements.
- [ ] After compatible code deployment, create and validate protected DB backup, freeze inventory/mapping, dry-run, apply only reverified entries in small batches and verify each batch.
- [ ] Verify authenticated playback/posters, unchanged Memory data, preserved old storage objects/quotas, runtime SHA/health/queues/migration parity and no provider reposts.
- [ ] Confirm merge/deploy, safely remove only own clean temporary branch/worktree; finish with the owner's single fenced HANDOFF and stop.

## Initial read-only inventory evidence

At 2026-10-25T11:18:36Z: 104 active videos (43 MAX references, 61 private video attachments in 25 Memories). All private video attachments have exact source-attachment records and pass MAX message identity, position/token identity, video metadata, HEAD 200 and two-byte Range 206 verification. No unverified active private candidates at this snapshot. Original objects: 61 / 594,845,085 bytes; playback: 61 / 279,731,376; preview posters: 61 / 5,873,071. All 183 physical objects exist; no duplicate object keys were summed. Recovery inventory with exact identities stays in ignored local/server-private artifacts, outside Git.

## Post-merge release safety closure (2026-10-25)

PR #245 merged at `d2999cca6e4e5980cc2277de7453440353f5b392`; source FULL passed at `2c16d235bb83701046ad9d01fff4c7a741daff83` with the identical tree. Production has not yet changed. The exact-release browser run exposed a one-child API-seed/feed-cache fixture race; the bounded fix reloads after seeding, as the two-child fixture already does.

A subsequent real frozen-0486 native upsert probe supersedes the 12:50 recovery assertion above: schema 58 removes scalar `source_id` uniqueness, so that client's `ON CONFLICT (source_id)` fails PostgreSQL 42P10 for create and replay. Read/edit/delete evidence alone was insufficient. Do not promote 0486 or 33a after this migration. The dependent correction uses the already accepted immutable d299 backend and frontend as compatible forward recovery, preserving the current UI and composite source/attachment ingestion. Their exact image IDs and installer source pin are recorded in the Selectel runbook and verifier. Artifact preparation does not promote services or mutate the database.

The canonical installer first verifies the running pair and, only for the exact 0486/0f2 pre-schema-59 transition, can designate the fixed d299 pair after all existing source, image, host-input and phase-specific readiness guards pass. Metadata inverse removes only registered migration references; all legacy files, quota and unledgered references remain. A real frozen-d299 probe now covers composite upsert create/replay and multiple references, plus legacy recovery/read/edit/delete. Historical Control pins remain unchanged. The correction requires scoped independent review, source FULL and exact final release FULL before guarded deployment and the separately backed-up bounded data migration.
