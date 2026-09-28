# MM-3 — Feed mixed photo/video carousel

Depends on: **MM-0 merged**

May run in parallel with: MM-1, MM-2.

## Goal

Render `kind=media` as an Instagram-style horizontal swipe carousel inside the existing production Feed.

Legacy photo/video Memories must continue to work.

## Carousel engine

Preferred:
**Embla Carousel with React integration**.

Before adding:
- check fresh package.json/lockfile;
- verify current stable compatible package;
- verify license;
- avoid duplicate carousel dependency if repo already gained an equivalent accepted engine.

Do not implement custom gesture physics unless an established engine is demonstrably unusable.

Embla owns:
- drag/swipe;
- snap;
- selected index;
- resize/reinit lifecycle.

memoLy owns:
- slide content;
- media privacy/auth;
- video playback;
- counters;
- fullscreen/detail;
- seen readiness;
- styles/accessibility.

## Feed UX

One Memory card contains:
- one media viewport;
- horizontally swipable slides;
- clear `current / total` indicator when total > 1;
- existing author/date/caption/like controls once per Memory.

No duplicated author/like/caption per slide.

Keep existing card aspect/source-ratio rules unless mixed presentation requires a narrow compatible wrapper.

## Gestures

- horizontal swipe switches slides;
- vertical page scroll remains natural;
- pinch zoom/fullscreen behavior should not be broken;
- no accidental feed navigation from minor horizontal drift.

Use appropriate `touch-action`/library patterns rather than custom pointer hacks.

## Video lifecycle

- no forced autoplay;
- active video uses existing player/presentation;
- when slide loses active status, pause/stop playback;
- never allow several carousel videos to keep playing simultaneously;
- do not preload every full video;
- previews/posters may preload according to existing policy.

## Seen/unread

One Memory = one seen unit.

Reuse B6 observer criteria.

For not-yet-seen carousel Memory:
- readiness follows active slide;
- photo active slide requires loaded/decoded main image;
- video active slide requires ready poster/preview; playback not required;
- slide switch before 1000 ms resets the candidate timer;
- blocking overlay/background semantics remain;
- once server seen ack succeeds, no further slide behavior changes seen state.

Do not require all slides to be viewed.

## Fullscreen/detail

Opening from slide N should open the corresponding media item/context.

Target behavior:
- mixed gallery supports photo and video order;
- current index preserved when entering fullscreen/detail;
- returning to Feed preserves carousel position where practical;
- video stops appropriately on close/switch.

Do not force PhotoSwipe to handle unsupported video in an unsafe hack. Reuse it where appropriate or introduce a small mixed viewer wrapper around existing photo/video components.

## Legacy normalization

Prefer one shared media presentation layer:
- legacy photo → one/many photo slides;
- legacy video → one video slide;
- media → ordered mixed slides.

Do not mass-migrate old rows.

## Accessibility

- carousel has accessible group/position semantics;
- keyboard controls where applicable;
- no hidden duplicate focus targets;
- indicator announced sensibly, not noisily;
- video controls remain operable;
- reduced motion respected;
- no focus trap.

## Responsive

At minimum:
- 320×568
- 390×844
- 430×932
- wider tablet sanity

Six memoLy themes must remain usable.

## Tests

Minimum:
- mixed 4 slides correct order;
- swipe index;
- indicator;
- vertical scrolling unaffected;
- video pause on slide change;
- only one video playing;
- active slide readiness feeds seen observer correctly;
- slide change resets uncompleted seen timer;
- already-seen stable;
- fullscreen starts on active index;
- legacy photo album unchanged;
- legacy single video unchanged;
- protected media errors/retry unchanged;
- unread Feed card does not disappear under finger.

## Evidence

Capture representative screenshots/frame evidence:
- mixed photo slide;
- mixed video slide;
- indicator;
- narrow viewport;
- at least representative theme set plus automated six-theme sanity.

## Scope exclusions

No schema/contract changes except bounded MM-0 defect fix.
No MAX history import.
No production deploy.

## Completion

Follow `04_GLOBAL_AGENT_RULES.md`.

Final HANDOFF title:

`HANDOFF — MM-3 FEED MIXED MEDIA CAROUSEL`
