# T07 SOL REVIEW

## Audited state

- Task ID: T07 — Live Feed, single independent final review.
- Base: `b03a82993dd72ceaca0d9724b0194295d5cadd2c`.
- Feature HEAD: `b80ba301911998f07d449b2001db2dd86f9291cc`.
- Branch/worktree: `feat/t07-live-feed` / `D:/codex/TG_OurMemoriesDevBot/worktrees/t07-live-feed`.
- Model: Sol; owner-provided model gate accepted.
- Origin: canonical `alexdubaev/OurMemoriesDevBot`.
- Initial working tree: clean. The only authorized write made by this review is this report.
- Allowed paths: repository-wide read-only inspection and test execution; write only `T07_SOL_REVIEW.md`. Production source/config, commits, remotes, PRs and branches were not changed.

## Diff scope

The audited commit contains one implementation commit, `feat(feed): implement live feed and Telegram video handoff`, with 30 changed paths and 829 insertions / 51 deletions. It changes:

- Prisma schema plus additive migration `20260911120000_block07_telegram_video_reference`;
- Memory DTO/repository/routes and shared contracts;
- Telegram capture mapping, source processing, Bot API port and a new video-delivery service;
- React Query feed API/query code, `FeedPage`, playback coordinator, HostBridge and app composition;
- normative T07/T09/T10/T11 text and the lockfile.

The actual diff does not change `backend/src/modules/telegram/infrastructure/prisma-caption-repository.ts`, `CaptionService.consumeReply`, or the caption/revoke transaction boundary. `process-task.ts` changes only the surrounding Telegram-video branches and command dispatch.

## Commands/tests actually run

| Command / check | Exit code | Result |
| --- | ---: | --- |
| Git preflight (`status`, branch, `HEAD`, `origin/main`, root, worktrees, sanitized remotes) | 0 | Clean `feat/t07-live-feed`; `HEAD=b80ba301…`; `origin/main=b03a829…`; expected linked worktree and canonical origin. |
| Read-only inspection of `WORKPLAN.xlsx` with bundled Python/openpyxl | 0 | Read workbook navigation, task order, T07 row, screens, Control B boundary and sources; workbook was not modified/exported. |
| `bun run test:contracts` | 0 | 38 passed, 0 failed, 155 expectations, 6 files. |
| `bun run test:webapp` | 0 | 91 passed, 0 failed, 769 expectations, 22 files. No T07 feed test file was discovered because none exists. |
| `bun run test:backend:integration -- src/modules/telegram/capture.integration.test.ts src/modules/memories/memories.integration.test.ts src/modules/media/media-access.integration.test.ts` | 0 | 32 passed: Telegram 12, memories 13, private media 7. A fresh PostgreSQL database applied all 18 migrations. |
| Installed TanStack `InfiniteQueryObserver` reproduction: first page succeeds, next page throws | 0 | Result was `status=error`, `isError=true`, `isFetchNextPageError=true`, while cached items remained present. This proves the component's `feed.isError` branch hides retained data after a next-page failure. |
| `bun run --cwd webapp e2e -- feed.spec.ts` | 1 | Playwright started the real backend/webapp, applied all 18 migrations, then failed with `No tests found`. The exact temporary Compose project was removed; post-cleanup container/volume/network counts were `0,0,0`. |
| `git diff --check b03a829…b80ba301` | 0 | No whitespace errors. |
| Dedicated secret-scanner availability plus filename-only fallback scan over changed files | 0 | `gitleaks`, `trufflehog`, `detect-secrets`, `git-secrets`, and `ggshield` unavailable. Fallback found no changed filename matching common private-key/provider-token signatures. |
| `git status --short --branch` after tests, before report | 0 | Still clean. |

Per the explicit review rule, the broad verification cycle stopped once deterministic P1 blockers were confirmed. Backend unit, FamilyAccess-specific regression suites, upgrade/repeat migration deploy, typecheck, production build, architecture check, lint and audit were therefore not independently rerun in this review and are listed under Unverified areas.

## P0

None confirmed.

## P1

