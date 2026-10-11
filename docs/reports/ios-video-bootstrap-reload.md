# FIX-IOS-VIDEO-BOOTSTRAP

Status: REVIEW; mandatory local release gate and integration pending. Lead: GPT-6; worker and independent reviewer: gpt-6-luna. Branch `fix/ios-video-bootstrap-reload`; worktree `.worktrees/ios-video-bootstrap-reload`. Base SHA `f712f20c36d36ec29b95a3ec25db759db64710b1`. Production changes are limited to `webapp/src/features/feed/FeedPage.tsx`. Probe and output are ignored artifacts under `webapp/e2e/.artifacts/`.

Release gate: APPROVED. Single documented command `bun run verify:local` passed all 16 stages, 658 Bun tests and 3 Chromium critical journeys (661 total), exit 0. Verified source SHA `c9415ed389387e2c76908079851f4e5b5c9803fe`, exact Git tree `2bb2c7e631111c692d6d76bc0bdff01e63fb7dcd`. Run used the existing Linux runtime/browser/package cache and isolated real test PostgreSQL; Prisma generation resolved the initial checkout's missing generated client. Evidence remains in ignored `webapp/e2e/.artifacts/video-jitter-verify-local-linux.log`. This gate-evidence update is documentation only; unchanged product tests are not repeated. Before publishing, compare product diff with the verified source and confirm the accepted squash tree.

## Findings

The initial source held one measured `{attachmentId, ratio}`. When selecting another attachment without DTO dimensions, its full-width stage used 16:9 while awaiting the intrinsic poster/video dimensions. The actual `FeedPage` probe reproduced a repeated height and scroll shift with a synthetic portrait photo and MAX poster, without pressing play:

- At 390×844, stage width was 346 px. Loaded portrait photo and decoded poster were 235×374, producing a 550.64 px stage.
- RED assertion required stage height to remain stable across selection, delayed poster load/decode, return, and revisit. It failed: unknown MAX video started at 16:9 (194.63 px), then became 235/374 (550.64 px), a 356.02 px height change. Revisiting it reset to 16:9 again. One load transition moved `scrollY` from 937 to 1013 (+76 px); stage top moved from 208.88 to 132.88 px. The active video stayed paused (`videoWidth=0`); it was never played.
- React root remained connected and pathname stayed `/blank.html` throughout. This establishes a layout/scroll bug independently of the reported white bootstrap. It does not establish a WebKit process termination, automatic reload, or that this change fixes the bootstrap display.
- Valid DTO comparison declared 235×374 on both attachments. Stage stayed 550.64 px through loading, decode, return, and revisit; comparison passed.

The focused probe uses actual `FeedPage`, a synthetic authenticated DTO/transport, and a delayed synthetic portrait poster. The lead independently inspected and reran the final harness: it advances the focused carousel with ArrowRight/ArrowLeft. Initial focus scrolls the card into view; that focus movement is distinct from the measured stage-height change. Physical iPhone touch behavior is not covered. Current stable-height assertion failed before the production change and passes afterward. No private recording or frames were used.

## Change

`FeedPage` now seeds a bounded per-attachment aspect map from valid DTO dimensions and records measured natural ratios by attachment ID. The stage preserves the last known aspect while a newly active null-dimension attachment waits for its poster/video dimensions, then uses that attachment's natural ratio. Revisited media reuse their cached ratio. Width remains full card width and no fixed height, crop, or letterbox was introduced.

## Verification

- `bunx playwright test --config e2e/.artifacts/ios-video-bootstrap-probe.config.ts` (from `webapp/`): pass, 1 focused scenario; RED stable-height assertion failed before the fix and passed after.
- Valid DTO comparison in the same harness: pass, stage height remained 550.64 px.
- `bunx eslint src/features/feed/FeedPage.tsx`: pass.
- `bunx tsc --noEmit -p tsconfig.app.json`: pass.
- `bun run typecheck`: blocked by existing missing `backend/src/generated/prisma/client` and resulting backend/E2E type errors; no FeedPage diagnostics. The source-only webapp typecheck passed.
- `git diff --check`: pass.

Lead focused rerun: 1/1 Chromium scenario passed, exit 0, 6.0 seconds. All five lifecycle samples retained 550.64 px stage height. Poster decode retained scrollY=999; later selection sampled 995, so no zero-scroll-change claim is made.

Independent reviewer `video_carousel_jitter_review`: no confirmed P0/P1/P2 findings; no edits or repeated tests. Only one independent review was run under the owner's lean verification policy.

Playwright's Chromium run logs a Vite HMR WebSocket local-network-access warning; the probe and assertions still pass. Existing locked dependencies were installed in the isolated worktree; no new dependency or runtime tool was added. No schema, contract, storage, or data changes. White bootstrap cause remains unknown. Publication and guarded manual deployment follow the owner's standing authorization once the local gate passes. Existing immutable-image rollback remains available; database rollback is not part of this UI task.
