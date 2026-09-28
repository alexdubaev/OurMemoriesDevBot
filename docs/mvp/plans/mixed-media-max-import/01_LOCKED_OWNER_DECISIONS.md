# Locked owner decisions

These decisions are approved for this project stage. Agents must not repeatedly ask the owner to reconfirm them.

## Product model

### One source post = one Memory

For a mixed media post:

- photo;
- photo;
- video;
- video;

the target is **one memoLy Memory**, not several independent Memories.

One Memory owns:

- one author;
- one caption/body;
- one event time;
- one like state/counter;
- one unread/seen identity;
- one delete/edit lifecycle.

### Mixed carousel

A Memory may contain an ordered mix of:

- photo;
- video.

Example:

`photo → video → photo → video`

Attachment order is significant and must be preserved.

### Memory kind evolution

Preferred additive evolution:

- preserve existing `note`, `photo`, `video`, `voice`;
- add a new neutral `media` Memory kind for new mixed photo/video Memories;
- do not reinterpret `photo` to secretly contain videos;
- do not mass-convert old `photo`/`video` Memories merely for consistency.

Old Memories remain valid.

Presentation can normalize:

- legacy photo;
- legacy video;
- new media;

through shared media presentation components.

### Carousel engine

Do not build low-level swipe physics from scratch.

Preferred approach:

- use Embla Carousel / React integration for drag/swipe/snap/active index;
- memoLy owns visuals, media lifecycle, data model, accessibility, counters, fullscreen behavior, and business rules;
- carousel library must not leak into domain models.

An agent may choose a different established library only if a fresh technical audit proves it materially safer/better for the current repo and records the reason. This is not an invitation to redesign.

### Limits

For the first mixed-media implementation:

- target max ordered attachments: 10 total;
- allowed mixed attachment kinds: photo and video only;
- `voice` remains its own Memory kind;
- `note` remains its own Memory kind.

Do not add audio+photo/video mixed posts in this stage.

## Temporal semantics

memoLy is a memory timeline, not merely a social feed.

Different times must remain distinct.

### `occurredAt`

Means: when the remembered event happened.

- user-editable under existing Memory edit rules;
- historical MAX import defaults it from original MAX publication time;
- later the user may correct it without erasing source history.

Used for future:

- “On this day”;
- year/month filters;
- stories by event date;
- child age/time views;
- event grouping.

### `firstPublishedAt`

Add an explicit immutable first-publication timestamp for Memory.

Meaning:

- when this Memory first became published in memoLy.

It must be set exactly once at the first publication boundary, alongside the existing first-publication semantics.

Editing caption, `occurredAt`, media order, etc. must not change it.

Do not fake exact historical values if current data cannot prove them.

Existing legacy published records may remain `NULL` unless a current-code invariant proves a safe exact backfill. Do not invent precision.

### `firstPublishedOrdinal`

Existing B4 semantics remain authoritative for unread/order boundary.

Do not replace it with timestamps.

`firstPublishedAt` and `firstPublishedOrdinal` serve different purposes.

### `sourcePublishedAt`

For imported/provider-sourced history, preserve the original provider publication time separately.

For MAX history:

- MAX message timestamp → `sourcePublishedAt`;
- initial `occurredAt` → same source time by default;
- `firstPublishedAt` → when memoLy first publishes the imported Memory.

If a user later edits `occurredAt`, `sourcePublishedAt` does not change.

### Time precision/timezone

Persist absolute instants in the existing timestamptz/ISO semantics.

Do not strip timezone or reduce to date-only storage.

Presentation may localize later.

## MAX history import

### Import shape

One historical MAX channel post becomes one Memory.

Preserve:

- source message identity;
- original publication timestamp;
- source attachment order;
- source caption/text;
- media types;
- source provider metadata required for idempotency/resume.

### Idempotency

Re-running the same import must not create duplicate Memories or duplicate media.

Provider source identity must be durable.

Do not dedupe by caption/time heuristics.

### Resume/retry

Historical import must be resumable and bounded.

Network/provider failures must not require restarting the whole channel import from zero.

### Access

Historical channel import is an explicit administrative/product action, not automatic background scraping.

Use existing MAX authentication/provider conventions.

Do not introduce insecure tokens into public DTOs/logs.

### Family/child targeting

Import must have an explicit target family and child/context before writing Memories.

Do not guess an arbitrary family.

If current product flow cannot resolve the target unambiguously, implement a deliberate selection step using existing family context patterns.

Do not silently import into “first family”.

### Existing data

No destructive rewrite of existing Memories to support import.

## Feed behavior

### One carousel Memory = one unread/seen unit

The Memory, not each slide, is the unread/seen unit.

### Seen readiness

Reuse B6 semantics.

For a mixed carousel:

- only the currently active slide is relevant to media readiness;
- if active slide is a photo: require successful image readiness;
- if active slide is video: poster/preview readiness is sufficient; playback is not required;
- existing 1000 ms + viewport threshold semantics remain;
- switching active slide resets an uncompleted timer;
- once the Memory is server-acknowledged seen, changing slides cannot “unsee” it.

Do not require the user to swipe through every attachment before the Memory can be seen.

### Video lifecycle

- no autoplay by default merely because a slide became active;
- if video is playing and user swipes away, pause/stop the departed video;
- avoid multiple simultaneous video playback;
- do not preload all full videos.

### Indicator

Carousel should provide a clear current/total indicator, e.g. `2 / 4`.
Dots are optional if visually useful, but do not create clutter for 10 items.

### Vertical feed scroll

Horizontal carousel gestures must not break vertical feed scrolling.

## Future stories

Stories are **not** implemented in this task pack.

The temporal/media foundation must make them easy later.

Do not create a stories subsystem now.
