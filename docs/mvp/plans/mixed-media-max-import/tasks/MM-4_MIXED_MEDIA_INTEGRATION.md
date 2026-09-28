# MM-4 — Mixed-media integration reconciliation

**Status: COMPLETE.** Mixed-media MM-0…MM-4 is complete. Historical MAX import is a separate `DEFERRED_POST_MVP` stage; see [the post-MVP roadmap](../POST_MVP_MAX_HISTORICAL_IMPORT.md).

Depends on:
- MM-0 merged
- MM-1 merged
- MM-2 merged
- MM-3 merged

## Goal

Reconcile the three parallel mixed-media implementation lanes on fresh main and prove the stage works end-to-end before historical import starts.

## Required scenarios

### Web-created

Create:
- photo;
- video;
- photo;
- video;

as one Memory.

Verify:
- one Memory;
- order exact;
- one caption;
- one like identity;
- one unread/seen identity;
- Feed carousel works;
- detail/fullscreen works.

### MAX live

Receive one MAX mixed post.

Verify:
- one MaxSource/provider identity;
- one Memory;
- same attachment order;
- sourcePublishedAt preserved;
- occurredAt initial value correct;
- firstPublishedAt set at memoLy publication;
- retry/redelivery does not duplicate.

### Legacy

Verify unchanged:
- old photo album;
- old single photo;
- old single video;
- voice;
- note;
- Telegram current flows;
- private/protected media;
- B6 unread/seen;
- “Показать новые”.

## Temporal proof

Create/import a Memory with known times and assert:

- `sourcePublishedAt = provider source time`;
- `occurredAt` initially matches source time for MAX;
- `firstPublishedAt = memoLy publish time`;
- edit `occurredAt`;
- sourcePublishedAt unchanged;
- firstPublishedAt unchanged.

## Concurrency/idempotency

Targeted integration for:
- duplicate publish request;
- duplicate MAX update;
- attachment processing retry;
- seen during carousel interactions;
- delete/edit of mixed Memory.

## Performance

Check:
- no eager full-download of all videos;
- carousel does not add feed-wide video listener/timer storms;
- pagination DTO size reasonable;
- no N+1 provider/media metadata fetch.

Do not prematurely micro-optimize.

## Luna review

One independent final mixed-media review:
- domain compatibility;
- security;
- media privacy;
- ordering;
- time semantics;
- idempotency;
- carousel lifecycle;
- old flow regressions.

P0/P1/P2 = 0 before merge.

## Output

Merge any bounded integration fixes through a normal PR.

After MM-4, the mixed-media foundation is available for a later historical MAX import. That work remains deferred until after MVP and requires the HI-0 provider/architecture gate.

No production deploy in this task unless separately authorized.

Final HANDOFF title:

`HANDOFF — MM-4 MIXED MEDIA INTEGRATION COMPLETE`
