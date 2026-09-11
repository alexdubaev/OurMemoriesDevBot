# T07 FINAL FIX HANDOFF

## Audited state

- Task ID: T07 — Final Fix Round P1-4 + H1/H2.
- Status: REVIEW.
- Model: Codex (GPT-5).
- Worktree: `D:/codex/TG_OurMemoriesDevBot/worktrees/t07-live-feed`.
- Branch: `feat/t07-live-feed`.
- Base SHA / `origin/main`: `b03a82993dd72ceaca0d9724b0194295d5cadd2c`.
- Starting HEAD: `46320328c7ede438d57c11ec23e99aebc431fc72`.
- Implementation HEAD: `f973fed1511809ae210224f728fc02cca6da6861`.
- Implementation commit: `fix(feed): close final T07 verification gaps`.
- Canonical origin was verified as `alexdubaev/OurMemoriesDevBot` without publishing its URL.
- Publication: not published. No push, PR, merge, deploy or T09 work was performed.

## Final finding status

- P1-4: **RESOLVED**.
- H1: **RESOLVED BY EVIDENCE**. The new reverse-interleaving test passed without a production delivery-path change.
- H2: **RESOLVED**.
- New P0: none.
- New P1: none.
- New P2: none.

## P1-4 — stable mounted-player identity

The playback coordinator now keys registrations by a stable per-mounted-instance `symbol`, not by a media path. `usePlaybackRegistration` creates the token once in a ref for that mounted hook instance. Therefore a card and detail player for the same attachment have separate registrations, and one unmount cannot delete the other registration. Activation still pauses every other registered local media instance.

RED → GREEN evidence using the production coordinator and hook:

- Initial RED: `bun test tests/playback.test.tsx` in `webapp` → exit 1; 2 passed / 1 failed. The same-media card was expected to receive one pause when detail played but received zero.
- Final focused GREEN: `bun test tests/playback.test.tsx` in `webapp` → exit 0; 6 passed / 0 failed, 14 expect calls.

Required scenarios:

- A: card plays → same-media detail mounts and plays → card pauses.
- B: same-media detail unmounts → card remains registered → hidden transition pauses card.
- C: detail closes → visible transition does not autoplay either element.
- D: two different media retain ordinary one-local-media-at-a-time behavior.
- E: authenticated feed unmount pauses both mounted local players; the existing real-stack revoke E2E also confirms active voice pause and feed cleanup.

## H1 — reverse protected-send serialization

The deterministic barrier exists only in the integration-test `TelegramApiPort.sendVideo` mock. No test-only synchronization was added to production.

The test starts a valid delivery and waits until the mocked `sendVideo` is entered inside the final protected transaction, after its `FOR SHARE` locks have been acquired. It then starts the real family-member DELETE endpoint on another connection. A separate PostgreSQL observer waits for `pg_stat_activity.wait_event_type = 'Lock'` on a query containing `family_members`, and the test asserts the revoke promise is still unsettled. Releasing the send barrier produces `delivered`, then the revoke completes with HTTP 204 and the persisted membership is revoked with its version incremented.

Focused evidence:

- `bun run test:integration src/modules/telegram/capture.integration.test.ts --test-name-pattern "serializes a concurrent membership revoke"` in `backend` → exit 0; 1 passed / 0 failed, 7 expect calls.
- Full Telegram integration → exit 0; 18 passed / 0 failed, including both interleavings:
  - revoke commits before final authorization → denied, zero video sends;
  - protected send section locks first → revoke waits, send completes, revoke commits afterward.

## H2 — PhotoSwipe lifecycle and Telegram BackButton

Production `HostBridge` now exposes an idempotent BackButton subscription backed by Telegram `WebApp.BackButton.onClick/offClick/show/hide`. PhotoSwipe subscribes only for an opened viewer and unsubscribes on destroy. The image component owns an abortable viewer session so Feed unmount destroys the viewer as well. Browser `popstate` handling remains independent.

Authenticated PhotoSwipe blobs are loaded into session-owned object URLs and revoked exactly once in `finally`, including close, host back, browser back and component unmount. Focus and scroll restoration remain on the connected trigger path.

RED → GREEN and browser evidence:

- HostBridge RED: `bun test tests/telegram-host-bridge.test.ts` in `webapp` → exit 1; 3 passed / 1 failed because `bridge.onBack` did not exist.
- HostBridge GREEN: same command → exit 0; 4 passed / 0 failed, 30 expect calls. It verifies idempotent unsubscribe, no stale callback, and no callback accumulation on resubscribe.
- Focused PhotoSwipe E2E → exit 0; 1 passed / 0 failed.
- Full `feed.spec.ts` → exit 0; 7 passed / 0 failed.

The browser test calls the Telegram BackButton harness that the production bridge subscribed to; it does not call a test-only application branch. It proves:

