# MAX-06 Image Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist supported direct-dialog MAX quick images and image-file messages through memoLy private media storage as retry-safe shared photo Memories.

**Architecture:** Extend the provider-specific MAX normalized event and durable source boundary with ordered stable attachment identities and predetermined MediaAsset IDs. Resolve fresh transient URLs through MAX message lookup, download through a credential-free allowlisted transport, reuse the shared trusted-source media lifecycle, and publish only after every asset is verified and stored through the existing fixed-ID trusted Memory publisher.

**Tech Stack:** Bun, TypeScript, Hono, Prisma/PostgreSQL, Web Streams, private storage port, Vitest-compatible Bun tests.

**Spec:** `docs/superpowers/specs/2026-09-15-max-06-image-capture-design.md`

## Global Constraints

- Work only in `D:\codex\TG_OurMemoriesDevBot\worktrees\max-adapter` on `feat/max-adapter`.
- The 1–10 image count is a memoLy application limit, never an official MAX inbound guarantee.
- One MAX message with 1–10 `type=image` attachments produces one ordered shared `photo` Memory.
- One MAX message with exactly one `type=file` attachment may produce one photo Memory only after actual bytes validate as a supported image.
- Separate file messages remain separate Memories. Multiple file attachments in one message and mixed attachments are wholly unsupported; never group heuristically.
- Preserve exact MAX rendition bytes for `type=image` and exact downloaded file bytes for supported `type=file`.
- Message text is the photo body/caption and never a separate note; preserve meaningful text unchanged, use empty body for null/blank, and never truncate over 8,000 Unicode code points.
- Stable identity is message identity plus ordered `photo_id` or `fileId`; URL and token are transient transport metadata and must not enter durable tables, TaskOutbox, logs, errors, fixtures, or reports.
- MAX API authorization is the raw token in the `Authorization` header only to `platform-api2.max.ru`. Media fetches send no bot Authorization, cookies, or provider credentials.
- Media downloads are HTTPS-only, exact-host allowlisted to `i.oneme.ru` and `fd.oneme.ru`, redirect-disabled, cancellable, time-bounded, and limited to `MAX_FILE_MAX_BYTES` actual bytes per file.
- Reuse shared Core `MediaAsset`, `Memory`, `MemoryMedia`, private storage, quota, photo decode/40-megapixel validation, and trusted-source authorization. Do not create `MaxImage`, `MaxMediaAsset`, or `MaxMemory`.
- Final publication rechecks active family, non-revoked FULL membership, child ownership, and all ready MediaAssets. Never publish a partial Memory.
- Keep TaskOutbox payloads reference-only: `max:process` remains `{ inboxId }`; response delivery remains independent.
- Keep Telegram behavior unchanged. Do not implement MAX video/audio/voice, MAX-07, invite changes, frontend changes, subscription/webhook mutation, deployment, live calls, push, PR, or merge.
- Existing migrations are immutable. Any schema change is one additive MAX-06 migration.
- Follow strict RED → observed expected failure → minimal GREEN → refactor. Every new behavior must have a test that failed before production code.

---

### Task 1: Provider-specific attachment contract and durable identities

**Files:**

- Modify: `backend/src/modules/max/application/ports.ts`
- Modify: `backend/src/modules/max/transport/update-mapping.ts`
- Modify: `backend/src/modules/max/update-mapping.test.ts`
- Modify: `backend/src/modules/max/application/accept-update.ts`
- Modify: `backend/src/modules/max/application/accept-update.test.ts`
- Modify: `backend/src/modules/max/infrastructure/prisma-max-repository.ts`
- Modify: `backend/src/modules/max/capture.integration.test.ts`
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260915130000_max_image_capture/migration.sql`

**Interfaces:**

- Replace the message event's boolean-only attachment projection with:

```ts
type MaxInboundAttachment =
  | { kind: 'image'; providerAttachmentId: string }
  | { kind: 'file'; providerAttachmentId: string; filename: string | null; declaredSize: number | null }

