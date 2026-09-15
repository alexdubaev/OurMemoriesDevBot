# MAX-05 Durable Text Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Durably accept supported MAX events, publish authorized plain-text memories exactly once, and deliver independently retryable MAX bot responses.

**Architecture:** A provider-specific `MaxInbox` owns permanent event identity and temporary AES-256-GCM payload storage; `MaxSource` owns deterministic Memory publication state; `MaxOutgoingResponse` owns one logical reply per event and response kind. `TaskOutbox` carries only record IDs through separate `max:process` and `max:deliver-response` handlers, while the existing `FamilyAccess` and trusted source publisher remain the shared Core authorization and publication boundary.

**Tech Stack:** Bun 1.4, TypeScript 6, Hono, Prisma 7/PostgreSQL, Node crypto AES-256-GCM/SHA-256, Bun test.

**Spec:** `docs/superpowers/specs/2026-09-14-max-05-durable-text-ingestion-design.md`

## Global Constraints

- Worktree: `D:/codex/TG_OurMemoriesDevBot/worktrees/max-adapter`.
- Branch: `feat/max-adapter`.
- Implementation base: `26bb19cc927dcab9194c116f1916d2d94934a252`.
- MAX is primary; Telegram remains independently enableable and unchanged.
- No provider-neutral inbox/source/reply refactor and no reuse of Telegram persistence, task handlers, or encryption key.
- No media download, `MediaAsset`, invite/start routing, group/channel support, account linking, generic MAX SDK, deployment, live MAX call, subscription mutation, push, or PR.
- Every production behavior starts with a focused failing test and recorded RED result.
- `TaskOutbox` payloads contain durable record IDs only.
- Secrets never enter URLs, database rows, logs, reports, tests, or public errors.
- Stop if actual MAX event fields cannot reproduce the approved stable keys, if a lower Memory body limit appears, or if family selection differs from the proven Telegram pilot rule.

## Baseline evidence

At implementation base:

```text
bun test backend/src/modules/max/max-api.test.ts backend/src/modules/max/update-mapping.test.ts backend/src/modules/max/webhook.test.ts
12 passed, 0 failed, 52 assertions

bun run --cwd backend typecheck
exit 0

bun run architecture:check
641 source files, exit 0
```

---

### Task 1: MAX persistence, independent encryption configuration, and deterministic keys

**Files:**

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260914130000_max_text_ingestion/migration.sql`
- Modify: `backend/src/env.ts`
- Modify: `backend/src/env.test.ts`
- Modify: `.env.example`
- Create: `backend/src/modules/max/infrastructure/payload-crypto.ts`
- Create: `backend/src/modules/max/infrastructure/payload-crypto.test.ts`
- Create: `backend/src/modules/max/application/event-key.ts`
- Create: `backend/src/modules/max/application/event-key.test.ts`

**Interfaces:**

- Consumes: approved `MaxInboundEvent` and existing `isInboxEncryptionKey()` environment policy.
- Produces:

```ts
type EncryptedMaxPayload = {
  ciphertext: Uint8Array
  iv: Uint8Array
  authTag: Uint8Array
}

function createMaxPayloadCrypto(encodedKey: string): {
  encrypt(value: unknown): EncryptedMaxPayload
  decrypt<T>(payload: EncryptedMaxPayload): T
}

