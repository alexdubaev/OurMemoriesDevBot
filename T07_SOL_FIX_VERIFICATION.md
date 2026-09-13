# T07 SOL FIX VERIFICATION

## Audited state

- Task ID: T07 — Sol Fix Verification.
- Status: REVIEW.
- Model: Sol; owner-provided model gate accepted.
- Worktree: `D:/codex/TG_OurMemoriesDevBot/worktrees/t07-live-feed`.
- Branch: `feat/t07-live-feed`.
- Base SHA / `origin/main`: `b03a82993dd72ceaca0d9724b0194295d5cadd2c`.
- Initially reviewed HEAD: `b80ba301911998f07d449b2001db2dd86f9291cc`.
- Post-Sol implementation HEAD: `ed4f7af0c15cf76c86303715424e785ac06911a2`.
- Audited final handoff HEAD: `46320328c7ede438d57c11ec23e99aebc431fc72`.
- Initial status was clean. Canonical origin is `alexdubaev/OurMemoriesDevBot`; the checkout is the expected linked worktree.
- `ed4f7af0…46320328` adds only `T07_SOL_REVIEW.md` and `T07_POST_SOL_FIXES_HANDOFF.md`. No production source/config changed after the implementation commit.
- Allowed paths: repository-wide read-only inspection and test execution; the only intentional repository write is this report. No production source, config, generated source, commit, branch, remote, PR or deployment was changed.

## P1 verification

### P1-1 — RESOLVED

- Voice and legacy private video no longer use `transport.raw(...).blob()` as the HTML media source. `AudioPlayer` and `PrivateVideo` use the protected relative path returned by `privateMediaSource` (`webapp/src/features/feed/FeedPage.tsx:201-210,222-232`; `webapp/src/platform/media/private-media-access.ts:9-20`). Photo blobs remain separate and are not the playback path.
- The service worker accepts only same-origin UUID-shaped private-media GET/HEAD paths and injects the in-memory bearer token while preserving the media element's Range header (`webapp/public/private-media-sw.js:1-31`). The token is not placed in the media URL, storage or a public/permanent URL.
- Fresh real-stack E2E observed no playback request before user action and observed Range requests with HTTP 206 for voice and legacy video. The exact required suite passed 7/7. The backend private-media suite passed 7/7, including authenticated HEAD, 206/Content-Range, 416, and foreign-family denial. FamilyAccess and feed revoke paths also passed.
- The Telegram-only attachment remains on its separate guarded deep-link branch (`FeedPage.tsx:168-185`); the browser E2E confirmed an opaque `watch_` link without `file_id`.

### P1-2 — RESOLVED

- Full-page error is gated by `feed.isError && items.length === 0`; retained items remain rendered and `isFetchNextPageError` renders the local retry at the pagination boundary (`FeedPage.tsx:100-108`).
- The intersection observer does not automatically re-request while `isFetchNextPageError` is true (`FeedPage.tsx:85-93`), preventing an error loop. Retry is an explicit user action.
- Unit evidence passed and the real-stack E2E forced a cursor request to fail with 503, kept page-one cards visible, showed the local error, retried once, loaded 48 records and verified unique IDs (`webapp/e2e/feed.spec.ts:57-90`).

### P1-3 — RESOLVED

- `webapp/e2e/feed.spec.ts` exists and contains seven real-stack browser tests. They seed PostgreSQL and private storage, exercise the production API/UI, and use route interception only to inject the intended page/like failures.
- Exact command: `bun run --cwd webapp e2e -- feed.spec.ts` → exit 0, **7 passed / 0 failed**. The filter discovered a non-zero suite.

### P1-4 — REOPENED

The basic lifecycle fix works for uniquely registered players: `pauseAll()` pauses every registered element, clears `activeId`, `visibilitychange` calls it only while hidden, visible does not autoplay, and every hook cleanup pauses its own element (`webapp/src/features/feed/playback.tsx:7-26`; `webapp/src/features/feed/use-playback-registration.ts:6-16`). The existing unit tests and ordinary feed E2E passed.

However, the fix is incomplete on the production card/detail path:

- **File:line:** `webapp/src/features/feed/FeedPage.tsx:103-109,201-204,222-225,236-239`; `webapp/src/features/feed/playback.tsx:8-19`; `webapp/src/features/feed/use-playback-registration.ts:8-14`.
- **Production path:** a card remains mounted while `MemoryDetail` renders the same attachment. Both players derive the registration ID only from the same media path (`audio:${path}` or `video:${path}`). The coordinator's `Map.set(id, pause)` replaces the card registration with the detail registration; detail cleanup then performs an unconditional `Map.delete(id)`.
- **Fresh deterministic reproduction:** mounted the production coordinator/hook with a card player, mounted a detail player with the same ID, activated detail, unmounted detail, then dispatched hidden `visibilitychange`. Result: `{"cardPauseAfterCompetingDetailPlay":0,"cardPauseAfterDetailCloseThenHidden":0,"detailPauseOnUnmount":1}` (exit 0).
- **Impact:** playing the detail does not pause an already-playing card with the same attachment, so two local media elements can play simultaneously. After detail closes, the still-mounted card is no longer registered; hiding the Mini App does not pause it. This violates F07.7 and the exact P1-4 requirement.
- **Existing protection:** unique IDs work and complete feed unmount/revoke/logout pauses each hook during cleanup.
- **Why insufficient:** the collision occurs specifically because card and detail coexist and use the same path-based key; current unit/E2E tests use distinct IDs or never open a media detail before the hide transition.

