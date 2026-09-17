# Task 5 report — responsive regression gate

- Task: 5
- Base SHA: `69841c4cb630076c0b04b4f2d2c43e71bae54e3d`
- Head SHA: `9e8a3f05680ae4e196fa9bed84c56b7cc86fb3ff`
- Worktree: `D:\codex\TG_OurMemoriesDevBot\worktrees\memoly-ui-integration`
- Branch: `feat/memoly-ui-integration`
- Allowed implementation paths: `webapp/e2e/feed.spec.ts`, `webapp/tests/mini-app-viewport.test.ts`, and the required navigation test hook in `webapp/src/components/BottomNavigation.tsx`

## RED

- `bun run --cwd webapp e2e -- feed.spec.ts` — **fail (exit 1)**. The existing first fixture rendered, then auth bootstrap timed out in `beforeEach` while waiting for the `Лента` button. This is the known E2E auth environment failure, not a presentation failure.
- `bun test webapp/tests/mini-app-viewport.test.ts` before the hook implementation — **fail (exit 1)**. The new acceptance assertion correctly failed because `BottomNavigation` had no `data-testid="bottom-navigation"`.
- `bun run --cwd webapp e2e -- feed.spec.ts -g "feed is usable at 320px"` before the hook implementation — **fail (exit 1)** at the same auth bootstrap wait, before the selector assertion.

## GREEN / verification

- `bun test webapp/tests/mini-app-viewport.test.ts` — **pass (exit 0)**, 3 tests / 14 assertions.
- `bun run typecheck:webapp` — **pass (exit 0)**.
- `bunx eslint webapp/e2e/feed.spec.ts webapp/tests/mini-app-viewport.test.ts webapp/src/components/BottomNavigation.tsx` — **pass (exit 0)**.
- `bun run build:webapp` — **pass (exit 0)**.
- `bun run test:webapp` — **pass (exit 0)**, 211 tests / 1,228 assertions.
- `bun run lint` — **fail (exit 1)** on pre-existing `webapp/src/features/feed/FeedPage.tsx:281` (`react-hooks/set-state-in-effect`) and `:315` (`react-refresh/only-export-components`). No changed-file lint errors were found by the targeted command above.

## Browser width and stacking evidence

Each focused command below was run independently; each was **environment-blocked before rendering** by the auth bootstrap timeout at `feed.spec.ts:78`, so no width reached the new presentation assertions or produced a successful Task 5 screenshot:

- `bun run --cwd webapp e2e -- feed.spec.ts -g "feed is usable at 320px"` — blocked, exit 1.
- `bun run --cwd webapp e2e -- feed.spec.ts -g "feed is usable at 390px"` — blocked, exit 1.
- `bun run --cwd webapp e2e -- feed.spec.ts -g "feed is usable at 430px"` — blocked, exit 1.
- `bun run --cwd webapp e2e -- feed.spec.ts -g "feed is usable at 480px"` — blocked, exit 1.
- `bun run --cwd webapp e2e -- feed.spec.ts -g "keeps card video overlays below navigation"` — blocked, exit 1.
- Required final command `bun run --cwd webapp e2e -- feed.spec.ts specs/family.spec.ts` — fail, exit 1: the 320px setup failed at auth; 390/430/480 and subsequent feed checks were skipped by the serial suite, and two family tests separately timed out waiting for Telegram auth exchange.

The failed browser runs generated Playwright screenshots, videos, traces, and error contexts under `webapp/e2e/.artifacts/test-results/`, including `feed-T07-live-feed-feed-is-usable-at-320px-chromium`, `...390px...`, `...430px...`, `...480px...`, and `feed-T07-live-feed-keeps-c...fullscreen-media-covers-it-chromium`. No successful width screenshots were produced because authentication never reached the feed.

## Change summary

The acceptance matrix now checks 320/390/430/480 CSS px at 844px height, fixed bottom navigation bounds, normalized bottom safe inset, feed content clearance, and navigation/media/fullscreen z-order. Production behavior changed only by adding the requested stable `data-testid` to the existing bottom navigation; existing `z-30`, host inset, and PhotoSwipe precedence remain unchanged.

## Final correction wave (base `9e8a3f05680ae4e196fa9bed84c56b7cc86fb3ff`)

- Scope: `webapp/src/features/memoly-ui/AddSheetPresentation.tsx`, `add-sheet-back.ts`, `FeedPresentation.tsx`, `memoly-ui.css`, plus focused tests in `webapp/tests/design-system.test.tsx`, `feed.test.tsx`, and `memoly-ui-adapters.test.ts`.
- RED: `bun test tests/design-system.test.tsx tests/feed.test.tsx tests/memoly-ui-adapters.test.ts` — **fail (exit 1)** before the fixes: no `subscribeAddSheetBack` export, no `line-clamp-4` card class, and no narrow-caption/gutter CSS assertions satisfied.
- Fix: production Add Sheet now registers the existing `hostBridge.onBack` only while the full sheet is open, cleans it up on effect teardown, and routes host Back through the existing history-back close path. Card captions retain `white-space: pre-wrap`, add `overflow-wrap: anywhere`, and clamp the presentation to 4 lines while preserving the original body in the existing detail callback input. Feed/family presentation removes duplicate horizontal padding and the narrow-screen child margin override so FeedShell/FamilyScreen own the outer gutter.
- GREEN: `bun test tests/design-system.test.tsx tests/feed.test.tsx tests/memoly-ui-adapters.test.ts` — **pass (exit 0)**, 47 tests / 214 assertions.
- GREEN: `bun test tests` — **pass (exit 0)**, 214 tests / 1,239 assertions.
- GREEN: `bun run typecheck` — **pass (exit 0)**.
- GREEN: `bun run build` — **pass (exit 0)**.
- GREEN: `bunx eslint src/features/memoly-ui/AddSheetPresentation.tsx src/features/memoly-ui/FeedPresentation.tsx src/features/memoly-ui/add-sheet-back.ts tests/design-system.test.tsx tests/feed.test.tsx tests/memoly-ui-adapters.test.ts` — **pass (exit 0)**.
- `git diff --check` — **pass (exit 0)**. No backend/API/contracts/Prisma/storage/media-pipeline paths changed; no auth, permissions, family isolation, or media URL behavior changed.