type MaxInboundMessageEvent = {
  kind: 'message_created'
  senderId: string
  recipientId: string
  messageId: string
  occurredAt: string
  text: string | null
  attachments: MaxInboundAttachment[]
}
```

- Provider tokens and URLs are parsed only where needed for structural validation and discarded from the durable normalized event.
- Add provider-specific Prisma `MaxSourceAttachment` and enums from the approved design. Allow duplicate provider IDs at different positions; enforce `unique(sourceId, position)` and `unique(plannedMediaId)`, with a non-unique lookup index over source/kind/provider ID.
- Add `max` to `MediaSourceKind` in the same additive migration.

- [ ] **Step 1: Write mapping tests and verify RED**

Use complete redacted fixtures matching the observed maintained MAX shapes. Assert literal normalized arrays for one image, three ordered images, and one file (`fileId`, filename, size). Assert that rotating token/URL values do not appear in normalized results. Assert malformed stable IDs, missing payload, invalid sizes, mixed/incomplete supported shapes, group/channel, and forward-only behavior at the existing boundary.

Run:

```powershell
bun test backend/src/modules/max/update-mapping.test.ts
```

Expected: FAIL because normalized attachments are not implemented.

- [ ] **Step 2: Implement minimal normalized attachment parsing and verify GREEN**

Keep provider field-name handling inside `modules/max`. Do not infer file grouping or media kind from filename. Preserve array position exactly.

Run the same command. Expected: PASS.

- [ ] **Step 3: Write acceptance/persistence tests and verify RED**

Assert:

- 1–10 all-image attachments select `accepted`;
- 11 images, mixed types, multiple files, and non-image types select `unsupported_media` without partial source attachments;
- exactly one file candidate selects `accepted` for later byte validation;
- caption does not become a separate event/task;
- one acceptance transaction creates ordered `MaxSourceAttachment` rows with distinct planned UUIDs;
- concurrent webhook repeats retain one inbox/source/ordered attachment set and one logical response/task;
- outbox payloads contain only `{ inboxId }` / `{ responseId }`;
- no token or URL is persisted.

Run:

```powershell
bun test backend/src/modules/max/application/accept-update.test.ts
bun run --cwd backend test:integration src/modules/max/capture.integration.test.ts
```

Expected: targeted failures for missing classification/schema/persistence.

- [ ] **Step 4: Add the additive migration and minimal acceptance implementation**

The migration creates the attachment kind/status enums and table, foreign key to `max_sources`, uniqueness/indexes, and adds the `max` enum value to `media_source_kind`. Do not edit either existing MAX migration. Generate each `plannedMediaId` once inside the first successful acceptance transaction.

- [ ] **Step 5: Validate schema, apply all migrations cleanly, and verify GREEN**

Run:

```powershell
bun run --cwd backend prisma:validate
bun run --cwd backend prisma:generate
bun test backend/src/modules/max/update-mapping.test.ts backend/src/modules/max/application/accept-update.test.ts
bun run --cwd backend test:integration src/modules/max/capture.integration.test.ts
```

Expected: PASS, with every repository migration applied to a disposable clean database.

**Task 1 STOP conditions:** destructive migration; token/URL persistence; provider types outside MAX; provider count represented as an official guarantee; Telegram schema behavior change; partial attachment row creation outside acceptance transaction.

---

### Task 2: Safe transient message resolution and media transport

**Files:**

- Modify: `backend/src/modules/max/application/ports.ts`
- Modify: `backend/src/modules/max/infrastructure/max-api.ts`
- Modify: `backend/src/modules/max/max-api.test.ts`
- Create: `backend/src/modules/max/infrastructure/media-download.ts`
- Create: `backend/src/modules/max/infrastructure/media-download.test.ts`

**Interfaces:**

```ts
type MaxResolvedAttachment =
  | { kind: 'image'; providerAttachmentId: string; url: string }
  | { kind: 'file'; providerAttachmentId: string; filename: string | null; declaredSize: number | null; url: string }

type MaxResolvedMessage = {
  messageId: string
  senderId: string
  recipientId: string
  attachments: MaxResolvedAttachment[]
}

MaxApiPort.getMessage(messageId: string, signal?: AbortSignal): Promise<MaxResolvedMessage>

