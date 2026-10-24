# Album private photos implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Repository teamlead/AGENTS delegation and one bounded review/fix/recheck take precedence.

**Goal:** New photos uploaded from albums persist only in existing private storage and album records; they never create or publish a feed Memory.
**Architecture:** Reuse current reserve/upload/finalize/private-content pipeline. A small media-owned AlbumPhoto registry retains finalized originals independently of album entries. Album sources may point directly to this registry without a Memory. Existing feed-source references and non-photo publication behavior stay compatible.
**Tech Stack:** Existing Bun/Hono/Prisma/PostgreSQL, React/Vite, shared contracts; no dependencies or new storage provider.
**Spec:** Owner correction in this conversation on 2026-10-23 supersedes previous MEMOLY-ALBUMS-IMPLEMENTATION feed-publication requirement. New photos must go to storage, not feed. Preserve existing production uploads; no deletion/unpublication of past feed records.

## Identity and constraints

Task MEMOLY-ALBUMS-PRIVATE-UPLOAD. BASE c829c886f5d0a0712eb2016dc0e4ebc25ff888d0; branch fix/albums-private-upload; own worktree D:/codex/TG_OurMemoriesDevBot/worktrees/memoly-albums-private-upload.
Lead owns architecture/shared schema/contracts/composition integration; one delegated Luna High writer at a time, fresh read-only independent review, no subagents from workers.
Only MAX Bot/Mini App/Web/PWA; preserve accepted four-template UI and four navigation positions. Do not change dependencies, lockfile, AGENTS, historical data, authentication model, media engines or storage pipeline.
No hidden/processing/deleted Memory workaround and no frontend-only feed filtering. Existing MemoryStatus has no draft; a fake Memory would expand publication semantics.
Full profile required for private media, ACL, data/contracts and release attestation. Standard guarded Selectel deployment only after exact-source verification/review/merge/release verification. No DB restore, production fixtures, paid resources or force Git operations.

## Lead design rulings

1. Retain current MediaAsset purpose=memory and upload APIs. Add media-owned AlbumPhoto (album_photos) registry: mediaId primary key, familyId, createdAt; composite same-family FK/unique to MediaAsset, family cascade. Claim only finalized ready photo/upload/memory assets in caller family; first registration requires current uploader and no MemoryMedia relation. Existing registered same-family asset may be reused by full members. Registry survives source replacement, chapter clear and album/entry soft deletion; originals remain stored and quota-counted. Family hard deletion retains existing lifecycle and is outside product changes.
2. Expand AlbumEntrySource.memoryId to nullable and add nullable albumPhotoMediaId composite FK to registry. CHECK permits exactly existing memory-backed reference OR direct private_storage/photo with null memoryId and albumPhotoMediaId=sourceId. Add partial unique(entryId,albumPhotoMediaId) for nonnull direct refs; retain old constraints/rows.
3. Shared source request/DTO accepts memoryId:null ONLY with sourceKind=private_storage (direct photos); old refs remain unchanged. Use one shared strict ref schema for create-entry/set-sources. Existing picker lists published memories only.
4. Media exports AlbumPhotoSourceCatalog public port/factory. claim(tx,scope,mediaIds) validates/locks/atomically registers; project(tx,scope,mediaIds) reads current available private-photo projection. Album layer composes it with existing public Memory catalog; do not teach the Memory catalog to accept unpublished Memory or import adjacent domain internals.
5. Existing write transaction's fresh session/member/family scope, family/album lock, aggregate version and durable source-operation receipt protect direct attachments too. Lock media IDs in stable order. Preserve exact retry/no-resurrection behavior; ID-only receipt reprojection must not re-register or reattach on replay.
6. Read authorization through existing media content endpoint additionally permits registry-backed stored photos to current same-family members (viewer read, full upload). Unregistered uploads remain unreadable; cross-family/revoked access denied. Existing media paths/variants are reused. Normal Memory creation/readiness must reject registered album-only assets; registration rejects any Memory attachment.
7. New GC excludes registered AlbumPhoto assets. Because frozen33a old GC does not know registry, additive DB triggers are required for recovery safety: protected stored asset deleted_at transition must return NULL (skip UPDATE/count0, not OLD); registered asset MemoryMedia INSERT/UPDATE must reject; registry INSERT must reject already-linked/deleted/nonphoto/unready assets. Registry/media linkage claims serialize on the same family/media rows before checking competing relation. No SECURITY DEFINER or bypass flags. Test concurrent registry claim versus old/current GC and publication, not just happy-path SELECT predicates.
8. UI photo mode reuses current upload implementation with explicit album destination/onUploaded callback, bypasses createMediaMemory completely, preserves completed asset IDs/retry without reupload. Store-photo receipt and attachment call use null-Memory refs; existing note/video route remains unchanged and accurately labelled. Album photo mode must not silently discard feed caption/date fields: use album entry editor for those, and omit feed-only fields in that mode. Use “Добавить в альбом”/storage copy, never “Опубликовать в ленту” for this photo path.
9. Direct-photo detail uses current private attachment projection and existing viewer; do not call GET memories with null/fake IDs. A presentation-only viewer group/adapter is fine; do not create persisted fake Memory or a new media engine. Preserve mixed existing-memory/direct-photo viewer, focus/Back/scope cancellation.
10. First implement/freeze runtime, then update only exact-source recovery attestation and exact reviewed migration suffix/catalog as needed for 53 migrations. Preserve validated backup, image/config/source/ancestry/host-lock, strict pre-SQL prefix and complete post-SQL requirements. No permissive hash/ledger fallback. Actual current→frozen33a→current probe must invoke real old media:pending:cleanup and old delete task on >24h direct-photo assets and prove byte/row preservation; old publication must fail closed.

