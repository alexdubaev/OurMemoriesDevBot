# MAX-07 VIDEO — MAX-hosted reference and guarded playback design

**Status:** LEAD APPROVED

**Date:** 2026-09-15

**Branch:** `feat/max-adapter`
**Design base:** `4b3595d739be144ced9adef437e7d5fec3d83353`

## 1. Owner decision and product boundary

The owner explicitly approved MAX-hosted video for MVP and unblocked implementation. memoLy accepts
the operational dependency on MAX retention even though MAX does not currently provide a proven or
documented indefinite archival-retention guarantee. The existing 24-hour and seven-day retention
checks are informational only.

The approved lifecycle is:

```text
MAX retains video
→ memoLy persists stable provider identity
→ an authenticated memoLy request resolves current MAX transport data
→ memoLy streams the selected provider MP4 through its guarded media boundary
```

MAX video is not a `MediaAsset`, `MediaVariant`, or `MemoryMedia` object. The adapter must not
download on ingest, archive the original, create a fallback copy, or charge family private-storage
quota for the provider video.

## 2. Evidence classification

### Officially documented

- `GET /messages?message_ids=...` returns the requested message(s) and uses the bot token only in
  the `Authorization` header: <https://dev.max.ru/docs-api/methods/GET/messages>.
- `GET /videos/{videoToken}` returns video URLs and metadata and requires MAX API authorization:
  <https://dev.max.ru/docs-api/methods/GET/videos/-videoToken->.
- The documented `videoToken` and `messageId` regexes are narrower than the live values observed by
  this project.
- The video endpoint documents `duration` as seconds.

### Observed in the bounded live probe

- A normal inbound video had one `type=video` attachment at position zero.
- The message `mid`, attachment `payload.id`, position, and type remained stable across repeated
  message reads.
- The attachment token rotated and its live shape did not match the documented regex.
- The query-form message lookup accepted the dotted `mid`; the documented path regex is inconsistent
  with that live identifier.
- URL-encoding the exact current token in `GET /videos/{token}` returned metadata and a fresh MP4 URL.
- The inbound duration was `7`; the video resolver returned `7000` for the same seven-second test.
- The selected MP4 was served by an HTTPS `maxvd<digits>.okcdn.ru` host without MAX Authorization or
  cookies, returned valid MP4 bytes to a bounded Range request, and did not redirect.

### Unknown / accepted risk

- Indefinite retention, message lifetime, payload-id durability, deletion/moderation lifecycle, and
  whether the returned MP4 is the submitted original or a MAX rendition remain unproven.
- A successful short, 24-hour, or seven-day read is not an archival guarantee.

## 3. Supported inbound shape

MAX-07 VIDEO supports exactly one normal `type=video` attachment in one direct-dialog
`message_created` event. Its stable identity is:

- `message.body.mid`;
- `attachment.payload.id`, normalized to a non-empty bounded decimal string;
- attachment array position, currently required to be zero;
- provider attachment type, required to be `video`.

Message text follows the established caption/body rule: null or whitespace-only becomes an empty
body; nonblank text of at most 8,000 Unicode code points is preserved; over-limit text is denied.
Mixed attachment messages, multiple videos, video-as-generic-file, malformed identity, and any
unsupported attachment shape fail closed without a Memory.

Ingress validates that transient token/URL fields are structurally usable when the provider sends
them, but normalized durable event data contains no token or URL. The encrypted inbox contains only
the normalized minimum until terminal processing.

## 4. Durable persistence

Add one provider-owned table, `MaxVideoReference`, created atomically with its published Memory:

```text
MaxVideoReference
  id UUID primary key
  sourceId UUID unique -> MaxSource
  memoryId UUID unique -> Memory
  familyId UUID
  attachmentPosition integer
  providerAttachmentId text       // stable payload.id
  width integer nullable
  height integer nullable
  durationMs integer nullable
  createdAt timestamptz
```

The table name and relationship encode `type=video`; application and database checks enforce a
non-negative position and positive nullable metadata. `MaxSource.messageId` is the durable `mid`.
Composite family foreign keys prevent cross-family source/reference/Memory linkage.

Do not store current token, inbound URL, resolved MP4/HLS URL, CDN host, cookies, or credentials.
`MaxSourceAttachment` remains the image/file planning table; its required `plannedMediaId` semantics
must not be weakened for provider-only video.

One additive migration is allowed. Existing migration history is immutable.

## 5. Durable processing and publication

The existing `MaxInbox` event key, `(botId, recipientId, messageId)` source uniqueness, fixed
`plannedMemoryId`, and `max:process` reference-only task remain authoritative. Token equality is
never used for deduplication.

The video processor:

1. reloads the accepted inbox/source;
2. resolves the current single-family admission and FULL member/child scope;
3. calls query-form `GET /messages?message_ids=<exact encoded mid>`;
4. requires the same message, direct-dialog sender/recipient, attachment count, position zero,
   `type=video`, and matching `payload.id`;
5. takes the current token only in memory and calls `GET /videos/{encodeURIComponent(token)}`;
6. validates dimensions, duration evidence, and at least one supported MP4 URL;
7. creates the fixed `video` Memory and `MaxVideoReference` in one transaction after a final FULL
   membership/family/child check;
