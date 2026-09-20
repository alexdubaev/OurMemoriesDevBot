# MAX Direct Video Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated MAX Mini App owner/full member upload one local video directly to MAX and create exactly one playable memoLy Memory.

**Architecture:** The backend reserves a durable, family-scoped operation before it asks MAX for an upload capability. The browser holds the selected file and capability only in component memory, uploads with XHR/FormData, then calls an authorized, idempotent finalize operation. Finalize sends one video message through the bot, publishes the preallocated Memory ID, and stores an outbound-only provider source that the existing authenticated playback adapter can resolve without altering inbound `MaxSource` semantics.

**Tech Stack:** Bun, Hono/OpenAPI, Prisma/PostgreSQL, Zod, React/Vite, TanStack Query, XHR/FormData, MAX Bot API.

**Spec:** `docs/superpowers/specs/2026-09-20-max-direct-video-upload-design.md`

## Global Constraints

- Keep `USE_DIRECT_BROWSER_TO_MAX`; do not proxy large video bodies, create S3 originals, transcode, use MediaRecorder, add another player, or start T09.
- Only `.mp4`, `.mov`, `.mkv`, `.webm`, one file, and at most `250_000_000` bytes are accepted.
- Browser receives no bot Authorization header; it sends XHR multipart `data` to the provider URL and must not persist, log, telemetry-export, or share full capability URLs/tokens.
- Provider URL lifetime is uncontrolled and may be unlimited. `expiresAt` expires the memoLy reservation/finalize lifecycle only; it cannot revoke the provider capability and this residual risk is accepted.
- Reserve and finalize both require current OWNER/FULL access. Session ownership, family, child, idempotency and revoked-member races are checked server-side; only successful finalize publishes the fixed Memory ID.
- Preserve inbound `MaxInbox`/`MaxSource`, the existing `/media/max-videos/:referenceId/content` authorization/range behavior, and the existing HTML5 video UI.
- Log only session ID, stage, HTTP status, redacted provider host/path, size/type and timing; never a capability URL, its query, bot token, or provider upload token.

## Review Focus

- A VIEWER, revoked member, outsider, or another family attempts reserve/finalize and receives no session outcome or Memory.
- A duplicate/concurrent finalize reaches MAX only once and leaves exactly one Memory/provider source/reference.
- A browser cancellation, MAX processing delay, or send failure remains retryable without reusing a stale capability.
- A leaked/expired provider URL alone cannot bypass authenticated finalize or create a Memory.
- Playback of both inbound and outbound MAX video still validates the message, attachment, rendition CDN and byte range.

---

