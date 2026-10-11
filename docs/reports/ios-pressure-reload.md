# FIX-IOS-PRESSURE-RELOAD

Status: APPROVED_FOR_OWNER_AUTHORIZED_RELEASE. Owner requested investigation and explicitly authorized deployment on 2026-10-11. Physical iPhone root cause is not established.

- Base: `72714ce421840ba994cadccf90dbd1444384953c` (accepted main and live UI v2).
- Branch: `fix/ios-profile-photo-reload`.
- Worktree: `.worktrees/ios-profile-photo-reload`.
- Allowed paths: `webapp/src/features/feed/FeedPage.tsx`, this report; ignored diagnostic/release artifacts. Production implementation and bounded review fix were delegated; lead owns verification and release.

## Owner evidence

The installed iPhone home-screen application unexpectedly displays the static HTML text `Загрузка memoLy…` during ordinary interface actions. The owner closes the application manually. Changing their profile photograph was one reproduction, but the owner explicitly says the problem also occurs with other actions and seems associated with system load. Device: iPhone 13; owner describes iOS as the latest installed version, without an exact version/build number. Telegram is excluded from this investigation.

## Verified observations

Read-only production checks: HTML and current JavaScript asset return HTTP 200, with correct asset MIME. HTML cache policy is `no-cache`; hashed JavaScript is immutable. Backend and PostgreSQL are healthy. Backend, static and gateway container restart counts are zero.

The text belongs to `webapp/index.html` before React mounts. Checked startup, service worker, resume and own-avatar paths contain no automatic document reload. Retry controls reload only on explicit user action. The profile photograph controls use explicit button types and are separate from the profile name form.

Code inspection identifies resource-pressure candidates, not a proven explanation of the physical iPhone failure:

- Every loaded feed page renders its cards, including private-image decoding and video metadata loading.
- Visited feed remains mounted when hidden behind the family screen.
- `usePrivateImageUrl` retains owned blob URLs until identity/path/user change or unmount; disabling loading alone does not release them.
- Profile photographs are decoded at original resolution. The byte-size cap does not bound decoded pixels, and the existing preview endpoint does not resize ordinary raster formats.

## Investigation acceptance

Use synthetic resources and actual application code to measure live media elements, blob URL lifecycle and decoding across repeated actions. Distinguish bounded warm retention from repeated growth. Only assign a fix for a confirmed resource-lifecycle flaw. Preserve feed navigation state, private access and original photograph bytes. Physical iPhone process eviction remains unproven without device evidence; browser automation cannot establish that result.

## Measured baseline and bounded implementation plan

An isolated Vite/Chromium probe rendered actual `FeedPage` with a synthetic authenticated transport and 30 photo cards across two pages. Command from `webapp`: `bunx playwright test --config=e2e/.artifacts/ios-profile-probe.config.ts --workers=1`; 1 passed, exit 0. All 30 photo elements and 30 live object URLs persisted while the feed was hidden. Ten round trips did not increase counts (30 media responses / 60 decode calls): no action-triggered leak was demonstrated. Synthetic image payloads do not measure real decoded-image memory, and Chromium heap figures are not an iPhone memory budget.

Bounded fix: retain `FeedPage`, its query data and navigation/filter state, but do not render the card list while `active=false`. This unmounts card media/author avatars, runs their existing cleanup and releases object URLs while viewing family/profile. Do not unmount the whole feed surface, change private-cache policy or change original photographs.

Acceptance: the same actual-source probe must show no retained card media URLs while hidden, restore all loaded cards on return without a new feed-page fetch, preserve unread/filter state and scroll restoration, and not leak URLs after repeated transitions/unmount. Run webapp typecheck/lint and relevant deterministic checks. Independent review focuses on URL ownership, viewer cleanup and warm navigation state. Stop if resource release would break viewer borrowing, media cleanup or scroll layout; do not widen to backend/contract changes.

Allowed implementation: `webapp/src/features/feed/FeedPage.tsx` and a small meaningful resource-lifecycle regression if supported by the existing test harness; scratch probe stays ignored. No production publication/deployment has been performed for this task. Physical iPhone reload root cause remains unproven.

## Local implementation and evidence

