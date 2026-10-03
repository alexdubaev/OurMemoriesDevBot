# Reference-led owner revision
Task: MEMOLY-UI-V2-REACT-LAB. Base: d9b1182f271fb40849f35eb4a922b1864b09c15c.
Branch/worktree: design/ui-v2-react-lab / .worktrees/ui-v2-react-lab.
One implementation agent, following the owner's explicit workflow.

Allowed paths: webapp/src/dev/ui-v2/**, webapp/ui-v2.html, webapp/ui-v2.vite.config.ts,
webapp/e2e/ui-v2/**, docs/design/ui-v2/**. No production integration or API/contract changes.

Latest owner decision supersedes six color variants: one cream/sage interface; change only
profile-cover images, which the owner is generating. The supplied watercolor reference is
the composition target. Do not generate substitute header artwork or SVG.

1. Shared FamilyHero: centered official logo/tagline, back/settings, round child avatar and name.
   Optional raster cover sits behind live controls; equal Feed/Family geometry.
2. MemoryCard: photographic author avatar, large rounded photograph, caption and existing reactions.
   Bottom navigation: soft selected pill and circular central Add action.
3. Remove alternate palettes and theme controls; keep one palette. Five redundant color catalog
   states are removed (243 states remain). Legacy theme URLs fall back to the single palette.
4. Add local-only cover-file preview in Lab, with object-URL cleanup; persist in memory across screens.
   The product artwork slot remains empty until the owner supplies their covers.
5. Validate screenshots at mobile widths, all existing flows and the cover-swap invariant; update docs.
   No invented comments/bookmarks, fake OS chrome or new production features.

Acceptance: shared fixed geometry, unchanged palette on cover swap, no overflow/broken assets,
all existing non-color states work. Final artwork acceptance is pending owner cover files.
The earlier independent technical review is historical, not a review of this later visual diff.