type MaxDownloadedMedia = {
  bytes: Uint8Array
  contentType: string | null
  contentLength: number
}

createMaxMediaDownload(options?: { fetch?: typeof fetch; timeoutMs?: number }):
  (url: string, maxBytes: number, signal?: AbortSignal) => Promise<MaxDownloadedMedia>
```

`getMessage` uses the documented/probed GET messages lookup with only the encoded message ID in its query and existing raw-token Authorization behavior. `createMaxMediaDownload` is a separate fetch path that has no token parameter and cannot add Authorization.

- [ ] **Step 1: Write MAX lookup contract tests and verify RED**

Assert exact GET method/path/query, header-only raw-token authorization, caller cancellation, ten-second API timeout, sanitized non-2xx/network/malformed results, exact direct-dialog identity normalization, ordered attachments, and no retention of token. Include image/file fixtures and reject wrong message IDs or malformed envelopes.

Run:

```powershell
bun test backend/src/modules/max/max-api.test.ts
```

Expected: FAIL because `getMessage` is missing.

- [ ] **Step 2: Implement the narrow lookup and verify GREEN**

Do not add a generic MAX SDK or attachment resolver. Keep provider response guards local and return only the transient URL plus stable comparison fields.

- [ ] **Step 3: Write credential-free media transport tests and verify RED**

Assert:

- HTTPS `i.oneme.ru` and `fd.oneme.ru` succeed;
- HTTP, userinfo, alternate/subdomain lookalikes, ports, and other hosts fail before fetch;
- redirect status fails and is not followed;
- request headers contain no Authorization or cookie;
- missing/incorrect Content-Length cannot bypass actual streamed byte counting;
- body above `MAX_FILE_MAX_BYTES` aborts and returns a sanitized provider error;
- caller abort and bounded timeout work;
- returned bytes are exact and Content-Type is metadata only;
- error objects contain no URL/query/provider body.

Run:

```powershell
bun test backend/src/modules/max/infrastructure/media-download.test.ts
```

Expected: FAIL because the downloader is missing.

- [ ] **Step 4: Implement bounded media download and verify GREEN**

Use `redirect: 'manual'`, an empty credential/header set, an AbortController linked to the task signal, and incremental stream reads into a bounded result no larger than `maxBytes`. Reject zero-byte responses. Do not log the URL.

Run:

```powershell
bun test backend/src/modules/max/max-api.test.ts backend/src/modules/max/infrastructure/media-download.test.ts
```

Expected: PASS.

**Task 2 STOP conditions:** bot credential sent outside MAX API host; redirect following; arbitrary-host support; URL in an error/log; undocumented endpoint probing; mutation method; live call.

---

### Task 3: Shared trusted-source photo ingestion and cleanup

**Files:**

- Modify: `backend/src/modules/media/application/ports.ts`
- Modify: `backend/src/modules/media/application/media-service.ts`
- Modify: `backend/src/modules/media/application/media-service.test.ts`
- Modify: `backend/src/modules/media/domain/media-policy.ts`
- Modify: `backend/src/modules/media/media-policy.test.ts`
- Modify: `backend/src/modules/media/infrastructure/prisma-media-repository.ts`
- Modify: `backend/src/modules/media/index.ts` only if composition/export is required
- Modify: `backend/src/modules/telegram/infrastructure/process-task.ts` only for a compatibility call-site rename, with no behavioral change
- Modify: `backend/src/modules/telegram/capture.integration.test.ts` only for regression evidence if needed

**Interfaces:**

```ts
type TrustedMediaSourceKind = 'telegram' | 'max'

MediaService.ingestTrustedPhoto(scope: FamilyScope, input: {
  assetId: string
  sourceKind: TrustedMediaSourceKind
  bytes: Uint8Array
}): Promise<{ asset: MediaAssetDto }>

MediaService.discardTrustedSourceAssets(input: {
  sourceKind: TrustedMediaSourceKind
  assetIds: string[]
  now?: Date
}): Promise<void>

