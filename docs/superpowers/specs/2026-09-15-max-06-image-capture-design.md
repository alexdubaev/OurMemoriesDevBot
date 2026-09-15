# MAX-06 — image capture design brief

**Status:** OWNER REVIEW

**Date:** 2026-09-15

**Branch:** `feat/max-adapter`
**Design base:** `c8c6202e09453703fe71477ac95d3c4501dd43e8`

## 1. Decision requested

Approve one bounded implementation of direct-dialog MAX image capture using the existing
`MaxInbox` / `MaxSource` / `TaskOutbox` boundary and the shared private-media and Memory Core.

The implementation supports both MAX send modes proven by synthetic live probes:

1. `attachment.type=image`: archive the exact image rendition bytes supplied by MAX. One MAX
   message containing one to ten ordered image attachments becomes one `photo` Memory with the
   same ordered `MediaAsset` list.
2. `attachment.type=file`: when one file attachment in one MAX message downloads and validates as
   a supported image, archive those exact file bytes as the original. Separate MAX messages remain
   separate Memories and are never grouped by time or another heuristic.

MAX renditions are not called originals. The adapter does not attempt to recover a higher-quality
image. No quality metadata, warning, replacement flow, or mode selector is added.

## 2. Evidence and provider rulings

The synthetic probes established the following observed behavior; it is not promoted to a broader
provider guarantee:

- quick-send single image: one `message_created`, one `image` attachment;
- quick-send three images: one `message_created`, three `image` attachments in observed order;
- `photo_id` remained stable across repeated message reads; attachment token rotated; the URL was
  short-lived transport metadata and served JPEG rendition bytes from `i.oneme.ru` without bot
  Authorization or redirect;
- the quick-send bytes were approximately 320 px MAX renditions, not submitted originals;
- uncompressed single image: one `message_created`, one `file` attachment; `fileId` remained stable,
  token and URL rotated, and `fd.oneme.ru` returned the submitted PNG without bot Authorization or
  redirect; its SHA-256, dimensions, format, and byte length matched the synthetic source;
- three uncompressed files in one message were not established by the probe.

Official MAX schema documents `photo_id`, attachment token, URL, and message reads, but does not
document an image-original resolver or an inbound attachment-order/count guarantee. The owner has
adjudicated that the received array order is the product order and that the exact bytes exposed by
the selected MAX send mode are the archive input.

## 3. Supported message classification

The MAX adapter normalizes provider attachments without leaking MAX types into Core.

### Quick image message

A supported quick image message has:

- one to ten attachments;
- every attachment has `type=image`;
- every attachment has a non-empty stable `photo_id` and the structurally valid fields required by
  the maintained MAX schema;
- no other attachment type.

Array position is recorded at durable acceptance and is authoritative for `MemoryMedia.position`.
The one-to-ten count is a memoLy application safety/product limit, not a claimed MAX inbound-message
guarantee. A message above the application limit is rejected as one unit: no download, MediaAsset,
or partial Memory is created.

### Uncompressed image-file message

A supported file candidate has exactly one `type=file` attachment in the MAX message, a non-empty
stable `fileId`, a bounded non-empty filename when supplied, and structurally valid provider fields.
The response Content-Type and filename are hints only. The downloaded bytes must pass the shared
photo magic-byte, decoder, pixel, and supported-format checks before publication.

One file message produces at most one `photo` Memory. Separate file messages produce separate
Memories. The adapter never groups them.

### Fail-closed cases

The entire MAX message is `unsupported_media`, with no download and no Memory, when it contains:

- video, audio, sticker, generic non-image attachment, or another excluded type;
- mixed attachment types;
- more than ten quick image attachments;
- more than one `file` attachment in one message;
- a structurally valid but unsupported attachment combination.

An incomplete or malformed `image` / `file` attachment in a supported `message_created` update is
rejected at the existing webhook validation boundary with HTTP 400; it is not durably accepted or
turned into a user-visible success/unsupported response.

Multiple `file` attachments in one message are deliberately not inferred to be an album. They can
be added only after a separate official contract or bounded live probe establishes representation,
identity, ordering, and download behavior.

## 4. Text and caption semantics

Image-message text is never published as a separate note.

- `null` or whitespace-only text becomes an empty photo Memory body;
- non-blank text of at most 8,000 Unicode code points is preserved unchanged as the photo Memory
  body;
- over-limit text is not truncated and causes safe whole-message denial.

This matches the existing Core photo-body invariant and the established Telegram source behavior,
without introducing a MAX-only caption model.

## 5. Durable identity and persistence

Keep `MaxInbox`, `MaxSource`, and `MaxOutgoingResponse`. Add one provider-specific child table; do
not create `MaxImage`, `MaxMediaAsset`, `MaxMemory`, or provider-neutral replacement inbox tables.

Proposed additive model:

