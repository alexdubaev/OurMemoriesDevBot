# Minimal feed PWA UI experiment

Task: `MEMOLY-PWA-MINIMAL-UI-EXPERIMENT`. Base: `920f223fae0216be6a92b6c3ad2199c87bad0c0a`.
Branch: `experiment/pwa-minimal-feed`. Worktree: `.worktrees/pwa-crash-diagnostics`.
Scope: additive frontend experiment only; no backend, database, ACL, MAX storage,
production source, existing styles, manifest, or worker changes. The white-screen
cause remains unknown. Local browser results are not physical iPhone acceptance.

The experiment is an additive entry at `/__experiments/minimal-feed/diagnostic.html`. Its build contains a single plain stylesheet and does not publish the product manifest or service worker. The existing startup bootstrap remains in the HTML template; local preview serves only the existing private-media worker and runtime-witness files needed to exercise this entry.

## Browser acceptance

In Safari, open the explicit diagnostic URL in the same browser profile used for the canonical app. If signed out, use the link to `/` and complete the canonical MAX browser-link flow. Return manually to the diagnostic URL in that same Safari profile. Confirm the family picker, authors, dates, notes, private photos, native media controls, and scrolling pagination. The experiment will only show browser sessions whose saved identity is MAX.

An installed standalone PWA has a separate app container and may not share Safari's cookie or storage session. Do not assume that completing login in Safari authenticates an installed copy. If standalone testing is needed, open the explicit diagnostic URL inside that installed app after the existing app session is established there. A dedicated in-app navigation toggle would need a separate owner decision.

The current main UI has no added experiment link. Consequently the direct URL is
ready for a same-browser Safari test after delivery; entry from an already installed
PWA remains a delivery limitation, not a claimed pass. Compare the same family and
ordinary scrolling in the same launch mode. Do not infer CSS, photos, memory, or
WebKit as the cause from a local test or from an unmatched Safari/PWA comparison.

## Proposed delivery — requires separate owner approval

Nothing has been deployed. The proposed address is
`https://app.memoly.ru/__experiments/minimal-feed/diagnostic.html`.

1. Fix the reviewed task commit and build only the diagnostic static artifact with
   an empty API base and the existing public MAX username `id911018762027_bot`.
   Record SHA and SHA-256 hashes of the resulting HTML/JS/CSS. Keep that immutable
   directory separate from the current static root and production release images.
2. After approval, transfer those static files to a separate read-only static
   service on the existing host/network. Save the current gateway configuration.
   Add exactly one prefix route for `/__experiments/minimal-feed/*` to that
   service; the service strips that prefix and serves the artifact directory.
   Validate the configuration before reload. Use `Cache-Control: no-store` for
   the experiment. Do not use the ordinary full-app deploy command for this task.
3. Keep `/`, `/api/*`, `/private-media-sw.js`, `/pwa-runtime-witness-v1.js`, the
   production manifest, existing backend, and all storage routes unchanged.
   The experiment's URL is opt-in; knowledge of it grants no access to family
   data. Existing auth and backend ACL still apply to every request.
4. Check the ordinary app and its assets against the previous hashes, then open
   the explicit address on the owner's iPhone, complete canonical login if needed,
   select the real family, and scroll normally through more than one feed page.
   Use the existing report-copy button if the symptom recurs. Record the launch
   mode, iOS version, result, and existing diagnostic report separately.
5. Rollback: remove the one prefix route, validate/reload the saved gateway
   configuration, and stop only the experiment's static service. No DB restore,
   auth reset, browser-cache clearing, or SW unregister/replacement is involved.

For a comparison inside the owner's existing standalone PWA, the narrow delivery
option is an owner-only temporary gateway opt-in that redirects the root document
to this path for that app container. It must be set and removed in that container,
have an expiry, preserve API/asset routes, and be explicitly approved before
implementation. Do not enable such a redirect for all users. This option is a
proposal only; it is not part of the local implementation.

## Local checks

From `webapp/`, build and inspect the isolated artifact:

```powershell
$env:VITE_MAX_BOT_USERNAME = 'id911018762027_bot'
bunx vite build --config vite.diagnostic.config.ts
node scripts/verify-diagnostic-build.mjs
```

Run the single backend-backed MAX, browser-session, photo, pagination, and service-worker smoke:

```powershell
bunx playwright test --config playwright.diagnostic.config.ts e2e/diagnostic-feed.experiment.ts
```

The diagnostic config pins the client API base to the same origin. `VITE_API_URL`
only selects the local development/preview proxy target. The test uses a separate
Postgres database and filesystem storage, real API responses, and a seeded
MAX-provenance refresh session. MAX bot startup is disabled in this test; it does
not validate the external MAX login exchange or a physical iPhone.

## Local handoff evidence — 2026-10-13

- `bun run typecheck:webapp`: exit 0 (application and E2E TypeScript).
- `bun run build:webapp`: exit 0; all 189 standard output files matched SHA-256
  hashes of the build taken before the change. Existing product files have no diff.
- Diagnostic build: exit 0; 193 modules, three output files (HTML, JS, CSS).
  The sole CSS asset is 1,631 bytes. Build-time CSS imports are allowlisted to
  `diagnostic-feed.css`; emitted JS modules are checked for product visual imports.
  The artifact checker reads the generated HTML and CSS and passes with exit 0.
- One built-preview Playwright smoke passed (1/1, 14.3s, exit 0) and covers restored MAX-provenance PWA auth,
  family selection, private photo upload/render through the actual API, existing
  SW control, and scroll-driven cursor pagination. No production data is used.
- The smoke requires a successful cursor response and the oldest seeded note
  (note 21) from the second page. After that run, the test was renamed from
  `.spec.ts` to `.experiment.ts` without changing its body, to exclude it from
  normal test discovery. `playwright test --list`: 8 standard tests, no diagnostic
  test; `playwright test --config playwright.diagnostic.config.ts --list`: exactly
  one diagnostic test. Both discovery checks exited 0.
- Visual evidence: the synthetic photo's successful decode and a plain white
  feed were inspected in
  `webapp/e2e/.artifacts/minimal-feed/test-results/diagnostic-feed-MAX-identi-4f2dd-d-the-existing-media-worker-chromium/diagnostic-feed-photo.png`.
  This is desktop Chromium evidence, not iPhone acceptance.
- Independent review: one fresh `gpt-6-luna` agent requested with high reasoning.
  One P2 (missing Telegram-video open control) was accepted and fixed using the
  existing API/single-flight host handoff. No P0/P1 was reported. One bounded fix
  pass and narrow closure; no second whole-change review.
- Closure logs: `.scratch/minimal-feed/review-closure-typecheck.log`,
  `review-closure-build.log`, and `review-closure-playwright.log` (ignored local
  artifacts). Primary lead: Codex; scout/worker/reviewer requested as GPT-6 Luna
  High. Model selection evidence is the orchestration calls.

The only changed paths are the new `src/diagnostic` folder, diagnostic HTML/Vite/
Playwright config, one smoke test, artifact-check script, and this document.
Removing those additions removes the experiment without changing product code.
Migrations and shared-contract changes: none. Publication: none; no PR, merge,
production deployment, or `verify:local` release gate was attempted. Before any
future main publication, run the repository's `bun run verify:local` against that
exact source SHA. Physical iPhone acceptance remains outstanding.