### P1-1 — Private audio/video playback eagerly downloads the entire response and bypasses Range/206

- **File:line:** `webapp/src/features/feed/FeedPage.tsx:107-111`, `:129-175`.
- **Production path:** feed/detail attachment → `PrivateVideo` or `AudioPlayer` → `usePrivateObjectUrl` → authenticated `transport.raw(path)` → `response.blob()` → object URL → HTMLMediaElement.
- **Evidence/reproduction:** `response.blob()` resolves only after consuming the complete HTTP response body. Every mounted private audio/video attachment starts this fetch before the user presses play. The later `<video preload="metadata">` cannot turn an already materialized Blob into authenticated backend Range requests.
- **Impact:** legacy private-storage video and voice do not use the required authenticated Range/206 seek path; visible cards can eagerly transfer complete playback files and retain them in memory. On a media-heavy feed this is a deterministic bandwidth/memory regression and breaks required F07.8/F07.21 playback semantics.
- **Existing protection:** the backend private-media endpoint correctly supports Range/206 and family authorization, and the object URL is revoked on component cleanup.
- **Why it does not save the flow:** the client asks that endpoint for an ordinary full response and converts it to a Blob before the media element is involved, so the media engine never negotiates byte ranges with the backend.
- **Minimal direction:** provide an HTMLMediaElement-compatible, still authorization-bound source that can service Range requests (without permanent/public URLs or credentials in browser-visible storage), and add a browser test proving no full transfer before play and 206-backed seek for voice and legacy video.

### P1-2 — A next-page failure removes already displayed feed entries

- **File:line:** `webapp/src/features/feed/FeedPage.tsx:61-69`; `webapp/src/features/feed/queries.ts:13-20`.
- **Production path:** sentinel → `fetchNextPage()` → network/server failure → TanStack infinite-query error state → `feed.isError` → `MemoryList` is not rendered.
- **Evidence/reproduction:** an independent reproduction against the installed query-core returned `status="error"`, `isError=true`, `isFetchNextPageError=true` while the first page remained in `data.pages`. Lines 62 and 64 then render the global error and suppress `MemoryList` solely because `isError` is true.
- **Impact:** a transient failure while loading page 2+ makes every already-read card disappear, directly violating the required rule that a next-page error must not destroy shown entries.
- **Existing protection:** TanStack retains successful pages and exposes `isFetchNextPageError` separately.
- **Why it does not save the flow:** the component ignores the retained data and the specific next-page error flag.
- **Minimal direction:** keep rendering retained pages, show a local retry state at the pagination boundary, and reserve the full-page error for an initial load with no data. Cover this with a component/E2E test.

### P1-3 — The required T07 feed E2E gate does not exist

- **File:line:** canonical `docs/mvp/tasks/07_LIVE_FEED.md` requires `webapp/e2e/feed.spec.ts`; no `feed.spec.ts` exists under `webapp/e2e`.
- **Production/CI path:** required T07 verification command → Playwright filter `feed.spec.ts` → no matching test.
- **Evidence/reproduction:** `bun run --cwd webapp e2e -- feed.spec.ts` exited 1 with `Error: No tests found` after starting the real stack and applying migrations.
- **Impact:** none of the required browser-level feed flows (>40 records, next-page failure retention, refresh/banner/anchor, PhotoSwipe focus/scroll, playback coordination, revoke, Telegram hand-off) has the mandatory executable acceptance gate. This is a required CI regression by the review classification.
- **Existing protection:** contracts, 91 pre-existing webapp unit tests and 32 targeted backend integration tests pass.
- **Why they do not save the gate:** the webapp run contains no T07 feed test file and the backend suites cannot verify rendered/browser/media behavior.
- **Minimal direction:** add the canonical feed E2E suite using the real local backend/PostgreSQL runner, ensure the filter discovers non-zero tests, and require it in the affected verification profile.

### P1-4 — Hiding the Mini App does not pause active media