function maxEventKey(botId: string, event: MaxInboundEvent): string
```

- Schema models: `MaxInbox`, `MaxSource`, `MaxOutgoingResponse`; enums for their bounded kinds/statuses.

- [ ] **Step 1: Write failing environment tests**

Add cases proving enabled MAX requires a base64url 32-byte `MAX_INBOX_ENCRYPTION_KEY`, disabled MAX rejects a supplied value, and the key must differ from `MAX_BOT_TOKEN`, `MAX_WEBHOOK_SECRET`, and `TELEGRAM_INBOX_ENCRYPTION_KEY` when both providers are enabled.

Use only synthetic values such as `'A'.repeat(43)` and `'B'.repeat(43)`.

- [ ] **Step 2: Run the environment tests and record RED**

Run:

```powershell
bun run --cwd backend test:unit src/env.test.ts
```

Expected: failure because `MAX_INBOX_ENCRYPTION_KEY` is absent from the schema and validation.

- [ ] **Step 3: Add the environment contract**

Add optional parsing plus enabled/disabled validation matching Telegram key format. Keep `.env.example` secret value empty:

```dotenv
MAX_INBOX_ENCRYPTION_KEY=
```

Cross-secret equality errors identify only configuration field names, never values.

- [ ] **Step 4: Run environment tests GREEN**

Run the same command. Expected: all selected tests pass.

- [ ] **Step 5: Write failing crypto and event-key tests**

Cover:

- AES-256-GCM round trip;
- wrong key/auth tag rejection without plaintext leakage;
- message key stability and change on bot/recipient/message change;
- `bot_started` stability with `payload: null` and change on bot/chat/user/timestamp/payload change;
- response text and retry/process time cannot affect keys.

Use the wished-for interfaces above.

- [ ] **Step 6: Run crypto/key tests and record RED**

Run:

```powershell
bun test backend/src/modules/max/infrastructure/payload-crypto.test.ts backend/src/modules/max/application/event-key.test.ts
```

Expected: module-not-found or missing-export failures for the two new interfaces.

- [ ] **Step 7: Implement minimal crypto and canonical keys**

Use AES-256-GCM with a random 12-byte IV. Validate decoded key length is exactly 32 bytes. Serialize only normalized events.

For canonical keys use unambiguous length-prefixed or NUL-separated fields and SHA-256. Message identity must include `message_created`, verified bot ID, recipient ID, and MAX message ID. `bot_started` must include kind, bot ID, chat ID, user ID, ISO event timestamp, and a SHA-256 payload hash; represent absence with a fixed literal distinct from any real payload.

- [ ] **Step 8: Run crypto/key tests GREEN**

Run the same focused command. Expected: all pass.

- [ ] **Step 9: Add the additive Prisma schema and migration**

Implement these invariants:

```text
MaxInbox
  id UUID primary key
  eventKey unique
  botId bigint
  eventKind message_created | bot_started
  encryptedPayload bytes
  encryptionIv bytes
  encryptionAuthTag bytes
  status accepted | processed
  receivedAt timestamptz
  processedAt nullable timestamptz

MaxSource
  id UUID primary key
  inboxId unique foreign key to MaxInbox
  botId bigint
  senderSubject text
  recipientId bigint
  messageId text
  status accepted | published | denied | unsupported_media
  plannedMemoryId UUID
  memoryId nullable UUID
  userId/familyId/childId nullable UUID
  rejectionCode nullable text
  createdAt/updatedAt timestamptz
  unique(botId, recipientId, messageId)

MaxOutgoingResponse
  id UUID primary key
  inboxId foreign key to MaxInbox
  destinationUserId bigint
  kind accepted | saved | denied | unsupported_media | welcome
  text text
  deliveredAt nullable timestamptz
  createdAt/updatedAt timestamptz
  unique(inboxId, kind)
