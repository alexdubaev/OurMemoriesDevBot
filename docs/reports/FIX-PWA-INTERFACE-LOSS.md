# FIX-PWA-INTERFACE-LOSS

## Scope and execution plan

- Worktree: `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/pwa-crash-diagnostics`
- Branch: `fix/pwa-interface-loss`
- Base and confirmed deployed SHA: `00e1c67ade30d0e26a063caf7fabe81ce3753e2f`
- `origin/main` fetched on 2026-10-11: same SHA; checkout initially clean and detached.
- Allowed edits: the existing real-app browser test `webapp/e2e/critical-smoke.spec.ts`, a bounded observer helper in `webapp/e2e/helpers/`, this report. Production edits require a reproduced mechanism and a separate bounded implementation brief.
- No storage, database schema, ACL, business-flow, dependency, global configuration or deployment changes.

1. Trace initial HTML, root mount, startup boundary, auth bootstrap and private-cache gate. Follow only concrete navigation/loading chains.
2. Exercise the real app and real synthetic backend: rapid family/feed navigation and carousel selection while an operation is outstanding. Run baseline, delayed API, API failure and delayed media separately.
3. Observe new main-document navigation, page crash/error, original root identity, static placeholder, global loading/auth/cache transitions and working controls. Record pending-operation overlap, not only final assertions.
4. If reproduced, first preserve a failing check, then delegate a minimal production fix and repeat that check. Otherwise retain the experiment and state the exact observation gap, without publishing a speculative fix.

## Source evidence

- `webapp/index.html`: the exact text `Загрузка memoLy…` appears only in the initial `#root` HTML. The startup failure handler replaces its contents with an error and manual retry, not this placeholder. `mounted()` clears the startup timer.
- `webapp/src/main.tsx`: one `createRoot`, followed by the startup/auth/cache/app composition. No later root unmount or reset was found in that chain.
- `StartupBoundary`: render failures produce a React error screen. They do not restore the initial HTML.
- `BootPreloader`: post-mount global loading uses `data-slot="app-loading"`, logo and dots; it does not contain the initial HTML text.
- `AuthProvider`: bootstrap/retry and cross-document session storage events can enter global auth loading. Ordinary media/feed requests are not direct bootstrap triggers.
- `PrivateCacheGate`: falls back during auth bootstrap or identity hydration. Hydration has a bounded deadline; ordinary media selection does not change its identity.
- `FamilyController`: welcome/invite gates can show `BootPreloader`; family/feed tabs use local state and keep visited surfaces mounted.
- `FeedPage.showPhoto`: fullscreen photo viewing pushes a same-document history entry and closes it with `history.back()`. This concrete browser traversal is included in the experiment; it is not established as the reported cause.
- `private-media-sw.js`: intercepts private media requests only, not main documents; no client navigation or automatic reload in this chain.

## Baseline

`bun run --cwd webapp e2e --grep 'owner uploads one photo' --project chromium`

Executed from the worktree above on base SHA: exit 0, 1 passed, 42.3 seconds total. Real synthetic authentication, family/feed entry, photo upload/publication and protected image loading succeeded. Docker project was derived from this worktree (`vibecoding-template-606916f8130e`); the test harness stopped and removed its own test database container. No tools were downloaded.

## Experiment results

Cause not established. No production fix was attempted. The persistent whole-interface loss did not reproduce in the checked environment.

The lead personally executed the final revised source:

```powershell
bun run --cwd webapp e2e --grep 'rapid full-app navigation and carousel switching while requests are pending'
```

Explicit execution directory for all commands: the worktree above. Result: **exit 0, 1 passed, 29.8 seconds total / 17.5 seconds test body**. The existing real frontend/backend harness used the isolated synthetic PostgreSQL database and filesystem storage, not a carousel fixture or a production account.

The scenario generates three complete synthetic JPEG photos, each 2048×1536, uploads/publishes them through the app, enters the feed, rapidly switches Family/Feed and advances the actual carousel using keyboard events. It opens/closes the fullscreen photo viewer twice to exercise its history traversal. A second synthetic album forces fresh media requests in the media condition. No crop, product interaction delay, reload recovery, tool download or production data operation was introduced.

Each injected condition is removed before the next one. API conditions intercept only this synthetic family's `/usage` endpoint. API and media requests are held behind a test gate; the experiment records interception, interaction-start and release times. Exact Playwright Request identities correlate response headers with request-finished/requestfailed events. After completion and removal of the injection, every condition performs another Family → Feed navigation to demonstrate continued interaction without restarting.

