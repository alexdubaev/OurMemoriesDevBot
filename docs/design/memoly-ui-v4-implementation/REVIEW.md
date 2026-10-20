# Independent review — MEMOLY-UI-V4-IMPLEMENTATION-AND-OWNER-PREVIEW

- Base/current HEAD: `f0a4e8ba3fa174f43c661ab2a70a6b744c6543f4`
- Branch/worktree: `feat/memoly-ui-v4-implementation` / `D:/codex/TG_OurMemoriesDevBot/worktrees/memoly-ui-v4-implementation`
- Reviewed: full `git diff HEAD`, untracked source/assets, final source manifest fingerprint `c6dd401d28cd156c022619aa04508dfc7d3f19e9b943d3af64684e77703537b5`, supplied visual/form evidence and implementation logs.
- Scope: read-only review. No files outside this report were changed.

## Finding

**P2 — Browser safe-area inset is omitted from the bottom navigation.**

At `webapp/src/components/ui-v2/shared-skin.css:50-51`, the v4 navigation height and bottom padding use only `var(--host-inset-bottom)`. The header CSS explicitly accounts for both the normalized host inset and `env(safe-area-inset-top)`, while the bottom navigation has no corresponding `env(safe-area-inset-bottom)` handling. On an iPhone browser/PWA with `viewport-fit=cover` and a zero host inset, the 62px navigation surface can reach the physical screen edge, placing its controls in the home-indicator safe area. The supplied inset evidence covers host inset values, not a nonzero browser safe-area environment.

**Suggested bounded fix:** derive one bottom-safe-area value as the maximum of the normalized host inset and CSS `env(safe-area-inset-bottom, 0px)`, and use it once for navigation padding/height and feed clearance. Preserve the current geometry when both values are zero and when host inset is already larger.

## Review result

No other P0/P1/P2 findings identified in the reviewed diff. The presentation changes retain existing family permissions and callbacks, feed/query/cache/auth boundaries, media playback controllers, shared avatar loading, invite actions, and the current theme preference provider. New production visuals are WebP assets; the harness and reference fixtures are isolated to E2E paths. The media ratio helper clamps dimensions and applies the specified mixed-video/fallback behavior. The page zoom restriction and external font link are removed, while targeted media gesture handling remains.

Evidence records the canonical Chromium geometry at 390×844 and responsive 320/430 widths, plus host inset variants. Physical iPhone/MAX acceptance was not run. Branch preview and owner visual acceptance remain pending the separately noted target/data/access decision; no preview, merge, or deployment was performed.

## Narrow closure — P2 safe-area finding

**Status: resolved in the frozen source snapshot.** Reviewed the 30-file manifest fingerprint `fc4e97c4f2ffe4e238abe9fa6d63d8f4ecf1a75b834124e8da4bed46ac0c63e7` after the bounded correction.

The stylesheet now defines browser bottom safe area from `env(safe-area-inset-bottom, 0px)` and computes `max(host, browser)` for the fixed navigation, feed bottom clearance, family overview, child profile, and family management. Navigation applies that effective inset once as bottom padding and includes it once in the bar height; feed and family content clear the same effective inset. Focused E2E assertions simulate browser inset 20px with host values 0/12/30px and check navigation heights 82/82/92px plus feed clearance; family checks verify overview and child-profile clearance. The updated nav assertion also verifies the inactive home indicator is hidden and the active family indicator is shown.

The CSS is wired to the real browser environment variable; the E2E assertion overrides its custom property to exercise nonzero browser inset behavior in Chromium. Supplied verification for the frozen source reports canonical Playwright 7/7 passed and `git diff --check` exit 0. My local `git diff --check` also exits 0, with only existing LF/CRLF normalization warnings. No further finding remains for this issue. This was a bounded closure check only; no new whole-change review was performed. Branch preview and owner acceptance remain pending.