- **File:line:** `webapp/src/features/feed/playback.tsx:8-20`; repository search finds no `visibilitychange` or `document.hidden` handling in the production webapp.
- **Production path:** user starts voice/legacy video → Telegram Mini App becomes hidden → no lifecycle handler reaches the playback coordinator or HTMLMediaElement.
- **Evidence/reproduction:** the coordinator only pauses other registered players from `activate(id)`. It subscribes to no document/Telegram visibility event and exposes no `pauseAll`. `FeedPage` remains mounted while hidden.
- **Impact:** audio/video may continue playing after the user hides the Mini App, violating F07.7 and the explicit revoke/hidden cleanup boundary.
- **Existing protection:** starting another registered element pauses the previous element; closing detail unmounts that detail's element.
- **Why it does not save the flow:** neither action occurs when the host simply hides the Mini App.
- **Minimal direction:** integrate the supported host/document visibility lifecycle with a coordinator-wide pause operation, update player state on `pause`, and cover hide/show in browser plus real Telegram acceptance.

## P2

### P2-1 — Pointer replay and ambiguous send failure can duplicate Telegram delivery

`backend/src/modules/telegram/application/video-delivery.ts:63-96` reads `deliveredAt`, calls external `sendVideo`, and only afterward performs an unchecked `updateMany`. Two distinct `/start` updates with the same pointer can both observe `deliveredAt=null` and send before either marks it. An ambiguous Bot API failure can also mean Telegram accepted the video while the worker retries. Same-update inbox idempotency and the existing sequential replay test do not cover distinct concurrent updates. Direction: introduce a durable claimed/sending state and a bounded reconciliation/idempotency design appropriate to Telegram's non-transactional side effect; add controlled concurrent replay and ambiguous-failure tests.

### P2-2 — Delivery-pointer rows have no retention cleanup

`video-delivery.ts:43-51` creates one row for every button press. Repository-wide search finds no production delete/retention path for `telegramVideoDelivery`; the only `deleteMany` is test fixture cleanup. Expired/delivered rows therefore grow indefinitely. Direction: add a bounded retention policy and scheduled cleanup indexed by expiry/delivery state.

### P2-3 — Logout clears only `session` keys, not the new feed cache

`webapp/src/features/feed/queries.ts:8-10` stores feed data under `['feed', familyId, filter]`, while `webapp/src/features/auth/queries.ts:120-125` removes only `['session', ...]`. The global QueryClient outlives authentication (`webapp/src/main.tsx:14-33`). Family IDs in the key prevent ordinary cross-family key collision, but family data and viewer-specific `likedByMe` remain in memory across logout contrary to the explicit cleanup requirement. Direction: put all authenticated feature queries under the session namespace or explicitly cancel/remove the whole authenticated cache on session transition.

### P2-4 — Measured T05 waveform data is discarded and never rendered

T05 stores validated 48-peak waveform data in the media layer, but `backend/src/modules/memories/infrastructure/prisma-memory-repository.ts:393-409` hard-codes `waveform: null`, and `FeedPage.tsx:107-145` passes only `playbackPath` into `AudioPlayer`. The UI therefore always renders the generic range input even when real peaks exist. This is a deterministic T05/T07 contract integration gap; fallback is valid only when peaks are actually absent. Direction: map the stored waveform into the Memory DTO and render/seek through those peaks, retaining the accessible slider fallback.

### P2-5 — Telegram denial is silent

For expired, replayed, foreign-requester, revoked or deleted pointers, `deliverFromStart` returns `denied`; `processInbox` marks the inbox processed and returns without any user-facing message. This conflicts with the required honest blocked/invalid-reference error and leaves a legitimate user with no explanation. Direction: return a generic privacy-preserving denial message without distinguishing existence, family or revocation details.

## HYPOTHESES

### H1 — Revoke can race the final Telegram send

`video-delivery.ts:82-93` performs a non-locking membership read and then calls the external Bot API outside a serializing transaction. A concurrent revoke that commits after the read but before `sendVideo` may allow delivery after the final revoked state. This is security-relevant, but no controlled barrier reproduction was run after P1 triggered the stop rule, so it remains a hypothesis. Required verification: a synthetic barrier test that pauses after membership authorization, commits revoke, resumes delivery, and asserts no send.

