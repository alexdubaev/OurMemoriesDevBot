# PERSISTENT-UI-AND-MEDIA-PREVIEW-CACHE verification

## Baseline (2026-10-02)

- Canonical remote: `https://github.com/alexdubaev/OurMemoriesDevBot.git`.
- Fresh `origin/main` and task base: `283265ed743ddb744308c4eb296644468b7692d0`.
- Task branch: `feat/persistent-ui-media-cache`.
- Isolated worktree: `.worktrees/persistent-ui-media-cache` under the documentation workspace. Existing checkout/worktrees left untouched.
- Production backend, worker, scheduler and actual `memoly-static-1` image revisions/tags match base. `memoly-webapp-1` is the unmanaged Caddy gateway, not the current application static image.
- Public `/health/live` and `/health/ready`: HTTP success, `{"status":"ok"}`.
- Production checkout clean and at base; filesystem free space roughly 7 GiB.
- Public HTML, hashed JS/CSS, artwork and service worker have ETag but no Cache-Control.
- Baseline webapp unit suite: 440 pass / 0 fail / 3138 expectations (implementer report, pending lead post-change verification).
- Lead baseline `bun run architecture:check`: exit 0, 731 source files.
- Lead baseline `bun run template:check`: sandbox cannot spawn Git (EPERM); same check outside sandbox exit 0.

## Final deterministic checks

Lead verification on the reviewed implementation (all exit 0):

- `bun run test:webapp`: 443 pass, 0 fail, 3157 expectations across 69 files.
- Backend targeted `bun test ./src/modules/media/application/media-service.test.ts ./src/modules/max/infrastructure/video-playback.test.ts ./src/modules/max/max-api.test.ts`: 65 pass, 0 fail, 225 expectations across 3 files.
- `bun test ./tests/selectel-deployment-ownership.test.mjs`: 12 pass, 0 fail.
- `bun run typecheck`: backend, contracts, webapp and website pass. Website reports one existing deprecation hint, no errors.
- After reviewer fixes: `bun run typecheck:webapp`, `bun run lint`, `bun run architecture:check` pass; architecture scans 783 source files.
- `bun run template:check`: pass.
- Final `bun run build:webapp`: pass, 696 modules, main JS `index-CBMRbIJF.js`; CSS `index-BeyRNI3V.css`.
- API CORS `bun test ./src/app.test.ts`: 9 pass, 0 fail, 39 expectations. The image-purpose header is allowed only by API CORS, not signed-upload CORS.
- `git diff --check`: pass. Original mixed line endings in MAX adapter files preserved, no unrelated normalization.

Windows child-process/native-runtime checks were run outside the filesystem sandbox where necessary; earlier sandbox EPERM/native binding failures are not treated as application successes.

## Independent scoped review

One fresh read-only reviewer (`gpt-6-luna`, high) reviewed the whole active change, with the original task specification. Two P2 findings were confirmed: image 403 did not purge the family, and query persistence was not bounded before writing. The implementer fixed both. Narrow read-only rechecks confirmed both resolved and checked CORS, decoded-poster seen readiness, and removal of the eager MAX video load. No outstanding P0/P1/P2. Reviewer also ran a scoped 79-test suite successfully. This technical review is not a GitHub approval.

## Browser / delivery

Lead final Chromium command from `webapp`:

`bun run e2e --grep "restores the authenticated family presentation from IndexedDB after a page restart|renders intrinsic photo and MAX video ratios and opens the memoLy bot"`

Result: 2 pass, 0 fail, exit 0 (49.3 seconds including isolated test database setup/teardown). It proves restored Feed before held refresh, updated child after fresh response, actual A/B QueryClient isolation, schema discard, query count/byte bounds, photo/avatar/poster hits, new avatar ID miss, video/206 rejection, image age/LRU bounds, logout/family cleanup and late-identity rejection. The MAX case confirms decoded poster/seen readiness, zero video content requests before Play, and successful playback over the canonical network path after Play.

Synthetic screenshots, excluded from Git:

- `webapp/e2e/.artifacts/persistent-cache-restored-feed.png`
- `webapp/e2e/.artifacts/max-poster-before-play.png`

Owner welcome-always-on flag and UI design preserved. Native MAX player keeps its canonical URL and explicit retry; source reset still aborts its old resource. Automatic `video.load()` for a newly assigned source was removed because the real browser proved that it fetched bytes before Play despite `preload=none`. Poster decode supplies the existing seen-ready input without changing observer thresholds or the seen queue.

Required CI and release results belong to the PR and final release handoff after publication. No migration or public DTO changes are introduced. Private authenticated production header checks require an authorized session; do not mint an impersonated session or create production fixtures to obtain one.

## Production header follow-up

PR #143 passed `verify-required` on `b368601bb67a67de3c7cbb1e3ee2cdd73fa09705`, then squash-merged as `41f44afc0d1b70c3aa4efbd2b095e7aa8703d67e`. Canonical Selectel release succeeded with no migrations; all four application containers matched that SHA, with zero restarts/startup-failure markers and healthy public live/ready probes.

Real HTTP verification confirmed HTML/SW revalidation and JS/CSS immutable caching, but found the unversioned PWA icon incorrectly immutable. The initial regex could backtrack across filename hyphens. A fresh follow-up branch from accepted main restricts the matcher to existing root `/assets/` files with exactly eight Vite hash characters, keeping nested public artwork/icons on `no-cache`.

Lead follow-up verification: 13 static deployment tests pass, exit 0. The actual production Caddy binary adapts the corrected template successfully without loading it into live configuration (exit 0; formatting warning only). The same independent read-only reviewer confirmed the correction, no outstanding findings. Final follow-up CI/deployment/header results are recorded in its PR and release handoff.

Unauthenticated production synthetic photo/avatar/poster/video-Range probes all returned 401 without public immutable policy. Positive 200/304/206 private-media production headers still require an authorized owner session; local/backend/browser tests cover those policies without reading or creating real production family data.