| Separate condition | Intercepted before interaction | Requests held at release | Actual terminal result |
| --- | ---: | ---: | --- |
| Normal rapid actions / fullscreen open-close | No injected request | 0 | Four same-document main-frame events from two photo viewer cycles; no new document request |
| Delayed family API | 1 | 3 | 3 finished, status 200 |
| Family API failure | 1 | 3 | 3 finished, status 500 |
| Delayed protected photos | 4 | 4 | 9 intercepted total: 4 finished with 200, 5 failed with `net::ERR_ABORTED` during slide changes |

All four conditions: **0 new document navigation requests during the interaction, 0 pageerrors, 0 crashes, original root identity preserved, root connected, feed/navigation present, 0 sampled global loading or initial-placeholder states**. There was one initial document request for the entire scenario. Same-document frame events are recorded separately and do not count as document reloads.

Read-only committed React fiber samples (test-only DevTools observer):

| Condition | Auth/cache committed samples | Auth state throughout samples | Cache state throughout samples |
| --- | ---: | --- | --- |
| Normal | 17 / 17 | bootstrapping=false, authenticated=true, user present | hydrated=true, generation present |
| API delay | 32 / 32 | same | same |
| API 500 | 31 / 31 | same | same |
| Media delay | 14 / 14 | same | same |

Media cancellations are a reproduced request-level outcome, **not an established cause of the reported iPhone screen loss**. The local app remains usable after them and after API 500.

Additional final checks:

- `bun run --cwd webapp tsc --noEmit -p tsconfig.e2e.json`: exit 0.
- `git diff --check`: exit 0.
- Final tested test-file SHA256 (working-file bytes): `F68A48E7E07BEEDC9A5721F0C138FB2EE4CB702B65A1BCE43DC5A4C6C0CFA121`.
- Source HEAD at execution: `00e1c67ade30d0e26a063caf7fabe81ce3753e2f`, with only the new experiment and this report as the task diff; production source unchanged.
- Full final console evidence: `.scratch/pwa-interface-loss-final.log`; machine-readable evidence: `.scratch/interface-loss-experiment.json`. Both are ignored local synthetic artifacts. The Playwright report also includes `interface-loss-experiment.json` as a test attachment, including partial observations and Node-side navigation/error/crash events if the experiment fails.

## Independent review and closure

One fresh reviewer inspected the experiment. Two P2 validity gaps were confirmed: an immediate 500 could precede rapid actions; media interception was checked only after the actions. One bounded fix pass gated the 500, moved pending-media confirmation before interaction, recorded timing and exact request identity, and separated response headers from terminal completion. The final command above is the narrow closure check. No second whole-change review or broad test matrix was run.

During initial harness preparation, two narrow runs failed (exit 1): an assumed card attribute did not exist, then a warm tab did not issue the assumed members request. Both failures were harness assumptions; the visible app remained present. The scenario now uses the real carousel selector and actual family usage requests. Preliminary passing runs (27.0/27.3 seconds) are superseded by the final revised-source run above.

## What is excluded, and the precise remaining gap

Excluded **only for this Chromium/Vite real-app experiment**: these rapid navigation/carousel actions, the tested `/usage` delay/500 and photo-request cancellation did not navigate to a new document, replace the root, enter observed global loading, or prevent continued interaction. No source chain restoring the literal initial placeholder after mounted was found. This does not exclude a different API endpoint, a longer stall, video operations or a different timing on iOS.

The environment is desktop Playwright Chromium, a Vite development frontend and synthetic Telegram authentication. It is not an installed iPhone PWA, the deployed production bundle, MAX browser login, or a physical WebKit/WebContent lifecycle. DOM observations sample every 25 ms and React state observations read committed fibers; they do not establish absence of a sub-sample transient or independently validate every cache-generation comparison. The photos' source dimensions are full-size, but the experiment is not an iPhone memory-pressure measurement.

The missing observation is **at the actual white-screen moment on iPhone**, not another retrospective `previous` snapshot: identity/navigation of the live main document, actual current `#root` contents, and whether its JS execution context still responds. `previous: mounted/active/visible, lastFailure=null` is only the last persisted sample of a prior run. It cannot discriminate a new document that never mounts from an unresponsive/lost browser execution context or a screen that does not reflect the current React DOM. The literal initial placeholder and React BootPreloader are different, so conflating them would select the wrong fix.

