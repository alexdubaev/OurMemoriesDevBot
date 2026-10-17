# MEMOLY-FULLSCREEN-CAROUSEL-SWIPE-FIX — plan

Task owner: lead/orchestrator. Base: e383d79269a3595f4c6cabedf167335aea042cf3.
Branch: fix/memoly-fullscreen-carousel-swipe.
Worktree: D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/memoly-fullscreen-carousel-swipe.

## Goal and scope
Restore one-finger horizontal navigation directly on fullscreen photos for MAX and Web/PWA. Preserve order, contain sizing, private access/cache ownership, video cleanup, buttons, keyboard, index synchronization and reopen behavior. No new dependencies, messenger work, release-gate changes, merge or deployment. PRs #176/#177 are excluded.

Allowed paths: webapp/src/features/feed/FeedPage.tsx; its presentation/memoly-feed.css (gesture policy only); webapp/e2e/fixed-carousel*; focused fullscreen swipe spec/config under webapp/e2e; this task's docs/mvp/review/MEMOLY-FULLSCREEN-CAROUSEL-SWIPE*.md. Root config, manifests, locks, contracts, backend/auth/ACL/schema and other tasks are forbidden.

## Single implementation outcome
1. Reproduce unchanged PhotoSwipe and MixedMediaViewer separately in the existing synthetic browser harness. Capture observed indices. Add a concise three-photo album and photo/video/photo fixture mode if needed; preserve existing fixture behavior by default.
2. Add a focused behavioral regression test that fails on missing mixed fullscreen swipe before production edits. Check album boundaries separately; preserve working PhotoSwipe gestures/pinch. If default PhotoSwipe wrapping violates the required first/last boundaries, only disable its loop option.
3. Add local single-touch gesture handling to the existing fullscreen media area. Require a deliberate predominantly horizontal movement; abandon vertical, multitouch, cancelled and stale gestures. Navigate at most once through existing navigate(index), which owns pause/index reporting. Exclude interactive controls and video seeking from recognition. Keep existing native zoom where supported, with no global gesture listeners. Retain original layout and contain sizing.
4. Verify photo -> video -> photo, second-item opening, boundaries, both directions, counter/feed synchronization, close/reopen, buttons, range controls, pinch/cancel/jitter/vertical rejection, and previous video pause/source release. Use Chromium iPhone/Android viewports and WebKit where available. Distinguish synthetic events from trusted native input and physical-device evidence.
5. Lead inspects actual diff and runs relevant deterministic checks. One fresh independent review, one bounded fix pass if needed, narrow closure check. Prepare separate draft PR to main; no merge/deploy.

## Verification
Existing baseline: bun run --cwd webapp e2e --config e2e/fixed-carousel.playwright.config.ts.
Focused regression: dedicated fullscreen swipe spec/config command to be recorded after baseline route verification.
Static validation: bun run typecheck:webapp; targeted ESLint for changed source/tests; git diff --check.
No full application audit or full release suite; verify:local remains required before future main publication and is not a claim of this task branch.

## Stop conditions
Escalate security/ACL/cache ownership redesign, new dependencies, migrations, changes to forbidden paths, unrelated dirty work, or unexplained failures in the affected path. Infrastructure failures must be reported distinctly from product passes. No physical iPhone is available; physical validation remains unconfirmed.

## Discovery evidence
- `bun install --frozen-lockfile`: 864 packages installed, exit 0; dependency manifests/lock unchanged.
- Existing baseline `bun run --cwd webapp e2e --config e2e/fixed-carousel.playwright.config.ts`: 1 passed, exit 0.
- Focused regression command: `bun run --cwd webapp e2e --config e2e/fullscreen-swipe.playwright.config.ts` (dedicated port 5197).
- Before production edits, Chromium iPhone touch emulation with trusted CDP touch input advances PhotoSwipe 1/3 -> 2/3; mixed fullscreen image stays at 1/3. Focused regression fails at expected mixed 2/3 assertion (exit 1).
- Root cause isolated to absent MixedMediaViewer gesture handling. PhotoSwipe swipe engine remains intact.
- Final lead focused run: 3 passed in 23.6s, exit0. Typecheck and targeted lint exit0 after normal generated client setup.
- Settled PhotoSwipe boundary reproduction confirmed default wraparound; only loop:false added.
- One fresh independent read-only review: no findings. No extra review loop required by owner policy.
- Allowed evidence paths extended by lead to two synthetic screenshots under docs/mvp/review/evidence/fullscreen-carousel-swipe/.
