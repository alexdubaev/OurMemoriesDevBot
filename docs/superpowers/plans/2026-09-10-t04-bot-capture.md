# T04 Telegram Bot Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a durable Telegram adapter that turns private-chat notes and supported media into exactly one family memory while preserving current family, memory, and private-media boundaries.

**Architecture:** The webhook or polling adapter normalizes an update, encrypts the minimum durable payload, and commits the inbox row plus an outbox task in one PostgreSQL transaction. Background handlers resolve the internal user and current family permissions, use the existing Media and Memories application services, and only then send a Telegram receipt. Albums are coordinated by PostgreSQL state and permanent source keys, never by grammY sessions or process memory.

**Tech Stack:** Bun 1.4.0, Hono, Prisma/PostgreSQL, grammY types/API, existing private storage, existing TaskOutbox.

**Spec:** `docs/mvp/tasks/04_BOT_CAPTURE.md`

## Global Constraints

- Canonical base is `cf7dcbc83bffbe0015584461849bf8346eca370c` from `origin/main`.
- Telegram is an adapter; Internal User remains resolved through `ExternalIdentity(provider=telegram, subject)`.
- Only private chats create content; group contents are neither logged nor retained.
- Every mutation rechecks active full access; viewer and revoked membership cannot publish.
- A media memory is published only after the original is stored and validated by the Block 03 lifecycle.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and inbox-encryption key remain server-side and never enter logs, fixtures, DTOs, or Git values.
- Album silence is 1.5 seconds and the initial collection deadline is 8 seconds, per the task file over the older 2/10-second reference.

---

### Task 1: Update normalization and provider-safe configuration

**Files:**
- Create: `backend/src/modules/telegram/transport/update-mapping.ts`
- Create: `backend/src/modules/telegram/update-mapping.test.ts`
- Create: `backend/src/modules/telegram/infrastructure/telegram-api.ts`
- Modify: `backend/src/env.ts`
- Modify: `backend/src/env.test.ts`
- Modify: `.env.example`
- Modify: `backend/.env.example`

**Interfaces:**
- Consumes: grammY `Update` wire types and `AppEnv`.
- Produces: `normalizeTelegramUpdate(update): TelegramInboundEvent` and a secret-safe `TelegramBotApi` port.

- [ ] **Step 1: Write failing mapping and env tests**

```ts
expect(normalizeTelegramUpdate(privateTextUpdate)).toMatchObject({ kind: 'note', text: 'Текст' })
expect(normalizeTelegramUpdate(groupTextUpdate)).toEqual({ kind: 'ignored_group', updateId: '2' })
expect(() => loadEnv(webhookWithoutSecret)).toThrow('TELEGRAM_WEBHOOK_SECRET')
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `bun run test:backend:unit -- src/modules/telegram/update-mapping.test.ts src/env.test.ts`

- [ ] **Step 3: Implement normalization and validated public/secret env boundaries**

```ts
export function normalizeTelegramUpdate(update: Update): TelegramInboundEvent
export function createTelegramBotApi(token: string): TelegramBotApi
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `bun run test:backend:unit -- src/modules/telegram/update-mapping.test.ts src/env.test.ts`

### Task 2: Durable inbox, permanent sources, and album state

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260910160000_block04_telegram_capture/migration.sql`
- Create: `backend/src/modules/telegram/application/ports.ts`
- Create: `backend/src/modules/telegram/infrastructure/payload-crypto.ts`
- Create: `backend/src/modules/telegram/infrastructure/prisma-telegram-repository.ts`
- Create: `backend/src/modules/telegram/capture.integration.test.ts`

**Interfaces:**
- Consumes: `DbClient`, encrypted normalized events, and existing TaskOutbox transaction storage.
- Produces: unique `(bot_id, update_id)`, unique `(bot_id, chat_id, message_id)`, durable album collection, and inbox/task atomicity.

- [ ] **Step 1: Write failing integration scenarios for F04.3, F04.5, F04.10, and group non-retention**

```ts
expect(await acceptTenTimes(update)).toEqual({ inboxRows: 1, processTasks: 1 })
expect(await retainedGroupPayload()).not.toContain('group secret text')
```

- [ ] **Step 2: Run the focused integration test and verify RED**

Run: `bun run test:backend:integration -- src/modules/telegram/capture.integration.test.ts`

- [ ] **Step 3: Add schema, migration, AES-256-GCM payload codec, and repository transactions**

```ts
acceptUpdate(botId: bigint, event: TelegramInboundEvent): Promise<{ accepted: boolean }>
reserveSource(context: CaptureContext, event: PublishableEvent): Promise<TelegramSourceReservation>
collectAlbumItem(sourceId: string, event: MediaEvent): Promise<AlbumCollectionResult>
```

- [ ] **Step 4: Run the focused integration test and verify GREEN**

Run: `bun run test:backend:integration -- src/modules/telegram/capture.integration.test.ts`

### Task 3: Source-stable media and memory publication

**Files:**
- Modify: `backend/src/modules/media/application/ports.ts`
- Modify: `backend/src/modules/media/application/media-service.ts`
- Modify: `backend/src/modules/media/infrastructure/prisma-media-repository.ts`
- Modify: `backend/src/modules/media/index.ts`
- Modify: `backend/src/modules/memories/index.ts`
- Create: `backend/src/modules/memories/infrastructure/source-memory-publisher.ts`
- Create: `backend/src/modules/telegram/infrastructure/process-task.ts`

**Interfaces:**
- Consumes: `FamilyAccess`, `MediaService.ingestTelegram`, and `MemoryService.createFromSource`/`appendMediaFromSource`.
- Produces: permanent source-to-memory mapping and ordered album attachments.

- [ ] **Step 1: Extend F04 tests for text, photo, ordered album, late photo, mixed album, viewer, and revoke**

```ts
expect(await memoriesForSource(source)).toHaveLength(1)
expect(album.attachments.map((item) => item.sourceMessageId)).toEqual(['10', '11', '12'])
```

- [ ] **Step 2: Run tests and verify the missing application methods fail**

Run: `bun run test:backend:integration -- src/modules/telegram/capture.integration.test.ts`

- [ ] **Step 3: Implement stable IDs, streaming download capped at 20 MB, Block 03 validation, publication, and late append**

```ts
ingestTelegram(scope, { assetId, kind, contentType, byteSize, body }): Promise<MediaAssetDto>
createFromSource(scope, input, idempotencyKey, memoryId): Promise<{ memory: MemoryDto; replayed: boolean }>
appendMediaFromSource(scope, memoryId, mediaIds): Promise<MemoryDto>
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `bun run test:backend:integration -- src/modules/telegram/capture.integration.test.ts`