The production change adds `active` to the condition rendering `MemoryList`; `FeedPage` and its query/state stay mounted. Meaningful RED: actual-source probe observed 30 hidden card photographs when expecting 0. GREEN: visible 30 object URLs, hidden 0, return 30 cards, unchanged 2 feed-page requests, 0 object URLs after final unmount. Three transition cycles stayed bounded. Across the probe, 270 object URLs were created and all 270 revoked by final unmount. Returning reloads card media: raw media calls rose from 30 to 150, a real cost of releasing the prior object URLs. No claim is made that native decoded memory was immediately reclaimed by WebKit.

Lead verification on the actual uncommitted diff:

- `bunx playwright test --config=e2e/.artifacts/ios-profile-probe.config.ts --workers=1` from `webapp`: 1 passed, exit 0.
- `bun run typecheck` from `webapp`: exit 0.
- `bun run lint` from `webapp`: exit 0.
- `git diff --check`: exit 0.

Worker initial typecheck required generating the existing Prisma client; `bun run --cwd backend prisma:generate` succeeded, then typecheck passed. No tracked dependency/schema changes were made.

The direct `FeedPage` harness does not exercise the App scroll-restoration effect or actual profile editor. Synthetic payloads are tiny; actual iPhone memory pressure and the unexpected fresh/stalled document remain unproven. There is no demonstrated per-action leak in the bounded baseline. No persistent browser spec, backend change, contract change or migration was added for this task.

Independent review: GPT-6 Luna (high), one fresh review and bounded fix pass under owner policy. P2 fixed: removing cards reset each carousel to its first attachment while the retained parent index could open a different attachment. Carousel local state and Embla now initialize from the clamped retained index, and report the initial clamped value back to the parent. No unresolved P0/P1/P2 in this bounded change.

Final lead narrow closure on the final source: the same probe passed 1/1, exit 0 (8.6 seconds total). It additionally verifies the selected second attachment survives return, card and details viewer open the same second attachment, and reducing attachment count clamps both carousel and viewers to the available first attachment. Reviewer final typecheck and targeted lint passed, exit 0. `git diff --check` passed. Full-source behavior on physical iPhone remains unverified; the local change reduces confirmed hidden-surface retention and is not presented as an established fix for the owner's unexpected restart.

## Publication verification and release authorization

Verified product commit: `d9ba17ed0fd1a0ebd76b5170201ca0fef73e86fe`, tree `cd74f0f9ca34346728fe7e0f29595345d6edacb4`. An isolated Linux copy was exported with Git CRLF conversion disabled; its indexed tree was confirmed identical before the final gate. The subsequent report update is documentation only.

Full command: `bun run verify:local`, Ubuntu WSL, native Bun 1.4.0 and Node 22.15.0, test Docker accessed through the local root session. All 16 stages passed, exit 0; 661 tests, including 369 PostgreSQL integration tests and 3 critical Chromium journeys. Evidence: ignored `webapp/e2e/.artifacts/ios-pressure-verify-local-linux-release.log`. A separate actual-source V2 lifecycle probe passed 1/1, exit 0 (`ios-pressure-v2-release-probe.log`).

Earlier Windows full runs stalled before the last two users integration scenarios, despite isolated users 18/18 passing; those processes were stopped and their disposable databases cleaned up. They are failures, not green evidence. Additional Linux preparation failures involved missing runtime tools, Git archive line endings/temporary storage, Docker permissions and ffprobe/browser dependencies; no tests were removed or weakened. The final complete gate passed on the exact source tree after environment preparation.

Owner authorization: «Ну деплой, будем проверять», reiterated «Просто закончи деплой». Publication plan: squash PR to main, confirm identical accepted tree, then guarded `ci-release.sh` deployment of the exact accepted SHA with migration=false. Existing data and video storage routing remain unchanged.

Rollback: preserve previous immutable images and the original legacy UI image/archive. `/opt/memoly/rollback-legacy-ee2b25d.env` is separately retained root-only so the new release's default previous-release rollback does not replace the original-interface option. Legacy return uses compatible `rollback-static`; no database restore is part of this release. Deployed SHA/manifest and public smoke are recorded in the release evidence after promotion.
