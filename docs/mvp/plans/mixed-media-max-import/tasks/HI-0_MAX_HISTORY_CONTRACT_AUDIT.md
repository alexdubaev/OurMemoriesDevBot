# HI-0 — MAX historical channel import contract + provider audit

**Status: `DEFERRED_POST_MVP` (partial documentary audit; controlled provider validation and architecture decision unresolved).** Historical import is not an MVP release blocker. See [the post-MVP roadmap](../POST_MVP_MAX_HISTORICAL_IMPORT.md).

Depends on: **MM-4 complete**; resume only after MVP assignment.

## Goal

Freeze the exact MAX history-import implementation contract against current MAX API/provider behavior and fresh memoLy code, so backend and UI can proceed in parallel.

This is a bounded discovery/contract task, not an open-ended research project.

## Verify current MAX capabilities

Using authoritative MAX documentation/current adapter behavior, establish:

- channel/message history endpoint;
- required bot/channel permissions;
- pagination model;
- chronological/reverse order behavior;
- timestamp field and unit;
- attachment representations;
- image/video resolution/download APIs;
- message identifiers and uniqueness scope;
- maximum page sizes;
- rate-limit behavior and retry signals;
- deleted/unavailable message behavior;
- bot admin requirement if applicable.

Record source links/versions in repo docs.

Do not rely on memory if provider docs differ.

## Freeze import API contract

Define minimal memoLy import workflow.

Recommended product contract:

1. owner/admin opens import action from an explicit family context;
2. target family is explicit;
3. target child is explicit;
4. source MAX channel is explicitly selected/identified through existing authorized integration;
5. optional preview/read-only scan may show count/date range;
6. owner starts import;
7. backend creates durable import job;
8. UI polls/statuses the job;
9. retry/resume does not duplicate.

Do not put provider secrets in browser payloads.

## Authorization

Default:
family owner only may start a historical channel import.

If fresh existing ACL has a more specific approved capability, reuse it.

Do not let a viewer start mass import.

## Source identity

Freeze the durable provider key used for dedupe.

Must use provider IDs (e.g. bot/channel/message identity), not caption/time heuristic.

## Time mapping

For every imported post:

- source provider timestamp → `sourcePublishedAt`;
- initial `occurredAt` → `sourcePublishedAt`;
- `firstPublishedAt` → memoLy publication time.

## Media mapping

- photo-only post → may remain legacy photo or new media, but contract must be consistent;
- video-only post → may remain legacy video or new media;
- mixed photo/video post → `kind=media`;
- attachment order exactly preserved.

Prefer minimal compatibility:
use `media` when mixed; keep existing one-type kinds where that avoids unnecessary churn.

## Backfill/import scope

No destructive rewriting of existing live-captured MAX Memories.

Importer must detect already-present source messages and skip/reconcile idempotently.

## Required deliverable

Commit a concise provider/import contract document plus any minimal shared types/contracts/tests needed to let HI-1 and HI-2 start independently.

## Escalation

Only escalate if provider limitations force a new product decision such as:
- impossible access to full channel history;
- inability to resolve video safely;
- ambiguous source identity;
- no safe family/child targeting.

Final HANDOFF title:

`HANDOFF — HI-0 MAX HISTORY IMPORT CONTRACT`

---

## Audit supplement — evidence and implementation gate