```

Keep existing migrations immutable. Add indexes for inbox/source terminal processing and pending response delivery. Do not add MAX relations to shared core models unless Prisma requires them; scalar shared IDs are sufficient and mirror the established source adapter boundary.

- [ ] **Step 10: Validate and generate Prisma client**

Run:

```powershell
bun run --cwd backend prisma:validate
bun run --cwd backend prisma:generate
```

Expected: both exit 0.

- [ ] **Step 11: Apply all migrations to a clean disposable integration database**

The first focused MAX integration run in Task 2 must exercise `prisma migrate deploy` from an empty database and report the exact migration count. Do not edit an applied migration to fix failures; add a new migration only after lead adjudication.

- [ ] **Step 12: Commit Task 1**

Before commit:

```powershell
git diff --check
git diff --stat
git status --short
```

Stage only the Task 1 paths and commit:

```text
feat(max): add durable ingestion persistence
```

**Task 1 STOP conditions:** destructive migration; need to change Telegram schema/crypto; unstable event fields; generated Prisma files appearing as tracked changes; unrelated env/root configuration changes.

---

### Task 2: Atomic webhook acceptance and idempotent immediate responses

**Files:**

- Create: `backend/src/modules/max/application/accept-update.ts`
- Create: `backend/src/modules/max/application/accept-update.test.ts`
- Create: `backend/src/modules/max/infrastructure/prisma-max-repository.ts`
- Create: `backend/src/modules/max/capture.integration.test.ts`
- Modify: `backend/src/modules/max/application/ports.ts`
- Modify: `backend/src/modules/max/index.ts`
- Modify: `backend/src/max-startup.ts`
- Modify: `backend/src/max-startup.test.ts`
- Modify: `backend/src/modules/max/webhook.test.ts` only for wiring assertions that are not already covered.

**Interfaces:**

- Consumes: `maxEventKey()`, `createMaxPayloadCrypto()`, verified startup `MaxBotIdentity.userId`, Prisma models, and the existing webhook `acceptUpdate(event)` seam.
- Produces:

```ts
type MaxAcceptResult = { inboxId: string; duplicate: boolean }

