# MEMOLY-MINIMAL-UI-BROAD-STAGE-1-COMPLETION

Branch: `experiment/pwa-minimal-feed`; permitted worktree: `.worktrees/pwa-crash-diagnostics`; base: `4fef84739467b6497c3214be14aba61fe90d02c9`. Main remains `920f223fae0216be6a92b6c3ad2199c87bad0c0a`. The owner's new methodology authorizes broad structural restoration and supersedes the header-stage pause only for this task. Stage 2 requires the owner's physical iPhone result.

This stage restores an independent bottom navigation and memory card anatomy in the diagnostic build. Geometry comes from the approved UI v2 presentation references, including `components/ui-v2/shared-skin.css` for the floating navigation and `features/feed/presentation/memoly-feed.css` for cards. These files are references only and are never imported. The diagnostic stylesheet remains the sole stylesheet.

The independent cards use author/name/avatar/date, then unchanged media/carousel and caption, then actual reaction totals and current-user reaction from the existing DTO. Author avatars use `author.avatarPath` with the existing `usePrivateImageUrl` lifecycle, identity/family gates and private cache. No new metadata API, loader, reaction business logic or media handling is introduced. Unavailable actions are visibly disabled; reaction totals are read-only in this stage. Family role comes from existing authorized family data.

The child header is retained. The carousel, dot navigation, media proportional sizing, private-image lifecycle, pagination, auth, query/cache, service worker and existing diagnostics are outside the change. Backgrounds and styling remain plain; no shadows, gradients, blur, filters, animation, old product UI/CSS imports or forced CSS overrides. Existing diagnostic selectors are edited directly rather than layered with override stylesheets.

Existing public WebP navigation icons are served by the unchanged ordinary static service. Only the development/preview asset map exposes the same files for the narrow test. The diagnostic release retains its three-file artifact contract: HTML, JS and one CSS. No backend, database, ACL, MAX storage, shared contracts, service worker or release-helper change is part of this stage.

## Checkpoints and rollback

Keep both immutable previous artifacts and their shared static image:

```bash
# Carousel and child header.
/opt/memoly/experiments/minimal-feed/minimal-feed-release.sh activate 97a6fa2d623be9af6816fde3c40ef663155a0609 root
# Carousel without child header.
/opt/memoly/experiments/minimal-feed/minimal-feed-release.sh activate 78da662665a7ba3bd7487d884c37752bc57f4ed7 root
# Original product interface.
/opt/memoly/experiments/minimal-feed/minimal-feed-release.sh off
```

The obsolete no-carousel artifact remains retired; no deletion was repeated. No Git history rewrite or merge to main is authorized. A browser pass is local evidence and does not establish the white-screen cause or physical iPhone acceptance.

## Local verification

- `bun run typecheck:webapp`: exit 0, application and E2E types. The additional avatar-test imports exposed the existing diagnostic ambient Window declaration being absent from the E2E compiler graph. An erased type-only import of that existing declaration resolves it; no runtime/typecheck suppression or production diagnostics change.
- With `VITE_MAX_BOT_USERNAME=id911018762027_bot`, `bunx vite build --config vite.diagnostic.config.ts` and `node scripts/verify-diagnostic-build.mjs`: exit 0. Actual module/CSS import guards pass; three files emitted, exactly one CSS, `assets/diagnostic-feed-ljEKJ1Lb.css` (5.76 kB). Emitted CSS was checked for forced overrides and deferred shadows/gradients/filters/animation/transitions; none present.
- `bunx playwright test --config playwright.diagnostic.config.ts --grep 'MAX identity opens'`: 1/1 passed, exit 0, 14.4 s total. At 390×844 the existing real local API/PostgreSQL scenario uploads/finalizes the owner's synthetic avatar and creates a real reaction using existing APIs, then verifies author-avatar/private decode, real reaction/current-user marker, navigation and icon decode, disabled actions, retained child header, media aspect ratio/poster revisit/dots, existing worker control and cursor pagination.
- The prior pending-video DTO and delayed local asset test gate are unchanged test fixtures. Production has no mock feed, interception or new diagnostic mechanism. This scenario does not prove live external-provider playback or iPhone/WebKit behavior.
- Lead inspected the header/card and decoded-carousel viewport screenshots in `webapp/e2e/.artifacts/minimal-feed/test-results/diagnostic-feed.experiment-0265a-d-the-existing-media-worker-chromium/`. The card screenshot precedes memory-image decoding; later assertions and the carousel screenshot verify decoded media. Child-header source and all feed implementation from `AttachmentProps`/`Carousel` onward match the saved header checkpoint.
- Evidence: `.scratch/minimal-feed/broad-stage1-{typecheck,build,smoke}.log`; allowed changes are diagnostic presentation/main/icon-preview map, the focused E2E and this document. No product UI, backend/contracts, schema, package/dependencies, media platform/cache/SW or helper changes.
- One fresh independent read-only review by GPT-6 Luna (high) reported no confirmed P0/P1/P2 findings. No review fix or second audit was needed.