No memory shortage, JS freeze, document reload or server fault was established for iPhone. No request to repeat the same JSON or iPhone system analytics was made. Further observation belongs to the live installed-PWA document/runtime boundary; another deployment that only adds event counters would not close this gap.

## Delivery

- Changed paths: `webapp/e2e/critical-smoke.spec.ts`, `docs/reports/FIX-PWA-INTERFACE-LOSS.md`.
- Production files, migrations and contracts: unchanged.
- Model roles: GPT-6 primary; configured Luna scout/worker/reviewer roles. One independent reviewer, one bounded fix pass, one narrow closure run.
- Screenshots: no product UI changes; no successful-run screenshot acceptance claim. Earlier harness failures produced local Playwright traces/snapshots.
- `bun run verify:local`: not run; no production fix or main publication is proposed.
- PR / merge / deployment: **not published**. Confirmed main/deployed SHA remains `00e1c67ade30d0e26a063caf7fabe81ce3753e2f`.
- Acceptance on iPhone remains unverified; this report establishes the local experiment result, not an iPhone fix.

## No-Mac continuation: production WebKit control

The owner has no Mac. No Mac purchase, repeated JSON export or repeat system analytics was requested. The existing Windows environment already had Playwright WebKit; no tools were downloaded. The continuation used the same worktree, task branch and production source (origin/main still `00e1c67ade30d0e26a063caf7fabe81ce3753e2f`). Its baseline local experiment commit was `dddce4b6f1219cc5cdc72a41da99ed6f54104002`.

An ignored `.scratch/playwright.webkit.production.config.ts` derives from the existing Playwright configuration, retaining its isolated real backend/database, replaces Vite dev with a build plus Vite preview through `.scratch/build-preview.mjs`, and selects desktop WebKit 26.5. This is a locally built production frontend, not the deployed artifact or installed iPhone PWA. The runner files are retained as ignored local experiment artifacts; they are not new repository release gates.

The test now records runtime metadata and service-worker controller, observes cache hydration without relying on minified function names, and remembers the discovered cache hook slot so later null states remain observable. API conditions use the real feed `/memories?limit=20` endpoint. A test-dispatched `document.visibilitychange` while visible invokes the existing active FeedPage foreground check. This synthetic event is an explicit setup trigger, not a claim that an actual iPhone background/foreground transition was reproduced. Requests must be captured before rapid actions begin; the pending assertion was retained.

With service workers enabled, ordinary rapid navigation, carousel changes and two fullscreen-photo history cycles completed with the interface intact: no new document request, pageerror, crash, sampled global loading or initial placeholder; original root and working navigation remained. The first production run then failed its API pending assertion (exit 1, 32.3 seconds body); a corrected foreground-request setup also failed that assertion (exit 1, 31.6 seconds body). These are incomplete injected-condition runs, not reproduced product interface failures.

The trace of the latter run shows a matching real GET `/api/v1/families/{synthetic-id}/memories?limit=20` after interception-pattern registration, completing 200 while the route callback never incremented pendingCount. A context-level routing trial also missed the request; its read-only observation identified `private-media-sw.js` as controller. Therefore no delayed/500 API behavior is claimed for the service-worker-controlled WebKit page. An accidentally unfiltered intermediate invocation was interrupted after one unrelated smoke passed; it is not acceptance evidence.

A single separate routing control set `serviceWorkers: 'block'` only in the ignored test config. It used this exact narrow command from the explicit worktree:

```powershell
bun run --cwd webapp e2e --config ../.scratch/playwright.webkit.production.config.ts --grep 'rapid full-app navigation and carousel switching while requests are pending'
```

Worker execution: **exit 0, 1 passed, 47.6 seconds total / 27.7 seconds body**. The lead inspected the actual diff, full result and extracted machine-readable observations. The controller was null in all conditions. No production service worker behavior or code was changed.

| Separate no-SW condition | Pending at interaction start | Still open at release | Actual terminal outcome | Auth/cache samples |
| --- | ---: | ---: | --- | ---: |
| Normal rapid actions / fullscreen viewer | 0 | 0 | Four same-document viewer events | 17 / 17 |
| Delayed feed API | 1 | 1 | One request finished 200 | 34 / 34 |
| Feed API 500 | 1 | 1 | One controlled request finished 500 | 33 / 33 |
| Delayed protected photos | 4 | 4 | Nine intercepted total: four finished 200, five `Load request cancelled` | 9 / 9 |

