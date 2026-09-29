# INT-1 — Media flow reconciliation

Depends on CAR-1 + PERF-1 + MAX-1 merged.

## Goal
Prove one coherent MVP media system.

## Scenario A — photo-only from app
1. Select 5 photos.
2. Progress visible.
3. Upload complete.
4. One Memory.
5. MAX backup exists.
6. Feed 5-slide swipe carousel.
7. Viewer selected index.
8. No duplicate re-ingestion from backup.

## Scenario B — mixed from app
1. photo→video→photo.
2. Progress visible.
3. Different transports allowed internally.
4. One Memory.
5. Exact order.
6. MAX representation/refs correct.
7. Stable Feed geometry.
8. Neutral video pending.
9. Ready appears in place.
10. Non-first-slide video works.

## Scenario C — live MAX input
1. Supported multi-attachment live post.
2. One Memory.
3. No duplicate.
4. Exact order.
5. Same Feed carousel.
6. Seen/unread one Memory unit.

## Cross-checks
- one Memory = one like/caption/date/edit/delete lifecycle;
- no backup→live feedback loop;
- processing ≠ upload failure;
- parallel upload does not reorder;
- photo-only presentation parity;
- legacy single-photo/video/note/voice playback preserved.

## Performance evidence
- confirm PERF-1 timings;
- no obvious MAX backup regression;
- bounded readiness polling;
- no repeated per-slide provider resolution.

## Visual evidence
- photo-only carousel;
- mixed photo;
- mixed video pending;
- mixed video ready;
- return to photo same geometry;
- viewer photo/video;
- progress UI.

## Final status
`READY_FOR_MEDIA_POLISH_PRODUCTION_DEPLOY`

Do not deploy automatically.
Do not start T10.
