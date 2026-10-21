# memoLy frontend test audit

Base: `dc3201096998f366a88a296d13914abf6047604b`
Branch: `test/full-suite-audit`

## Browser portfolio

The MAX Playwright profile now discovers 36 scenarios across 7 spec files: comments and comments state (22), browser-link authentication (2), functional v4 navigation/profile/crop/viewer (8), voice playback (1), video lifecycle/privacy resource bounds (1), and MAX family scope/revocation (2). The family browser scenarios retain the browser-only stale-response and revoke/rejoin protections. API-heavy comment ACL, family isolation, and pagination setup was removed from the browser flow; those contracts are exercised by backend PostgreSQL integration tests.

The profile includes `comments.spec.ts`, `comments-state.spec.ts`, `max-browser-link.spec.ts`, `memoly-v4.spec.ts`, `voice-player.spec.ts`, `video-lifecycle.spec.ts`, and only the two tagged journeys in `max-family-audit.max-e2e.ts`. It avoids the broad legacy family audit and the PWA watchdog diagnostics spec. Private Service Worker behavior remains covered by `private-media-sw.test.ts` and cache units.

## Refactored checks

- Comment browser coverage is centered on create retry, edit, cancel/delete, draft retention, conflict handling, open/close, and access changes. The six-theme/three-width footer matrix and the large browser-side real-API ACL/pagination scenario were removed; database-backed API coverage remains in backend integration tests.
- The v4 browser spec now checks navigation, allowed family actions by role, profile editing and crop entry/return, viewer attachment navigation and recovery, cached-slide navigation, and AddSheet focus wrapping, Escape focus restoration, and browser Back. Geometry, screenshot, exact visual sizing, and decorative asset path checks were removed.
- Voice and video browser coverage retains playback/seek/replay/owner switching, private source release, and a bounded attached-video resource check. Waveform/layout matrices, fixed text, screenshots, and arbitrary sleep assertions were removed or replaced by observable events.
- Long-press behavior advances a scoped Playwright clock and still checks the actual menu/reaction/input/link outcomes. Queue, touch-guard, private-cache, and PWA journal units now synchronize on controlled callbacks, worker messages, or store transitions instead of wall-clock polling.
- The inactive-detail playback regression now activates a different feed owner before unmounting the inactive detail. The private-cache scope regression uses valid family UUIDs and a valid deferred response body to prove an in-flight private response is rejected after a family switch. The MAX auth race mock no longer implements the stale-result guard itself.
- Header tests no longer require six fixed illustration paths. The landing-page secondary action keeps URL validation and link behavior without pinning button copy.

## Retired visual-only suites

Removed the five disconnected Playwright visual suites and their configs, along with the obsolete welcome parity HTML fixture and contrast baseline. Their useful AddSheet focus, Escape/focus-return, browser Back, family selection/return, and role behavior are represented by compact functional browser checks or the existing MAX family browser journeys. No frontend production source changed.

## E2E database safety

E2E port planning and global startup use the shared strict loopback test-database guard before Docker, Prisma, or app-server startup. Skip-Docker mode requires an explicit test URL; mismatched URLs, remote hosts, and connection-routing overrides are rejected. The separate MAX family server applies the same integration database guard before creating its Prisma client. Browser tests use a unique local `*_test` database and do not target external accounts.

## Verification

- Focused frontend unit command: 36 passed, 0 failed across 7 files (including auth race, playback, private cache, PWA journal, queue timing, touch guard, and E2E DB guard).
- `bun test website/tests/landing.test.ts`: 4 passed, 0 failed.
- `bun run --cwd webapp typecheck`: passed, including the E2E Playwright config TypeScript project.
- `bunx playwright test --config webapp/playwright.max.config.ts --list`: discovered 36 scenarios in 7 files. This is discovery only; no browser execution result is claimed here. The lead is running the real MAX browser portfolio on the isolated local PostgreSQL environment.
- Comparable before/after runtime measurements were not available, so no suite speedup is claimed.