detectPhotoMime(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic'
```

Keep `ingestTelegram` as a compatibility wrapper or preserve its behavior through a private common implementation. `ingestTrustedPhoto` derives MIME from magic bytes, then uses the existing reservation, immutable object key, quota, exact original write, SHA-256, decoder/pixel checks, derivative creation, and finalization. Existing browser/Telegram declared-MIME validation remains unchanged.

- [ ] **Step 1: Write media-policy and service tests and verify RED**

Test exact JPEG/PNG/WebP/HEIC magic detection, unsupported/octet-stream bytes rejection, `sourceKind=max` persistence, exact stored original bytes/SHA-256, existing planned stored asset reuse, reservation/quota behavior, decoder/pixel failure, and unchanged Telegram ingestion behavior.

Run:

```powershell
bun test backend/src/modules/media/media-policy.test.ts backend/src/modules/media/application/media-service.test.ts
```

Expected: FAIL for missing trusted MAX ingestion.

- [ ] **Step 2: Implement provider-aware shared ingestion and verify GREEN**

Before consuming bytes, query the fixed planned asset. Return an existing ready asset only when family/uploader/source/purpose/kind match. Reject conflicting fixed IDs. Use exact downloaded bytes as the original object; derivatives never replace them.

- [ ] **Step 3: Write idempotent cleanup tests and verify RED**

For a list of planned MAX asset IDs, prove cleanup affects only unattached `sourceKind=max` assets, releases live reservations exactly once, marks stored/pending assets deleted/failed as appropriate, enqueues one `media:delete` task per asset, and never touches an attached/published or Telegram asset. Repeating cleanup must be harmless.

- [ ] **Step 4: Implement cleanup and verify GREEN**

Use a transaction and existing `media:delete:<mediaId>` dedupe keys. Storage deletion remains in the existing outbox handler. Do not require a now-revoked user to pass publication authorization for system cleanup; instead constrain every target by exact planned IDs, `sourceKind=max`, `purpose=memory`, and absence of `MemoryMedia`.

Run:

```powershell
bun test backend/src/modules/media/media-policy.test.ts backend/src/modules/media/application/media-service.test.ts
bun run --cwd backend test:integration src/modules/telegram/capture.integration.test.ts
```

Expected: PASS and unchanged Telegram results.

**Task 3 STOP conditions:** original bytes overwritten by derivative; relaxed browser/Telegram MIME checks; public storage URL; quota bypass; cleanup can delete attached or non-MAX assets; Telegram behavioral refactor.

---

### Task 4: Retry-safe MAX image processing and atomic publication

**Files:**

- Create: `backend/src/modules/max/application/image-policy.ts`
- Create: `backend/src/modules/max/application/image-policy.test.ts`
- Create: `backend/src/modules/max/infrastructure/process-image.ts`
- Create: `backend/src/modules/max/infrastructure/process-image.test.ts`
- Modify: `backend/src/modules/max/infrastructure/process-task.ts`
- Modify: `backend/src/modules/max/infrastructure/process-task.test.ts`
- Modify: `backend/src/modules/max/index.ts`
- Modify: `backend/src/modules/max/capture.integration.test.ts`

**Interfaces:**

```ts
function classifyMaxImageMessage(event: MaxInboundMessageEvent):
  | { kind: 'quick-images'; attachments: MaxInboundAttachment[]; body: string }
  | { kind: 'image-file'; attachment: MaxInboundAttachment; body: string }
  | { kind: 'unsupported' }
  | { kind: 'denied'; reason: 'invalid_caption' }

function createMaxImageProcessor(options: {
  runtime: BackendRuntime
  api: MaxApiPort
  media: ReturnType<typeof createMediaService>
  download: ReturnType<typeof createMaxMediaDownload>
}): (input: {
  inboxId: string
  sourceId: string
  event: MaxInboundMessageEvent
  signal?: AbortSignal
}) => Promise<'done' | 'skipped'>
```

The implementation may refine file boundaries, but provider matching, media ingestion, and final publication must remain separately testable. `createMaxTasks` supplies the same MAX API and private media service to `max:process`; TaskOutbox payload stays `{ inboxId }`.

- [ ] **Step 1: Write pure policy tests and verify RED**

Assert literal outcomes for 1 and 10 quick images, 11 quick images, one file, two files, mixed image/file, other types, null/blank caption, exact non-blank caption, 8,000 astral code points, and 8,001 code points. The 11-image test name must say memoLy application limit rather than provider limit.

Run:

```powershell
bun test backend/src/modules/max/application/image-policy.test.ts
```

Expected: FAIL because policy is missing.

- [ ] **Step 2: Implement pure classification and verify GREEN**

No download occurs for unsupported shapes. A single file remains only a candidate until its bytes validate.

- [ ] **Step 3: Write processor unit/integration tests and verify RED**

Use injected fake MAX lookup/download and real integration storage/Prisma where state matters. Prove:

- one quick image stores exact rendition bytes and publishes one photo Memory/MediaAsset;
- three quick images publish one Memory with three `MemoryMedia` positions matching accepted order;
- one file whose response is `application/octet-stream` but bytes are the synthetic PNG stores a byte-identical original and publishes one photo Memory;
- two separate file messages create two Memories;
- 11 quick images, mixed types, multiple files, and non-image types download nothing and publish nothing;
- message lookup must match message/sender/recipient, count, kind, stable ID, and ordered ID sequence before any download;
- changed URL/token is accepted only when stable identity/order match;
- unexpected host, redirect, malformed/oversize/corrupt/decompression-bomb bytes, and file bytes that are not a supported image publish nothing;
- a transient failure on image three leaves no Memory, preserves encrypted inbox, and a retry skips two completed assets before finishing one ordered Memory;
- a permanent failure after earlier assets schedules whole-source cleanup and leaves no partial Memory;
- ten concurrent/repeated processors create one set of MediaAssets, one Memory, one ordered link set, and one logical saved response;
- viewer, revoked membership, inactive family, missing/ambiguous family, missing child, quota exhaustion, and revocation immediately before publication create no Memory;
- the final trusted publication transaction records source/media IDs, clears inbox payload only after terminal commit, and preserves the fixed Memory ID;
- caption becomes the photo body only; no note Memory is created;
- response delivery failure leaves stored assets and published Memory intact and does not rerun processing.

Run:

```powershell
bun test backend/src/modules/max/application/image-policy.test.ts backend/src/modules/max/infrastructure/process-image.test.ts backend/src/modules/max/infrastructure/process-task.test.ts
bun run --cwd backend test:integration src/modules/max/capture.integration.test.ts
```

Expected: targeted failures for missing image processor/publication.

- [ ] **Step 4: Implement staged processing and guarded terminal transitions**

Processing order:

1. load non-terminal inbox/source and ordered planned attachment rows;
2. classify without downloading unsupported shapes;
3. resolve existing MAX identity/family/first child using the MAX-05 rule;
4. load the current MAX message and compare accepted stable identity/order;
5. for each planned asset in order, skip an already matching stored asset; otherwise download current URL without credentials, enforce actual bytes, detect supported photo MIME, and run shared trusted ingestion;
6. after all assets are ready, call `createSourceMemoryPublisher().publish()` with fixed Memory ID, `kind='photo'`, exact caption body, event time, and ordered media IDs;
7. in `afterWrite`, conditionally transition the accepted source to published, record user/family/child/memory/media references, mark inbox processed and clear encrypted payload, and create the unique `saved` response/delivery task;
8. map expected permanent media-shape failures to guarded `unsupported_media`, expected authorization/quota/caption failures to guarded `denied`, and clean all unattached source assets; propagate transient provider/storage/database failures for outbox retry.

If the accepted-to-terminal conditional transition is lost, create no contradictory response and return `skipped`. Do not hold a database transaction open during network or image decoding.

- [ ] **Step 5: Verify MAX image processing GREEN**

Run the Task 4 commands again. Expected: PASS.

**Task 4 STOP conditions:** partial Memory; network call inside publication transaction; authorization checked only before download; URL/token used as identity; download of unsupported shapes; direct Memory create; response delivery coupled to publication; cross-message file grouping; MAX-07 behavior.

---

### Task 5: Whole-change deterministic verification and report evidence

**Files:**

- Create: `task-6-report.md`
- Modify: `docs/superpowers/SDD_LEDGER.md`
- No planned production changes except regression-tested review fixes.

- [ ] **Step 1: Inspect scope and migration history**

Run:

```powershell
git status --short --branch
git diff --stat c8c6202e09453703fe71477ac95d3c4501dd43e8...HEAD
git diff --check c8c6202e09453703fe71477ac95d3c4501dd43e8...HEAD
Get-ChildItem backend/prisma/migrations -Directory | Sort-Object Name
```

Confirm exactly one additive MAX-06 migration, no edited historical migration, and no frontend/invite/video/subscription/deployment scope.

- [ ] **Step 2: Run focused MAX/media tests**

```powershell
bun test backend/src/modules/max/max-api.test.ts backend/src/modules/max/update-mapping.test.ts backend/src/modules/max/webhook.test.ts backend/src/modules/max/application/event-key.test.ts backend/src/modules/max/application/accept-update.test.ts backend/src/modules/max/application/image-policy.test.ts backend/src/modules/max/infrastructure/media-download.test.ts backend/src/modules/max/infrastructure/process-image.test.ts backend/src/modules/max/infrastructure/process-task.test.ts backend/src/modules/max/infrastructure/deliver-response.test.ts backend/src/max-startup.test.ts backend/src/modules/media/media-policy.test.ts backend/src/modules/media/application/media-service.test.ts
```

Record exact test/assertion/file counts and exit code.

- [ ] **Step 3: Run clean-database integration and regressions**

```powershell
bun run --cwd backend test:integration src/modules/max/capture.integration.test.ts
bun run --cwd backend test:integration src/modules/telegram/capture.integration.test.ts
```

Record exact migration/test/assertion counts and exit codes.

- [ ] **Step 4: Run repository gates**

```powershell
bun run --cwd backend test:unit
bun run --cwd backend typecheck
bun run --cwd packages/contracts typecheck
bun run architecture:check
git diff --check
```

Zero discovered tests is failure.

- [ ] **Step 5: Run secret and forbidden-scope scans**

```powershell
rg -n "Authorization.*(i\.oneme|fd\.oneme)|MAX_BOT_TOKEN.*(console|logger)|expires=|[?&]rq=" backend/src/modules/max backend/src/modules/media backend/prisma/migrations/20260915130000_max_image_capture docs/superpowers/specs/2026-09-15-max-06-image-capture-design.md
rg -n "MaxImage|MaxMediaAsset|MaxMemory|media_group_id|videoToken|createSubscription|deleteSubscription" backend/src/modules/max backend/prisma/migrations/20260915130000_max_image_capture
```

Interpret matches manually. Test literals proving credentials are absent and unchanged subscription API boundaries are allowed; leaked credentials/signed URLs, forbidden models, grouping, or new video/subscription behavior fail.

- [ ] **Step 6: Write the implementation report and update the ledger only after reviews pass**

`task-6-report.md` records task/model, base/head, paths, migration, contracts, exact test evidence, review findings/fixes, residual P3 risks, publication state, and no-live-call statement. Set MAX-06 to `APPROVED` only after lead verification plus both fresh whole-change reviews. Preserve MAX-07 owner decision verbatim and identify MAX-07 as not started.

**Task 5 STOP conditions:** mandatory check fails; clean migration cannot be proven; secret/signed URL appears; unresolved P0/P1/P2; worktree has unrelated changes; publication would be required.

---

## Lead pre-flight approval

The plan is approved for one bounded TDD worker when all of the following remain true at dispatch:

- worktree/branch/HEAD match the recorded MAX feature state plus the local design-plan commit;
- only approved documentation precedes implementation;
- `MAX_FILE_MAX_BYTES` remains per-file and the 1–10 image count remains explicitly application-owned;
- the worker receives the approved spec, this plan, allowed paths, STOP conditions, exact checks, and no-subagents instruction;
- no live MAX call, subscription/webhook mutation, deployment, push, PR, or MAX-07 work is included.
