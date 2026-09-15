# MAX-07 VIDEO — bounded implementation brief

**Status:** LEAD APPROVED

**Task:** MAX-07 VIDEO
**Worktree:** `D:\codex\TG_OurMemoriesDevBot\worktrees\max-adapter`
**Branch:** `feat/max-adapter`
**Implementation base:** to be recorded after the documentation decision commit
**Design:** `docs/superpowers/specs/2026-09-15-max-07-video-reference-design.md`

## Outcome

Implement normal inbound MAX video as a published Core video Memory backed only by a stable
MAX-owned reference, and serve it through an authenticated memoLy Range-capable MP4 proxy which
resolves fresh MAX transport data for every playback request.

## Allowed paths

- `backend/prisma/schema.prisma`
- one new `backend/prisma/migrations/*_max_video_reference/migration.sql`
- `backend/src/env.ts`, its focused tests, root/backend `.env.example` only for
  `MAX_VIDEO_MAX_BYTES`
- `backend/src/modules/max/**`
- narrowly required `backend/src/modules/memories/**`
- narrowly required `backend/src/modules/media/**`
- composition-only changes in `backend/src/app.ts`, `backend/src/index.ts`, and focused tests
- `packages/contracts/src/memories.ts` and `packages/contracts/src/memories.test.ts`
- the existing private-media service-worker matcher and focused feed tests only if required for the
  new memoLy playback path
- MAX-07 design/plan/report/ledger/handoff documents

## Forbidden paths and behavior

Do not change Telegram behavior, invite/start routing, generic file handling, image storage,
audio/voice, unrelated frontend design, lockfiles, dependencies, CI, deployment, subscriptions,
webhook registration, or later MAX tasks. Do not call live MAX during implementation. Do not create
video MediaAsset/MediaVariant/MemoryMedia/private objects, persist transport data, expose raw MAX
URLs, add HLS proxying, or edit an existing migration.

## Task 1 — persistence and ingress contract

### Implement

- Add `MaxVideoReference` with source/Memory/family integrity, stable payload id, position, and
  nullable metadata; add one additive migration.
- Extend normalized MAX attachment types for exactly one normal video.
- Require a bounded stable `payload.id`; strip token and URL from normalized/durable data.
- Accept exactly one video as a supported media message while preserving existing image/file rules.
- Do not create `MaxSourceAttachment` or planned MediaAsset state for video.

### Acceptance

- A live-shaped video event with dotted mid is accepted and encrypted without token/URL.
- Mixed/multiple/malformed video is rejected atomically.
- Existing image/file/text classification is unchanged.

### Tests

```powershell
bun test backend/src/modules/max/update-mapping.test.ts backend/src/modules/max/application/accept-update.test.ts backend/src/modules/max/application/event-key.test.ts
```

### STOP

Any token/URL persistence; weakened image semantics; video MediaAsset planning; historical migration
edit; missing DB family integrity.

## Task 2 — current-token resolution and atomic publication

### Implement

- Extend `MaxApiPort.getMessage` with resolved video position/id/current-token data kept in memory.
- Add `getVideo` using `encodeURIComponent(exactToken)` and normalize only supported MP4 URLs,
  dimensions, raw duration, and safe thumbnail metadata if used.
- Add the explicit duration pair rule: `7 → 7000`; inconsistent/absent pair produces null.
- Add a video processor behind `max:process`: fresh message lookup, exact identity validation,
  resolver call, then fixed-ID Memory + reference + terminal source/inbox + saved response in one
  finally authorized transaction.
- Preserve reference-only outbox payloads and existing retry/idempotency behavior.

### Acceptance

- One accepted video creates one published video Memory and one `MaxVideoReference`, with no private
  object, MediaAsset, MemoryMedia, or quota charge.
- Provider/retry ambiguity cannot create duplicates.
- Identity/type/position mismatch creates no Memory.

### Tests

```powershell
bun test backend/src/modules/max/max-api.test.ts backend/src/modules/max/infrastructure/process-task.test.ts backend/src/modules/max/capture.integration.test.ts
```

### STOP

Network call inside publication transaction; token equality dedupe; direct unguarded Memory create;
partial publication; guessed duration; URL/token in error or task payload.