### Task 1: Durable outbound upload model and MAX provider port

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_max_direct_video_upload/migration.sql`
- Modify: `backend/src/modules/max/application/ports.ts`
- Modify: `backend/src/modules/max/infrastructure/max-api.ts`
- Test: `backend/src/modules/max/max-api.test.ts`
- Create: `backend/src/modules/max/infrastructure/max-direct-upload-repository.test.ts`

**Interfaces:**
- Produces `MaxVideoUploadSession` with UUID IDs, `familyId`, `authorId`, `childId`, fixed `plannedMemoryId`, normalized body/occurredAt, idempotency fingerprint/key, `expiresAt`, state, provider upload token/message ID, retry metadata and timestamps.
- Produces a separate `MaxOutboundSource`/video reference relation, keyed by provider recipient/message/attachment, rather than weakening `MaxSource.inboxId`.
- Extends `MaxApiPort` with `createVideoUpload()` → `{ url, token? }`, `sendVideoMessage({ userId, text, uploadToken })` → `{ messageId }`, and provider errors that preserve only retry classification/status/code.

- [ ] **Step 1: Write failing provider and repository tests** for normalized `POST /uploads?type=video`, video attachment message payload, rejected malformed provider data, token/url redaction, unique idempotency reservation, and an outbound source that cannot collide with an inbound source.
- [ ] **Step 2: Run the focused tests** with `bun --cwd backend test src/modules/max/max-api.test.ts src/modules/max/infrastructure/max-direct-upload-repository.test.ts`; verify they fail because the port/model/repository do not exist.
- [ ] **Step 3: Add the minimal schema, migration, repository and port/adapter implementation.** The adapter sends bot Authorization only in backend requests, validates HTTPS upload URLs and opaque tokens, and never includes sensitive values in error text.
- [ ] **Step 4: Regenerate Prisma and re-run focused tests** with `bun --cwd backend run prisma:generate` and the focused test command; verify green output.
- [ ] **Step 5: Commit** with explicit schema, migration, MAX port/adapter, repository and test paths using `feat(max): add direct video upload persistence`.

### Task 2: Authorized reserve/finalize application service and routes

**Files:**
- Create: `backend/src/modules/max/application/direct-video-upload.ts`
- Create: `backend/src/modules/max/transport/direct-video-upload-routes.ts`
- Modify: `backend/src/modules/max/index.ts`
- Modify: `backend/src/app.ts`
- Modify: `packages/contracts/src/memories.ts` only if a public DTO schema is necessary
- Test: `backend/src/modules/max/direct-video-upload.integration.test.ts`
- Test: `backend/src/modules/max/capture.integration.test.ts`

**Interfaces:**
- Consumes Task 1 repository and `MaxApiPort`, `createSourceMemoryPublisher`, authenticated `FamilyScope`, and a request idempotency key.
- Produces `POST /api/v1/families/:familyId/max-video-uploads/reserve` and `POST /api/v1/families/:familyId/max-video-uploads/:sessionId/finalize`.
- Reserve accepts `{ childId, body, occurredAt, fileName, fileSize, mimeType, idempotencyKey }`; finalize accepts `{ uploadToken }` and returns a Memory DTO or a sanitized retryable session state.

- [ ] **Step 1: Write failing integration tests** for OWNER/FULL success, viewer/outsider/wrong-child rejection, duplicate reserve, expired finalize, concurrent finalize, `attachment.not.ready` bounded retry, lost post-send database write recovery, and exactly one published Memory.
- [ ] **Step 2: Run** `bun --cwd backend test src/modules/max/direct-video-upload.integration.test.ts`; verify failures identify the missing reserve/finalize routes/service.
- [ ] **Step 3: Implement minimal transactional coordination.** Reserve validates metadata and persists before calling MAX. Finalize locks the session, rechecks full membership/child/family/author ownership, treats expiration as non-revocation, sends only under durable intent, recovers by durable provider identity before a resend, publishes with the fixed ID, and writes the outbound video reference in the after-write transaction.
- [ ] **Step 4: Re-run focused integration tests and preservation regression** with `bun --cwd backend test src/modules/max/direct-video-upload.integration.test.ts src/modules/max/capture.integration.test.ts`; verify green output.
- [ ] **Step 5: Commit** explicit Task 2 paths as `feat(max): finalize direct video memories`.

### Task 3: Outbound MAX playback compatibility

**Files:**
- Modify: `backend/src/modules/max/infrastructure/video-playback.ts`
- Modify: `backend/src/modules/max/infrastructure/process-video.ts` only if the shared reference projection needs it
- Test: `backend/src/modules/max/infrastructure/video-playback.test.ts`
- Test: `backend/src/modules/media/media-access.integration.test.ts`

**Interfaces:**
- Consumes inbound `MaxVideoReference` and the outbound source/reference created in Task 2.
- Produces the unchanged `MaxVideoPlayback.content(scope, referenceId, range, method, signal)` behavior for either source kind.

- [ ] **Step 1: Write failing tests** showing an authorized member can play an outbound reference and that wrong family, changed message/attachment identity, non-MP4 CDN response, invalid CDN host, and byte-range failures are rejected exactly as inbound playback is.
- [ ] **Step 2: Run** `bun --cwd backend test src/modules/max/infrastructure/video-playback.test.ts src/modules/media/media-access.integration.test.ts`; verify the outbound fixture fails before implementation.
- [ ] **Step 3: Add the narrow source lookup/projection** so playback validates provider message sender, recipient, single video attachment and stored attachment identity for inbound and outbound records without exposing provider tokens.
- [ ] **Step 4: Re-run focused playback tests** and verify both inbound and outbound cases are green.
- [ ] **Step 5: Commit** explicit paths as `feat(max): play outbound direct video`.

### Task 4: MAX-only Video Composer and secure browser transport

**Files:**
- Create: `webapp/src/features/max-video-upload/api.ts`
- Create: `webapp/src/features/max-video-upload/VideoComposer.tsx`
- Create: `webapp/src/features/max-video-upload/xhr-upload.ts`
- Modify: `webapp/src/platform/max/host-bridge.ts`
- Modify: `webapp/src/App.tsx`
- Modify: `webapp/src/features/feed/FeedPage.tsx`
- Test: `webapp/tests/max-host-bridge.test.ts`
- Create: `webapp/tests/max-video-upload.test.tsx`

**Interfaces:**
- Consumes the authenticated transport for reserve/finalize; XHR receives only provider URL, `FormData` field `data`, selected `File`, and abort signal.
- Produces an acceptance-only route when MAX `start_param` or `startapp` equals `max-video-upload-acceptance`; normal launches retain the existing UI.

- [ ] **Step 1: Write failing component/transport tests** for MAX-only route gating, file extension/size validation, progress, abort, retry reservation with preserved caption/date, no Authorization request header, no storage writes, URL/token redaction, single-save, and feed refetch after success.
- [ ] **Step 2: Run** `bun --cwd webapp test tests/max-host-bridge.test.ts tests/max-video-upload.test.tsx`; verify the new route/composer/transport behaviors fail.
- [ ] **Step 3: Implement the smallest composer and XHR adapter.** Keep `File`, capability and upload token in React memory only; remove them on cancel/error/unmount; request a new reservation after expiry/retry; do not alter Add Sheet or existing video player behavior.
- [ ] **Step 4: Re-run focused tests plus feed regression** with `bun --cwd webapp test tests/max-host-bridge.test.ts tests/max-video-upload.test.tsx tests/feed.test.tsx`; verify green output.
- [ ] **Step 5: Commit** explicit paths as `feat(webapp): add MAX video composer`.

### Task 5: Contract, typecheck, complete test suite and acceptance evidence

**Files:**
- Modify: focused test fixtures only where required by Tasks 1–4
- Create: `docs/acceptance/max-direct-video-upload.md`

**Interfaces:**
- Consumes all prior task boundaries.
- Produces an operator acceptance checklist that uses synthetic video only and never logs or records a capability URL/token.

- [ ] **Step 1: Write a failing cross-boundary regression** for a provider capability leak attempt that cannot create a Memory without an authorized finalize.
- [ ] **Step 2: Run the regression** in its owning backend integration file and confirm it fails before the final minimal correction.
- [ ] **Step 3: Make only the correction required by the regression, document the accepted provider-URL residual risk, and add a synthetic MAX WebView acceptance checklist.** Do not deploy, upload real family material, or invoke a bot credential in this task.
- [ ] **Step 4: Run deterministic verification:** `bun --cwd backend run typecheck`; `bun --cwd backend test`; `bun --cwd webapp run typecheck`; `bun --cwd webapp run lint`; `bun --cwd webapp test`; and `git diff --check`.
- [ ] **Step 5: Commit** explicit documentation/test paths as `test(max): verify direct upload security boundaries`.

## Plan Self-Review

- Spec coverage: Tasks 1–2 implement durable state, direct provider flow, authorization, idempotency and recovery; Task 3 retains secure playback; Task 4 implements MAX-only UX and browser controls; Task 5 validates accepted-risk and full contract.
- Placeholders: migration timestamp is created by Prisma at execution; no runtime API value is left unspecified.
- Type consistency: `plannedMemoryId` is allocated at reserve and passed unchanged to the publisher at finalize; provider upload token flows only browser upload result → authenticated finalize → backend sender.
- Review focus: each listed failure mode has an explicit Task 2, 3, 4 or 5 regression.
