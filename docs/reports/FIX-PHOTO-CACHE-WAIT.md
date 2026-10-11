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
Independent review and final publication gate: pending at report creation; results recorded below before publication.

## Remaining iPhone observation gap

Owner's 23:07 report ran watcher build `index-DHAU24jT.js`. The previous run last recorded a healthy root at 23:07:10.174 and a media-load event at 23:07:14.303, with auth ready and cache hydrated. It saved no root-loss, loading reset, pagehide or JavaScript failure. The pinned incident referred to an older run; PR 166 already corrected inferred-incident attribution.

There is no observation of whether JavaScript and the DOM were still alive at the moment the physical iPhone displayed the loading screen. A JavaScript watcher cannot save evidence after its execution environment stops; a healthy DOM also does not prove native presentation is healthy. Native process termination, memory pressure, document restart, JavaScript freeze and compositor failure remain unproven. Last saved media-load is not a proven trigger; image/blob counts are not memory measurements.

This Windows desktop WebKit experiment neither reproduced the whole-interface loss nor establishes acceptance on iOS 18.7 / iPhone 13. It demonstrates the photo-display ordering and cleanup only in the tested environment. No claim that the PWA crash is fixed, and no request for the same JSON or system analytics.

## Release boundary

No migrations or contract changes. Rollback uses the preceding immutable code/images; no database restoration is needed for this change. Publication/deploy requires the standing owner authorization, one independent review and `bun run verify:local` on the actual product source. This release must be described as a photo-display fix, never as a confirmed iPhone white-screen fix.

Independent review: fresh read-only GPT-6 Luna, high effort, standard/default service tier; no confirmed P0/P1/P2 findings, no edits or repeated formal review. Evidence `.scratch/pwa-photo-wait-review.txt` and `.scratch/pwa-photo-wait-review.log`. Reviewed the final product diff (6 insertions / 8 deletions) against base53e1ce1. Review did not claim iPhone acceptance.

### Final gate — BLOCKED, no main publication or deploy

Product source checked: `b2e6fe9220afae1210106c543fa41770734d598d`. Command: `bun run verify:local`, Bun1.4.0 / Node24.15.0 on Windows. Initial attempt passed product build/type/lint/unit stages but failed starting integration dependencies: Docker predefined address pools exhausted (`.scratch/pwa-photo-wait-verify-local.log`, exit1). No unrelated Docker networks/containers were removed.

A dedicated fixture-owned PostgreSQL18 container used the existing bridge network and localhost36438, temporary filesystem data, and an explicitly synthetic `web_app_demo_test` database. Set `TEST_DATABASE_URL` to that test instance, `TEST_SKIP_DOCKER=1 E2E_SKIP_DOCKER=1`; these flags skip only dependency creation, not integration/browser tests. Same-source retry failed when native Bun segfaulted at address0x32 in `memories.integration.test.ts` (`.scratch/pwa-photo-wait-verify-local-retry.log`, gate exit1).

One unchanged-source Bun retry passed that file, then spun in `users.integration.test.ts` after the concurrent development-seed scenario. No output for more than147s, process CPU152s, all eight PostgreSQL application connections idle with ClientRead and no active lock waits. Only the exact fixture-owned test process (PID41304, verified parent86872 and full command) was stopped; runner reported exit255 and gate exit1. This is an incomplete gate, not a successful run (`.scratch/pwa-photo-wait-verify-local-bun-retry.log`). The critical browser stage was not reached in the final gate. No tests were skipped or changed to mask the runtime failures.

Installed WSL Ubuntu has Docker but neither Bun nor Node. Current installed native build dependencies (rolldown/esbuild/sharp) are Windows packages. No instruments/dependencies were downloaded or other worktrees altered to construct another environment. Gate remains BLOCKED; repeat native-Bun full-suite attempts stopped. The Windows test-runtime failures do not diagnose the iPhone PWA failure.

PR: https://github.com/alexdubaev/OurMemoriesDevBot/pull/167 (draft). The product source still matches the independently reviewed change and passing controlled WebKit experiment. Only documentation changes follow b2e6fe9. No merge SHA or production deployment for this task. Existing production remains53e1ce1c7595aa985e9309477c1859cb91d45fc0. Fixture-owned PostgreSQL container is removed after the stopped gate; unrelated containers/networks remain untouched.
