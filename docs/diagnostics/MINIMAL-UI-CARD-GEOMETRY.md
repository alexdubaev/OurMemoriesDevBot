# MEMOLY-PWA-CARD-GEOMETRY-ONLY

Branch: `experiment/pwa-card-geometry`; worktree: `.worktrees/pwa-crash-diagnostics`; exact base: `b899f3539991f73852e3346dc9879cc42ca50169`. The saved nav-only branch remains at `5d625760fad9db7bc928c73cdbf12752a0db26c2`; existing histories remain unchanged. Canonical main remains `920f223fae0216be6a92b6c3ad2199c87bad0c0a`.

The owner reports that the carousel/header version `97a6fa2` and navigation-only `b899f35` work on the physical iPhone, while combined card/avatar/reaction version `bda2b3c` hung. This experiment restores only card geometry; it establishes no specific white-screen cause.

## Extraction and scope

Compared `97a6fa2 → bda2b3c` with `97a6fa2 → b899f35`. The latter already contains the nine navigation rules, normalized inset integration and page bottom clearance. Those remain unchanged. The only product edit is in `diagnostic-feed.css`: page width cap becomes 480px; card spacing, border, 24px radius, bottom padding and geometry of name/date/caption come from the former diff.

No avatar, reaction or additional notice selector is transferred. The combined version's unrelated page top-padding change is excluded. Generic metadata used by media states/navigation notice, child-header selectors, navigation rules and all carousel/media/dot sizing rules remain intact.

`DiagnosticFeed.tsx` keeps its existing direct-child DOM (name, date, optional caption, carousel, dots). Ordinary CSS layout/order places the media and its dots before the caption without changing React markup, requests, hooks or events. The original full-width natural media ratio/containment remains in force. No fixed media height or new crop is introduced.

All TSX, including DiagnosticFeed, DiagnosticHeader, DiagnosticNavigation and diagnostic main, must remain byte-identical to `b899f35`. No author portraits, reactions, new `usePrivateImageUrl` calls, decorative image, animation, transition, gradient, shadow, blur/filter, forced override or old product CSS import is included. API/auth/query/private-media/cache/SW/pagination/diagnostics/backend/schema/package/helper sources are unchanged.

Allowed changes: the existing diagnostic stylesheet, a narrow extension of the existing real-API E2E scenario and this document. One emitted diagnostic CSS only; no new build infrastructure or interceptors.

## Delivery and rollback

Preserve all previous artifacts: `78da662`, `97a6fa2`, `bda2b3c`, especially owner-confirmed `b899f35`. Required rollback:

```bash
/opt/memoly/experiments/minimal-feed/minimal-feed-release.sh activate b899f3539991f73852e3346dc9879cc42ca50169 root
```

The original product rollback remains `minimal-feed-release.sh off`. Do not merge main. After delivery, stop until the owner physically tests the iPhone; do not add portraits, reactions, decoration or a speculative fix.

## Local verification

- `bun run typecheck:webapp`: application and E2E types passed, exit 0.
- With `VITE_MAX_BOT_USERNAME=id911018762027_bot`, `bunx vite build --config vite.diagnostic.config.ts` and `node scripts/verify-diagnostic-build.mjs`: exit 0. Three files emitted, exactly one stylesheet `assets/diagnostic-feed-CHBWN-mu.css`. Source module/CSS guards and emitted-CSS check for no override/deferred effects passed.
- The emitted JS bytes are identical to the nav-only checkpoint, SHA-256 `baa11a9b9ffa397ed5f329758d5f416bdef5db632374a9d7a8567522a83ab27f` (the chunk filename can change with the CSS dependency). All React components, Vite config, hooks, handlers and media code are unchanged.
- `bunx playwright test --config playwright.diagnostic.config.ts --grep 'MAX identity opens'`: 1/1 passed, exit 0, 13.0 s total. The same real local API/PostgreSQL 390×844 scenario checks full card/media width, 24px border radius, line/gap geometry and author/date/media/dots/caption visual order, plus unchanged restored MAX session, child header/avatar, nav, private image/poster/carousel/dots, existing SW and cursor pagination.
- The first run caught an incorrect expected-width calculation in the new test. Only the expectation was corrected to use the actual page content width minus horizontal padding; the same focused scenario then passed. No new fixture or interceptor was introduced. The previously existing pending-video test fixture still does not prove live external-provider playback or physical iPhone acceptance.
- Lead inspected `diagnostic-card-geometry-390.png` and the diff. A CSS allowlist comparison confirms that only page width and card geometry rules changed; header/nav/media/dot rules and the original page padding are unchanged. Evidence and screenshots are under `webapp/e2e/.artifacts/minimal-feed/test-results/diagnostic-feed.experiment-0265a-d-the-existing-media-worker-chromium/` and allowed-worktree `.scratch/minimal-feed/card-geometry-{typecheck,build,smoke}.log`.
- Execution note: the worker initially wrote these three logs to `.scratch/minimal-feed` in the main checkout, outside the allowed worktree. The lead copied the exact task-owned logs into the allowed worktree without changing the originals or foreign source files. No further writes outside the permitted worktree were made; product source changes remain the two allowed files only.
- One fresh independent review by GPT-6 Luna (high) initially raised visual/DOM sequence and focus-outline observations. In a single bounded severity clarification, it confirmed neither is P2: the original accessible caption-before-media sequence remains meaningful, and the top/bottom focus-outline segments remain visible. Partial clipping of the side segments is a P3 limitation of the restored card geometry. No confirmed P0/P1/P2 remains; no React/media/focus-rule change or additional audit was made.
