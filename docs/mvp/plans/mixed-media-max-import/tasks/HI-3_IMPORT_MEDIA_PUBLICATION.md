# HI-3 — MAX history media transfer + Memory publication

**Status: `DEFERRED_POST_MVP` (not started).** Historical import is not an MVP release blocker. See [the post-MVP roadmap](../POST_MVP_MAX_HISTORICAL_IMPORT.md).

Depends on:
- MM-4 merged
- HI-1 backend foundation merged
- HI-0 contract merged

May overlap late with HI-2 if contracts are stable.

## Goal

Turn reserved historical MAX source posts into memoLy Memories with correct media, order, source time, event time, and idempotency.

## Mapping

For each source post:

### Text/note only
Use existing note semantics if source is text-only.

### Photo-only
Reuse existing photo/media pipeline and preserve order.

### Video-only
Reuse existing safe MAX video/media behavior according to current architecture.

### Mixed photo/video
Create exactly one `kind=media` Memory.

Never split a mixed source post into several independent Memories.

## Time

For imported post:

- `sourcePublishedAt` = MAX source timestamp;
- initial `occurredAt` = sourcePublishedAt;
- `firstPublishedAt` = memoLy first publication moment;
- `firstPublishedOrdinal` = existing B4 publication boundary.

Editing occurredAt later cannot change sourcePublishedAt/firstPublishedAt.

## Attachment order

Provider attachment order → `MemoryMedia.position` exactly.

## Partial failure

No half-published mixed Memory.

If one media item fails transiently:
- preserve durable source/job state;
- retry only missing/incomplete work;
- no duplicate successful assets where current source model can reuse them.

Permanent provider-unavailable item:
follow HI-0 error policy and expose bounded per-post/job failure; do not silently omit a slide and claim success.

## Dedupe

Already imported source post:
- no duplicate Memory;
- no duplicate attachments;
- job counts skipped/reconciled.

## Existing live capture

If a historical traversal encounters a post already captured live:
- detect by durable provider source identity;
- do not import again.

## Tests

At minimum:
- historical note;
- multiple photos;
- one video;
- 2 photo + 2 video mixed;
- alternating mixed order;
- original timestamp;
- initial occurredAt;
- later occurredAt edit preserves provenance;
- duplicate history run;
- interruption after some media stored;
- restart/resume;
- provider missing media;
- existing live source dedupe;
- family/child target correctness;
- no cross-family media leak.

## Scope

No stories.
No production deployment.
No source-post splitting fallback.

Final HANDOFF title:

`HANDOFF — HI-3 MAX HISTORY MEDIA PUBLICATION`