### Task 4: Webhook, polling, receipts, retries, and dry-run configuration

**Files:**
- Create: `backend/src/modules/telegram/transport/webhook.ts`
- Create: `backend/src/modules/telegram/transport/polling.ts`
- Create: `backend/src/modules/telegram/index.ts`
- Create: `backend/scripts/configure-telegram.ts`
- Create: `backend/src/modules/telegram/config.test.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/src/worker.ts`
- Modify: `backend/src/outbox/types.ts`
- Modify: `backend/src/outbox/drain.ts`
- Modify: `backend/src/outbox/handlers.ts`
- Modify: `backend/src/outbox/drain.test.ts`
- Modify: `backend/package.json`
- Modify: `bun.lock`

**Interfaces:**
- Consumes: verified numeric bot id, Telegram webhook header, outbox runtime, and optional HTTPS Mini App URL.
- Produces: `/webhooks/telegram`, polling entrypoint, commands, safe receipts, provider-aware retry schedule, and no-side-effect dry-run.

- [ ] **Step 1: Add failing tests for F04.11–F04.13 and 5/30/120/600 retry scheduling**

```ts
expect(providerError.message).not.toContain(token)
expect(retryTimes).toEqual([5_000, 30_000, 120_000, 600_000])
expect(dryRun).not.toContain(secret)
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `bun run test:backend:unit -- src/modules/telegram/update-mapping.test.ts scripts/configure-telegram.test.ts src/outbox/drain.test.ts`

- [ ] **Step 3: Implement transport and runtime wiring without calling setWebhook**

```ts
createTelegramWebhook(options): OpenAPIHono
runTelegramPolling(runtime): Promise<void>
createTelegramTasks(runtime): { processInbox(input): Promise<void>; finalizeAlbum(input): Promise<void> }
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `bun run test:backend:unit -- src/modules/telegram/update-mapping.test.ts scripts/configure-telegram.test.ts src/outbox/drain.test.ts`

### Task 5: Verification, report, and delivery

**Files:**
- Modify: `REPO_MAP.md`
- Modify: `verification-map.json` only if new paths are otherwise uncovered.
- Create: `docs/mvp/review/04_BOT_CAPTURE_REPORT.md`

**Interfaces:**
- Consumes: all F04 implementation and repository delivery rules.
- Produces: reproducible verification evidence and rollback notes.

- [ ] **Step 1: Run exact task commands**

```text
bun run test:backend:unit -- src/modules/telegram/update-mapping.test.ts
bun run test:backend:integration -- src/modules/telegram/capture.integration.test.ts
bun run architecture:check
```

- [ ] **Step 2: Run affected regression verification**

```text
bun run typecheck:backend
bun run test:backend:unit
bun run test:backend:integration
bun run verify:plan -- --base origin/main
```

- [ ] **Step 3: Inspect diff, secrets, migration, and report evidence**

```text
git diff --check
git diff --stat origin/main...HEAD
git status --short
```

- [ ] **Step 4: Commit small finished changes, request one independent review, fix only real blockers, and rerun affected verification**

- [ ] **Step 5: Push, create PR from the project template, wait for `verify-required`, squash merge, synchronize main, and record the merge SHA**