8. marks source/inbox terminal and queues one independent logical `saved` response.

Transient provider failures remain retryable through the existing outbox. Identity mismatch,
unsupported response shape, or unsafe URL is a terminal fail-closed outcome with no Memory.
Response delivery remains separate and at-least-once when the provider outcome is unknowable.

## 6. Explicit duration rule

Do not assign a unit from field name alone. Preserve both raw observations inside the in-memory
adapter flow and normalize only by this tested rule:

- inbound duration must be a positive safe integer interpreted according to the documented inbound
  seconds contract;
- resolver duration is accepted as milliseconds only when it equals `inbound × 1000`, matching the
  live `7 → 7000` contract;
- if the pair is absent, unsafe, or inconsistent, publish the video with `durationMs = null` rather
  than guessing or rejecting otherwise usable video;
- normalized duration must fit the application's positive integer bounds.

Regression tests use exactly the `7 → 7000` discrepancy and mismatched/absent controls.

## 7. Public DTO and playback path

Add a `source: "max", kind: "video"` attachment DTO containing only:

- opaque reference UUID;
- width, height, normalized duration;
- a relative memoLy playback path.

The path is `/api/v1/families/{familyId}/media/max-videos/{referenceId}/content`. No MAX identifier,
token, signed URL, host, or storage key is public frontend state. Existing HTML5 `<video>` controls
consume this path; no new media engine or player dependency is introduced.

## 8. Guarded playback resolution

The MAX module supplies a narrow playback port to the existing media-route composition. GET and HEAD
use the existing bearer/service-worker/playback-cookie boundary under `/families/{familyId}/media/`.
Before any MAX or CDN request, the service verifies:

- current authenticated session;
- active family membership;
- requested reference belongs to the family;
- linked Memory belongs to the family, is published, and is not deleted;
- linked MAX source/reference is the one belonging to that Memory.

It then repeats exact message and attachment identity checks, obtains the current token, calls the
video resolver, and selects the highest available MP4 rendition at or below 720p. HLS is not exposed
or proxied in this bounded implementation because safe manifest/segment proxying is a separate
contract; absence of a supported MP4 fails closed.

## 9. CDN transport rules

The streaming fetcher:

- accepts HTTPS only, default port only, no userinfo;
- accepts only hosts matching the observed `^maxvd[0-9]+\\.okcdn\\.ru$` boundary;
- uses normal TLS verification;
- uses `redirect: "manual"` and rejects every redirect;
- sends no MAX Authorization, cookies, referrer, or credentials;
- forwards at most one syntactically valid byte Range and requires `206` for a Range request;
- accepts `200` for an un-ranged GET/HEAD;
- requires `video/mp4`, consistent Content-Length/Content-Range, and a configured maximum total
  video size;
- streams the body and enforces an actual-byte ceiling without buffering or persisting the complete
  video;
- returns only safe playback headers (`Content-Type`, `Content-Length`, `Content-Range`,
  `Accept-Ranges`, private/no-store and same-origin protections).

Provider failures and diagnostics are sanitized. The full URL, query, token, Authorization header,
and response body never enter errors or logs.

## 10. Configuration

Add `MAX_VIDEO_MAX_BYTES`, defaulting to the product's 250 MB provider ceiling and capped at that
documented maximum. This is a streaming safety ceiling, not storage quota. Secret fields remain
empty in examples; no new secret is introduced.

## 11. Tests and acceptance

Required regression coverage:

- live-shaped dotted `mid`, numeric `payload.id`, rotating non-regex token, and removal of transport
  data from normalized/durable events;
- exact query-form message lookup and exact URL-encoded token path;
- `GET /videos` metadata/URL parsing and `7 → 7000` normalization;
- one video publishes one Memory/reference, zero MediaAssets/MemoryMedia/private objects;
- duplicate event/task retries create no duplicate reference, Memory, or logical response;
- mixed/multiple/mismatched attachment shapes publish nothing;
- authorization and family/Memory/reference ownership are checked before network resolution;
- outsider, revoked member, deleted/unpublished Memory, wrong reference, and cross-family access fail;
- CDN receives no MAX Authorization/cookie, redirects/unknown hosts/non-HTTPS fail, Range/HEAD headers
  remain correct, full signed URLs never appear in DTOs/errors;
- existing MAX image/text, Telegram capture, private media, contracts, and feed behavior regressions
  remain green.

## 12. Explicit exclusions and STOP conditions

Excluded: audio/voice investigation or implementation; generic file video; image refactor; Telegram
refactor; private video original/rendition; Selectel copy; HLS manifest proxy; webhook/subscription
mutation; live network calls during implementation; deployment; push; PR; merge; MAX-09/MAX-10.

STOP on any design that persists transport tokens/URLs, creates a video `MediaAsset`, sends MAX auth
to the CDN, weakens TLS/redirect/host rules, exposes raw provider URLs, bypasses family authorization,
uses token equality for dedupe, edits historical migrations, or requires unrelated refactoring.

## 13. Lead approval

The lead approves this bounded VIDEO design and its implementation brief at base
`4b3595d739be144ced9adef437e7d5fec3d83353`. A fresh worker may implement only the allowed scope.
