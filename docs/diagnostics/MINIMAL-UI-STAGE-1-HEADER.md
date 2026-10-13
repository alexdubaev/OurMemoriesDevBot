# MEMOLY-MINIMAL-UI-STAGE-1-HEADER

Branch: `experiment/pwa-minimal-feed`. Allowed worktree: `.worktrees/pwa-crash-diagnostics`. Base: `c327083c9f3e52d32364a5bb1e8ac1c78d8c8ed9`; verified carousel checkpoint: `78da662665a7ba3bd7487d884c37752bc57f4ed7`; main remains `920f223fae0216be6a92b6c3ad2199c87bad0c0a`.

This stage adds only an independent child header. It retains the child returned by the already existing `loadFamily` request and uses the existing private-image hook and canonical avatar display path. No new metadata request, loader, media cache, authentication mechanism or worker is introduced. The existing public wordmark `/assets/brand/memoly-logo-correct.webp` remains served by the original static image; local preview uses that same repository asset. Its verified SHA-256 is `55638b8e2156f7b1b7c82d4362c963aa8236502c8109c5d981c51b81f62294e4`.

The header has only plain layout and local selectors in `diagnostic-feed.css`. It imports no ChildHeader, ChildHeaderV2, BrandLogo or old visual stylesheet. Carousel/media geometry, pagination, family ACL and existing startup diagnostics are outside the change. No next UI component is authorized by this stage.

## Retired artifact

`f6db4c15a5fe486a996fd298f27d511c18723a2e` is retired from further experiment selection. The owner explicitly authorized retirement. Under the existing deployment lock, the lead verified it was absent from the active gateway and product rollback manifests, and that only its own isolated container mounted its release paths. Its exact root-owned six-file release, checksums, source label and image identity were validated before standard Docker stop/rm and removal of that single resolved release directory.

Removed: `memoly-minimal-feed-f6db4c15a5fe486a996fd298f27d511c18723a2e` and `/opt/memoly/experiments/minimal-feed/releases/f6db4c15a5fe486a996fd298f27d511c18723a2e/`. Git history, shared static image, helper files, historical gateway snapshots, current `78da662` artifact/container and original product rollback files were preserved. Root HTML, live gateway, normal container/image identities, product rollback checksums and health remained unchanged. Local evidence: `.scratch/minimal-feed/header-retire.log`.

The saved helper file named `helper-f6db4c1.sh` is shared release infrastructure, not the retired UI artifact, and remains intact. Historical receipts mentioning f6 are evidence only; they are no longer activation instructions.

## Local verification

- `bun run typecheck:webapp`: application and E2E types passed, exit 0.
- With `VITE_MAX_BOT_USERNAME=id911018762027_bot`, `bunx vite build --config vite.diagnostic.config.ts` and `node scripts/verify-diagnostic-build.mjs` passed, exit 0. The actual module graph excludes product visual modules and all other CSS imports; output has exactly three files and one stylesheet, `assets/diagnostic-feed-2y1RzIbN.css`, from `src/diagnostic/diagnostic-feed.css` (3.09 kB).
- `bunx playwright test --config playwright.diagnostic.config.ts --grep 'MAX identity opens'`: 1/1 passed, exit 0, 12.8 s total. The same real local API/PostgreSQL scenario verifies restored MAX identity, actual avatar upload/private decode, child name, logo decode, one family metadata request, unchanged carousel/media geometry, private image/cache, existing worker and cursor pagination. This uses synthetic local test records; no production fixtures or interception were introduced.
- The first attempt could not start because Docker Desktop was stopped. After the owner started it, the fixture was corrected from a rectangular image/full-frame crop rejected by the existing API (409) to a square synthetic avatar. Only that same narrow scenario was rerun; backend behavior was unchanged.
- The lead inspected `diagnostic-feed-header-viewport.png` and the test evidence in `webapp/e2e/.artifacts/minimal-feed/test-results/diagnostic-feed.experiment-0265a-d-the-existing-media-worker-chromium/`. `DiagnosticFeed.tsx` remains identical to the carousel checkpoint, Git blob `31e862aa72d98e60cf7c9f14c8bbc76d4138218e`. Device acceptance remains pending.
- One fresh read-only independent review by GPT-6 Luna (high) found no confirmed P0/P1/P2 findings. It checked the header/private-image lifecycle, selection guards, CSS/module graph and focused test boundary. No review fix or additional audit was needed.

## Delivery and rollback

Use the unchanged minimal-feed release helper. The permitted previous experimental checkpoint is:

```bash
sudo /opt/memoly/experiments/minimal-feed/minimal-feed-release.sh activate 78da662665a7ba3bd7487d884c37752bc57f4ed7 root
```

Original production interface rollback remains `minimal-feed-release.sh off`. No main merge or database rollback is part of this stage. Physical iPhone acceptance remains the owner's next step; no white-screen cause is established.
