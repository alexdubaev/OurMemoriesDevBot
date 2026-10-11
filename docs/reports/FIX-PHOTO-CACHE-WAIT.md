# FIX-PWA-INTERFACE-LOSS / PHOTO-CACHE-WAIT

Task branch: `fix/photo-cache-wait`. Worktree: `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/pwa-crash-diagnostics`.
Base: `53e1ce1c7595aa985e9309477c1859cb91d45fc0`. Lead: Codex; bounded implementation: GPT-6 Luna. Allowed product path: `webapp/src/platform/media/use-private-image-url.ts`; report and ignored experiment evidence only otherwise.

## Confirmed defect and change

Network photos were fetched and decoded, but the hook waited for optional persistent-cache work before publishing their URL. A slow cache operation therefore kept usable photos hidden. This is a separately reproduced photo-display defect, not an established cause of the installed iPhone PWA white screen.

The hook now publishes a decoded cold-photo URL before awaiting cache persistence. It still checks active user identity, family generation and request cancellation before publication. A warm displayed URL stays stable; its unused refresh candidate is revoked before persistence. Published URLs remain owned by the existing path/identity/unmount cleanup. Cache completion does not publish state or revoke an already displayed URL after cancellation. Cache storage, limits, queue, eviction, API error handling and `onSettled` timing are unchanged.

No DB/schema/migration, ACL, MAX video storage, Telegram integration, carousel layout, media cropping, reload or action delay changes.

## Actual application experiment

Use the existing Playwright infrastructure, isolated PostgreSQL/ports/storage and three synthetic photo memories. Authenticate the full browser application with a browser-link challenge approved through a synthetic MAX API session; no real bot/messages or Telegram SDK. All three media responses are real API HTTP 200 responses.

One controlled condition: a test-only Vite transform inserts a promise gate immediately before the real `cachePrivateImageResponse` call, after image decoding. The gate holds optional persistence; it does not simulate a native IndexedDB stall or an API error. The production-build plugin refuses to run without exactly one cache gate and two decode markers, and verifies markers in the emitted bundle. No gate is present in the published application.

Open the actual feed, wait for three decoded candidates to reach the gate, capture displayed photos/root/auth/cache, release the gate, verify three displayed photos, navigate to Family and verify URL cleanup. Independently observe main-document navigation, `pageerror`, `crash`, root identity and global loading/auth/cache transitions. The final assertion requires three displayed photos in the held checkpoint, after release and cleanup observations have been collected.

Command, from the named worktree, with isolated fixture environment:

```powershell
bun run --cwd webapp e2e --config ../.scratch/pwa-photo-wait.config.ts --project webkit-production-phone-emulation
```

Local reproducible fixture and artifacts remain in ignored `.scratch/pwa-photo-wait-*`; they contain synthetic data only. The initial harness run used the wrong Vite config and is invalid evidence; it is preserved separately at `.scratch/pwa-photo-wait-baseline.log`. The corrected baseline and fixed run verified the actual bundle markers.

| Observation | Corrected baseline | Same scenario after fix |
|---|---|---|
| Successful photo responses / decoded candidates | 3 / 3 | 3 / 3 |
| Displayed while persistence held | 0 | 3 |
| Root connected, loading absent, auth ready, cache hydrated | Yes | Yes |
| Main document navigations / page errors / crashes | 1 / 0 / 0 | 1 / 0 / 0 |
| After release: displayed photos | 3 | 3 |
| After Family exit: created / revoked / live blob URLs | 3 / 3 / 0 | 3 / 3 / 0 |
| Test result | 1 failed, exit 1, expected held display 3 vs 0 | 1 passed, exit 0, 23.7s |

Evidence: `.scratch/pwa-photo-wait-baseline-closure.log`, `.scratch/pwa-photo-wait-fixed.log`, browser trace/screenshot in `.scratch/pwa-photo-wait-results-closure/`. The assertions were not weakened for the fixed run. Fixture-owned Compose resources were removed after both runs.

`bun run --cwd webapp typecheck`: exit 0. `git diff --check`: exit 0.
Independent review and final publication gate completed; actual results are recorded below.

## Remaining iPhone observation gap

Owner's 23:07 report ran watcher build `index-DHAU24jT.js`. The previous run last recorded a healthy root at 23:07:10.174 and a media-load event at 23:07:14.303, with auth ready and cache hydrated. It saved no root-loss, loading reset, pagehide or JavaScript failure. The pinned incident referred to an older run; PR 166 already corrected inferred-incident attribution.

There is no observation of whether JavaScript and the DOM were still alive at the moment the physical iPhone displayed the loading screen. A JavaScript watcher cannot save evidence after its execution environment stops; a healthy DOM also does not prove native presentation is healthy. Native process termination, memory pressure, document restart, JavaScript freeze and compositor failure remain unproven. Last saved media-load is not a proven trigger; image/blob counts are not memory measurements.

