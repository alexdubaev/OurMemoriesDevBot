# MM-1 — Web composer mixed photo/video Memory

Depends on: **MM-0 merged**

May run in parallel with: MM-2, MM-3.

## Goal

Allow a web/PWA user with existing publishing permission to create one `kind=media` Memory containing an ordered mix of photos and videos.

Example:

`photo, video, photo, video`

→ one Memory.

## Core rules

- 1–10 total attachments;
- photo + video only;
- preserve user-selected order;
- one caption/body;
- one `occurredAt`;
- one idempotency key / one Memory publication;
- reuse existing photo/video media upload pipelines;
- do not create a second storage/upload architecture.

## UX

Create a unified media composer entry or extend current composer cleanly.

User must be able to:
- select multiple supported photos/videos;
- see ordered previews;
- remove an item before publish;
- reorder only if a simple accessible implementation already fits current UI; otherwise preserve picker order and do not invent drag-and-drop scope;
- see per-item upload/processing state;
- retry failed transfer where existing media upload patterns support it;
- publish once all required assets are ready.

Do not make the carousel engine part of composer state architecture.

## Existing legacy flows

Do not regress:
- photo-only compose;
- video-only compose;
- note;
- voice.

It is acceptable for new mixed selection to use `kind=media` while old dedicated one-type composers remain intact initially.

Avoid unnecessary broad composer redesign.

## Video constraints

Use current actual video validation/limits.

Do not invent new codec/size/duration rules.

If a mixed selection contains a video that existing web upload pipeline cannot support, show the existing-style error rather than silently dropping it.

## Time

`occurredAt` remains the event date/time chosen by user/current flow.

`sourcePublishedAt` remains null for normal web-created Memory.

## Tests

Minimum:
- photo+video creates one `media` request;
- order preserved;
- two photos + two videos;
- 10 total accepted;
- 11 rejected;
- unsupported/failed item blocks publication appropriately;
- remove an item updates order;
- duplicate upload result not duplicated;
- one idempotency key per publication;
- legacy photo-only and video-only flows remain green;
- permissions unchanged.

## E2E

At least:
- create 4-slide mixed Memory;
- open resulting Feed;
- verify attachment order via DTO/UI;
- no duplicate Memory.

## Scope exclusions

Do not:
- implement MAX history import;
- change schema/contracts owned by MM-0 except bounded bug fix;
- redesign Feed carousel (MM-3 owns it);
- deploy production.

## Completion

Follow `04_GLOBAL_AGENT_RULES.md`.

Final HANDOFF title:

`HANDOFF — MM-1 WEB MIXED MEDIA COMPOSER`
