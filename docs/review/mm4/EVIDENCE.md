# MM-4 integration evidence

Task: MM-4, Mixed Media final integration. Base: `e6d027425f03f06c6e539ccb2302bc637b5cce75`. All data and media in these checks are synthetic. No production deployment, migration, or data access was performed.

## Cross-boundary paths

| Path | Evidence | Result |
| --- | --- | --- |
| Web composer → upload/finalize → create → real Feed API → carousel/viewer | `webapp/e2e/specs/mm1-mixed-composer.spec.ts` | One `media` Memory and one card for photo A, video B, photo C, video D; selection order equals `MemoryMedia.position`, Feed DTO order, and carousel order. Shared author, caption, date, likes, and actions. Ready protected video playback returns HTTP 200/206. Viewer opens video at index 2, moves to photo at index 3, and restores focus on close. |
| Web two-item and reordered upload completion | `webapp/tests/photo-composer.test.tsx` and existing MM-1 tests | One photo + video creates one `media` request. Existing delayed-upload tests retain selection order. |
| MAX source → private transfer → publish → real Feed service → seen | `backend/src/modules/max/capture.integration.test.ts` | One alternating four-item source creates one Memory, four ordered attachments, and one Feed DTO. Duplicate delivery retains the source/Memory/asset counts, order, target family/child, and one seen row. The MM-2 suite additionally covers two-item and two-photo/two-video forms, later transfer failure, retry, and incomplete/changed source plans. |
| Temporal publication | Web E2E, MAX integration, upgrade integration | Web source time is null and selected event time survives; MAX source and initial event time equal provider time; publication time and ordinal are set once. MAX event-time edit preserves source/publication/ordinal. Database guard rejects missing or changed publication metadata. |
| Seen and unread | MAX integration, `webapp/e2e/feed.spec.ts`, existing unread integration | One Memory is one unread row/ack identity. Active photo and video preview readiness, 1000 ms dwell, slide-switch reset, server ack, and stable B6 card behavior are browser exercised. Remaining slides need not be visited. |
| Pending video completion | `webapp/e2e/feed.spec.ts` and `webapp/tests/feed.test.tsx` | A published pending video polls its authenticated Memory detail and becomes playable in the same mounted card after the rendition is ready. Automatic polling is capped at three pending Memories and finite attempts; other pending videos have a manual check. Browser tests confirm an unchanged card node and Feed order, a ready viewer after a later Feed refetch, and manual readiness for a fourth pending video. The pending check itself does not replace the Feed list. |
| Legacy Feed | `backend/src/modules/memories/memories.integration.test.ts` | Note, single photo, photo album, video, and voice serialize through the actual Feed/detail contract while historical `firstPublishedAt` remains null. |
| Populated DB upgrade | `backend/scripts/mm4-upgrade.integration.test.ts` | Isolated database receives all pre-MM migrations and five historical records, then deploys MM-0 and MM-2 in order. Historical rows and null publication time remain valid; new `media` publication and MAX `video` attachment enum work. |

## Visual evidence

Synthetic browser captures from the real Web publication and Feed path:

- [Web-created carousel, photo active](web-created-feed-photo.png)
- [Web-created carousel, ready video active](web-created-feed-video.png)
- [Mixed viewer, photo at nonzero index](web-created-viewer-photo.png)
- [Mixed viewer, ready video at nonzero index](web-created-viewer-video.png)
- [Mixed card under persisted lavender theme](mixed-feed-theme-lavender.png)

The Playwright tests also inspect 320, 390, and 430 px widths, all six Settings themes (`mint`, `rose`, `sky`, `lavender`, `apricot`, `sand`) after reload, horizontal overflow, carousel labels and keyboard focus. Browser checks are not physical iPhone, installed PWA, or live MAX device acceptance.

## Release boundary

The affected migration order is `20260928100000_mm0_domain_temporal_foundation` followed by `20260928130000_mm2_max_mixed_video_attachment`. Neither was applied to production during MM-4. Existing historical published rows legitimately keep `firstPublishedAt = NULL`; new publications require both first publication time and B4 ordinal. After the MM-0 database guard is applied, blindly rolling back to an older publisher runtime is unsafe because that runtime does not set the new publication invariant. Release should advance with a compatible runtime or a tested forward fix; restoring a database backup may lose intervening records and requires separate production authorization.
