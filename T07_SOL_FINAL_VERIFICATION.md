# T07 SOL FINAL VERIFICATION

## Audited state

- Task ID: T07 — Sol Final Fix Verification.
- Status: REVIEW.
- Model gate: Sol manually selected by the owner; accepted as instructed.
- Worktree: `D:/codex/TG_OurMemoriesDevBot/worktrees/t07-live-feed`.
- Branch: `feat/t07-live-feed`.
- Base SHA / `origin/main`: `b03a82993dd72ceaca0d9724b0194295d5cadd2c`.
- Previous audited HEAD: `46320328c7ede438d57c11ec23e99aebc431fc72`.
- Final implementation commit: `f973fed1511809ae210224f728fc02cca6da6861`.
- Audited final docs HEAD: `26f843f9a3972ee43a89497b4a8857c2dab99e7d`.
- Initial worktree status was clean. The canonical origin and linked worktree were verified.
- `f973fed…26f843f` adds only `T07_FINAL_FIX_HANDOFF.md` and `T07_SOL_FIX_VERIFICATION.md`. It contains no production source or configuration changes.
- Scope was limited to P1-4, H1, H2, their direct regression surface, and this report. No source fix, commit, push, PR, merge, deployment or T09 work was performed.

## P1-4

**RESOLVED.**

- `usePlaybackRegistration` creates one `Symbol(id)` in a ref for each mounted hook instance (`webapp/src/features/feed/use-playback-registration.ts:6-20`). The token is not recreated on render.
- `PlaybackCoordinator` registers and activates by `symbol`, so card and detail players for the same media path occupy separate entries (`webapp/src/features/feed/playback-context.ts:3-7`; `webapp/src/features/feed/playback.tsx:7-25`). Detail cleanup deletes only its token.
- Activation pauses every other registered instance, preserving one-local-media-at-a-time. `pauseAll` still pauses every registration on hidden state, and the hook cleanup pauses its own element on feed/detail unmount.
- The focused tests import the production coordinator and hook and deterministically cover all requested cases (`webapp/tests/playback.test.tsx:9-162`):
  - A: same-media detail activation pauses the card;
  - B: detail unmount leaves the card registered and hidden pauses it;
  - C: visible after detail close causes no autoplay;
  - D: different media retain the normal coordinator behavior;
  - E: authenticated feed unmount pauses both mounted local players. The real-stack feed E2E additionally confirms an active voice is paused after membership revoke.
- Fresh result: 6 passed / 0 failed, 14 expect calls.

## H1

**RESOLVED BY EVIDENCE.**

- The reverse-interleaving barrier exists only in the integration-test `TelegramApiPort.sendVideo` mock (`backend/src/modules/telegram/capture.integration.test.ts:239-299`). The final-fix diff does not modify the production delivery service or add test synchronization to it.
- Entering the mocked `sendVideo` proves execution has passed the production `FOR SHARE OF d, r, m, fm, f, ei` statement and remains inside that database transaction (`backend/src/modules/telegram/application/video-delivery.ts:99-138`).
- While `sendVideo` is held, the test starts the real family-member DELETE endpoint. A separate PostgreSQL client queries `pg_stat_activity` and succeeds only after observing `wait_event_type = 'Lock'` on the `family_members` mutation (`capture.integration.test.ts:632-665`). The 50 ms sleep is only polling cadence; a timeout cannot make the test pass.
- Before releasing the send barrier the test asserts the revoke promise is unsettled. After release it asserts delivery is `delivered`, revoke returns 204, and the persisted membership has `revokedAt` plus `version + 1`.
- The opposite order remains covered: revoke commits at the pre-final-authorization barrier, then delivery is denied and `sendVideo` has zero calls (`capture.integration.test.ts:203-236`).
- Fresh full Telegram result: 18 passed / 0 failed, 104 expect calls. Both named concurrency tests passed against a fresh PostgreSQL database.

## H2

**RESOLVED.**