All four no-SW conditions preserved the original connected root, feed and navigation; recorded 0 new document requests during interaction, 0 pageerrors, 0 crashes, 0 loading/initial-placeholder samples. Auth remained non-bootstrapping/authenticated with a user, and cache samples remained hydrated. The app remained interactive after the 500 and media cancellations.

Blocking service workers made interception work in this environment. This isolates a test-routing limitation; it does not implicate the production service worker in iPhone interface loss. The delayed/error API and delayed-media results here apply only to the no-SW control. Service-worker-controlled API fault injection remains a specific experiment gap, in addition to the missing live installed-iPhone document/root/JS observation described above. The owner does not need a Mac for these completed local checks; physical iPhone acceptance remains unresolved.

Continuation checks and evidence:

- `bun run --cwd webapp tsc --noEmit -p tsconfig.e2e.json`: exit 0.
- `git diff --check`: exit 0.
- Latest tested test-file SHA256: `3A7694284C0282C33E4FD7DC48738E483E0F757B024D4BCCDDC69765120C017A`.
- Ignored logs: `.scratch/pwa-interface-loss-webkit-production-attempt1.log`, `.scratch/pwa-interface-loss-webkit-production-attempt2.log`, `.scratch/pwa-interface-loss-webkit-production-swblocked.log`.
- Lead-extracted JSON: `.scratch/interface-loss-webkit-production-swblocked.json`.
- Changed tracked paths remain only the browser experiment and this report. No new formal review loop or broad test matrix; the earlier independent review is historical, not a claim of a fresh review of this continuation.
- No production fix, PR, merge, `verify:local` or deploy. Main/deploy remains `00e1c67ade30d0e26a063caf7fabe81ce3753e2f`; the iPhone cause and acceptance criterion remain unestablished.

The lead also reran the updated scenario through the default Chromium/Vite-development runner to verify that the harness changes did not break its original execution mode: `bun run --cwd webapp e2e --grep 'rapid full-app navigation and carousel switching while requests are pending'`, **exit 0, 1 passed, 29.8 seconds total / 18.3 seconds body**. Chromium version was `151.0.7922.34`, and the real `private-media-sw.js` controller was present in every condition. Each feed API condition held one request before interaction through release and completed respectively 200/500; media held four at interaction/release, with four finishes and five cancellations. All conditions preserved root and working UI without new document navigation, crash, pageerror or sampled global loading/initial placeholder; auth/cache sample counts were 17/37/37/15. This does not close the WebKit-with-SW interception gap or establish an iPhone fix. Evidence: `.scratch/pwa-interface-loss-chromium-continuation.log`. No source changes followed this run except report text.

## New physical-iPhone occurrence: ordinary feed scrolling

On 2026-10-11 the owner supplied a new iPhone screenshot showing the literal initial `Загрузка memoLy…` at 19:22, and reported ordinary feed scrolling, without rapid actions or an apparent heavy operation. Rapid gestures and an explicit heavy operation are therefore not necessary conditions for the observed failure. This does not by itself establish the browser's actual workload or memory state. The supplied image is evidence of the visible initial label, not live DOM/document identity.

A bounded read-only source continuation found real work activated by ordinary scrolling: FeedPage's pagination sentinel (320px intersection margin), pending-video/media visibility (600px margin), and nearby private-media loads. No document navigation, root replacement or global auth bootstrap call was found in that inspected scrolling chain. Pagination errors are caught locally. No production fix follows from this source observation.

The existing owner-provisioned strict-host-key SSH access was available. Read-only host checks executed from `/opt/memoly/app` confirmed the current static/backend/worker/scheduler images at `00e1c67ade30d0e26a063caf7fabe81ce3753e2f`. The older host-port gateway remains the unmanaged Caddy gateway described in the runbook; its image tag is not the served static revision. No deployment, container restart, configuration or data mutation was performed.

Sanitized edge-container log aggregation for 2026-10-11 16:18–16:25 UTC (19:18–19:25 Moscow) found 15 media reverse-proxy warnings at 16:21:28–16:21:42 UTC: 12 `stream closed`, 3 `context canceled`; the request user-agent category was iPhone and the requests involved one family. No private URL, family/user ID, cookie, signed URL or address was emitted. The logs cannot attribute these requests conclusively to the supplied screenshot or establish whether cancellation preceded or followed interface loss. Media cancellations are already a request-level outcome that the local earlier experiment survived; they are not a proven cause.

