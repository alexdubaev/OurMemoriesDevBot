# MEMOLY-PWA-NAV-ONLY-ISOLATION

Branch: `experiment/pwa-nav-only`; worktree: `.worktrees/pwa-crash-diagnostics`; exact base: `97a6fa2d623be9af6816fde3c40ef663155a0609`. The previous branch `experiment/pwa-minimal-feed` remains at `9711bffbef81d300962f909033e5219b4759543f`; no history rewrite. Main remains `920f223fae0216be6a92b6c3ad2199c87bad0c0a`.

Physical evidence reported by the owner: the combined card/navigation version `bda2b3c` hung, while rollback to `97a6fa2` worked. This task tests navigation alone and does not establish a specific white-screen cause.

The navigation component and its nine local CSS rules are copied verbatim from `bda2b3cd329afe59ddea0f37ce478679524b712e`: fixed position, bottom inset, widths, grid, sizes and `translateX(-50%)` retained. It appears only after family selection. Role comes from the existing family-home response; no extra metadata request. Add/Family actions remain disabled with a short visible explanation. The Feed link targets the existing selected-family section.

The existing diagnostic page's width and all card/media styles remain those of `97a6fa2`; only its bottom padding accommodates the navigation. `DiagnosticFeed.tsx` and `DiagnosticHeader.tsx` must remain byte-identical to that base. No new card containers, author avatars, reactions or changed media/carousel/dot behavior are included.

The sole stylesheet is still `diagnostic-feed.css`; no product CSS, visual component, override layer, forced rule or decorative effects. The three existing public WebP menu icons are served by the unchanged original static service; their paths are added only to the diagnostic dev/preview asset map for the narrow browser scenario. The immutable artifact contract remains HTML, JS and one CSS. API, auth, React Query, cache, pagination, private media, SW and diagnostics are unchanged.

Allowed product paths: `src/diagnostic/DiagnosticNavigation.tsx`, `src/diagnostic/main.tsx`, `src/diagnostic/diagnostic-feed.css`, and the three-path icon map in `vite.diagnostic.config.ts`; test changes only in the existing `e2e/diagnostic-feed.experiment.ts`. No backend, contract, package, helper, main or normal product UI changes.

## Checkpoints and rollback

Keep `78da662`, `97a6fa2` and `bda2b3c` artifacts intact. Required rollback is the owner-confirmed carousel/header version:

```bash
/opt/memoly/experiments/minimal-feed/minimal-feed-release.sh activate 97a6fa2d623be9af6816fde3c40ef663155a0609 root
```

Original product rollback remains `minimal-feed-release.sh off`. After delivery, stop and await the owner's physical iPhone test. Do not add another component or speculative fix.

## Local verification

- `bun run typecheck:webapp`: application and E2E types passed, exit 0.
- With `VITE_MAX_BOT_USERNAME=id911018762027_bot`, `bunx vite build --config vite.diagnostic.config.ts` and `node scripts/verify-diagnostic-build.mjs`: exit 0. Actual import/module guards pass; three files emitted, exactly one CSS `assets/diagnostic-feed-BC2A-TqY.css` (4.28 kB). The emitted stylesheet also passes the check for no forced rules, imported styling, shadows, gradients, filters, animation or transitions.
- `bunx playwright test --config playwright.diagnostic.config.ts --grep 'MAX identity opens'`: 1/1 passed, exit 0, 12.8 s total. The same real local API/PostgreSQL scenario at 390×844 verifies existing MAX session, family selection, one metadata request, child header/avatar, decoded private photo, carousel/poster/dots, worker and cursor pagination, plus navigation geometry/icons/disabled actions. No author-avatar or reaction fixture was added.
- The first run failed only because the new test incorrectly expected the CSS minimum (82px) to be the rendered fixed height. The actual panel is 88px. Only the assertion was corrected to check the 82px computed minimum, rendered height at least that minimum, and 48px center circle; copied menu CSS remained unchanged. Only the same scenario was rerun.
- Lead inspected `diagnostic-nav-only-390.png` in `webapp/e2e/.artifacts/minimal-feed/test-results/diagnostic-feed.experiment-0265a-d-the-existing-media-worker-chromium/`. Both `DiagnosticFeed.tsx` and `DiagnosticHeader.tsx` are unchanged from the exact base; the navigation Git blob matches bda (`4771fb7a9cc6564a61956c3e10dda0e2b31ed9c4`). All nine menu rules match bda, and the rest of the diagnostic CSS matches the base except page bottom padding. No card-width or card-style change.
- Evidence: `.scratch/minimal-feed/nav-only-{typecheck,build,smoke}.log`. The previously existing local pending-video fixture is unchanged; this test is not live external-provider playback or physical iPhone acceptance. No production fixture or new interception was introduced.
- One fresh independent read-only review by GPT-6 Luna (high) confirmed the nav-only boundary and reported no P0/P1/P2 findings. No review fix or additional audit was needed.