This Windows desktop WebKit experiment neither reproduced the whole-interface loss nor establishes acceptance on iOS 18.7 / iPhone 13. It demonstrates the photo-display ordering and cleanup only in the tested environment. No claim that the PWA crash is fixed, and no request for the same JSON or system analytics.

## Release boundary

No migrations or contract changes. Rollback uses the preceding immutable code/images; no database restoration is needed for this change. Publication/deploy requires the standing owner authorization, one independent review and `bun run verify:local` on the actual product source. This release must be described as a photo-display fix, never as a confirmed iPhone white-screen fix.

Independent review: fresh read-only GPT-6 Luna, high effort, standard/default service tier; no confirmed P0/P1/P2 findings, no edits or repeated formal review. Evidence `.scratch/pwa-photo-wait-review.txt` and `.scratch/pwa-photo-wait-review.log`. Reviewed the final product diff (6 insertions / 8 deletions) against base53e1ce1. Review did not claim iPhone acceptance.

### Final gate — PASSED; ready for authorized publication and deploy

Verified source: `4ee34d66a7211b57dfb0a0dacdd057b7fad63dbc`; product implementation remains `b2e6fe9220afae1210106c543fa41770734d598d`. The final command was `bun run verify:local`, with `NODE_ENV` unset, executed at `/verify` in the owned `pwa-linux-gate-runner-4ee34d` Linux container. It completed all 16 stages, exit 0: 304 unit/boundary tests, 369 PostgreSQL integration tests, and 4 unchanged Chromium browser journeys (41.6s). No stages, assertions or tests were skipped or weakened. Evidence: `.scratch/pwa-photo-wait-verify-local-linux-fresh.log`, including `FULL_GATE_EXIT_CODE=0`.

The runner uses existing cached Bun 1.4.0 / Debian 13, Node 22.23.2 and musl libraries from the existing Node image, existing WSL Git 2.53.0 and Docker/Compose tools. Project dependencies alone were restored from the unchanged lock with `bun install --frozen-lockfile --ignore-scripts` (875 packages). No new runtime/helper tool or browser was downloaded. GNU Bun and musl Node native imports and actual Sharp operations were verified separately. Rolldown's Debian `ldd` filesystem probe chose the wrong binding for musl Node; retaining that tool as `ldd.glibc` in the owned container allows truthful process-report ABI detection. No library source was edited.

Source came from the exact HEAD archive (SHA256 `4c6ac83a74d5fa4aa0d5205f2bb1e559df8dee71dddb5800f97ad4429ba8fd78`). Audit used a read-only shallow Git metadata snapshot containing the original commit/tree/blob objects and index, not a new commit or rewritten history. All 1,820 original source-file SHA256 checks passed after the completed full gate; lock, manifests and implementation stayed unchanged. Evidence: `.scratch/pwa-linux-gate-source-before.sha256` and `.scratch/pwa-linux-gate-source-after-full.log`. Only this report changes after the gate; unchanged product tests are not repeated for a documentation-only update.

PostgreSQL 18 ran in a fresh, owned tmpfs container sharing only the runner's network namespace. `TEST_DATABASE_URL` and `DATABASE_URL` pointed to `127.0.0.1:5432/web_app_demo_test`; `TEST_SKIP_DOCKER=1 E2E_SKIP_DOCKER=1` skip dependency creation only. No non-test database override was used. Existing Windows Chromium 151 was reached through the existing Playwright CLI `run-server`, `PW_TEST_CONNECT_WS_ENDPOINT` and `PW_TEST_CONNECT_EXPOSE_NETWORK=<loopback>`. A controlled HTTP probe verified the network tunnel before the unchanged browser journeys. Linux server/test execution and Windows Chromium are the actual environment; this is not physical iPhone acceptance.

Earlier incomplete attempts remain recorded: Windows Docker address-pool exhaustion, Bun native segfault and CPU spin (`.scratch/pwa-photo-wait-verify-local*.log`); the JIT-disabled narrow attempt also did not solve the Windows hang. Linux setup attempts exposed missing Git metadata, wrong Node native ABI selection, the MAX migration guard rejecting a non-loopback DB hostname, missing network tunneling in browser `launchServer`, and synthetic E2E family rows left in a reused test DB. Each condition was resolved in owned test infrastructure; the final gate used fresh test data. Linux failure logs and narrow closure evidence remain in `.scratch/pwa-linux-gate-*` and `.scratch/pwa-photo-wait-verify-local-linux-*`. No unrelated container/network/worktree, production DB, test assertion or release guard was changed.

PR: https://github.com/alexdubaev/OurMemoriesDevBot/pull/167. Standing owner authorization applies to squash merge and the existing guarded Selectel release, with migration input `false`. Actual merge SHA and deployment evidence are recorded in the PR/release handoff after completion. This change is a verified photo-display fix; the iPhone whole-interface-loss observation gap above remains open.
