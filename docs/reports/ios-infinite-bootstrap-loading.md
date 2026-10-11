# FIX-IOS-INFINITE-BOOTSTRAP-LOADING

Task assigned by owner on 2026-10-03. Lead: GPT-6. Discovery/implementation/review role metadata is recorded in the task's orchestration calls.

- Base: `a7bb1e715a6e4f2858f217d0d2b6d0ffeea4f086`.
- Branch: `fix/ios-infinite-bootstrap-loading`.
- Isolated worktree: `OurMemoriesDevBot/.worktrees/ios-infinite-bootstrap-loading`.
- Scope: frontend startup HTML, React mounting/recovery, bounded bootstrap JSON/storage operations, focused tests. No backend, contracts, schema, migrations, media pipelines or unrelated UI changes.

## Production evidence and limits

The owner confirmed that both 2026-10-03 incidents (07:24 and 09:33 MSK) were launches from the iPhone home-screen PWA icon. The literal `Загрузка memoLy…` belongs to the static HTML root before React mounts. The React preloader instead contains the local logo and animated dots.

Read-only production investigation used the exact 04:19–04:29 UTC and 06:28–06:38 UTC windows. Release history identifies `5fff01da41ae1b30d61caabf2a9dfb58bf08a86d` as the last deployment before the first incident; its application containers have since been recreated, so their logs are unavailable. During the second window, static/backend/worker/scheduler were all `a7bb1e715a6e4f2858f217d0d2b6d0ffeea4f086`, started at 05:54:40–45 UTC. No release/restart occurred in that second window.

There is no complete access log or client bootstrap telemetry. Available second-window logs contain 13 MAX media download error stack instances and 14 incomplete media-response gateway warnings from an iPhone Safari-compatible user agent. They describe media operations and do not identify the stalled bootstrap. Auth/session/family request status, latency, request-start/completion pairs, or the exact historical failed resource cannot be established. Header evidence alone cannot distinguish PWA from Safari/WebView; PWA context comes directly from the owner.

## Deterministic failure boundary

An isolated Playwright experiment loaded the unchanged production HTML/bundles, mocked every API call with synthetic responses, and kept `https://rsms.me/inter/inter.css` pending. In both Chromium and WebKit, the root remained exactly `Загрузка memoLy…`, document ready state remained `loading`, and no auth request started. Releasing the stylesheet allowed React to mount and auth requests to start.

The optional third-party stylesheet precedes the classic parser-blocking host selector. Its non-completion blocks script execution and completion of parsing/module startup. Thus React never replaces the static root, and the HTML has no failure/recovery transition. This is a proven cause of the identical symptom in the owner-confirmed ordinary/PWA launch path. It does not prove that this particular resource failed in either historical incident.

The committed regression was observed RED on the base: both browser projects failed the assertion that the static loader becomes hidden while the font stylesheet is held. Existing scoped startup baseline: 17 tests passed across five files, 58 assertions, exit 0; worker auth baseline: 22 passed, 67 assertions, exit 0.

## Cache and version investigation

The current index responds `200 text/html`, `Cache-Control: no-cache`; current fingerprinted JS/CSS responds with correct MIME and immutable caching. The private-media service worker does not serve the HTML or JS shell. Older `5fff01d` hashed asset URLs now receive SPA HTML fallback from the current deployment, so a stale shell/chunk mismatch is another reproducible pre-mount failure. Its occurrence in the incidents is unproven. The fix does not change cache headers or service-worker caching policy; it supplies bounded recovery for shell/module failures.

## Delivery verification

Implementation, final test counts, independent findings, reconciliation, and release results are recorded below after actual verification. Physical iPhone acceptance remains the owner's final step; Playwright WebKit is not a physical iPhone PASS.

## Startup transitions and implementation

