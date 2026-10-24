# Wishlist production completion plan

> For agentic workers: execute bounded tasks under teamlead-development. Owner authorized checks, publication, merge and guarded deployment on 2026-10-24. No destructive database rollback.

Goal: deliver IDEA-0001 through PR #227, preserving accepted albums and UI v4.
Architecture: preserve Bun/Hono/Prisma modular monolith, shared Zod contracts, React/Vite and existing private media/currentColor WebP icons. Integrate with current main rather than replacing its album implementation.
Spec: manifest.md and spec.md in this directory; later owner navigation and icon instructions override their older four-slot layout.

## Source and ownership
- Original base: 84e45a9b05402b7674a776e4eb88524cfa8cf7ae.
- Received head: 138a8f043d3d8f943d3578ab04f8b432e04a9fd7.
- Current main: b4cdbbc49500d0850a64075d1bfba683a9bd22ad.
- Worktree: D:/codex/OurMemoriesDevBot-GitHubSync/.worktrees/wishlist; branch feat/wishlist; existing PR #227.
- Allowed paths: existing wishlist changed paths; conflicting album integration paths; relevant regression tests; gift WebP assets and manifest; release compatibility probes/guards and runbook only if required by measured candidate recovery evidence; this task's .autopilot records.
- Forbidden: unrelated product features, old migrations, production data edits, DB restore/drop, guard bypass, unrelated branches/worktrees, secrets, GitHub Actions.

## Task 1 — integrate accepted main and finish wishlist
- [ ] Resolve current merge conflicts by preserving both modules/relations/imports/routes. Cleanup must exclude both giftPhotoFor and albumPhoto in both predicates. Preserve all existing album migrations and behavior; no migration rewrite.
- [ ] Integrate App screen/visited/scroll/callback state and existing global composer; full navigation order: Feed, Albums, Add, Gifts, Family. Viewer retains existing read-only placeholder in third slot. Forward callbacks from every surface. Use data-nav-position gifts consistently for gift, without renaming unrelated position contracts.
- [ ] Gifts 403/404 list access failure uses the existing family access-loss cleanup and hub transition; prevent stale private gifts from rendering after revocation. Verify scope/cache boundaries and a real browser revoked-member journey.
- [ ] UnmarkBought on an already-unmarked unreserved gift is a no-op; another holder's purchase remains protected. Verify API/domain behavior and unchanged version.
- [ ] Prevent form dismissal through cancel, backdrop, Escape and swipe while saving; retain forced family/account teardown. Verify with delayed save, not source/markup assertions.
- [ ] Extend real PostgreSQL photo PATCH negative cases (foreign, wrong-purpose, occupied) and assert old photo content 404 after replacement, preserving original state on rejected PATCH.
- [ ] Install selected gift icon as six optimized RGBA WebP assets, synchronize public copies and manifest; no SVG, runtime generation or screenshots in bundle. Colors follow current UI v4.
- [ ] Narrow checks first; useful red/green regressions where behavior changes. Update existing memoly-v4/max-family-audit navigation expectations and short gift journey without adding broad visual matrices.

## Task 2 — prove source and recovery
- [ ] Commit exact candidate after inspecting explicit staged paths, whitespace and secrets.
- [ ] bun run verify:full on exact candidate; real isolated *_test PostgreSQL and owned ports/storage. If Docker network exhausted, own disposable PostgreSQL plus explicit loopback TEST_DATABASE_URL and TEST_SKIP_DOCKER/E2E_SKIP_DOCKER.
- [ ] Independent fresh GPT-6 Luna High read-only review of current-main...candidate with ACL, media lifecycle, races, host bridge, albums integration and recovery focus. One bounded fix pass and relevant closure checks; no formal repeated review loop.
- [ ] Establish current candidate -> accepted v4 recovery -> candidate compatibility using synthetic PostgreSQL and exact immutable/source-bound recovery guards; do not assume additive SQL authorizes an existing fingerprint. Preserve grants/ledger and data. If required update exact attestations with measured evidence and test mutation rejection before release.

## Task 3 — publish and release
- [ ] Recheck current origin/main; merge it into task branch if moved, recheck affected risks.
- [ ] Record exact SHA, FULL commands/counts/exits, review and recovery evidence in PR; Ready; squash with expected HEAD.
- [ ] Confirm merged source/tree in main and applicable FULL evidence on exact release SHA, including cumulative deployed delta.
- [ ] Deploy via tracked Selectel ci-release.sh FULL with migrate; host lock/disk/source/images/backup/readiness/recovery/manifest guards mandatory. No direct SQL/Compose bypass or destructive rollback.
- [ ] Confirm production SHA/images/migration/public smoke/recovery readiness; safely clean only own branch/worktree after saved merge; synchronize local main. Provide copied Markdown HANDOFF.

## Review focus
Revoked membership and stale cached photos; cross-family/wrong-purpose/reused media PATCH; reservation and purchase idempotency/concurrency; preserved album source/cleanup behavior; navigation/composer and pending-form dismissal; exact candidate recovery rather than inherited source attestation.
