# CAR-1 — Feed: единая карусель photo-only + mixed и стабильная video geometry

## Goal
Сделать один presentation path для multi-photo и mixed Memories в Feed.

## Scope
Primary:
- Feed presentation;
- Embla;
- legacy photo album normalization;
- media-stage layout;
- video pending/ready/unavailable;
- viewer selected-index;
- CSS/accessibility/responsive.

Avoid:
- upload orchestration;
- MAX backup writes.

## Requirements
1. Reuse existing Embla.
2. `kind=photo` with 2–10 attachments swipes in Feed.
3. Single photo may be non-scrollable but uses compatible geometry.
4. `kind=media` and multi-photo share the same media-stage where practical.
5. Outer stage height does not follow active video's intrinsic height.
6. Video/poster fits same Feed-stage box as photo.
7. Fullscreen/detail only on explicit action.
8. Return from video to photo restores identical geometry.
9. Remove nested video card/frame styling; provider controls live inside slide.
10. Pending MAX-video shows neutral processing state.
11. Ready replaces pending in place.
12. Permanent unavailable distinct.
13. Preserve no-autoplay, pause-on-leave, one seen unit, selected-index viewer, vertical scroll.

## Readiness polling
- bounded;
- no offscreen storm;
- no endless high-frequency polling.

## Accessibility
- inactive slides not focusable;
- counter accessible;
- viewer focus restore;
- keyboard web behavior;
- reduced motion.

## Tests
- 5-photo swipe;
- 10-photo swipe;
- exact order;
- photo→video→photo stable height;
- pending→ready;
- no false failure;
- viewer slide N;
- video pause;
- vertical scroll;
- 320/390/430 px;
- current theme set.

## Handoff
Include:
- root cause of photo-only/mixed divergence;
- component consolidation;
- geometry rule;
- readiness state machine;
- tests/evidence;
- Luna result;
- deploy NOT performed.