```text
MaxSourceAttachment
  id UUID primary key
  sourceId UUID foreign key -> MaxSource
  position integer
  providerKind image | file
  providerAttachmentId text       // photo_id or fileId
  plannedMediaId UUID
  mediaId nullable UUID
  status planned | stored | failed
  createdAt / updatedAt timestamptz

  unique(sourceId, position)
  unique(plannedMediaId)
  index(sourceId, providerKind, providerAttachmentId)
```

At the existing acceptance transaction:

- event deduplication remains `MaxInbox.eventKey` and message identity remains
  `(botId, recipientId, messageId)`;
- one `MaxSource` is created for one `message_created`;
- each supported attachment gets its durable position and predetermined `plannedMediaId`;
- `max:process` still contains only `{ inboxId }`;
- a supported image candidate gets the existing logical `accepted` response and independent
  `max:deliver-response` task;
- non-image/fail-closed shapes get the existing logical `unsupported_media` response and terminal
  processing without download.

Rotating tokens and signed media URLs are never database identity. They are not stored in the
attachment table, TaskOutbox, logs, errors, reports, or Core. The encrypted inbox keeps only the
normalized minimum needed until terminal processing; current transport URLs are obtained in memory
from a message lookup.

Add `max` to the shared `MediaSourceKind` enum so shared `MediaAsset` records accurately retain their
trusted adapter origin. Existing migrations remain immutable; MAX-06 uses one new additive migration.

## 6. Retrieval and transport security

Extend the narrow `MaxApiPort` with a message lookup by the accepted `messageId`. The implementation
uses the documented/probed MAX message-read operation and sends the raw bot token only in the
`Authorization` header to `https://platform-api2.max.ru`.

Immediately before each download, the adapter:

1. reloads the MAX message;
2. verifies the same message, direct-dialog sender/recipient, attachment count, attachment kinds,
   stable IDs, and ordered stable-ID sequence recorded at acceptance;
3. selects the current URL for that exact attachment identity;
4. downloads it with a separate no-credentials media fetcher.

The media fetcher accepts only HTTPS and the observed exact hosts `i.oneme.ru` and `fd.oneme.ru`,
disables redirects, never sends MAX Authorization or cookies, applies caller cancellation and a
bounded timeout, streams with an actual-byte ceiling, and returns sanitized failures. A new host,
redirect, identity/order mismatch, unusable URL, TLS failure, or inconsistent length fails closed and
publishes nothing.

`MAX_FILE_MAX_BYTES` is a **per-file actual-byte ceiling** for both flows. This mirrors the existing
provider download boundary. A one-to-ten image message is additionally constrained by the existing
family quota, which accounts for the sum of stored archive inputs. Provider Content-Length and file
size metadata may reject early but never replace the streamed byte limit.

## 7. Shared private-media lifecycle

Generalize the internal trusted-source ingestion seam, without changing Telegram behavior, so MAX
can reuse the same lifecycle:

- predetermined MediaAsset ID and UUID-only private object key;
- active FULL membership check and family quota reservation;
- immutable private original write;
- magic-byte and decoder verification, maximum 40 megapixels, supported JPEG/PNG/WebP/HEIC policy,
  SHA-256, width, and height;
- display and preview WebP derivatives;
- `originalStatus=stored` only after verified finalization;
- no provider URL, token, external ID, or filename in the object key or public DTO.

For `type=image`, the MAX rendition bytes are the immutable archive input to this lifecycle. For
`type=file`, the exact downloaded file bytes are the immutable archive input. Because the live file
response used `application/octet-stream`, the MAX path detects the supported image MIME from bytes
before finalization and then requires full decode; it does not weaken MIME or decoder validation for
browser or Telegram uploads.

The shared seam checks an existing planned asset/reservation/object before invoking a lazy provider
download. Ordinary retries therefore reuse a stored/finalizable object and do not repeat completed
downloads. An unknowable network/process failure during a physical GET may retry that GET, but cannot
create a second logical attachment, object key, MediaAsset, or Memory.

## 8. Multi-image atomicity and retry behavior

For a quick-send image message, assets are staged in recorded order. Publication starts only after
all planned assets are verified and `stored`.

- A transient lookup, download, storage, or database failure keeps the source non-terminal and the
  encrypted inbox payload available. A retry skips already stored planned assets and continues.
- A permanent byte/format/pixel/count failure publishes no Memory. All planned, unattached assets
  from that source are marked for the existing idempotent private-media cleanup, reservations are
  released, and the source reaches one guarded terminal outcome.
- No `MemoryMedia` row is written until every asset is ready.
- The trusted source publisher receives the predetermined Memory ID and the ordered planned media
  IDs. Its transaction re-locks active family/non-revoked FULL membership, rechecks the child and all
  ready/unattached MediaAssets, creates one `photo` Memory plus ordered `MemoryMedia`, marks source
  and attachments published/stored, clears the encrypted inbox payload, and creates the one logical
  `saved` response plus delivery task.