### H2 — PhotoSwipe lifecycle and album behavior are under-specified by the implementation

`FeedPage.tsx:129-133,179-183` opens each attachment as a one-item PhotoSwipe data source and supplies no explicit dimensions, history/back integration or focus-restoration hook. Library behavior may cover part of focus/scroll management, so this review does not promote the concern without a browser reproduction. Multi-photo navigation and close/back/focus/scroll need direct E2E/mobile evidence.

## Feed/cache/pagination assessment

- PASS from code: query identity includes family and filter; API response validation uses shared Zod contracts; backend cursor keeps the existing family/filter-bound snapshot watermark; backend integration covers sequence-bound pagination, backdated insert and family isolation; likes send desired boolean state and backend reauthorizes current membership.
- FAIL: next-page error hides retained pages (P1-2); required feed E2E is absent (P1-3); authenticated feed cache is not cleared on logout (P2-3).
- Not accepted as complete: client page-ID deduplication, 15-second visible refresh, scroll-anchor preservation and the new-items banner are not covered by any T07 test. The current banner observes the first item only after query data has already changed and then calls another full `refetch`, which is not evidence that reading position is preserved.
- Likes optimistic update/rollback exists in `queries.ts:23-47`; rapid overlapping mutations and rollback ordering were not independently exercised.

## Telegram-video security assessment

- Confirmed positive controls: 192-bit random opaque pointer with only its SHA-256 hash stored; five-minute TTL; requester user, family and reference binding; request-time FamilyAccess plus final ExternalIdentity/current-membership checks; memory family/status/deleted checks; private-chat-only update normalization; recipient chat comes from the Telegram update, not the Mini App; viewer can request viewing without receiving write capability; `/start watch_…` returns before invite/onboarding/caption command handling.
- Confirmed confidentiality: pointer/deep link contains no `file_id`, bot token, source chat/message ID, caption, storage key or private URL. DTO exposes only a guarded relative action path. The Bot API receives the decrypted file ID only server-side.
- Remaining defects/risks: concurrent replay/ambiguous send duplication (P2-1), silent denial (P2-5), and unverified revoke/send interleaving (H1).

## Negative pipeline guarantees

- **No full download:** PASS for new Telegram-origin video production branch; `processSource`/mixed-album code excludes video from `ingestSourceMedia`, and the integration test observes zero download calls.
- **No S3 original:** PASS; Telegram video gets no planned MediaAsset ID and no media row/object write.
- **No ffmpeg:** PASS for the new Telegram-only branch; no MediaAsset/rendition task is created.
- **No ffprobe:** PASS for the same reason.
- **No transcode:** PASS; published Memory is linked directly to the encrypted Telegram reference.
- **No Telegram `file_id` leak:** PASS for API/contracts/client. The plaintext ID exists only inside the encrypted inbound payload before publication and transiently after server-side decrypt for `sendVideo`.
- Existing download/transcode code remains reachable for photo, voice and legacy private-storage media only; no hidden Telegram-video fallback to it was found.

## Pointer security assessment

Entropy, TTL, requester/family/memory binding, hashed-at-rest pointer storage, soft-delete check and final current-membership check are present. The pointer is not treated as authorization by itself, and copied use by another ExternalIdentity is denied. Database growth, concurrent replay, ambiguous send and revoke serialization are not complete (P2-1, P2-2, H1). No client-selected `chat_id` path was found.

## Migration/encryption assessment

- The migration is additive: one unique index plus two new tables; existing rows are not rewritten or deleted and nullable/backfill work is unnecessary.
- `file_id` is encrypted with the existing server-side Telegram payload crypto; ciphertext, IV and authentication tag are stored. No encryption key is present in source. Composite source/memory-family foreign keys prevent cross-family reference substitution, and delivery rechecks the relationship.
- `file_unique_id` remains plaintext metadata; it is not a usable Bot API download identifier and is not exposed in DTO/client.
- A fresh deploy of all 18 migrations passed twice as part of separate isolated test starts. A populated upgrade migration and a second `migrate deploy` against the same database were not rerun after P1 and remain unverified by this review.

