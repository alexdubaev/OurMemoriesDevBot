# Release and owner acceptance

After INT-1 merge:
- separate production deploy;
- inspect fresh main, production revisions and migrations;
- use guarded runbook;
- minimal health/log smoke;
- no synthetic production content unless separately authorized.

## Owner real-device acceptance on iPhone/MAX

### Carousel
1. 5 photos.
2. Swipe in Feed.
3. Open photo 3 fullscreen.
4. Return.
5. Photo + video + photo.
6. Swipe photo→video→photo.
7. No card-height jump.
8. No large blank region.
9. Video same Feed-stage size as photos.
10. Fullscreen/detail on tap.

### Readiness
11. Publish mixed Memory.
12. Open Feed immediately.
13. If MAX still processing: neutral processing state.
14. It becomes playable in place.

### Progress/performance
15. Upload 5 photos.
16. Real progress visible.
17. Upload photo+video+photo.
18. Progress understandable.
19. Compare perceived time with old behavior.
20. Capture safe stage timings if still slow.

### MAX backup
21. Create photo-only album.
22. Confirm MAX backup/provider representation.
23. Create mixed Memory.
24. Confirm provider representation/order.
25. Retry/reopen does not duplicate provider post.

### Live MAX input
26. Send supported multi-attachment live MAX post.
27. Confirm one Memory in Feed.
28. Confirm order/carousel.

Telegram is excluded.

Stage COMPLETE only after:
- CAR-1/PERF-1/MAX-1/INT-1 merged;
- deploy successful;
- owner real-device PASS.
