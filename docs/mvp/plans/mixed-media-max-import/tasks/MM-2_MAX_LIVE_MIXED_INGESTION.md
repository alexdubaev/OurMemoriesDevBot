# MM-2 — MAX live mixed photo/video ingestion

Depends on: **MM-0 merged**

May run in parallel with: MM-1, MM-3.

## Goal

When a newly received MAX message contains an ordered mix of photos and videos, publish it as exactly one `kind=media` Memory.

Example source order:

1. photo
2. photo
3. video
4. video

Target:
one Memory with four ordered attachments.

## Reuse current MAX source infrastructure

Prefer existing:
- MaxInbox;
- MaxSource;
- MaxSourceAttachment;
- durable provider identity;
- plannedMemoryId;
- family/child target logic from B3;
- current image/video resolution/download infrastructure;
- existing locking/idempotency conventions.

Do not create a parallel “mixed MAX source” table if current source/attachments can model it safely.

## Source identity

One MAX provider message:
- exactly one source identity;
- exactly one Memory;
- retries/redelivery cannot produce another Memory.

Attachment provider IDs and positions remain durable.

## Caption/text

One source message caption/body becomes one Memory body.

Do not duplicate caption across pseudo-Memories.

## Source time

MAX provider timestamp:
- preserve as `sourcePublishedAt`;
- initialize `occurredAt` from it for this source-created Memory unless current live ingestion has a stronger approved event-time rule;
- memoLy `firstPublishedAt` is assigned only at memoLy publication boundary.

## Mixed video storage/reference

Fresh code must determine whether current MAX videos are:
- private-storage assets;
- provider-backed references;
- or both depending on path.

Implement mixed Memory attachments without exposing provider secrets.

If current `MaxVideoReference` has a one-reference-per-Memory uniqueness that prevents multiple videos in one Memory, this is an expected schema/domain consequence of mixed media and must be handled safely within the MM-0/MM-2 approved direction.

Do not silently fall back to splitting one source post into multiple Memories.

If fresh code proves a deeper provider limitation that makes one-Memory multi-video impossible without a new security architecture, escalate with evidence.

## Permission/revocation

Preserve B3:
- no arbitrary family;
- wrong-user choice rejected;
- viewer/non-publisher cannot publish;
- revoke before publication rejects instead of redirecting.

## Failure/retry

No partial published Memory containing only some source attachments.

A source may remain processing/failed/resumable according to current patterns, but publication must be coherent.

Redelivery/retry must continue same source/Memory plan.

## Tests

Minimum:
- two photos + two videos → one Memory;
- alternating photo/video order;
- body preserved once;
- provider timestamp preserved;
- duplicate webhook/redelivery → one Memory;
- mid-attachment transient failure resumes;
- permanent invalid attachment → deterministic failure, no partial publish;
- target family immutable;
- revoke race safe;
- multiple videos in one source handled;
- legacy photo-only MAX still works;
- legacy single-video MAX still works.

## Scope exclusions

No historical channel traversal/import UI.
This task handles live/new MAX messages only.

No Feed UI redesign.

No production deploy.

## Completion

Follow `04_GLOBAL_AGENT_RULES.md`.

Final HANDOFF title:

`HANDOFF — MM-2 MAX LIVE MIXED MEDIA INGESTION`
