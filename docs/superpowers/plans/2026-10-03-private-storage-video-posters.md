# Private storage video posters implementation plan

**Task:** FIX-PRIVATE-STORAGE-VIDEO-POSTERS
**Base:** 36a60c7f187d6a0e7f716cd4db9795d38b53e0e7
**Branch:** fix/private-storage-video-posters
**Worktree:** D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/private-storage-video-posters
**Spec:** Owner task in current conversation, sections 0–27.

## Architecture rulings

Reuse MediaVariant.preview as the persistent private poster object, linked to its original MediaAsset through existing composite mediaId/familyId FK. It is a canonical derivative rather than a second MediaAsset holding a duplicate original. The MAX-reference thumbnail migration is MAX-only and remains unchanged. No schema or DTO field addition is needed. previewPath already serves authenticated image content.

Enqueue a separate media:video-poster task in common original finalization for every video, regardless of sourceKind. Playback preparation and poster failure remain independent. Derive a versioned deterministic storage key and outbox dedupe key from media ID. Skip existing image preview/display derivatives. Use original stored video, never provider URL. Run ffprobe duration query without ingestion resolution/codec acceptance checks, then ffmpeg with automatic rotation, aspect-preserving long-edge cap 1280, JPEG output. Seek at 10% duration, with a bounded later-frame fallback for near-black output. Limit subprocess threads, allocation, time, output, downloaded bytes and temporary disk; stream original to disk with abort support. Existing worker processes tasks sequentially; protect cross-worker same-asset publication with canonical row locks and unique variant relation. Poster tasks must not mutate MediaAsset playback/status/duration or Memory content.

Reuse current bounded visible/opened pending-video query mechanism for missing private posters. Copy preview/display fields as well as playback readiness. Keep playback ready while poster is processing. Render poster/placeholder with play affordance and DTO duration in the common PrivateVideo renderer used by single and mixed carousel media. Authenticated private image source must use the existing media loading abstraction.

## Task 1: durable backend pipeline

Allowed: backend/src/modules/media/**, backend/src/outbox/handlers.ts, backend/src/modules/max/capture.integration.test.ts, backend/scripts/video-poster-repair.ts (new), relevant integration tests. No schema/migrations/lockfile/package changes, no MAX-reference poster implementation changes.

- [x] Run baseline media lifecycle/renditions and MAX poster unit tests.
- [x] Add failing real-tool extraction tests: portrait, landscape, rotation metadata, subsecond, initial-black fallback, high resolution, corrupt input.
- [x] Add extraction primitive and independent task, common finalize enqueue, cleanup integration.
- [x] Prove durable variant relation, duplicate/concurrent task idempotency, retry adoption, deletion race and failure preservation with database integration tests.
- [x] Test authenticated preview bytes, unauthenticated/other-family denial, web-upload and MAX-envelope private video producers, existing MAX poster regression.
- [x] Add operator repair script: read-only count/dry-run by default; exact-ID stdin input; apply only explicitly supplied videos; deduped enqueue; counts/status only; no Memory or source asset updates.
- [x] Run targeted backend checks; hand implementation diff to lead.

## Task 2: common frontend rendering and readiness

Allowed: webapp/src/features/feed/FeedPage.tsx, pending-video-selection.ts, relevant existing media styles/adapters, webapp/tests/**, a dedicated webapp/e2e private-video-poster fixture/spec/config. No root config/lockfile/generated tree changes.

- [x] Add failing unit tests using exact source=private_storage fixtures with single, mixed, four and two videos.
- [x] Connect private preview to renderer; show placeholder until image ready; preserve HTMLMediaElement playback/seek/fullscreen and source cleanup.
- [x] Extend existing bounded readiness refresh for poster-only completion and no reload; preserve membership/account scoping.
- [x] Dedicated browser tests on Chromium and WebKit for posters, play, duration, carousel navigation, processing-to-ready, away/back, refresh/reopen. Only synthetic media and screenshots.
- [x] Run targeted and full webapp checks; hand diff to lead.

## Lead verification, review and release

- [ ] Inspect actual full diff and run worker/media/backend integration, targeted/full webapp, Chromium/WebKit, typecheck, lint, build, architecture/template checks.
- [ ] One fresh scoped read-only Luna High reviewer; adjudicate and delegate P0/P1/P2 fixes, then one narrow recheck if needed (AGENTS 5A and owner section 21).
- [ ] Commit explicit paths, push canonical task branch, create PR from template and attach it, required CI.
- [ ] Fetch and merge fresh origin/main if advanced, rerun affected tests and CI before squash merge.
- [ ] Deploy fresh accepted merged main through reviewed ci-release.sh/runbook. Never change admin/roles/credentials. Owner-authorized migration bypass applies only if a required migration fully applied, parity passes and sole error is assertLoginCapableAdmin.
- [ ] Verify all four runtime SHAs, health/live/ready, queue, startup errors, migration count/checksum parity.
- [ ] Read-only count of missing private posters; enqueue only owner-approved six assets after successful deploy, wait for completion; duplicate variants=0 and poster relations=6; compare source assets/Memory content before and after.
- [ ] Final handoff only owner's fenced format; physical iPhone/MAX acceptance remains owner verification. Stop after handoff.

## Stop conditions

Unexpected origin, unrelated dirty changes, schema/contract or security architecture ambiguity, production secret exposure, non-fast-forward push, unknown migration error, failed mandatory checks, deploy guard failure, or repair target mismatch require lead adjudication. No broad backfill, unrelated ingestion refactor or automatic next task.