| Boundary | Pending / success | Error, cancellation, retry |
| --- | --- | --- |
| HTML → JS module | Static literal until React commit | Early resource/runtime/rejection handler; 20 s mount guard; reload button; failed attempt cannot mount late |
| Selected host SDK | Async load, then hostReady and bridge.ready | 10 s SDK deadline/error; stays in recoverable shell state, never switches selected MAX/Telegram to browser auth |
| Cookie restore | Shared refresh, then verified current user | 15 s lock acquisition and scoped HTTP/body deadlines; shared refresh cleared in finally; 401 uses existing session expiration path |
| Current user | Query until verified /me | networkMode always, one bounded retry; error → recoverable session view, Retry refetches or restores session |
| Private cache | Hydration only after current user is verified | 3 s native IDB operation deadlines, 5 s optional hydration limit; late connection closes and identity/generation checks protect writes |
| Welcome / Family | Existing welcome and family routing | Scoped initial JSON deadlines; existing recoverable request UI; unrelated media transfers keep their original lifecycle |
| React render | Root commits application providers | React error boundary provides recovery; pre-mount async exceptions report only a safe category |

The remote Inter stylesheet is now optional asynchronous CSS, removing it from the parser/script critical path. Host selection precedence and signed-auth handling remain covered by the existing MAX/Telegram tests. No cache header, service-worker policy, auth contract, dependency, schema or migration changes are introduced by this task. Optional private-cache failure may skip hydration, but it never skips authentication.

Observability is limited to safe console startup failure categories. There is no existing client telemetry ingestion architecture; no new provider or endpoint was introduced. Historical client runtime SHA/step durations remain unavailable. Background/foreground is not established as the cause, and no speculative page-lifecycle hooks were added.

Actual lead checks on the implementation before main reconciliation: full webapp 458 passed / 0 failed, 3196 assertions, 73 files; all-workspace typecheck, lint, production webapp build, architecture (747 source files), template check and 2 build-contract tests exit 0. Dedicated browser matrix passed 24 tests (12 Chromium, 12 WebKit), including held CSS, failed module, held/delayed MAX SDK, cold/warm PWA, failed/held/aborted refresh, expired session, retry and Feed/Family navigation. The independent-review host retry finding was closed before delivery.

Independent review: GPT-6 Luna reviewer (high, role dispatch), read-only active diff; P0=0, P1=0, P2=1 fixed. The P2 was a missing host-auth reset on the shared session-error retry. The bounded fix and regression (cookie refresh 503 + first MAX exchange 503 → Retry → second MAX exchange succeeds) passed in Chromium and WebKit; the reviewer confirmed the code/test diff in a single narrow recheck. No unresolved P0/P1/P2.

Synthetic WebKit screenshots: [normal PWA Family](../review/FIX_IOS_INFINITE_BOOTSTRAP_LOADING/pwa-family.png) and [recoverable session error](../review/FIX_IOS_INFINITE_BOOTSTRAP_LOADING/recoverable-error.png). These contain no production user data and are browser-emulation evidence only.

Lead final complete browser rerun after the review fix: 26 passed (13 Chromium, 13 WebKit), exit 0, including the combined cookie/MAX retry regression.

Fresh-main reconciliation: merged `3bac37c7199aba6c39d340ef1e588318964bf8c8` without conflicts, preserving poster #153 and all prior fixes. Task diff against reconciled main remains frontend/tests/report only. Relevant checks rerun after reconciliation: 460 webapp tests / 0 failed, 3206 assertions, 73 files; 26 browser tests (13 Chromium + 13 WebKit); all-workspace typecheck, lint, webapp production build, architecture (798 source files), template and 2 build-contract tests exit 0. No migration is needed for this task; the separate poster release completed before this release. Required CI, merge/deploy SHAs and post-deploy health are recorded in the task's final handoff.
Initial required CI exposed a test-only lifecycle error: a scheduled React Query notification ran after the test browser shim was removed. The provider harness now owns/clears QueryClients and drains queued notifications before restoring globals. Isolated harness repeated 25 times and full webapp suite passed; production code and browser regression results are unchanged.
