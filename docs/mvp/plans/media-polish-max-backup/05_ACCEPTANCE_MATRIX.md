# Acceptance matrix

## Photo-only carousel
- 2 photos swipe in Feed.
- 5 photos exact order.
- 10 photos exact order.
- tap slide N opens viewer at N.
- return preserves Feed position.
- same media-stage concept as mixed.

## Mixed geometry
- photo→video→photo outer height stable.
- no blank enlarged region after returning to photo.
- video/poster same Feed-stage size as photo.
- fullscreen/detail by explicit action.
- no nested frame-inside-frame.
- vertical scroll works.
- horizontal swipe works.
- no autoplay.
- pause/stop departed video.

## Video readiness
- processing is neutral.
- processing is not upload failure.
- ready updates in place.
- polling bounded.
- permanent unavailable distinct.
- other slides remain usable.

## Upload progress
- single file percentage where bytes exposed.
- multiple files aggregate progress and understandable file count/state.
- 100% upload transitions to processing if needed.
- retry does not redo finalized work unnecessarily.
- progress never >100%.
- cancel remains correct.

## Performance
- timing evidence for validation/reserve/upload/finalize/provider-processing/create.
- no unnecessary serial waits without reason.
- bounded parallelism preserves order.
- partial failure no incomplete Memory.
- retry/idempotency one Memory.
- no unbounded provider-rate burst.
- no redundant full-file expensive work.

## MAX backup
- 1 photo → MAX backup.
- 5-photo album → MAX backup with all 5.
- 10-photo album remains one logical Memory/provider post.
- mixed exact order.
- retry no duplicate provider post.
- provider refs durable.
- photo originals remain private-storage assets.
- delete/edit follow current policy; no invented provider revocation guarantee.

## Live MAX → memoLy regression
- live photo works.
- live video works.
- 5 photos + 3 videos in one supported source post → one Memory.
- exact provider order.
- duplicate delivery → one Memory.
- sourcePublishedAt/occurredAt correct.
- Feed uses same carousel.

## Not required
- Telegram.
- historical MAX import.
- history pagination/checkpoints.
- Stories.