- Production `HostBridge.onBack` registers through Telegram `WebApp.BackButton.onClick`, shows the button for the first live subscription, removes the exact callback through `offClick`, and hides it after the final unsubscribe (`webapp/src/platform/telegram/host-bridge.ts:52-104`). Cleanup is idempotent.
- PhotoSwipe calls that production subscription only after the viewer is being opened and unsubscribes in the viewer's `destroy` cleanup (`webapp/src/features/feed/FeedPage.tsx:306-345`). Browser `popstate` remains a separate close path.
- Each mounted `PrivateImage` owns an abortable viewer session. Component unmount aborts the session and destroys the initialized gallery (`FeedPage.tsx:190-208,276-345`).
- Authenticated slide object URLs are accumulated in the viewer session and revoked in one `finally` block on normal close, host back, browser back, loading abort or component unmount (`FeedPage.tsx:276-303`).
- The focused HostBridge test uses the production bridge and verifies subscribe, idempotent unsubscribe, stale callback removal, and resubscribe without accumulation (`webapp/tests/telegram-host-bridge.test.ts:9-49`). Fresh result: 4 passed / 0 failed, 30 expect calls.
- The real-stack feed E2E installs a Telegram `BackButton` host, lets the application build its normal production bridge, and invokes the handler that bridge registered (`webapp/e2e/feed.spec.ts:138-198,404-486`). It does not use a separate application close branch.
- The E2E covers single photo, two-photo album, host back, stale host back, reopen, browser back and component unmount. Handler count is zero while closed, one while open, and zero after every destroy/unmount. Focus and exact scroll position are restored on connected-trigger closes.
- Object URL instrumentation records **7 unique creates and 7 unique revokes**: single close (1), album host close (2), album browser-back reopen (2), and album component-unmount reopen (2). Set cardinality and sorted equality assertions detect both duplicate revocation and leaks.
- Fresh full feed result: 7 passed / 0 failed.

## Targeted tests

All commands below were run personally at audited HEAD `26f843f9a3972ee43a89497b4a8857c2dab99e7d` and completed with exit code 0.

| Profile | Command | Result |
| --- | --- | --- |
| Playback focused | `bun test tests/playback.test.tsx` in `webapp` | 6 passed, 0 failed, 14 expects |
| HostBridge focused | `bun test tests/telegram-host-bridge.test.ts` in `webapp` | 4 passed, 0 failed, 30 expects |
| Webapp unit | `bun run test` in `webapp` | 101 passed, 0 failed, 797 expects, 24 files |
| Telegram integration | `bun run test:integration src/modules/telegram/capture.integration.test.ts` in `backend` | 18 passed, 0 failed, 104 expects |
| Feed real-stack E2E | `bun run e2e -- feed.spec.ts` in `webapp` | 7 passed, 0 failed |
| Fresh database | Telegram integration and feed E2E runners | all existing 19 migrations applied successfully |
| Diff integrity | `git diff --check`; implementation and post-implementation ranges checked separately | PASS |
| Post-implementation scope | non-document paths in `f973fed…26f843f` | 0 |
| Caption final-fix scope | caption production paths in `4632032…f973fed` | 0 |

The broader handoff results (Contracts 39/39, Backend unit 346/346, focused PostgreSQL integration 62/62, Family E2E 2/2, typecheck/build/lint/architecture/audit PASS) were not mechanically repeated because the implementation commit is immutable and this verification was explicitly limited to the targeted profile.

## New regressions

- NEW P0: none.
- NEW P1: none.
- NEW P2: none.
- New hypotheses requiring a code fix: none.

No direct regression was found in the production paths changed by the final-fix commit.

## Existing caption/revoke P2

**UNCHANGED / DEFERRED.**

The final-fix diff does not touch `backend/src/modules/telegram/application/captions.ts` or `backend/src/modules/telegram/infrastructure/prisma-caption-repository.ts`. The existing Control B caption reply versus membership revoke/downgrade P2 remains outside this verification and was not fixed.

## Mobile acceptance

- iOS: **NOT RUN**.
- Android: **NOT RUN**.

Browser E2E is code-level evidence and does not replace testing in real Telegram clients.

## Final verdict

P1 REOPENED: **none (0)**

H1 REOPENED: **no**

H2 REOPENED: **no**

NEW P0: **0**

NEW P1: **0**

NEW P2: **0**

CODE READY: **YES**

MOBILE ACCEPTANCE: **NOT RUN**

READY FOR MOBILE ACCEPTANCE: **YES**

Next owner-operated step: real Telegram acceptance on iPhone and Android. Do not start T09 before the owner advances the gate.