- Competing or stale processors must win the single `accepted -> terminal` source transition before
  creating a terminal response. Fixed IDs and unique constraints make publication replay-safe.

Response delivery remains outside media ingestion and Memory publication. A delivery retry cannot
rerun downloads or publication, and a delivery failure cannot roll them back.

## 9. User-visible response semantics

Reuse the MAX-05 messages and durable response kinds:

- structurally supported image/file candidate after committed acceptance:
  `Получено. Сохраняем…` (`accepted`);
- successful photo publication: `Сохранено в семейную ленту.` (`saved`);
- unsupported/mixed/invalid image bytes or unsupported attachment shape:
  `Получено. Медиа пока не поддерживается — отправьте текстовую заметку.` (`unsupported_media`);
- identity, membership, family, child, authorization, quota, or invalid caption denial:
  `Не удалось сохранить это сообщение в memoLy.` (`denied`).

The response does not disclose internal family or authorization state. An `accepted` response means
only durable acceptance, not successful publication.

## 10. Implementation boundary after approval

### Allowed paths

- `backend/src/modules/max/**`
- `backend/src/modules/media/application/**` and the minimal media infrastructure/port changes needed
  for a shared trusted-source seam
- `backend/src/modules/memories/infrastructure/source-memory-publisher.ts` only if a proven transaction
  hook is required; prefer its existing contract
- `backend/prisma/schema.prisma`
- one new additive MAX-06 migration
- focused MAX/media tests and Telegram capture regression tests
- `.env.example` / env validation only if a new non-secret transport limit is proven necessary;
  prefer existing `MAX_FILE_MAX_BYTES`
- MAX SDD/design/plan documentation

### Forbidden paths and scope

- Telegram behavior, album grouping, API contract, or persistence semantics
- frontend, shared public contracts, invite/start routing, account linking
- MAX video/audio/voice/sticker/generic file ingestion
- provider-neutral inbox/source replacement tables
- webhook/subscription mutation, deployment, secrets, live calls
- MAX-07 or later MAX tasks

### Expected contract changes

- provider-specific normalized attachment union and durable attachment identity;
- narrow message lookup plus unauthenticated allowlisted media download boundary;
- shared trusted-source photo ingestion supporting `sourceKind=max` while preserving Telegram behavior;
- no Core provider type and no public API/DTO change.

## 11. Required TDD and acceptance evidence

Implementation starts only after owner approval and uses one fresh bounded worker. Tests must prove:

- mapping of one image, three ordered images, one image-file, and fail-closed mixed/multi-file shapes;
- malformed provider attachment rejection and no URL/token leakage;
- durable and concurrent webhook deduplication with fixed attachment/Memory IDs;
- repeated processing skips stored assets and never creates duplicate downloads after a completed
  asset, MediaAssets, object keys, Memories, ordered links, or logical responses;
- one and three quick images publish one photo Memory in accepted array order;
- a validated image-file preserves exact bytes/SHA-256 and publishes one photo Memory;
- separate file messages publish separate Memories and are never grouped;
- MAX rendition bytes are stored unchanged as the private archive input;
- redirects, unexpected hosts, credential forwarding, MIME spoofing, bad magic, corrupt decode,
  oversize bytes, excessive pixels, and attachment identity/order drift fail closed;
- a partial multi-image transient failure publishes nothing and resumes from completed assets;
- a permanent partial failure publishes nothing and schedules cleanup of all source assets;
- photo body rules and no separate note publication;
- owner/FULL success; viewer, revoked, inactive family, ambiguous family, missing child, quota denial,
  and final revocation create no Memory;
- response delivery failure is independent from stored MediaAssets and Memory publication;
- clean database applies every migration.

Final gates after implementation: focused MAX/media unit tests; clean-database MAX integration;
backend unit and typecheck; contracts typecheck; architecture check; Telegram capture integration;
`git diff --check`; secret/signed-URL/forbidden-scope scans; fresh independent review, confirmed
P0/P1/P2 fixes with regression tests, rerun, and a second fresh whole-change review.

## 12. STOP conditions

Stop and return to the owner if implementation discovers that:

- `photo_id` or `fileId` is not stable enough to match a refreshed message safely;
- a fresh message lookup cannot supply a usable current URL;
- the accepted attachment sequence cannot be matched without heuristics;
- media requires sending bot Authorization to a media host;
- redirects or media hosts exceed the explicit allowlist;
- shared media invariants cannot preserve exact received bytes, quota, privacy, or all-or-nothing
  Memory publication;
- supporting multiple file attachments in one message becomes required without a proven contract;
- MAX video policy or MAX-07 scope would be crossed.

## 13. Owner approval gate

No worker, production code, migration, live API call, subscription/webhook mutation, deployment, push,
PR, or merge is authorized by this brief. Approval authorizes planning and one bounded TDD worker only;
publication remains a separate owner decision.