## P2 verification

### P2-1 — RESOLVED

- `updateMany` atomically claims an unexpired, nonterminal pointer before the send boundary; one of two concurrent callers can set `claimToken` (`backend/src/modules/telegram/application/video-delivery.ts:81-93`).
- Final identity, membership, family, reference and Memory authorization runs after claim inside the protected transaction with `FOR SHARE`; only that section decrypts and reaches `sendVideo` (`video-delivery.ts:95-138`).
- A failure after send begins writes `ambiguousAt`; the retained claim/terminal state prevents retry. The code and handoff explicitly avoid an exactly-once claim for an ambiguous external Bot API outcome (`video-delivery.ts:143-149`).
- Fresh Telegram integration passed concurrent replay (one `delivered`, one `denied`, one `sendVideo`) and ambiguous outcome (one send total, then denied) tests.

### P2-2 — RESOLVED

- Hourly `telegram:deliveries:cleanup` is declared in `backend/src/job-schedules.json:42-49`.
- The job deletes only rows whose `expiresAt` is older than `now - 24h` (`backend/src/jobs.ts:153-158`). An active/unexpired pointer is retained.
- Migration/schema provide `telegram_video_deliveries_expires_at_idx` (`backend/prisma/migrations/20260911150000_t07_delivery_claims/migration.sql:12-13`; `backend/prisma/schema.prisma:412`).
- Fresh regression test retained the live pointer and removed only the row beyond the retention window.

### P2-3 — RESOLVED

- Feed keys now live under `sessionQueryKeys.all` (`webapp/src/features/feed/queries.ts:9-16`). Authentication logout and principal transition remove that entire namespace (`webapp/src/features/auth/queries.ts:110-125`), including viewer-specific `likedByMe` data.
- Revoke handling cancels then removes all feed keys before showing the closed-access state (`FeedPage.tsx:56-63`). Unmount pauses local media; auth transition also clears the service-worker token.
- Fresh webapp unit tests passed the namespace cleanup assertion; real-stack revoke E2E passed with zero remaining cards and paused audio.

### P2-4 — RESOLVED

- The Memory contract accepts exactly 48 normalized peaks (`packages/contracts/src/memories.ts:110`); contract negative/positive cases passed.
- The Prisma Memory producer maps the stored validated waveform instead of returning null (`backend/src/modules/memories/infrastructure/prisma-memory-repository.ts:373-409`); the fresh PostgreSQL integration returned all 48 values.
- The UI passes those peaks to `VoiceSeek`, renders exactly 48 bars, and overlays an accessible range input that changes `currentTime`; the fallback slider is used only when peaks are absent/not 48 (`FeedPage.tsx:201-219`). No random/fake waveform path exists.
- Fresh webapp unit evidence rendered 48 stored peaks; the browser fixture displayed the same 48-peak path.

### P2-5 — RESOLVED

- Every shaped invalid/replayed/expired/foreign/revoked/deleted pointer resolves to `denied`; `processInbox` maps that single result to exactly `Видео недоступно или у вас нет доступа.` (`backend/src/modules/telegram/infrastructure/process-task.ts:59-68`).
- The generic string includes no family name, caption, existence reason, `file_id`, revoke reason or other resource metadata.
- Fresh Telegram integration passed the denial matrix and the end-to-end revoked case, including the exact generic response.

## H1 verification

**REOPENED — implementation is directionally correct, required regression evidence is incomplete.**

- Fresh deterministic integration evidence confirms the first direction: delivery claims, waits before final authorization, revoke commits, delivery resumes, final authorization denies, and `sendVideo` is called zero times (`backend/src/modules/telegram/capture.integration.test.ts:203-236`).
- The protected send transaction takes share locks on delivery/reference/Memory/membership/family/identity before calling `sendVideo` (`video-delivery.ts:99-138`). PostgreSQL updates used by revoke/downgrade and soft-delete conflict with those share locks, so the inspected implementation should serialize the opposite direction.
- There is no deterministic regression test that blocks after the protected send section has acquired its locks, starts revoke/downgrade or Memory soft-delete, proves that mutation is waiting, releases send, and then proves the mutation commits. Repository search found only the pre-final-authorization barrier test. Therefore the handoff claim that both directions are regression-protected is not demonstrated, and H1 cannot be marked RESOLVED under the requested rule.

## H2 verification

**REOPENED — current implementation covers the normal flow, but the claimed browser regression evidence does not cover the full required boundary.**

