# MAX-05 Durable Text Ingestion Design

**Status:** Owner-approved design  
**Date:** 2026-09-14  
**Branch:** `feat/max-adapter`  
**Design base:** `1cf202f4ca6551f2bd17d78232fd1df765502eba`

## Goal

Accept supported MAX `message_created` and `bot_started` webhook events durably, process them idempotently, publish authorized text memories through the shared memoLy Core, and deliver retry-safe bot responses independently from business processing.

MAX-05 does not download or publish media and does not route invite/start payloads.

## Scope and invariants

- MAX remains the primary provider while Telegram remains optional and unchanged.
- MAX persistence stays provider-specific. Do not reuse or refactor `TelegramInbox`, `TelegramSource`, Telegram task handlers, or Telegram encryption configuration.
- Shared `User`, `ExternalIdentity`, `Family`, `FamilyMember`, `Child`, `Memory`, `FamilyAccess`, and trusted source publisher remain authoritative.
- Do not create `MaxUser`, `MaxFamily`, `MaxMemory`, or a generic provider messaging SDK.
- No live MAX requests, subscription mutation, webhook registration, deployment, push, or PR belong to MAX-05.

## Provider contracts

The accepted normalized events remain:

```ts
type MaxInboundEvent =
  | {
      kind: 'message_created'
      senderId: string
      recipientId: string
      messageId: string
      occurredAt: string
      text: string | null
      hasAttachments: boolean
    }
  | {
      kind: 'bot_started'
      chatId: string
      userId: string
      occurredAt: string
      payload: string | null
    }
```

The verified numeric bot identity returned by MAX `GET /me` is passed from startup into the module and participates in every durable incoming event key.

MAX-05 adds only this narrow outgoing API capability:

```ts
sendMessage(input: { userId: string; text: string }, signal?: AbortSignal): Promise<void>
```

It calls `POST https://platform-api2.max.ru/messages?user_id=...` with JSON `{ text }`. The bot token is present only in the `Authorization` header. Provider failures remain sanitized. Caller cancellation and the existing fixed request timeout apply.

## Persistence

### MaxInbox

`MaxInbox` is the permanent event identity and temporary encrypted processing payload.

It stores:

- a database-unique stable provider event key;
- the verified bot identity;
- event kind;
- AES-256-GCM ciphertext, IV, and authentication tag while processing is required;
- received and processed timestamps;
- terminal status.

The payload is the normalized event, not the raw webhook envelope. It is encrypted only with a dedicated, base64url-encoded 32-byte `MAX_INBOX_ENCRYPTION_KEY`. This key must differ from the Telegram inbox key, MAX webhook secret, and MAX bot token. Disabled MAX configuration rejects a supplied MAX inbox key; enabled MAX requires a valid independent key. Secret examples remain empty.

After terminal processing, ciphertext, IV, and authentication tag are cleared. The inbox row and stable event key remain permanently for provider-event deduplication.

Stable keys are deterministic:

- `message_created`: event kind + verified bot identity + recipient identity + MAX message ID;
- `bot_started`: SHA-256 of a canonical representation containing event kind, verified bot identity, `chatId`, `userId`, event timestamp, and SHA-256 of the normalized payload. A missing payload has one fixed canonical representation.

Localized response text, process time, random IDs, and attempt numbers never participate in an incoming event key.

### MaxSource

`MaxSource` represents a durable `message_created` source without creating a MAX-specific core memory.

It stores the inbox relationship, bot/sender/recipient/message identity, processing status, a predetermined `plannedMemoryId`, optional final `memoryId`, and a non-sensitive terminal reason code when useful. User, family, and child references are resolved during processing rather than created from a webhook.

The database enforces permanent uniqueness for the provider message identity. Reusing the fixed planned ID makes retries idempotent through `createSourceMemoryPublisher()`.

### MaxOutgoingResponse

`MaxOutgoingResponse` represents one logical response independently from incoming acceptance and memory publication.

It stores only the inbox/source relationship, destination MAX user ID, response kind, bounded response text, delivery timestamps/status, and operational attempt information needed by the existing outbox flow. It never stores credentials.

The database enforces one logical response per incoming event and response kind. Supported kinds are:

- `accepted`
- `saved`
- `denied`
- `unsupported_media`
- `welcome`

Retries reuse the same logical response row.

## Publishable text policy

A publishable text event:

- has no attachments;
- has a string `text` value;
- contains at least one non-whitespace character;
- contains at most 8,000 Unicode code points.

Use code-point counting such as `[...text].length`, not JavaScript UTF-16 `.length`. Trimming may determine whether content is blank, but meaningful stored text is not silently trimmed or altered. Over-limit or blank text is not truncated and becomes a safe terminal denial.

This matches the existing shared Memory body contract, which also permits at most 8,000 Unicode code points.

## Durable acceptance transaction

For every supported normalized event, webhook acceptance computes the canonical event key and encrypts the normalized payload. One database transaction establishes:

- `MaxInbox`;
- `MaxSource` for `message_created`;
- one `max:process` `TaskOutbox` row containing only the durable record ID;
- the immediate logical `MaxOutgoingResponse` when applicable;
- its `max:deliver-response` task containing only the response row ID.

Immediate response selection is:

- publishable plain text: `accepted`;
- any attachment message: `unsupported_media`;
- `bot_started`: `welcome`.

A unique-key race loads and reuses the already committed durable boundary. It creates no second inbox, source, process task, response, or delivery task.