Both actual gateway and internal-static Caddyfiles lack an access-log directive. The edge output in this time window is warning/error logging, not a complete HTTP request record; the static container produced no lines. Absence of document/JS entries therefore cannot exclude a document reload, successful startup-asset fetch, cache-served document, or asset failure outside this logged boundary. This is a concrete production-observation gap, not a claim that the server was ruled out.

A single additional real-app production WebKit ordinary-scroll experiment was attempted with service workers allowed. It UI-published 32 notes and three albums of three complete synthetic 2048x1536 photos, interleaved chronologically (35 records), then issued 200px wheel inputs at 250ms intervals without tab/carousel switching or injected API/media faults. The scenario observed an active `private-media-sw.js` controller, 80 scroll steps and 20 distinct window scroll positions up to 3936px. Initial test-file syntax errors were caught during harness preparation, before this scenario body executed; corrected E2E TypeScript passed before execution.

Exact bounded browser command from the worktree: `bun run --cwd webapp e2e --config ../.scratch/playwright.webkit.production.config.ts --grep 'ordinary feed scrolling loads the next page'`. Result: **exit 1, one failed scenario, approximately 2.0 minutes body**, because the assertion expected 35 loaded cards and received 20. All 35 synthetic publishes returned 201. The worker inspected the trace: feed responses had another page (`nextCursor` present), but no cursor request was issued during measured scrolling. Three measured feed GETs with only `limit=20` finished 200. The pagination trigger/viewport intersection was not established; this is an incomplete scenario, not a product white-screen reproduction or a passing scroll acceptance check. No further browser attempts or out-of-scope pagination fix followed.

The failed-run final snapshot had the original connected root, feed and navigation present, no initial placeholder or app loading, and latest auth/cache samples authenticated/hydrated. Node-side observations recorded 0 crashes, 0 pageerrors and one initial document navigation only. These final snapshots do not establish absence of every transient global-state change during the incomplete run. There were 66 successful media requests during synthetic data setup and zero new media requests after the scroll observation baseline, so media loading during pagination was not exercised.

The complete experimental test and diff were preserved in ignored `.scratch/critical-smoke-scroll-experiment.ts` and `.scratch/critical-smoke-scroll-experiment.diff`; tested source SHA256 was `683E46A34E42527DA8F994C760BDA523F17E383CAEF3B0A5C12D42FCFD4FA141`. Evidence is `.scratch/pwa-interface-loss-scroll-webkit.log`, the lead-extracted `.scratch/interface-loss-scroll-webkit.json` and the existing local Playwright trace. The worker removed only its own tracked test/refactor changes by restoring that file's pre-turn contents, without reset/stash/clean/rebase; only this report remains as the tracked continuation change. A failing experimental scenario was not installed as a routine release test.

The lead personally inspected the diff/evidence and ran `bun run --cwd webapp tsc --noEmit -p tsconfig.e2e.json` (exit 0 on the experimental source) and `git diff --check` (exit 0). No additional formal review or broad matrix was run. `origin/main` fetched again remains `00e1c67ade30d0e26a063caf7fabe81ce3753e2f`. No PR, main publication, production change or deploy; `verify:local` is not a claimed result. The latest iPhone occurrence is not contradicted by local passes: ordinary scrolling is now a reported trigger, while the cause and the live document/root/JS observation remain unresolved. A hardware fault in the owner's iPhone has not been established.

## MAX occurrence and explicit platform scope

The owner subsequently reported ordinary downward feed scrolling in the MAX bot mini-app: frequent incomplete photo/video loads and two apparent application reloads. The previously installed PWA left the static initial placeholder. These are reported visible outcomes; actual document navigation or WebContent crash was not instrumented on the device. Installed-PWA mode is no longer a necessary reported condition. This still does not establish an iPhone hardware fault, memory shortage, or media cancellation as the cause.

The owner explicitly excluded Telegram from all further investigation, changes and tests. Working scope is MAX plus installed PWA. Previous browser experiments used synthetic Telegram auth and remain historical evidence of those test environments, not acceptance of the real MAX launch/auth path. No subsequent Telegram code/auth/test work is authorized by this task.

A read-only source trace and lead inspection found a concrete shared photo-loading/resource-lifetime candidate: FeedPage flattens retained pages and MemoryList renders retained cards; ordinary scrolling does not unmount those cards. MixedMediaCarousel mounts the selected item and adjacent photos, rather than every slide. PrivateImage calls usePrivateImageUrl without photo viewport gating. Its owned object URLs are revoked on hook unmount or identity/path/user changes; its separate fetch effect cleanup aborts the request. Scrolling retained cards does not invoke object-URL cleanup. An eligible persistent-cache hit shows the cached Blob and then still performs authenticated network fetch, complete cloned-body consumption and decode; cache persistence consumes another response clone. This is observed source behavior, not a measured device-memory limit or established interface-loss mechanism.

