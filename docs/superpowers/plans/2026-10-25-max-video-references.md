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

- [ ] Establish synthetic PostgreSQL baseline on owned loopback `*_test` database.
- [ ] Replace inbound source-wide uniqueness with `(source_id, attachment_position)`; retain family/source/memory foreign keys and memory-position uniqueness.
- [ ] Extend trusted source publication with validated contiguous ordered private/external positions, retaining existing ordinary-source behavior.
- [ ] Replace mixed full-video download with verified metadata/reference creation and poster enqueue inside publication transaction.
- [ ] Verify single/two/four videos, alternating mixed media, identity rejection, timestamp preservation, replay/concurrency and existing direct-session creation; assert no full-video storage writes.

## MV2 — non-destructive migration and recovery

Allowed: retention additive schema/migration; MAX migration service/CLI and tests; media cleanup gates; Memory/album/poster projection changes; documentation.

- [ ] Add durable retention/recovery ledger with same-family MediaAsset FK, original mapping and immutable source evidence; database guard plus delete-worker checks retain legacy originals, variants and quota, including after Memory deletion.
- [ ] Create new reference with the existing MediaAsset UUID, retaining original MemoryMedia and source attachments. Projection substitutes exactly matching reference at the same position; old attachment/tag IDs stay unchanged.
- [ ] Reuse the existing preview poster through the existing authenticated media endpoint, with display/preview-aware poster projections. Do not regenerate available posters.
- [ ] Existing album source identities remain stable; resolve migrated private-source IDs to MAX attachment projection and suppress duplicate picker items.
- [ ] Implement bounded read-only plan, reverified atomic apply and explicit recovery. All provider probes use message/channel/sender/attachment identity, metadata and bounded HEAD/Range only. No provider writes or video-file reads.
- [ ] Synthetic real-DB/storage tests: stable Memory row and related state, order, migration replay/concurrency, unavailable skip, wrong identity refusal, retained cleanup/delete, album/edit/poster playback and recovery to legacy.

## MV3 — verification and delivery

- [ ] Inspect actual complete diff and targeted evidence; run one fresh scoped independent Luna High review and one bounded fix pass.
- [ ] Reconcile fresh origin/main using merge if necessary, then exact-source FULL and dependency/security checks; publish evidence in one PR and squash merge with expected HEAD.
- [ ] Confirm final main tree/source, perform required exact-release FULL and guarded Selectel release, preserving all accumulated changes and applicable recovery requirements.
- [ ] After compatible code deployment, create and validate protected DB backup, freeze inventory/mapping, dry-run, apply only reverified entries in small batches and verify each batch.
- [ ] Verify authenticated playback/posters, unchanged Memory data, preserved old storage objects/quotas, runtime SHA/health/queues/migration parity and no provider reposts.
- [ ] Confirm merge/deploy, safely remove only own clean temporary branch/worktree; finish with the owner's single fenced HANDOFF and stop.

## Initial read-only inventory evidence

At 2026-10-25T11:18:36Z: 104 active videos (43 MAX references, 61 private video attachments in 25 Memories). All private video attachments have exact source-attachment records and pass MAX message identity, position/token identity, video metadata, HEAD 200 and two-byte Range 206 verification. No unverified active private candidates at this snapshot. Original objects: 61 / 594,845,085 bytes; playback: 61 / 279,731,376; preview posters: 61 / 5,873,071. All 183 physical objects exist; no duplicate object keys were summed. Recovery inventory with exact identities stays in ignored local/server-private artifacts, outside Git.