function createMaxAcceptUpdate(options: {
  botId: string
  repository: MaxAcceptRepository
  encrypt: (event: MaxInboundEvent) => EncryptedMaxPayload
  now?: () => Date
}): (event: MaxInboundEvent) => Promise<MaxAcceptResult>
```

`MaxAcceptRepository.accept()` owns one transaction and receives only the normalized event, stable key, encrypted payload, verified bot identity, selected immediate response kind/text, and current time.

- [ ] **Step 1: Write failing acceptance unit tests**

Cover code-point text policy:

```ts
expect(isPublishableMaxText({ text: '💛'.repeat(8_000), hasAttachments: false })).toBe(true)
expect(isPublishableMaxText({ text: '💛'.repeat(8_001), hasAttachments: false })).toBe(false)
expect(isPublishableMaxText({ text: '   ', hasAttachments: false })).toBe(false)
expect(isPublishableMaxText({ text: 'caption', hasAttachments: true })).toBe(false)
```

Also assert immediate response selection: valid plain text → `accepted`, attachment → `unsupported_media`, `bot_started` → `welcome`, invalid plain text → no immediate response.

- [ ] **Step 2: Run acceptance unit tests and record RED**

Run:

```powershell
bun test backend/src/modules/max/application/accept-update.test.ts
```

Expected: missing interface/implementation failure.

- [ ] **Step 3: Implement the pure acceptance policy and service**

Count Unicode code points with `[...text].length`, use `text.trim()` only for blank detection, and pass original text unchanged into encrypted storage.

Use exact response text from the spec. Do not deliver responses from this service.

- [ ] **Step 4: Run acceptance unit tests GREEN**

Run the same focused command. Expected: all pass.

- [ ] **Step 5: Write failing atomic acceptance integration tests**

Create synthetic MAX events and prove after one accepted webhook callback:

- one inbox exists;
- message events have one source with a predetermined UUID;
- one `max:process` task references only `{ inboxId }` or `{ sourceId }`;
- the correct immediate response row and one delivery task exist;
- `bot_started` has no source;
- encrypted payload decrypts to the normalized event but plaintext is absent from outbox payloads;
- ten sequential and concurrent repeats create the same single boundary;
- a forced transaction failure creates none of the rows and propagates so webhook returns 503.

- [ ] **Step 6: Run focused integration and record RED**

Run:

```powershell
bun run --cwd backend test:integration src/modules/max/capture.integration.test.ts
```

Expected: clean migration deploy succeeds, then tests fail because repository/composition is missing.

- [ ] **Step 7: Implement atomic Prisma acceptance**

Use `createMany({ skipDuplicates: true })` for the inbox insert so a PostgreSQL uniqueness race does not poison the transaction. When insertion count is zero, load the committed inbox by `eventKey` and return `{ duplicate: true }` without creating dependent rows.

For a new event, create source, process task, optional immediate response, and delivery task in the same transaction. Task dedupe keys are stable:

```text
max-process:<inboxId>
max-response:<responseId>
```

Task payloads contain exactly one UUID field.

- [ ] **Step 8: Wire verified bot identity and the real acceptor**

Change `createMaxModule()` to require the verified `MaxBotIdentity`, construct MAX payload crypto/repository/acceptor, and replace the MAX-04 deliberate throwing callback. `startMaxIfEnabled()` passes the identity returned by `getMe()` into module creation. Disabled MAX still constructs nothing.

- [ ] **Step 9: Run acceptance integration and startup/webhook regression GREEN**

Run:

```powershell
bun run --cwd backend test:integration src/modules/max/capture.integration.test.ts
bun test backend/src/max-startup.test.ts backend/src/modules/max/webhook.test.ts backend/src/modules/max/application/accept-update.test.ts
```

Expected: all pass; valid supported webhook events now return 200 only after persistence.

- [ ] **Step 10: Commit Task 2**

Run diff/status checks, stage only Task 2 paths, and commit:

```text
feat(max): accept inbound events durably
```

**Task 2 STOP conditions:** response delivery inside acceptance callback; raw event in TaskOutbox; memory publication in webhook request; process-memory dedupe; identity/family creation; any supported event acknowledged before commit.

---

### Task 3: Text publication, terminal outcomes, and logical response creation

**Files:**

- Create: `backend/src/modules/max/infrastructure/process-task.ts`
- Create: `backend/src/modules/max/infrastructure/process-task.test.ts`
- Modify: `backend/src/modules/max/infrastructure/prisma-max-repository.ts`
- Modify: `backend/src/modules/max/index.ts`
- Modify: `backend/src/modules/max/capture.integration.test.ts`

**Interfaces:**

- Consumes: `createPrismaFamilyAccess()`, `createSourceMemoryPublisher()`, MAX payload crypto, `MaxInbox`, `MaxSource`, and response/outbox uniqueness.
- Produces:

```ts
function createMaxTaskProcessor(options: {
  runtime: BackendRuntime
  crypto: ReturnType<typeof createMaxPayloadCrypto>
}): (payload: unknown) => Promise<'done' | 'skipped'>
```

The task payload parser accepts exactly one usable UUID reference and throws `TerminalTaskError` for malformed payloads.

- [ ] **Step 1: Write failing processor tests**

At unit level prove malformed payload rejection and already-terminal skip. At integration level prove:

- owner and invited full member publish one note with exact original body/occurredAt;
- ten process attempts keep one fixed-ID Memory and one `saved` response;
- viewer, revoked, missing identity, inactive family, no child, multiple active families, blank text, and 8,001-code-point text create no Memory and one generic `denied` response;
- 8,000 astral code points publish;
- attachment with caption creates no Memory/MediaAsset and ends `unsupported_media`;
- `bot_started` creates no User/identity/family/memory and ends processed;
- payload bytes are cleared only after a terminal transition;
- revocation committed before publisher lock results in denial and no Memory.

- [ ] **Step 2: Run processor tests and record RED**

Run:

```powershell
bun test backend/src/modules/max/infrastructure/process-task.test.ts
bun run --cwd backend test:integration src/modules/max/capture.integration.test.ts
```

Expected: processor missing and integration behavior absent.

- [ ] **Step 3: Implement the proven family/child resolver**

Mirror `PrismaTelegramRepository.findAdmission()` exactly at the application level:

- find `ExternalIdentity(provider=max, subject=senderId)`;
- select at most two active, non-revoked memberships ordered by `joinedAt`;
- accept only exactly one;
- select the first child ordered by `createdAt`;
- retain owner/full publication through shared `FamilyAccess.requireFull()`; do not add MAX role rules.

Missing or ambiguous context returns a non-sensitive internal denial code.

- [ ] **Step 4: Implement terminal outcome transactions**

For `bot_started` and attachment events, mark terminal and clear the encrypted fields without touching shared Core records. For denial, atomically mark source denied, clear inbox payload, upsert the unique `denied` response, and enqueue its delivery task.

- [ ] **Step 5: Implement trusted fixed-ID publication**

Call `createSourceMemoryPublisher().publish()` with a synthetic adapter session ID, original validated text, `kind: 'note'`, event time, and no media IDs. Use its `afterWrite` callback to atomically:

- set source `memoryId = plannedMemoryId` and status `published`;
- persist resolved user/family/child IDs;
- mark inbox processed and clear encrypted fields;
- create the unique `saved` response and delivery task.

Convert expected Family/Memory authorization failures to the safe denial path. Unexpected database/runtime failures remain retryable and retain encrypted payload.

- [ ] **Step 6: Run processor tests GREEN**

Run the Task 3 focused commands. Expected: all pass.

- [ ] **Step 7: Commit Task 3**

Run diff/status checks, stage only Task 3 paths, and commit:

```text
feat(max): publish authorized text memories
```

**Task 3 STOP conditions:** multiple-family selection invention; bypass of `createSourceMemoryPublisher`; direct Memory create; authorization reason disclosure; payload clearing before a terminal database commit; media or invite processing.

---

### Task 4: Narrow MAX response delivery and outbox registration

**Files:**

- Modify: `backend/src/modules/max/application/ports.ts`
- Modify: `backend/src/modules/max/infrastructure/max-api.ts`
- Modify: `backend/src/modules/max/max-api.test.ts`
- Create: `backend/src/modules/max/infrastructure/deliver-response.ts`
- Create: `backend/src/modules/max/infrastructure/deliver-response.test.ts`
- Modify: `backend/src/modules/max/index.ts`
- Modify: `backend/src/outbox/handlers.ts`
- Modify: `backend/src/outbox/handlers.test.ts`
- Modify: `backend/src/modules/max/capture.integration.test.ts`

**Interfaces:**

- Extends `MaxApiPort` with the approved `sendMessage({ userId, text }, signal?)` only.
- Produces `createMaxTasks(runtime)` with `process(payload, signal?)` and `deliverResponse(payload, signal?)` entrypoints for lazy outbox handlers.

- [ ] **Step 1: Write failing MAX API send tests**

Assert exact method, URL, JSON body, content type, header-only token, caller cancellation, timeout, generic errors, and response validation for official `POST /messages`. Use only injected fake fetch; no network.

- [ ] **Step 2: Run API tests and record RED**

Run:

```powershell
bun test backend/src/modules/max/max-api.test.ts
```

Expected: `sendMessage` is missing.

- [ ] **Step 3: Implement narrow sendMessage**

Validate positive decimal `userId` and text bounded by the official MAX send limit of 4,000 code points. The five approved responses are below this limit. Encode only `user_id` using `URLSearchParams`; send `{ text }`; normalize the documented `{ message }` success envelope enough to reject malformed success responses without leaking it.

For HTTP 429, retain sanitized provider error behavior while exposing only a validated retry delay property if the official response/header supplies one; never retain raw provider text.

- [ ] **Step 4: Run API tests GREEN**

Run the same command. Expected: all pass.

- [ ] **Step 5: Write failing delivery/registry tests**

Prove:

- malformed response task ID is terminal;
- missing response is skipped;
- delivered row is skipped without API call;
- provider failure leaves `deliveredAt` null and throws for outbox retry;
- success sets `deliveredAt` once;
- concurrent/recovered delivery reuses one logical row;
- `taskHandlers` contains `max:process` and `max:deliver-response` and lazily imports MAX;
- delivery failure never changes Memory/source publication state.

- [ ] **Step 6: Run delivery/registry tests and record RED**

Run:

```powershell
bun test backend/src/modules/max/infrastructure/deliver-response.test.ts backend/src/outbox/handlers.test.ts
```

Expected: missing delivery service and handler entries.

- [ ] **Step 7: Implement response delivery and lazy handlers**

Load response by UUID. Return `skipped` when absent or already delivered. Call API outside a Memory transaction. On success use `updateMany({ where: { id, deliveredAt: null } })`; on failure write no success state.

Register:

```text
max:process
max:deliver-response
```

with bounded attempts/deadlines and lazy `await import('../modules/max')`. Apply retry-after only through a sanitized numeric property.

- [ ] **Step 8: Run delivery, registry, and capture tests GREEN**

Run:

```powershell
bun test backend/src/modules/max/max-api.test.ts backend/src/modules/max/infrastructure/deliver-response.test.ts backend/src/outbox/handlers.test.ts
bun run --cwd backend test:integration src/modules/max/capture.integration.test.ts
```

Expected: all pass, including independent reply retry after published Memory.

- [ ] **Step 9: Commit Task 4**

Run diff/status checks, stage only Task 4 paths, and commit:

```text
feat(max): deliver retry-safe bot responses
```

**Task 4 STOP conditions:** generic messaging SDK; token in URL/query/log/error/DB; reply delivery inside Memory publication transaction; business rerun from delivery handler; live API call.

---

### Task 5: Whole-change verification and report evidence

**Files:**

- No planned production changes. An unexpected failure returns to its owning task, where a focused regression test must fail before the in-scope fix.

- [ ] **Step 1: Inspect whole active change**

Run:

```powershell
git status --short --branch
git diff --stat 26bb19cc927dcab9194c116f1916d2d94934a252...HEAD
git diff --check 26bb19cc927dcab9194c116f1916d2d94934a252...HEAD
```

Confirm no webapp, contracts, Telegram implementation, deployment, lockfile, media, invite, or owner checkout paths changed.

- [ ] **Step 2: Run focused MAX unit tests**

```powershell
bun test backend/src/modules/max/max-api.test.ts backend/src/modules/max/update-mapping.test.ts backend/src/modules/max/webhook.test.ts backend/src/modules/max/application/event-key.test.ts backend/src/modules/max/application/accept-update.test.ts backend/src/modules/max/infrastructure/payload-crypto.test.ts backend/src/modules/max/infrastructure/process-task.test.ts backend/src/modules/max/infrastructure/deliver-response.test.ts backend/src/max-startup.test.ts
```

Record passed/failed/assertion counts and exit code.

- [ ] **Step 3: Run clean-database MAX integration**

```powershell
bun run --cwd backend test:integration src/modules/max/capture.integration.test.ts
```

Record the migration count, test counts, assertions, and exit code.

- [ ] **Step 4: Run backend and contract gates**

```powershell
bun run --cwd backend test:unit
bun run --cwd backend typecheck
bun run --cwd packages/contracts typecheck
bun run architecture:check
```

Record each result and exit code. Zero discovered tests is failure.

- [ ] **Step 5: Run regression and forbidden-pattern checks**

```powershell
bun run --cwd backend test:integration src/modules/telegram/capture.integration.test.ts
rg -n "platform-api2\.max\.ru.*token|MAX_BOT_TOKEN.*(console|logger)|TELEGRAM_INBOX_ENCRYPTION_KEY" backend/src/modules/max backend/prisma/migrations/20260914130000_max_text_ingestion .env.example
rg -n "MaxUser|MaxFamily|MaxMemory|MediaAsset|startapp|invite" backend/src/modules/max
```

Interpret matches manually: expected configuration field comparisons and explicit exclusion tests are allowed; secrets, Telegram-key reuse, forbidden models, media creation, or invite routing are failures.

- [ ] **Step 6: Final commit only if verification required an in-scope fix**

Use a regression test first and a specific conventional commit. Do not create an empty verification commit.

**Task 5 STOP conditions:** environment prevents clean migration/integration evidence; mandatory check fails outside allowed scope; unexpected dirty paths; secrets detected; need for a live MAX token or deployment.
