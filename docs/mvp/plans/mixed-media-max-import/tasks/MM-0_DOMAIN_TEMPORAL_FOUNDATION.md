# MM-0 — Mixed-media domain + temporal foundation

## Goal

Create the additive domain foundation for:

- mixed photo/video Memories;
- immutable first publication timestamp;
- preserved source publication timestamp;
- future MAX history import.

This task is the contract/schema owner for the mixed-media stage.

## Owner-approved decisions

Implement:

- add `media` to `MemoryKind`;
- `media` allows 1–10 ordered attachments;
- each attachment must be photo or video;
- `note`, `voice`, legacy `photo`, legacy `video` remain valid;
- no mass conversion of legacy Memories;
- add immutable nullable `firstPublishedAt`;
- add nullable immutable `sourcePublishedAt`;
- `occurredAt` remains event time and remains editable under existing rules;
- `firstPublishedOrdinal` remains unchanged and authoritative for unread ordering.

## Migration semantics

### MemoryKind

Additive enum evolution only.

Do not remove or rename legacy values.

### firstPublishedAt

New first publications after migration:
- set once at first transition/publication boundary;
- use DB/service guard consistent with existing `firstPublishedOrdinal` protection.

Existing already-published Memories:
- do not fabricate exact historical timestamps unless fresh code proves `createdAt` is guaranteed to equal first publication;
- default safe migration semantics: leave `NULL`.

Once non-NULL:
- application updates cannot change it;
- retries/idempotent publication cannot assign a later value.

### sourcePublishedAt

- nullable;
- only provider/import pipelines set it;
- normal web-authored Memories may remain NULL;
- once set for a source-derived Memory, ordinary Memory edit cannot modify it.

Do not expose mutation of this field in generic Memory edit API.

## Contract

Add `media` to public `MemoryKind`.

Create contract for `kind=media`:
- `mediaIds`: 1–10 unique UUIDs;
- assets must resolve to `photo | video`;
- ordered array defines attachment order.

Legacy:
- `photo`: retain current accepted behavior;
- `video`: retain current accepted behavior;
- `voice`: retain current accepted behavior;
- `note`: retain current behavior.

DTO should expose:
- `firstPublishedAt: datetime | null`;
- `sourcePublishedAt: datetime | null`;
only if consistent with project API conventions and future consumers.

Do not expose provider secrets/source IDs unnecessarily.

## Repository/service invariants

Publication must validate:
- all media IDs belong to the family;
- all are ready according to existing media pipeline;
- no duplicate media IDs;
- `media` does not accept voice assets;
- ordering is preserved in `MemoryMedia.position`.

Do not create a second attachment table.

## Publication timing

At first publication:
- allocate existing `firstPublishedOrdinal`;
- set `firstPublishedAt` in the same logical first-publication boundary/transaction.

Retries must not move either first-publication value.

## Source timing

Provide an internal path/field in source publisher input to set `sourcePublishedAt`.

Existing live MAX mapping already derives source event time from provider timestamp; adapt source publication plumbing without changing user-editable `occurredAt` semantics.

## Compatibility

Prove:
- all legacy photo/video/note/voice DTOs still parse;
- old photo albums continue;
- old single-video Memories continue;
- unread/seen semantics unchanged;
- cursors/filtering remain valid when `kind=media` appears.

If list filter accepts kind, `media` must be supported without breaking existing kinds.

## Tests

At minimum:

1. migration adds `media` and temporal fields;
2. legacy rows survive;
3. old published rows follow documented `firstPublishedAt` migration semantics;
4. new first publication sets ordinal + timestamp exactly once;
5. retry does not move timestamp;
6. edit `occurredAt` does not change `firstPublishedAt`;
7. ordinary update cannot change `sourcePublishedAt`;
8. `media` accepts ordered photo/video;
9. `media` rejects voice;
10. rejects duplicate IDs;
11. rejects foreign/unready media;
12. max 10;
13. legacy photo/video contracts unchanged;
14. unread remains one Memory unit.

## Scope exclusions

Do not implement:
- carousel UI;
- unified web composer;
- MAX historical importer;
- stories;
- production deploy.

## Review focus

Luna High:
- enum migration safety;
- first-publication race/idempotency;
- temporal semantics;
- legacy compatibility;
- no fake timestamp backfill;
- security/family media ownership;
- no unread regression.

## Completion

Follow `04_GLOBAL_AGENT_RULES.md`.

Final HANDOFF title:

`HANDOFF — MM-0 MIXED MEDIA DOMAIN + TEMPORAL FOUNDATION`
