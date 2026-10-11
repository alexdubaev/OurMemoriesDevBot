# FIX-V2-CAROUSEL — implementation brief

Status: APPROVED locally; not published or deployed. Base/live SHA 5908b00f6c98827c4ab2dc783414a76e0ae6f4cf. Branch fix/v2-carousel-layout, worktree .worktrees/v2-carousel-layout. Lead: GPT-6; delegated discovery/implementation/review.

Owner requirements: restore the old working mixed photo/video carousel behavior. Both photos and videos fill card width with height following their natural proportions, without cropping, distortion, or a small image inside a fixed frame. Apply this to single-media and carousel cards. Carousel navigation is a compact single row of dots beneath media, without previous/next arrow buttons. Restore visible photo/video content in the currently blank mixed-media card. Preserve MAX video routing and existing resource release on inactive feed.

Read-only scout located the minimal source in FeedPage.tsx and presentation/memoly-feed.css. V2 photo CSS explicitly uses object-fit:cover. V2 mixed-card rules replace aspect ratios with auto and use percentage heights through nested wrappers; browser measurements must distinguish collapsed geometry from media request failure before implementation. User's latest no-crop decision overrides the old design.md cover requirement.

Plan: reproduce with real FeedPage, full production feed CSS and V2 root, using synthetic authenticated fixtures. Record media decode/network state and bounding boxes. Establish failing rendered behavior, then repair V2 media sizing and replace feed arrows with compact dot indicators and focused-root keyboard navigation. Keep carousel selected index, swipe, pause-on-leave, cached feed pages, viewer index and URL cleanup. Do not broaden to upload/storage/MAX/backend changes.

Allowed product paths: webapp/src/features/feed/FeedPage.tsx; webapp/src/features/feed/presentation/memoly-feed.css. A short meaningful existing browser scenario may be extended, or one focused fixture regression added if necessary; no large visual matrices or source-text assertions. Report and ignored diagnostic screenshots/scripts are permitted. Dependency/schema/contracts/production configuration changes are forbidden.

Acceptance: loaded image/video or its genuine readiness/error state is inside a nonzero visible stage; photo and video occupy full available width and retain natural aspect ratio; dot row is compact, does not wrap, and sits below media inside the card; no previous/next feed arrows; single attachment has no unnecessary dots. Preserve the old mixed-media switching, viewer selection, swipe, and pause behavior. Focused carousel keyboard navigation must not intercept video-control events. Returning to feed preserves selected slide. Maintain hidden feed resource release and no-autoplay. Use one targeted mobile viewport and synthetic content; do not assert physical iPhone behavior from Chromium alone. Inspect diagnostic screenshots internally; do not present colored fixture rectangles as the product interface.

Checks: focused actual-source browser reproduction before/after, webapp typecheck/lint, git diff --check; independent review plus bounded closure as owner policy requires. Full bun run verify:local only before main publication; existing prepared persistent Linux environment can be reused without downloading runtimes/browser again. No deployment performed by this task yet.

Stop/escalate if blank content is caused by auth/server/API rather than layout, or if the fix requires changing shared contracts, media storage, release configuration or data. Return measured evidence and ask lead to adjudicate scope.

## Result and verification

Compared the legacy carousel at ee2b25d3151afb88394687a20d3ec38bd1adbb4a. Preserved Embla selection, swipe, adjacent-photo/active-video mounting, viewer opening, video pause and inactive-feed cleanup. Removed V2 fixed-ratio/cropping overrides; V2 uses the selected attachment's natural ratio, with narrowly scoped load/metadata fallback when dimensions are missing. The legacy 4:5 carousel geometry remains unchanged. Dots are compact indicators below media; focused-root arrow keys supplement swiping without intercepting video controls.

Lead independently verified the final source:

- `bun run typecheck:webapp`: exit 0.
- `bun run lint`: exit 0.
- From webapp, `bunx playwright test --config=e2e/.artifacts/v2-carousel-probe.config.ts --reporter=list`: 1/1 passed, 7.6 seconds, exit 0.
- `git diff --check`: exit 0.

Actual V2 portrait photo: native 235x374, rendered 346x550.64. Landscape photo: native 104x66, rendered 346x219.56. Real synthetic private video: native 120x214, loaded metadata and proportional stage; play and pause on slide change verified. Single photo/video sizing, no autoplay, compact dots, mouse swipe, keyboard switching, MAX poster loading, retained selected index after hide/return and blob release verified. Viewer interaction was preserved by inspection, not exercised in this probe.

Fresh independent reviewer completed one review with bounded closures. Confirmed poster fallback issues and a legacy viewport ratio regression were fixed; lead inspected the actual final diff and reran the focused browser check. No unresolved confirmed P0/P1/P2 remains. No migrations, contracts, dependencies, uploads, storage, backend or production configuration changed.

Screenshots are local ignored artifacts: `webapp/e2e/.artifacts/v2-carousel-after.png` and `v2-carousel-video-after.png`. The probe mocks the playback-session response and disables the service worker; it verifies rendered components and real video decoding/playback, not production authentication or physical iPhone behavior. Full `bun run verify:local` has not been run for this task; it remains required before publication to main. PR: not published. Deployment: not performed.
