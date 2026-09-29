# Current baseline

## Уже реализовано
### Domain
- `MemoryKind.media`;
- 1–10 ordered photo/video;
- `MemoryMedia.position`;
- `occurredAt`;
- `sourcePublishedAt`;
- `firstPublishedAt`;
- `firstPublishedOrdinal`.

### Web/PWA create
- mixed photo/video → one Memory;
- selection order preserved;
- partial failure does not publish incomplete Memory;
- retry/idempotency protections.

### MAX live mixed ingestion
- one live source post → one Memory;
- exact provider order;
- provider identity/dedupe;
- sourcePublishedAt from provider time;
- family/child target stability.

### Feed mixed carousel
- Embla;
- mixed swipe;
- active index/counter;
- no autoplay;
- pause/stop departed video;
- mixed viewer;
- one Memory = one seen/unread unit.

### Current video transport
- canonical MAX direct-video path;
- `250_000_000` bytes limit;
- mixed video uses existing MAX Reserve/Upload/Finalize;
- photos use private media path.

## Real-device issues still open
1. Photo-only album:
   - no Feed swipe;
   - viewer only.

2. Mixed geometry:
   - video changes height;
   - returning to photo can leave enlarged viewport/blank area;
   - nested frames.

3. Video transition/readiness:
   - intermediate compact state;
   - later expansion;
   - failure-like state before video becomes playable.

4. Upload UX:
   - indeterminate spinner;
   - no percentage.

5. Performance:
   - multi-file upload feels slow;
   - prior implementation used sequential upload for safety;
   - bottleneck not yet measured.

6. MAX backup:
   - photo-only album created in memoLy does not appear in MAX backup/provider destination as expected.

## Distinction
Current/live MAX ingestion and backup are MVP.
Old-history import/synchronization is post-MVP.