- Fresh browser E2E passed single photo, two-photo album, `1 / 2 → 2 / 2`, close, browser back, focus restoration and exact scroll restoration (`webapp/e2e/feed.spec.ts:138-170`). The two-photo screenshot was inspected.
- Production code obtains each slide through authenticated `transport.raw`, creates object URLs, and registers a PhotoSwipe `destroy` callback that revokes every slide URL, restores scroll and restores trigger focus (`FeedPage.tsx:267-305`).
- The E2E does not instrument/assert `URL.revokeObjectURL`, and it exercises `page.goBack()` only; it does not invoke the HostBridge back path or a Telegram host-back callback. Consequently removing the revoke callback or breaking the host-back bridge would leave the named E2E green. The present code path appears correct, but H2 is not fully closed by the regression evidence required by this verification.

## Regression commands/tests

All commands below were run at final HEAD `46320328…`; final HEAD differs from implementation HEAD only by the two declared Markdown artifacts.

| Profile | Command / evidence | Result |
| --- | --- | --- |
| Git preflight | root/status/branch/HEAD/origin-main/worktrees/sanitized remotes | exit 0; clean expected worktree, branch and SHAs |
| Contracts | `bun run test:contracts` | exit 0; 39 passed, 0 failed, 158 expects, 6 files |
| Backend unit | `bun run test:backend:unit` | exit 0; 346 passed, 0 failed, 995 expects, 63 files |
| Webapp unit | `bun run test:webapp` | exit 0; 96 passed, 0 failed, 778 expects, 24 files |
| Feed real-stack E2E | `bun run --cwd webapp e2e -- feed.spec.ts` | exit 0; 7 passed, 0 failed; exact required filter |
| Focused PostgreSQL integration | six Telegram/Memory/private-media/FamilyAccess/T08 suites | exit 0; 61 passed, 0 failed |
| Family browser E2E | `bun run --cwd webapp e2e -- family.spec.ts` | exit 0; 2 passed, 0 failed |
| Fresh migrations | feed, family and focused integration runners | exit 0; all 19 migrations freshly applied in isolated PostgreSQL |
| Typecheck | `bun run typecheck` | exit 0; 0 errors; one existing website deprecation hint |
| Production build | `bun run build` | exit 0; all workspaces built; existing website chunk-size warning |
| Architecture | `bun run architecture:check` | exit 0; 599 source files checked |
| Lint | `bun run lint` | exit 0 |
| Dependency audit | `bun run audit` | exit 0; no known vulnerabilities |
| Diff | `git diff --check b80ba301…ed4f7af0` and `ed4f7af0…46320328` | exit 0 |
| Secret scan | tool availability plus filename-only fallback signature scan over implementation diff | dedicated scanners unavailable; fallback found no matching changed file |
| P1-4 focused reproduction | production coordinator/hook, duplicate path ID, detail activation/unmount, hidden transition | exit 0; card pause count remained 0 (finding reproduced) |

The populated-upgrade and repeat-`migrate deploy` commands were not repeated in this verification. The immutable-head handoff records a preserved populated row and `No pending migrations to apply`; this was checked against the additive migration SQL and against multiple fresh 19-migration deploys, but is not reported here as a fresh rerun.

Visual artifacts inspected:

- `webapp/e2e/.artifacts/t07-feed.png` — fresh full-page synthetic feed screenshot, 1280×9136, 438931 bytes.
- `webapp/e2e/.artifacts/t07-photoswipe.png` — fresh synthetic album on slide `2 / 2`, 1280×720, 17510 bytes.

These browser artifacts are not iOS/Android Telegram acceptance.

## New findings

- NEW P0: none.
- NEW P1: none. The player-ID collision is classified as **P1-4 REOPENED**, because it leaves the original hidden/single-coordinator finding incompletely fixed.
- NEW P2: none.
- No cosmetic findings were created.

## Existing caption/revoke P2

**EXISTING / UNCHANGED.** `git diff b80ba301…ed4f7af0` contains no change to `backend/src/modules/telegram/infrastructure/prisma-caption-repository.ts` or `backend/src/modules/telegram/application/captions.ts`. `process-task.ts` changes only the Telegram-video delivery result handling in the relevant diff. The confirmed Control B caption reply vs membership revoke/downgrade P2 remains deferred; it is not a new T07 regression and was not fixed in this verification.

## Mobile acceptance status

- iOS: NOT RUN.
- Android: NOT RUN.
- Browser E2E and screenshots do not substitute for real Telegram clients.

## Final verdict

P1 REOPENED: **P1-4 (1)**

P2 REOPENED: **none (0)**

H1 REOPENED: **yes — reverse protected-send serialization lacks the required deterministic regression test**

H2 REOPENED: **yes — URL revocation and host-back are not asserted by the claimed browser regression test**

NEW P0: **0**

NEW P1: **0**

NEW P2: **0**

CODE READY: **NO**

MOBILE ACCEPTANCE: **NOT RUN**

READY FOR MOBILE ACCEPTANCE: **NO**

Required next action is a separate T07 fix/evidence round for P1-4 and the H1/H2 regression gaps. Do not start T09. No commit, push, PR, merge or deployment was performed.
