# memoLy — Mixed Media Carousel + MAX Channel History Import
## START HERE

This specification pack is owner-approved planning material for the next memoLy media/import stage.

### Goals

1. First, evolve memoLy so **one Memory can contain an ordered mix of photos and videos** and render as an Instagram-style swipe carousel.
2. Then, add **historical MAX channel import**, where one MAX source post becomes one memoLy Memory, preserving:
   - attachment order;
   - caption/text;
   - original MAX publication time;
   - source identity for idempotency;
   - one Memory-level like/unread/seen identity.
3. Preserve future temporal semantics needed for:
   - “On this day”;
   - year/month/time filters;
   - stories;
   - event/time-based views;
   - source-history attribution.
4. Use a proven carousel engine rather than inventing low-level touch physics. Preferred engine: **Embla Carousel / React integration**, subject to fresh-main dependency/license/compatibility audit.

### Repository destination

When this pack is introduced into the repo, place it under a stable documentation path, preferably:

`docs/mvp/plans/mixed-media-max-import/`

Preserve this pack as planning/task documentation. Agents should update task status/evidence in repo according to existing conventions, but should not silently rewrite owner decisions.

### Sources used to prepare this pack

The pack was prepared against the uploaded fresh code snapshot `OurMemoriesDevBot-main.zip` plus owner decisions from the memoLy project conversation.

Confirmed current-code facts include:

- `Memory.kind` is a Prisma enum: `note | photo | video | voice`.
- `MemoryMedia` already gives a Memory ordered attachments via `position`.
- `MediaAsset.kind` already supports `photo | video | voice`.
- `photo` create contract currently allows 1–10 `mediaIds`.
- `video` create contract currently allows exactly one `mediaId`.
- DTO attachments already discriminate `photo | video | voice`.
- current MAX source model already stores durable provider identity and ordered attachment positions.
- current MAX update mapping converts MAX millisecond `timestamp` to `occurredAt`.
- `firstPublishedOrdinal` already exists and is immutable first-publication ordering for unread semantics.
- `Memory` currently has `createdAt`, `updatedAt`, `occurredAt`, but no explicit immutable `firstPublishedAt`.
- current MAX mixed image+video message handling is not a first-class mixed-Memory path.
- existing photo album and video pipelines should be reused rather than rebuilt.

### Mandatory order

Do **not** start historical MAX import before the mixed-media Memory foundation is merged and integration-verified.

High-level dependency:

`MM-0 → (MM-1 || MM-2 || MM-3) → MM-4 → HI-0 → (HI-1 || HI-2) → HI-3 → HI-4`

See `03_DEPENDENCY_AND_PARALLEL_PLAN.md`.

### Production

None of the implementation tasks in this pack automatically authorize production deployment unless their own task explicitly says so.

Normal implementation tasks are code-only:
branch → tests → Luna → PR → autonomous merge.

A later dedicated release task should deploy the completed stage.
