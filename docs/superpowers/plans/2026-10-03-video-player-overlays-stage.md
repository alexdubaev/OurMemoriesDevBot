# Video player overlays and stage background implementation plan

Task: FIX-VIDEO-PLAYER-OVERLAYS-AND-STAGE-BACKGROUND
Base: 1682ef5e0a9e22eef3c0611637cf67e7f8df70b4
Branch: fix/video-player-overlays-stage
Worktree: D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/video-player-overlays-stage

Goal: preview contains only poster, central Play and single duration; playing/paused uses one custom controls panel; no app video-bottom gradient in any state; portrait contain bars use canonical #151315.

Architecture: retain HTMLMediaElement engine, private source/readiness/cache and MAX source/error lifecycle. Share the small playback controls/fullscreen presentation primitive if needed, rather than duplicate another renderer. Transition on successful native play event; failed play remains preview. Unmount/pause inactive carousel media via existing registration. Inline native controls never compete with custom controls. Prefer stage DOM fullscreen; retain feature-detected WebKit video fallback without changing media backend.

Allowed paths: webapp/src/features/feed/FeedPage.tsx, webapp/src/features/feed/presentation/memoly-feed.css, small video-presentation helper in feed, webapp/tests/feed.test.tsx and focused helper tests, webapp/e2e/private-video-poster.* and scoped new overlay screenshot specs/snapshots, docs/review/video-player-overlays-stage (synthetic evidence), this plan.
Forbidden: backend, schema/migrations/storage/API/contracts, MAX ingestion, rendition/poster worker, bootstrap, shared package/config/lock manifests.

- [x] Fresh origin/main fetched, isolated branch created; scout confirmed two bottom-control gradients at CSS166/337, unconditional PrivateVideo controls, light stage/poster backgrounds, MAX native controls/duration overlap, missing WebKit private fullscreen fallback.
- [x] Baseline feed unit: 80 pass, 0 fail, exit0.
- [x] Worker adds meaningful failing preview/state/portrait/browser tests and verifies RED, implements minimal state/CSS/controls fixes, runs targeted tests.
- [x] Synthetic portrait and landscape actual-media visual checks; Chromium/WebKit screenshot baselines and comparison rerun; preview/playing/paused, carousel2/4/mixed, away/back/reopen/fullscreen and native fallback semantics.
- [x] Lead inspects actual diff and evidence, runs full webapp/typecheck/lint/build/architecture/template.
- [ ] One fresh scoped read-only reviewer; one bounded fix pass/narrow recheck if P0/P1/P2.
- [ ] Fetch/reconcile main, commit/push/PR and required CI; squash merge exact green head.
- [ ] Canonical deploy fresh merged main; 4 service revisions, health/live+ready, startup errors and migration parity.
- [ ] Owner physical iPhone/MAX acceptance remains pending; final exact fenced handoff then STOP.

Stop conditions: backend/source/API change needed, unexpected shared-file conflict, security/privacy/lifecycle architectural choice, broader refactor. Report to lead; no child agents, no commit/push/production by worker.