## T05/T08 regression assessment

- Targeted Telegram, Memory and private-media integration suites passed 32/32; contracts passed 38/38; existing webapp tests passed 91/91.
- Telegram captions, ForceReply, `/cancel`, TTL, photo/voice source capture, duplicate source protection and private-media Range endpoint remain green in those targeted suites.
- FamilyAccess/revoke behavior is exercised indirectly by Memory/Telegram/media tests, but the dedicated T08 family suites and family E2E were not rerun after P1.
- Legacy private-storage video server semantics were not deleted, but the new client playback integration breaks required Range behavior (P1-1).

## Existing caption/revoke P2

**Unchanged.** T07 does not modify `prisma-caption-repository.ts`, `CaptionService.consumeReply`, or its membership-locking/transaction boundary. The confirmed Control B race remains:

> Existing confirmed P2: caption/revoke race — deferred to targeted post-T07 hotfix.

It is not counted as a new T07 P2 and was not fixed in this review.

## Mobile acceptance

- iOS: **NOT RUN**.
- Android: **NOT RUN**.
- Final screenshots: **NOT RUN**.

Manual checklist for both iOS and Android Telegram:

1. Open a synthetic family feed with 40+ mixed entries; filter each kind, scroll through 3 pages, confirm no duplicates and preserved position.
2. While loading the next page, interrupt the network; already shown cards must remain and a local retry must work.
3. Insert a new and a backdated entry while reading; confirm the new-items banner and snapshot/scroll anchor behavior.
4. Open single and multi-photo memories; verify contain, pinch/zoom/swipe, Telegram Back/Close, focus and scroll restoration.
5. Play prepared voice with 48 measured peaks and fallback voice without peaks; seek with touch and accessibility controls.
6. Play legacy private-storage video; verify no autoplay, Play/Pause, Range-backed seek, time, fullscreen and Back/Close cleanup.
7. Start a second audio/video and hide the Mini App; the first/active media must pause and remain stopped after logout/revoke.
8. Open Telegram-only video as owner/full/viewer; verify personal-chat delivery. Copy the pointer to another user and confirm denial. Revoke between issuance and `/start` and confirm no delivery.
9. Exercise expired pointer, blocked bot, invalid Telegram reference, network failure and 429; verify bounded retry and honest non-leaking feedback.
10. Capture final synthetic-data screenshots at 390px plus 360/430 and 200% text; record Telegram/iOS/Android versions and device models.

## Unverified areas

- Backend unit suite; dedicated FamilyAccess/T08 integration and family E2E.
- Feed E2E cannot run because the required file is absent.
- Upgrade-from-populated-state and repeat migrate deploy.
- Root/webapp/backend typecheck, production builds, architecture check, lint and dependency audit at this feature HEAD.
- Dedicated entropy/credential secret scanner; only a bounded signature fallback ran.
- Real Telegram Bot API, real iOS/Android Telegram, production object storage/database, network/429/blocked-bot behavior and final screenshots.
- Controlled concurrent pointer replay, revoke-vs-send and ambiguous Bot API delivery reproduction.
- Full PhotoSwipe album/history/focus behavior, scroll anchors, visible-only refresh and rapid overlapping like mutations.

## Final verdict

P0: 0
P1: 4
P2: 5 new T07 findings
HYPOTHESIS: 2

CODE READY: NO

MOBILE ACCEPTANCE: NOT RUN

MERGE READY: NO

Exact remaining gates:

1. Fix and independently verify P1-1 through P1-4.
2. Add a discoverable, passing real-stack `feed.spec.ts` covering the canonical T07 scenarios.
3. Rerun the mandatory backend/contracts/webapp/feed E2E/private-media/FamilyAccess/migration/typecheck/build/architecture/lint/audit/diff/secret-scan profile on the fixed HEAD.
4. Resolve or explicitly accept the new P2 items and adjudicate H1 with a controlled defensive concurrency test.
5. Complete and record iOS, Android and final screenshot acceptance.

This review made no production-code fix, commit, push, PR, merge, deployment or T09 change.
