# INT-1 browser evidence

All images are synthetic Playwright fixtures. The screenshots show the 390 px viewport; the linked browser tests also assert stage geometry and horizontal overflow at 320, 390, and 430 px.

| State | Screenshot |
| --- | --- |
| Five-photo aggregate upload active | `photo-upload-active-390.png` |
| Upload complete, Memory publication processing | `photo-upload-processing-390.png` |
| Five-photo Feed carousel | `photo-feed-carousel-390.png` |
| Selected photo viewer, slide 3/5 | `photo-selected-viewer-390.png` |
| Mixed Feed photo, slide 1/4 | `mixed-photo-active-390.png` |
| MAX video processing, slide 2/3 | `max-video-processing-390.png` |
| MAX video ready, slide 2/3 | `max-video-ready-390.png` |
| Mixed Feed video ready, slide 2/4 | `mixed-video-ready-390.png` |
| Selected video viewer, slide 2/4 | `mixed-video-selected-viewer-390.png` |
| Photo after returning from video, slide 3/4 | `mixed-photo-after-video-390.png` |
| Selected mixed photo viewer, slide 3/4 | `mixed-photo-selected-viewer-390.png` |

Capture sources: `webapp/e2e/specs/mm1-mixed-composer.spec.ts` and `webapp/e2e/feed.spec.ts`. MAX provider calls in the browser tests use synthetic adapters. Backend database integration tests separately exercise the real Memory, backup, webhook, and Feed paths with synthetic provider responses.