The persistent image cache permits successful supported image variants/avatars/MAX posters up to 2 MiB per entry; MAX video streams do not enter that image cache. MAX video elements use preload=none, and readiness/poster work is viewport-gated. MAX playback source acquisition waits for private-media worker control and posts a playback-session request. Its controllerchange wait is unbounded if a controller never arrives; evidence does not connect this possible source-acquisition stall to replacement of the entire interface. No automatic document reload/recovery call was found in the inspected MAX host/media chain, so the observed mini-app recovery is not attributed to a proved application handler.

Read-only production check at 17:08 UTC (20:08 Moscow) found static/backend container RestartCount=0, started at approximately 10:51 UTC. There were no edge media warnings in the preceding 20-minute window. This rules out those containers restarting as the explanation, not every possible server or client failure. It also does not attribute the owner's MAX occurrences to an exact timestamp. Server access logging remains incomplete as described above.

### Bounded synthetic MAX experiment: incomplete, no root-loss fix

An ignored MAX-only diagnostic runner used the real backend app and `/api/v1/auth/max` verifier with synthetic signed MAX init data and a mocked MAX WebApp host surface. The backend entry point omitted external bot startup. This checks a synthetic MAX authentication path, not the physical MAX host. No Telegram auth was used in these runs. Production WebKit 26.5 with a 390x844 viewport and service workers allowed is local phone emulation, not iPhone acceptance.

Three actual invocations of `bun run --cwd webapp e2e --config=../.scratch/playwright.max-pwa-diagnostic.config.ts` exited 1. The first failed synthetic seed foreign-key setup before authentication. The second authenticated and displayed the uploaded photo, then failed its image-cache-entry assertion. The third recorded that checkpoint and subsequently timed out waiting for cursor pagination after wheel input. No warm-cache reload, completed pagination/media scenario or complete root/document-lifetime result was obtained. These are failed or incomplete experiments; they do not reproduce the reported MAX restart or PWA interface loss.

The lead inspected sanitized evidence extracted from the last actual trace: MAX auth returned 200; the protected display-image request returned 200, `image/webp`, with 14,420 response-body bytes in the trace. The IndexedDB `memoly-private-cache` / `entries` getAll checkpoint had zero image Blob entries and no operation error. The response variant, type and size meet the inspected cache eligibility boundaries, but this checkpoint alone does not establish why persistence was absent or whether its asynchronous write had completed. Cache write timing, identity/generation changes and rejection/error paths remain unobserved. The source's family-cache-generation increment is called by family selection, not ordinary feed scrolling; it is not established as this checkpoint's cause.

The failed experiment did not emit its planned final observation report on early assertion failure. Accordingly no zero-crash, zero-navigation, global-state or object-URL lifetime result is claimed from its unfinished phases. Evidence remains local and ignored: `.scratch/max-pwa-media-trace-evidence.json` and the original trace under `webapp/e2e/.artifacts/test-results-max-pwa-diagnostic/`. The diagnostic spec and runner were moved to `.scratch/` after execution to avoid adding a failing routine release test. Their imports/output paths then changed; the saved files are not byte-for-byte the last browser-executed source. No further browser run was performed after that move.

Closure checks: the normal webapp typecheck after moving the file does not cover `.scratch/`. The lead therefore explicitly checked the saved diagnostic through an ignored extending config: `bun run --cwd webapp tsc --noEmit -p ../.scratch/tsconfig.max-pwa-diagnostic.json`, exit 0. This verifies TypeScript only, not successful execution. `git diff --check` passed. No production implementation changed in this continuation and no additional formal review or broad suite was run.

Remaining technical gap: local MAX pagination must first be exercised reliably, and the cache checkpoint needs its actual write outcome and timing before any cache fix can be justified. For the reported interface loss, current document identity/navigation, root contents and JS responsiveness at the physical iPhone failure are still missing. Neither cache absence nor retained media resources has been connected to that root-loss mechanism. No guessed fix, PR, main publication or deploy was made; `verify:local` was not run or claimed. Last verified main/deploy remains `00e1c67ade30d0e26a063caf7fabe81ce3753e2f`. Scope remains MAX and installed PWA only.
