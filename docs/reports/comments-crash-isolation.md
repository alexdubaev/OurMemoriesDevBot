# MEMOLY-COMMENTS-CRASH-ISOLATION

Result: the reported React crash was not reproduced. Exact publication/release status is recorded in the PR and final handoff. Investigation of repeated React fallback on iPhone iOS 18.7 in MAX.

## Source and production identity

- Requested known source: `dc3201096998f366a88a296d13914abf6047604b` (#200).
- Fresh fetched base: `f6abc66089962764385802d7045cd694f1993993` (#203).
- Task branch: `fix/comments-crash-isolation`; task worktree: `D:/codex/TG_OurMemoriesDevBot/worktrees/comments-crash-isolation`.
- Read-only host verification: checkout and running static OCI revision both `f6abc66089962764385802d7045cd694f1993993`.
- Public HTML on 2026-10-22: `/assets/index-BhFHYc-A.js`, downloaded SHA256 `b06ae0aa9368f66868c159d1c8f0a3803d97a9f6454c58a7f64b73833bf968ad`.
- Reported failed run used `index-cKHmDYFR.js`. It is a different artifact. Current request to that asset path returns the HTML SPA fallback, not JavaScript. No claim is made about which artifact was served when that failure happened or remained loaded on the phone.
- Between requested SHA and fresh base, `webapp/src` differs only in four avatar-resource-pool lines: timer defaults now call globalThis.setTimeout/clearTimeout instead of capturing those functions directly. Comments/feed/StartupBoundary source is unchanged. No avatar changes are part of this task.

## Evidence before changes

`bun test ./webapp/tests/comments-state.test.ts ./webapp/tests/comments-scope.test.tsx ./webapp/tests/pwa-diagnostics.test.ts`: exit 0, 29 pass, 0 fail, 144 assertions.

Source inspection establishes that summaries are enabled independently of panel visibility. Memory IDs are grouped by 50 and supplied to one `useQueries` call. That dynamic array is not itself a conditional hook call. Panel mounts only when its scoped selection is current and feed active. Its visibility/network/focus/history listeners and polling have cleanup paths. Feed and panel use shared avatar providers; their intersection and an ESM barrel cycle are hypotheses without crash evidence, not reasons for changes.

`StartupErrorBoundary.componentDidCatch` currently drops the exception and component stack and records only `react-boundary`. This explains why that diagnostic path can yield `error:null`; it does not explain the original exception.

## Comparative reproduction

The isolated harness uses real production FeedPage with synthetic transport/data. Test-only Vite substitutions keep each variant separate and hooks unconditional:

| Variant | Summaries requests | Panel | Current comparative finding |
| --- | --- | --- | --- |
| A | Real hook, enabled | Real | No React crash in completed optimized Chromium/WebKit runs |
| B | Disabled test-only hook substitute | Real | No React crash in completed optimized Chromium/WebKit runs |
| C | Real hook, enabled | No mount | No React crash in completed optimized Chromium/WebKit runs |
| D | Disabled | No mount; entry removed | No React crash in completed optimized Chromium/WebKit runs |

Chromium dev and production-optimized preview each passed 4/4 variants. The optimized test build inherits production strict execution order and React/TanStack/vendor chunk groups. Long-feed target is 130 synthetic records, crossing the 50/100-ID grouping boundaries. A/B also exercise opening, sending, closing, rapid reopening, simulated offline/online and visibility/focus changes. All variants exercise active transitions, feed reordering, query removal/clear and scoped family/account/epoch changes. React 19 root caught/uncaught callbacks collect synthetic exception/stack evidence locally; no original application exception was captured.

The first full-depth WebKit attempt failed a test-driver assertion (expected exactly 40 records while 130 were already loaded), not a React exception. An earlier reduced two-page WebKit pass is not counted as full-depth evidence. Closure: optimized preview WebKit passed all four 130-record variants plus two StartupBoundary checks (6/6); optimized preview Chromium passed 6/6. After a final sanitizer-only privacy tightening and rebuild, WebKit boundary checks passed 2/2. No physical iPhone/MAX run was performed.

The transport is synthetic, not an integration test against the production API. A-D verify playback progress for one local H.264 fixture; they do not establish every real user media format, native background/network transition, or behavior under iOS WebView process pressure. Existing media journeys are complementary evidence, not proof that a real MAX/iPhone incident is fixed.

## Minimal diagnostic change

Because no original crash was reproduced, comments/feed/media/cache/avatars remain unchanged. The only product change forwards caught React errors plus component-stack input to the existing allowlist sanitizer. The stored shape remains an allowlisted error class and at most four public bundle basenames/line/column coordinates. No error.message, props, comment content, raw stacks, URLs or tokens are stored. Diagnostics failures cannot replace the existing fallback screen. This closes an evidence gap; it is not a root-cause fix.

Lead narrow check after that change: `bun test ./webapp/tests/pwa-diagnostics.test.ts ./webapp/tests/comments-state.test.ts ./webapp/tests/comments-scope.test.tsx`: exit 0, 31 pass, 0 fail, 156 assertions. Typecheck passed. Lint passed with one pre-existing auth/provider.tsx dependency warning. Exact-SHA gate results, PR/merge SHA and any deployment are recorded separately in the PR and final handoff.

## Release and data boundaries

No production DB, backend, migration, MAX API or ACL changes. No speculative media/cache/avatar fix. No experimental production deployment. Applicable local risk gate, one fresh independent review, publication SHA/PR and any guarded release will be recorded after completion.


## Reproduction commands (PowerShell)

From repository root, install only frozen dependencies with `bun install --frozen-lockfile`. Existing `bun run --cwd backend prisma:generate` may be needed for e2e TypeScript imports; it generates an ignored client without connecting to a database.

```powershell
bun test ./webapp/tests/pwa-diagnostics.test.ts ./webapp/tests/comments-state.test.ts ./webapp/tests/comments-scope.test.tsx
bun run typecheck:webapp
bun run lint
Push-Location webapp
bunx vite build --config e2e/comments-crash.vite.config.ts
Pop-Location
$env:COMMENTS_CRASH_PREVIEW='1'
$env:COMMENTS_CRASH_WEBKIT='1'
$env:E2E_WEB_PORT='5218'
bun run --cwd webapp e2e -- --config e2e/comments-crash.playwright.config.ts
Remove-Item Env:COMMENTS_CRASH_WEBKIT
$env:E2E_WEB_PORT='5219'
bun run --cwd webapp e2e -- --config e2e/comments-crash.playwright.config.ts
Remove-Item Env:COMMENTS_CRASH_PREVIEW
Remove-Item Env:E2E_WEB_PORT
```

Build output is isolated under `webapp/e2e/.artifacts/comments-crash-dist`; the normal product build does not import the variants. The intentionally thrown TypeError is a synthetic diagnostic regression fixture, not the original iPhone failure.

## Owner check after a successful diagnostic release

Reopen the MAX Mini App to load the new artifact and confirm its reported build is the newly released bundle. Scroll multiple feed pages; swipe photo/video, open/close comments, send one comment, return from background, change Wi-Fi/mobile network, and reopen comments quickly. If the fallback returns, use **Скопировать отчёт об ошибке** before retrying. Preserve that report and note the immediately preceding action. Do not clear app storage before copying it. A new error class/coordinates may locate the exception; successful desktop tests do not establish that the phone crash is fixed.

## Independent review

One fresh reviewer found a P2 acceptance gap: the first A-D fixture did not include usable carousel media. The lead confirmed it is within the assigned scope and requested one bounded test-only correction using existing local media fixtures. The bounded fix adds the same usable photo/video carousel to A-D: physical swipe, ready poster, real fullscreen viewer, Play, decoded aspect ratio and currentTime progress. Optimized Chromium and WebKit each passed 6/6 (four comparative scenarios plus two boundary checks). WebKit native media requests are served by exact-fixture-only, range-aware middleware in the test preview configuration. The same reviewer closed the P2 after inspecting the fix and running the media A scenario on optimized Chromium and WebKit; no material findings remain. The reviewer also tightened the A baseline to import the unqueried production FeedPage module and verified that sending a comment actually reaches the synthetic POST transport. No product comments or media fix was requested by the review.