- no host callback while PhotoSwipe is closed;
- one callback while open and zero after destroy/unmount;
- a host back closes the viewer through the production callback;
- a stale host back after close does nothing;
- reopening does not accumulate callbacks;
- browser back still closes the viewer;
- focus and exact scroll position are restored;
- object URL accounting is 7 unique creates ↔ 7 unique revokes: single photo (1), album host-close (2), album browser-back reopen (2), and album unmount reopen (2), with no duplicate revoke or leak.

## Changed paths

Implementation commit changed only:

- `backend/src/modules/telegram/capture.integration.test.ts`
- `webapp/e2e/feed.spec.ts`
- `webapp/src/features/feed/FeedPage.tsx`
- `webapp/src/features/feed/playback-context.ts`
- `webapp/src/features/feed/playback.tsx`
- `webapp/src/features/feed/use-playback-registration.ts`
- `webapp/src/platform/telegram/host-bridge.ts`
- `webapp/tests/feed.test.tsx`
- `webapp/tests/playback.test.tsx`
- `webapp/tests/telegram-host-bridge.test.ts`

Contracts, `package.json`, lockfile, Prisma schema, migrations, shared contracts, generated sources, CI and manifests are unchanged.

## Verification

Every final command below completed with exit code 0.

| Profile | Command / evidence | Result |
| --- | --- | --- |
| Playback focused | `bun test tests/playback.test.tsx` (`webapp`) | 6 passed, 0 failed, 14 expects |
| HostBridge focused | `bun test tests/telegram-host-bridge.test.ts` (`webapp`) | 4 passed, 0 failed, 30 expects |
| Contracts | `bun run test` (`packages/contracts`) | 39 passed, 0 failed, 158 expects, 6 files |
| Backend unit | `bun run test:unit` (`backend`) | 346 passed, 0 failed, 995 expects, 63 files |
| Webapp unit | `bun run test` (`webapp`) | 101 passed, 0 failed, 797 expects, 24 files |
| Focused PostgreSQL integration | six Telegram/Memory/private-media/FamilyAccess/T08 suites | 62 passed, 0 failed |
| Telegram integration | `capture.integration.test.ts` within the focused run | 18 passed, 0 failed, 104 expects |
| Memories integration | `memories.integration.test.ts` | 14 passed, 0 failed, 72 expects |
| Private media integration | `media-access.integration.test.ts` | 7 passed, 0 failed, 50 expects |
| FamilyAccess/T08 regressions | access + review-fixes + persistence suites | 14 + 7 + 2 passed, 0 failed |
| Feed real-stack E2E | `bun run e2e -- feed.spec.ts` (`webapp`) | 7 passed, 0 failed |
| Family real-stack E2E | `bun run e2e -- specs/family.spec.ts` (`webapp`) | 2 passed, 0 failed |
| Fresh migrations | focused integration, feed E2E and family E2E runners | all 19 migrations applied successfully in isolated PostgreSQL |
| Typecheck | `bun run typecheck` | 0 errors; one pre-existing website deprecation hint |
| Production build | `bun run build` | all workspaces built; pre-existing website chunk-size warning only |
| Lint | `bun run lint` | PASS |
| Architecture | `bun run architecture:check` | PASS; 599 source files checked |
| Dependency audit | `bun run audit` | PASS; no known vulnerabilities |
| Diff | `git diff --check` and `git diff --cached --check` | PASS |
| Secret scan | filename/sensitive-signature scan over implementation diff | 0 matches; dedicated `gitleaks` unavailable |

The full feed E2E refreshed `webapp/e2e/.artifacts/t07-feed.png` and `webapp/e2e/.artifacts/t07-photoswipe.png` with synthetic data. These are ignored test artifacts, not committed product assets.

## Migrations and contracts

- Migrations: unchanged.
- Prisma schema: unchanged.
- Shared contracts: unchanged.
- Fresh isolated databases applied the existing 19 migrations successfully during three final runners.

## Existing caption/revoke P2

**EXISTING / UNCHANGED.** The Control B caption reply versus membership revoke/downgrade P2 was not modified or retested as a fix. No caption production path is present in the implementation diff. It remains deferred to its separate targeted hotfix.

## Residual risks and acceptance boundary

- Dedicated `gitleaks` was unavailable; the filename and sensitive-signature fallback found zero matches.
- The existing website chunk-size warning and deprecation hint are outside this bounded fix.
- Real Telegram client acceptance remains owner-operated and was intentionally not run.

Mobile Acceptance:

- iOS: **NOT RUN**.
- Android: **NOT RUN**.

CODE READY: **YES** for the requested P1-4/H1/H2 verification scope.

READY FOR SOL VERIFICATION: **YES** on immutable implementation HEAD `f973fed1511809ae210224f728fc02cca6da6861`.

Next step: one short Sol verification limited to P1-4, H1 and H2. Do not start T09 before that gate.