**Audit date:** 2026-09-28 · **Base SHA:** `a4480a2fd402490a9ca4e5a33c2021ad19959adc` · **Branch:** `docs/hi0-max-history-contract`
No MAX API calls were made. **VERIFIED** means supported by the cited documentation or current code; **NOT DOCUMENTED** means the reviewed source does not establish the behavior; **REQUIRES EXPLICIT LIVE VALIDATION** means a controlled synthetic-channel test is needed. Official schema facts use OpenAPI v0.0.33 pinned at commit [`1a4a502fab096aa3a15d83d7ea95667ffb44d2ac`](https://github.com/max-messenger/api-schema/blob/1a4a502fab096aa3a15d83d7ea95667ffb44d2ac/schema.yaml), reviewed 2026-09-28.

### Required contract matrix (30 categories)

| # | Required category | Evidence and finding | Status |
|---:|---|---|---|
| 1 | History endpoint/method | `GET /messages`; `chat_id` retrieves messages/posts from a chat/channel. [Method docs](https://dev.max.ru/docs-api/methods/GET/messages) | VERIFIED |
| 2 | Authorization | Method docs state the bot must be an administrator in the chat/channel. Exact role variations and historical visibility still require a controlled access test. [Method docs](https://dev.max.ru/docs-api/methods/GET/messages) | VERIFIED; live access scope REQUIRES EXPLICIT LIVE VALIDATION |
| 3 | Source/channel identifier | API accepts `chat_id` (int64). The current product has no approved connected-channel selection/authorization record. [Method docs](https://dev.max.ru/docs-api/methods/GET/messages) | API field VERIFIED; product binding NOT DOCUMENTED |
| 4 | Message/post identifier | `MessageBody.mid` required string; candidate durable post ID. Its global vs channel/bot uniqueness scope is unspecified. [Pinned schema](https://github.com/max-messenger/api-schema/blob/1a4a502fab096aa3a15d83d7ea95667ffb44d2ac/schema.yaml) | Field VERIFIED; uniqueness NOT DOCUMENTED |
| 5 | Live/history identity compatibility | Current normalizer ignores non-dialog recipient and requires sender; channel sender may be null. `MaxSource` requires `inboxId`, `senderSubject`, recipient ID and unique `(botId,recipientId,messageId)`. Channel live dedupe is not established. [Code](../../../../../backend/src/modules/max/transport/update-mapping.ts) · [schema](https://github.com/max-messenger/api-schema/blob/1a4a502fab096aa3a15d83d7ea95667ffb44d2ac/schema.yaml) | VERIFIED |
| 6 | Pagination type | Method docs document `from`/`to` Unix-ms bounds and `count`, and explicitly say newest-first; schema has `before`/`after`, marks `from`/`to` deprecated, and mentions `marker` only in OpenAPI prose. `dev.max.ru` method page does not mention marker. [Method docs](https://dev.max.ru/docs-api/methods/GET/messages) · [schema](https://github.com/max-messenger/api-schema/blob/1a4a502fab096aa3a15d83d7ea95667ffb44d2ac/schema.yaml) | Ordering VERIFIED; conflicting pagination docs VERIFIED; effective contract REQUIRES EXPLICIT LIVE VALIDATION |
| 7 | Cursor/checkpoint semantics | Pinned `MessageList` has only `messages[]`, no marker/cursor field. Schema provides no pagination by `seq`. No deterministic checkpoint can be frozen. [Pinned schema](https://github.com/max-messenger/api-schema/blob/1a4a502fab096aa3a15d83d7ea95667ffb44d2ac/schema.yaml) | NOT DOCUMENTED |
| 8 | Page-size/default/max | `count` is 1–100, default 50, maximum response count 100. [Method docs](https://dev.max.ru/docs-api/methods/GET/messages) | VERIFIED |
| 9 | End-of-history detection | No explicit has-more/terminal field in `MessageList`; method prose alone does not establish a safe terminal condition. [Method docs](https://dev.max.ru/docs-api/methods/GET/messages) · [schema](https://github.com/max-messenger/api-schema/blob/1a4a502fab096aa3a15d83d7ea95667ffb44d2ac/schema.yaml) | NOT DOCUMENTED; REQUIRES EXPLICIT LIVE VALIDATION |
| 10 | Publication timestamp | `timestamp` is Unix milliseconds per method docs and maps to ISO time in current live adapter. [Method docs](https://dev.max.ru/docs-api/methods/GET/messages) · [code](../../../../../backend/src/modules/max/transport/update-mapping.ts) | VERIFIED |
| 11 | Text/caption | `MessageBody.text` nullable; preserve source text as caption/body, including attachment-only posts. [Pinned schema](https://github.com/max-messenger/api-schema/blob/1a4a502fab096aa3a15d83d7ea95667ffb44d2ac/schema.yaml) | VERIFIED |
| 12 | Photo | `PhotoAttachmentPayload` requires `photo_id`, `token`, `url`; URL/token lifetime and historical access are unknown. [Pinned schema](https://github.com/max-messenger/api-schema/blob/1a4a502fab096aa3a15d83d7ea95667ffb44d2ac/schema.yaml) | Shape VERIFIED; lifetime REQUIRES EXPLICIT LIVE VALIDATION |
| 13 | Photo album | Attachments are an array and photo identity is `photo_id`; grouping and completeness for channel albums are not proven by schema. [Pinned schema](https://github.com/max-messenger/api-schema/blob/1a4a502fab096aa3a15d83d7ea95667ffb44d2ac/schema.yaml) | REQUIRES EXPLICIT LIVE VALIDATION |
| 14 | Video | Video attachment carries token; `GET /videos/{videoToken}` returns nullable URLs including MP4 renditions/HLS and thumbnail. [Pinned schema](https://github.com/max-messenger/api-schema/blob/1a4a502fab096aa3a15d83d7ea95667ffb44d2ac/schema.yaml) | Shape VERIFIED; historical resolution REQUIRES EXPLICIT LIVE VALIDATION |
| 15 | Multiple video | Schema permits attachment arrays but no guarantee or explicit limit for multiple videos in one post. | REQUIRES EXPLICIT LIVE VALIDATION |
| 16 | Mixed photo/video | Schema attachment variants permit both kinds; support and faithful retrieval for channel history are unverified. | REQUIRES EXPLICIT LIVE VALIDATION |
| 17 | Attachment ordering | Array order is the only ordering signal; there is no explicit attachment position. Match to authored/display order needs fixture validation. | REQUIRES EXPLICIT LIVE VALIDATION |
| 18 | Media download | Current `media-download.ts` streams/bounds video and downloads image payloads with host/content/size checks; these code paths do not prove historical channel URLs are fetchable. [Code](../../../../../backend/src/modules/max/infrastructure/media-download.ts) | Current handling VERIFIED; channel compatibility REQUIRES EXPLICIT LIVE VALIDATION |
| 19 | Preview/poster | Video API schema includes thumbnail fields, but availability/expiry and sufficiency as a preview for history are unknown. [Pinned schema](https://github.com/max-messenger/api-schema/blob/1a4a502fab096aa3a15d83d7ea95667ffb44d2ac/schema.yaml) | Shape VERIFIED; behavior REQUIRES EXPLICIT LIVE VALIDATION |
| 20 | Deleted posts | Whether deleted posts are omitted, returned, or fail retrieval is unspecified. | NOT DOCUMENTED |
| 21 | Unavailable media | Whether inaccessible/expired media is omitted, represented with an error, or refreshable is unspecified. | NOT DOCUMENTED |
| 22 | Edited posts | Historical snapshot/edit representation and whether the endpoint returns latest or original content are unspecified. | NOT DOCUMENTED |
| 23 | Rate limiting | Official bot preparation guide recommends no more than 30 requests per second to `platform-api2.max.ru`; this is a stability recommendation, not a history-endpoint quota guarantee. [Preparation guide](https://dev.max.ru/docs/chatbots/bots-coding/prepare) | Recommendation VERIFIED |
| 24 | Retry-after | Current adapter parses numeric-seconds `Retry-After` when present; this is a code fallback, not a MAX guarantee that the header is always sent. [Code](../../../../../backend/src/modules/max/infrastructure/max-api.ts) | Code behavior VERIFIED; provider guarantee NOT DOCUMENTED |
| 25 | Retryable errors | Current adapter classifies HTTP 429 and 5xx as retryable; media downloader also retries 408/429/5xx and network errors. This local policy is not a complete provider error contract. [API code](../../../../../backend/src/modules/max/infrastructure/max-api.ts) · [download code](../../../../../backend/src/modules/max/infrastructure/media-download.ts) | Code behavior VERIFIED; provider contract NOT DOCUMENTED |
| 26 | Permanent errors | Method docs list 401, 403 and 500; 401/403 are authorization/access errors, while the adapter only marks 429/5xx retryable. Full status/code taxonomy is unspecified. [Method docs](https://dev.max.ru/docs-api/methods/GET/messages) · [code](../../../../../backend/src/modules/max/infrastructure/max-api.ts) | Partial VERIFIED; full taxonomy NOT DOCUMENTED |
| 27 | Dedupe identity | `mid` is the candidate post ID; durable uniqueness scope is not documented. Do not dedupe by caption/time. Existing direct-dialog key cannot safely establish channel uniqueness. | NOT DOCUMENTED |
| 28 | Resume implications | Without proven cursor/termination and identity scope, a durable checkpoint cannot safely advance; ambiguous boundary must stop, not skip forward. | REQUIRES EXPLICIT LIVE VALIDATION |
| 29 | Security/token boundary | Existing API adapter sends bot token in `Authorization`; HI workflow must keep it server-side. Never expose token, rotating media token, signed URL, encrypted payload or raw provider error in UI/logs. [Method docs](https://dev.max.ru/docs-api/methods/GET/messages) · [owner decisions](../01_LOCKED_OWNER_DECISIONS.md) | VERIFIED product constraint |
| 30 | Known unknowns | Pre-join history, cursor/page-boundary behavior (including equal-ms posts), `seq` ordering, media expiry/refresh, deletion/edit semantics, exact error taxonomy and ID uniqueness require evidence. | REQUIRES EXPLICIT LIVE VALIDATION |

### Provisional HI-1/HI-2 API and workflow sketch — NOT FROZEN

For planning only, a proposed server API shape is:

```text
POST /api/v1/families/{familyId}/max-history-imports
  body: { childId, channelId }
  response: { jobId, status }
GET /api/v1/families/{familyId}/max-history-imports/{jobId}
  response: { jobId, status, scannedCount, importedCount, skippedCount,
              failedCount, startedAt, completedAt, safeErrorCode }
```

Names, route, request fields, auth capability and response shape are **NOT FROZEN** and must be reconciled by HI-1/HI-2 after the provider gate. The server must derive actor identity from the authenticated principal and validate owner role, family, and child; client must not send provider secrets or actor identity. `channelId` must refer to an authorized connected channel, not an arbitrary ID. Provisional status values may be queued/running/retryable/complete/failed only if supported by the eventual job design. Counters are monotonically updated durable progress indicators, not proof of full completeness until traversal semantics are verified.

The approved owner decisions still govern mapping: one channel post → one Memory; provider timestamp → `sourcePublishedAt` and initial `occurredAt`; memoLy publication → `firstPublishedAt`; preserve caption and attachment order; explicit family and child; retries without duplicates; no destructive rewrite. Existing `MaxSource` requires `inboxId` and direct-dialog identity fields, so reuse or alteration needs a lead decision; do not silently weaken its constraints or invent a parallel identity system.

### Post-MVP gate / controlled validation

HI-1 and HI-2 are **not started** and remain gated after MVP on this unresolved provider contract. A synthetic test-channel validation must establish bot admin access, pre-join visibility, newest-first ordering, pagination request/response behavior, safe end detection, equal-millisecond boundary completeness, `mid`/`seq` semantics, page limits, deleted/edited/unavailable behavior, rate-limit/retry responses, attachment ordering, and media token/URL refresh. Record only redacted synthetic observations. If no deterministic no-gap/no-duplicate traversal can be demonstrated, escalate to the owner/lead; never claim “all history imported.” No real API calls were made for this audit.

**UNRESOLVED ARCHITECTURE:** Channel-history provenance, a durable provider key shared with live capture, and adaptation/extension of the dialog-oriented `MaxSource` model require an explicit lead decision after provider validation. The provisional HI-1/HI-2 API above remains **NOT FROZEN**. This is a post-MVP implementation gate, not an MVP release blocker.