The webhook returns HTTP 200 only after the transaction commits. A temporary persistence failure before commit remains retryable and produces HTTP 503 through the existing webhook boundary.

## Business processing

### bot_started

The event is deduplicated and terminally processed. Its payload is not routed, no invitation is accepted, and no `User`, `ExternalIdentity`, `Family`, `Child`, or `Memory` is created. The only response is `welcome`. Invite/start routing belongs to MAX-08.

### Attachment message

The event is terminally marked `unsupported_media`. MAX-05 does not download attachments, create `MediaAsset`, create `Memory`, or publish attachment-message text as a separate note. Media support starts in later tasks.

### Plain text message

Processing resolves:

```text
senderId
→ existing ExternalIdentity(provider=max)
→ existing User
→ current eligible family context
→ eligible child
→ trusted source publication
```

It reuses the proven Telegram pilot selection rule: exactly one active non-revoked membership and the first eligible child in that family. Multiple active eligible family memberships are ambiguous and must produce a safe denial; MAX-05 does not invent a family selector.

Publication uses `createSourceMemoryPublisher()` with:

- the predetermined `plannedMemoryId`;
- `kind: 'note'`;
- the original validated text;
- the event occurrence time;
- no media IDs.

The shared publisher and `FamilyAccess.requireFull()` remain authoritative. In the current model the owner has the required full membership, so both owner and invited full members can publish. Viewer, revoked membership, inactive family, missing identity, missing child, ambiguous context, invalid text, and any other non-publishable context produce the same user-facing denial.

Authorization is rechecked inside the publisher transaction under the existing family/membership locks. If revocation commits before final publication, no Memory is created.

Successful publication atomically records `MaxSource.memoryId`, marks the source published, and creates/enqueues the single `saved` response. Response delivery is not part of the publication transaction.

Terminal processing clears the encrypted inbox payload while retaining permanent event/source identity.

## Outbox handlers

`TaskOutbox` contains durable record references rather than provider payloads.

### max:process

The handler validates its inbox/source ID, decrypts the current payload, and performs exactly one terminal business transition. Re-entry observes terminal source/inbox status and skips successful work. A fixed `plannedMemoryId` prevents a retry from creating a second Memory.

### max:deliver-response

The handler validates its response ID and loads the logical response. If `deliveredAt` is already set, it returns `skipped`. Otherwise it invokes the narrow MAX `sendMessage()`, then marks the row delivered. Provider, timeout, cancellation, and rate-limit failures retry only this task according to bounded provider-aware outbox policy.

Incoming acceptance, business processing, Memory publication, and response delivery are independent durable stages. Reply failure cannot roll back acceptance or publication, and delivery retry cannot rerun business processing.

## User-facing responses

| Kind | Exact text |
|---|---|
| `accepted` | `Получено. Сохраняем…` |
| `saved` | `Сохранено в семейную ленту.` |
| `denied` | `Не удалось сохранить это сообщение в memoLy.` |
| `unsupported_media` | `Получено. Медиа пока не поддерживается — отправьте текстовую заметку.` |
| `welcome` | `Добро пожаловать в memoLy. Откройте приложение, чтобы продолжить.` |

`accepted` confirms durable receipt only. A later authorization recheck may still produce `denied`.

## Failure and security behavior

- No raw or decrypted provider payload, response body, encryption key, bot token, or webhook secret enters logs, errors, reports, public DTOs, URLs, or the frontend.
- Database uniqueness, not process memory, is the idempotency authority.
- A database failure before acceptance commit remains a webhook failure.
- A business retry cannot create a second Memory or logical response.
- A delivery retry may repeat a physical provider attempt when the outcome is unknown, but never creates a second logical response row.
- Unsupported authenticated event types continue to return the existing safe ignored response and create no MAX persistence.
- Groups and channels remain ignored by the existing normalized boundary.

## Verification

TDD is mandatory: every production behavior begins with a focused failing test whose expected failure is recorded.

Focused and integration coverage must prove:

- canonical key determinism for message and `bot_started` retries;
- AES-256-GCM round trip using the independent MAX key;
- required/disabled config behavior and cross-secret/key rejection;
- atomic inbox/source/process/response acceptance and 503 before commit;
- concurrent duplicate acceptance creates one durable boundary;
- ten deliveries create one Memory and one response of each logical kind;
- owner and invited full member publish;
- viewer, revoked, missing identity, inactive/ambiguous family, missing child, blank text, and over-limit text create no Memory and receive only the generic denial;
- 8,000 astral Unicode code points are accepted and 8,001 are denied;
- attachment text is not separately published and no media rows are created;
- `bot_started` creates no user/family/memory and does not route payload;
- revocation before final publication creates no Memory;
- response failure leaves acceptance/publication intact and retries delivery only;
- already delivered response skips without another API call;
- MAX API sends the exact request with header-only authorization and sanitized errors;
- Telegram capture behavior remains unchanged.

Required gates include focused MAX tests, the MAX capture integration suite on a clean migrated test database, backend unit tests, backend typecheck, contracts typecheck when touched, architecture check, migration application from a clean database, `git diff --check`, and secret/forbidden-pattern checks.

## Explicit exclusions

- image, audio, video download or publication;
- `MediaAsset` creation;
- invite/start payload routing or invite acceptance (MAX-08);
- MAX video-reference feasibility work (MAX-07);
- group/channel handling;
- account linking or provider identity inference;
- provider-neutral persistence refactor;
- generic MAX SDK construction;
- live MAX API calls or webhook/subscription mutation.
