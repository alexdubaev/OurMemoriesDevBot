# MEMOLY-FIXED-CAROUSEL-AND-FULLSCREEN

Status: REVIEW. Lead: GPT-6; scout/worker/reviewer: delegated agents. Worktree: `.worktrees/pwa-crash-diagnostics`; branch: `fix/memoly-fixed-carousel-fullscreen`. Base: `fe05558bc3c66fe73d0ed34b5d5ae83a9eef4bd9`, fetched from canonical origin on 2026-10-15. Before implementation, the clean Selectel checkout and running backend/static immutable tags matched that SHA. Owner explicitly authorizes PR, squash merge and guarded deployment for this task.

Scope: existing FeedPage mixed carousel, its existing fullscreen viewers and feed CSS; focused synthetic browser fixtures. No changes to single-media dimensions, avatars (#169), MAX single-video fix (#170), backend, data, contracts, private-cache, service worker, navigation or release guards.

Evidence: v2 CSS uses the selected media aspect for viewport geometry; selected-index rendering removes outgoing video content while Embla can still be moving. Existing video clicks play inline and the mixed viewer does not report its index back to the carousel.

Implementation plan:

1. Reproduce fixed-height and transition failures using production FeedPage/UI v2 with synthetic portrait/landscape videos and square/portrait photos.
2. Reserve a single 4:5 window for multiple attachments only. Show contained, centered images/posters against an existing light surface token. Keep bounded preview resources across actual transitions without preloading feed video files or players.
3. Route carousel taps through existing photo/mixed viewers, guard drag clicks, synchronize selection and retain focus/scroll. Keep fullscreen independent of feed aspect and preserve video controls/Back.
4. Run narrow browser/type/build checks, #169/#170 regressions, one fresh independent review and bounded fixes if needed. Run `bun run verify:local` once on final source in the existing native Linux verification runtime, then publish/merge and use `deploy/selectel/README.md` guarded release with migrations disabled and saved immutable rollback.

Acceptance: real drag in both directions with delayed poster/quick reversal; stable viewport/dots/caption, visible outgoing ready media, no selection/metadata reInit, contain geometry, correct photo/video fullscreen, no swipe-induced viewer, synchronized return and no duplicate audio. Desktop results do not certify physical iPhone smoothness; stop after delivery pending owner device acceptance.

Baseline reproduction: the lead served the exact base SHA's `FeedPage.tsx` and CSS through an ignored Vite load plugin, preserving relative imports and the production UI v2 root. The rendered portrait-video carousel measured 360×640 CSS px (height/width 1.7778), failing the required 1.25 ratio. Command: `bun run --cwd webapp e2e --config e2e/.artifacts/fixed-carousel-baseline.config.ts`; 1 failed, exit 1. Evidence: ignored `webapp/e2e/.artifacts/fixed-carousel-baseline.log` and `fixed-carousel-baseline.png`. Initial probe setup lacked the production root wrapper; that setup was corrected before the recorded failing result.

Implementation checks before independent review: lead personally ran webapp typecheck (including E2E types), ESLint and the focused browser scenario: all exit 0, browser 1/1 in 10.0 s. Worker also ran production build and #169/#170 browser regressions, each 1/1 and exit 0. The lead inspected source diff and screenshots. Screenshot inspection identified a possible portrait-poster clipping issue despite the passing CSS/object-fit assertions; independent review must resolve it before acceptance. Browser fixture covers private-storage playback; MAX single-video behavior is checked by #170. Physical iPhone remains unverified.
