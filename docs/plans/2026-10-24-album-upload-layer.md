# ALBUM-UPLOAD-LAYER

Base/main/deployed backend/deployed frontend: ab6b9a55d14db407308a1668605fd72610529b92.
Branch: fix/album-upload-layer. Existing isolated worktree: .worktrees/album-phone-upload (new branch created from fetched origin/main; cancelled work remains only in old local history).

## Required result and proven cause

Owner requires phone-photo selection in album upload to work; ordinary adding to feed works and must retain its current behavior. Reproduction on unchanged production tree9693c0f91ea409e49be290d614b030d1cd73f065: Album -> Add story -> Upload new displays notice/title/cancel only. The album-local opaque fixed ComposerHost atz65 covers body-portalled Drawer overlay/content atz50. The menu remains DOM-visible and can receive synthetic clicks because Radix disables pointer-events on underlying content; DOM-only assertions miss the paint failure. WebKit iPhone13 emulation reproduces the supplied screenshot. Existing actual API album-upload test passed independently (private_storage, same-key attach retry, no feed-memory publication).

## Bounded fix

Only change webapp/src/features/albums/albums.css. While a ComposerHost is nested inside .albums-surface, place body-portalled Drawer overlay above host and content above overlay (e.g.70/71 vs65). Use album-local ancestor scope, not a rule for every ComposerHost. Preserve first menu and second voice/video level, modal focus/back/dismissal and PhotoComposer. The ordinary feed and global Add outside the album-local host must retain existing layers and behavior. No JSX/state/API/upload/private-storage/ACL/contracts/schema/migrations/dependencies/config changes.

## Acceptance and publication

- Baseline screenshot already reproduces owner issue: output/album-upload-check-2026-10-24/webkit-album-chooser.png. Capture and inspect after screenshot on actual unchanged app plus CSS fix, WebKit iPhone13 emulation, synthetic data only.
- Album -> Upload new: visible chooser -> Photo -> existing file chooser -> synthetic PNG preview -> enabled Add to album; cancel/back returns safely. Check second menu level remains visible.
- Normal feed Add remains unchanged. Inspect CSS activation only under album-local host; no normal-feed layer mutation. Native MAX/iPhone not remotely available; emulation is not native acceptance.
- Existing short journey: albums.spec.ts / existing composer publishes once and album attach retries the same operation only. FRONTEND on exact source and final releaseSHA with both deployed basesab6b9a55d14db407308a1668605fd72610529b92: typecheck/lint/build, mapped album units, performed journey, targeted visual acceptance. CSS+docs A-only scope; independent review confirms presentation-only eligibility. No new source-text or exact-style unit tests/baseline matrix for a purely visual fix.
- Fresh independent LunaHigh read-only review after deterministic checks, one bounded fix pass if needed. Then evidence in PR, Ready, expected-head squash merge, verify main tree, FRONTEND on final releaseSHA, guarded frontend-only Selectel release, manifest/public smoke/recovery readiness. Backend/worker/scheduler/gateway/DB unchanged and verified. No schema migration or DB rollback.

## Ownership and stop rules

Worker allowed path only webapp/src/features/albums/albums.css; lead owns this plan and verification/publication. No release-policy exceptions, capability/ACL relaxation, private data, bot messages or unrelated work. If a code/data/security boundary change is necessary, stop and return evidence to lead rather than expanding scope. Wishlist metadata work closed by owner, excluded.