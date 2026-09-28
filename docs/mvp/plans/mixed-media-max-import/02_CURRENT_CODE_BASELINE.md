# Current code baseline

This document captures the relevant baseline found in the uploaded code snapshot. Agents must re-check fresh `origin/main` before implementation.

## Data model

Current Prisma `Memory` includes:

- `kind: MemoryKind`;
- `body`;
- `occurredAt`;
- `firstPublishedOrdinal`;
- `createdAt`;
- `updatedAt`;
- ordered `media: MemoryMedia[]`.

Current `MemoryKind`:

- `note`
- `photo`
- `video`
- `voice`

Current `MemoryMedia`:

- belongs to one Memory;
- belongs to one MediaAsset;
- has integer `position`;
- primary key `(memoryId, position)`;
- media asset currently unique to one Memory.

Current `MediaAssetKind`:

- `photo`
- `video`
- `voice`

This means ordered heterogeneous asset storage is already close to what mixed media needs; the hard restrictions are mostly domain/contracts/publish/ingestion/presentation.

## Public contracts

`packages/contracts/src/memories.ts` currently defines:

- `memoryKindSchema = note | photo | video | voice`;
- photo creation: 1–10 media IDs;
- video creation: exactly 1 media ID;
- voice creation: exactly 1 media ID;
- note: no media IDs;
- attachment DTO union already has photo/video/voice representations.

## Publication

Existing B4 semantics provide:

- immutable `firstPublishedOrdinal`;
- one Memory as one unread unit;
- server `seen`;
- server unread filtering/cursor.

Mixed media must not create per-slide unread records.

## MAX ingress

Current MAX source infrastructure already contains important reusable structures:

- `MaxSource`;
- durable uniqueness on `(botId, recipientId, messageId)`;
- `plannedMemoryId`;
- target `familyId`/`childId`;
- ordered `MaxSourceAttachment(position, providerKind, providerAttachmentId, ...)`;
- `MaxVideoReference` for current MAX video behavior.

Current MAX update mapping maps provider `timestamp` milliseconds into ISO `occurredAt`.

Current video policy is intentionally narrow: a video message path recognizes one video attachment. Current image path handles image groups separately.

Mixed image+video historical/source posts therefore need an explicit new supported path; do not assume the current video/image handlers already compose safely.

## Telegram

Telegram currently has its own album/source/video-reference behavior.

The first mixed-media stage must avoid accidentally breaking it.

Whether Telegram mixed albums should be upgraded in the same stage depends on actual current provider semantics and task scope; do not silently broaden historical MAX import into a full Telegram history-import project.

## Web composer

Current web composer has a dedicated multi-photo flow and a separate video flow.

The mixed composer task should reuse media upload infrastructure but may need a new unified media selection/orchestration layer.

## Feed

Legacy photo/video presentation is currently type-specific.

The mixed carousel should become a shared presentation layer while preserving existing:

- protected media;
- source aspect behavior;
- fullscreen/detail;
- video controls;
- B6 seen observer;
- “Показать новые” separation;
- unread mode stability.

## Time model gap

Current Memory has:

- `occurredAt`;
- `createdAt`;
- `updatedAt`;
- `firstPublishedOrdinal`;

but no explicit immutable `firstPublishedAt` and no generic preserved `sourcePublishedAt`.

This task pack intentionally addresses that gap before historical import.