## Task 3 — guarded MP4 playback

### Implement

- Add a MAX video playback service which first verifies session/family/published Memory/reference
  ownership, then resolves fresh message token and video metadata.
- Select the highest MP4 at or below 720p; do not expose/proxy HLS in this task.
- Add GET/HEAD `/api/v1/families/{familyId}/media/max-videos/{referenceId}/content` under the existing
  media bearer/service-worker/playback-cookie boundary.
- Add a streaming CDN fetcher with HTTPS/default-port/no-userinfo, exact
  `maxvd<digits>.okcdn.ru` allowlist, manual redirects, no credentials, single Range forwarding,
  MP4/header validation, and actual-byte ceiling.
- Sanitize every provider error and response header; never log token or full signed URL.
- Pass the playback service through the composition root only; MAX-disabled startup remains valid.

### Acceptance

- Authentication and ownership checks occur before the first provider call.
- Viewer family access works; outsider/revoked/cross-family/deleted/unpublished cases fail closed.
- Range returns consistent 206; HEAD returns metadata without body; CDN receives no MAX credentials.
- Unknown host, redirect, non-HTTPS, invalid MP4 headers, malformed range, or size overflow fails.

### Tests

```powershell
bun test backend/src/modules/max/infrastructure/video-playback.test.ts backend/src/modules/media/media-access.integration.test.ts backend/src/app.test.ts
```

### STOP

Raw provider URL reaches client; CDN auth leakage; redirect follow; TLS bypass; complete-body
buffering/storage; route outside authenticated media boundary; broad auth/media refactor.

## Task 4 — DTO and existing HTML5 consumer

### Implement

- Add the strict `source=max`, `kind=video` DTO variant with opaque reference id, normalized metadata,
  and only the memoLy playback path.
- Include the reference in Memory list/get serialization without N+1 queries.
- Extend the existing private-media path validator and service-worker matcher narrowly for the MAX
  video route.
- Reuse the existing `<video>` and playback coordinator; no new player or visual redesign.

### Acceptance

- DTO contains no mid, payload id, token, signed URL, host, or storage key.
- Existing private-storage and Telegram video DTOs remain valid.
- MAX video uses browser streaming/Range rather than a fetched blob.

### Tests

```powershell
bun test packages/contracts/src/memories.test.ts backend/src/modules/memories/memories.integration.test.ts webapp/tests/feed.test.tsx
```

### STOP

Provider identity in public contract; object-URL full download; Telegram handoff change; new media
engine/dependency; unrelated UI work.

## Task 5 — deterministic verification and report evidence

The worker runs focused checks and returns compact JSON. The lead then independently inspects the
actual diff and runs deterministic domain/contract checks before review.

Worker minimum:

```powershell
bun test backend/src/modules/max
bun test backend/src/modules/media/media-access.integration.test.ts backend/src/modules/memories/memories.integration.test.ts
bun test packages/contracts/src/memories.test.ts webapp/tests/feed.test.tsx
bun run --cwd backend typecheck
bun run --cwd packages/contracts typecheck
bun run check:architecture
git diff --check
```

If a command does not match the repository runner, correct the invocation without weakening its
coverage and report the exact replacement and result. Zero discovered tests is failure.

## Review gates

1. Lead inspects diff, migration, secret scan, and test evidence.
2. Lead runs deterministic focused/domain/contract checks.
3. Fresh reviewer receives original requirements, base/head/diff, risk checklist, and commands.
4. That reviewer fixes confirmed in-scope P0/P1/P2 and verifies them.
5. Lead reruns affected checks.
6. A second fresh reviewer reviews the whole active change.
7. VIDEO becomes APPROVED only when no unresolved P0/P1/P2 remains.

## Final task boundary

After VIDEO is APPROVED, update `task-7-report.md` and the SDD ledger. Only then begin a separately
bounded audio/voice contract investigation. Do not infer video semantics for audio and do not start
MAX-10 automatically. Publication remains local unless separately authorized.

## Lead approval

Approved for one fresh bounded worker after the documentation decision is committed and its SHA is
recorded as the implementation base.
