# MAX-1 — MAX backup: photo albums/mixed media + live ingestion regression

## Goal
Restore the approved invariant:
MAX is the backup/provider media layer for MVP.

This is NOT historical sync.

## Directions
### memoLy → MAX
New app-created Memories get correct MAX backup/provider representation.

### MAX live → memoLy
Existing live ingestion remains one Memory per source post.

## Scope
Primary:
- MAX provider adapter;
- outbound publication/outbox;
- durable provider/source refs;
- photo album backup;
- mixed backup;
- idempotency;
- live ingestion regression.

Avoid:
- Feed redesign;
- progress UI;
- historical listing.

## Photo-only
For `photo1, photo2, photo3`:
- one memoLy Memory;
- private assets stay in private storage;
- MAX backup/provider representation exists;
- all attachments included;
- order preserved;
- provider ref durable;
- retry no duplicate provider post.

## Mixed
For `photo1, video2, photo3, video4`:
- one Memory;
- photos keep private storage;
- videos use current MAX storage/delivery;
- one logical MAX source post;
- exact order;
- no split into product Memories.

## Live MAX regression
- photo ingestion;
- video ingestion;
- multi-attachment live input one Memory;
- duplicate delivery idempotent;
- provider order exact;
- sourcePublishedAt provider time.

If current channel/live route is missing/regressed relative to established MVP, treat as a bug, not a historical-import redesign.

## Provider identity
Use durable provider identity.
Do NOT dedupe by caption/timestamp/content similarity.

## Outbound note contract
Plain `note` Memories do not have a MAX backup representation in the current MAX-1 contract. Only `photo` and `media` Memories create `max:backup-media` work and durable `MaxMemoryBackup` provider references; a missing MAX post for an ordinary text note is therefore current-scope behavior, not a regression.

## Critical loop prevention
Because memoLy writes backup to MAX and also ingests live MAX:
- memoLy-generated backup posts must not re-enter as duplicate Memory;
- self-originated/provider-linked posts must be recognized safely;
- this is mandatory and tested.

## Failure semantics
- provider failure does not corrupt valid private photo;
- do not claim backup success without durable provider ref;
- ambiguous send result follows conservative idempotency;
- no blind resend if duplicate risk;
- bounded safe retry only.

## Historical sync excluded
No old-history enumeration/pagination/import/resume.

## Tests
- 1 photo backup;
- 5-photo album;
- 10-photo album;
- mixed exact order;
- retry no duplicate provider post;
- backup post does not re-ingest;
- live 5 photos + 3 videos → one Memory when supported by live fixture;
- duplicate live delivery → one Memory;
- sourcePublishedAt/order;
- provider failure;
- no historical API calls.

## Handoff
Include:
- root cause of photo-only backup gap;
- outbound mapping;
- loop prevention;
- provider identity;
- retry/idempotency;
- live regression;
- Telegram post-MVP;
- historical sync not started;
- Luna;
- deploy NOT performed.