## Review focus

- Raw API cannot put album-only photos into a feed or attach cross-family/unready/stolen staged assets.
- Quota/retention remains correct after clear/remove, current GC, actual frozen recovery GC/delete task and return to current.
- Two competing claim/publication/cleanup transactions cannot create a successfully attached but deleted/published photo.
- A lost attach response/retry/revocation cannot reupload, duplicate or resurrect old references.
- Viewer uses only current authorized private asset paths and clears resources on family/account/epoch changes.

## Task 1 — server storage-source boundary

Files: backend/prisma/schema.prisma + one new additive migration; packages/contracts/src/albums.ts and tests; backend/src/modules/media public port/adapter/index + repository read/readiness; backend/src/modules/albums catalog/repository/module/types; narrow Memory publication validation; backend/src/jobs.ts; backend album/media integration tests; albums-release-compatibility probe.
Interfaces: public media AlbumPhotoSourceCatalog described above; generalized albums source catalog composes existing memory catalog and direct-photo catalog; existing route/set-sources version/idempotency remain.
- [ ] Add real HTTP/PostgreSQL regression: finalized photo attaches with memoryId:null, no Memory/feed/publication count changes; run against baseline and save observed FAIL.
- [ ] Implement minimal registry/migration/source composition/read/retention/publication boundary.
- [ ] Verify own/full/viewer/foreign/revoked/unready/mismatched refs; existing Memory source identity unchanged; covers/year counts/direct mixed ordering.
- [ ] Verify durable retry, clear/remove retention, >24h GC and competing claim/publication/GC on real PG.
- [ ] Extend actual frozen33a probe with GC/delete/publication checks, then same-source narrow tests/types/architecture.
STOP: incompatible migration, proposed production-data edits, weakening existing auth/ACL/guards, new dependency/media pipeline, unresolved protocol fork. Report to lead before expanding scope.

## Task 2 — album photo UI destination

Files: webapp/src/features/composer/PhotoComposer.tsx (+ narrow existing API types if needed); albums ComposerHost/EntryEditor/AlbumsPage/detail/model; webapp/e2e/albums.spec.ts + existing fixture; no restyle/new icons.
- [ ] Add short real-backend journey proving new upload→storage-only attach→reload/view with zero POST memories and unchanged feed count.
- [ ] Add explicit album photo destination to existing upload path and accurate UI/receipt; preserve completed asset IDs on attachment-only retry.
- [ ] Support direct and existing sources in original viewer, no bogus Memory load. Preserve free/year/events/workshop and upload accessibility where no child is required for a direct photo.
- [ ] Run targeted upload retry/viewer/scope journey and relevant types/lint/build, targeted actual React visual check.
STOP: auth/ACL ambiguity, changed MAX video path, lost user-entered fields, new media engine or unrelated UI redesign.

## Task 3 — exact recovery/release and completion

Files: only required deploy/selectel exact-source attestation/catalog/readme and focused Selectel regression after runtime freeze.
- [ ] Lead inspect actual diff and narrow evidence; fresh independent read-only Luna High review of full active diff; one bounded fix pass and narrow closure.
- [ ] Freeze source, run FULL on exact HEAD in existing isolated Linux cache + fresh dedicated PG *_test DB; no skips/timeouts increases/CI.
- [ ] Fetch current main, ordinary merge if needed, verify affected checks and record exact evidence in one PR; squash merge expectedHEAD and verify main/tree.
- [ ] FULL on exact release SHA, refresh actual production runtime/ledger/recovery, existing guarded release under shared lock; verify service SHAs/images, ledger53, health/root/manifest/private-route and recovery readiness.
- [ ] Preserve evidence, remove only own branch/worktree/resources, final copyable HANDOFF including actual device limitation.
