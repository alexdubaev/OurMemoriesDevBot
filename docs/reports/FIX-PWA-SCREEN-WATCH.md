# FIX-PWA-INTERFACE-LOSS/WATCH

The owner explicitly requested a detector of the post-mount initial HTML loading screen and expanded diagnostics. This implements a tested observer, not a claimed fix for the physical iPhone failure.

- Branch: `fix/pwa-screen-watch`.
- Worktree: `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/pwa-crash-diagnostics`.
- Base: `e602080057f7012ba3f64b817cc51a14ce500171`.
- Implementation delegated to the existing Luna worker; independent review requested through fresh ephemeral Codex CLI `gpt-6-luna`, reasoning high, service tier default, read-only. The CLI log confirms model/reasoning; provider-side billing tier is not independently verified.

## Behavior and boundaries

After `mounted`, observe missing/empty root or the exact initial `p[role=status]` loading paragraph. Valid root replacement is a separate observation. Initial startup and hidden/background state do not themselves constitute screen loss. A lightweight visible heartbeat records the last observed and last healthy root times. One incident is pinned independently of the rotating current/previous sessions and flushed immediately. Document/build/run identity, safe OS/version/standalone, auth/cache transitions and sanitized same-origin script frames are exported by the existing report action in Settings → About memoLy.

No automatic reload, recovery, artificial action delay, backend ingestion, database/ACL/contracts, Telegram, media storage or product layout changes. Records remain local on the device and bounded; raw error messages, arbitrary exception names, tokens, user content, full URLs and query/hash values are not exported.

If JavaScript stops executing, the observer cannot report its own termination. An unclosed prior run or observation gap is retained as evidence without classifying it as a crash, OOM or document reload. This feature cannot alone distinguish every native WebKit presentation/process failure.

## Actual checks before review closure

- Baseline with base bootstrap and the same new behavioral test harness: `bun test ./.scratch/pwa-screen-watch-base.test.ts`, exit1,6 pass/6 fail. The new watch/state/error expectations fail on the old implementation. The initial command without the explicit `./` prefix discovered no tests and is not counted as a baseline result.
- Updated bootstrap: `bun test webapp/tests/pwa-diagnostics.test.ts`, exit0,12 pass/0 fail,71 assertions.
- Worker `bun run --cwd webapp typecheck`, exit0.
- Worker `bun run --cwd webapp e2e e2e/pwa-screen-watch.spec.ts --project=chromium`, one scenario passed. This uses the actual anonymous application, no Telegram authentication: wait for mount, replace root contents with the exact loading paragraph, assert durable incident before calling report, then controlled test-only reload and assert retained incident. The test is a deliberate DOM-loss trigger, not a reproduction of the physical iPhone cause.
- Lead `bunx playwright test --config .scratch/pwa-screen-watch-webkit.config.ts`, exit0,1 pass,14.7s total. Same native MutationObserver/whole-app scenario in desktop WebKit,390×844; not physical iOS acceptance. Unique Compose `memoly-screen-watch-d588c968`, teardown completed.
- `git diff --check`, exit0.

Evidence: ignored `.scratch/pwa-screen-watch-baseline.log`, `.scratch/pwa-screen-watch-unit.log`, `.scratch/pwa-screen-watch-webkit.log`, browser trace output and `.scratch/pwa-screen-watch-review.txt`.

## Independent review and bounded closure

The one independent reviewer raised two P2 observations. The unbounded numeric version input allowing duplication over8KiB is confirmed and assigned for a bounded fix plus regression. The claim that normal single-child React roots require descendant text traversal is not accurate: the literal check short-circuits unless the child is the status paragraph. Nevertheless the closure additionally narrows mutation relevance and uses a sole text node for the exact placeholder so the observer avoids unnecessary work. No second formal review is required by the owner's policy.

The bounded closure caps version strings at24 characters, narrows mutation relevance before root lookup, and matches only a sole direct text node in the status paragraph. Added a malicious near8KiB legacy-record regression and irrelevant-mutation assertions. Worker closure:13 unit tests/77 assertions, typecheck and the same one Chromium browser scenario passed (13s). The lead inspected the actual diff and these paths. No second formal review was performed.

Lead closure evidence: `bun test webapp/tests/pwa-diagnostics.test.ts`, exit0,13 pass/77 assertions; and `bunx playwright test --config .scratch/pwa-screen-watch-webkit.config.ts`, exit0,1 pass,14.3s after the bounded fixes. Unique Compose `memoly-screen-watch-closure-148ed4dd` was stopped/removed by teardown. Evidence `.scratch/pwa-screen-watch-unit-closure.log` and `.scratch/pwa-screen-watch-webkit-closure.log`. Earlier lint also passed; publication gate will verify final source lint again.

Exact publication source SHA, `bun run verify:local` and release outcome are pending. This report does not assert that the watcher is deployed or that the iPhone failure is fixed.
