# MEMOLY-PWA-AUTHOR-AVATARS-ONLY

Branch: `experiment/pwa-author-avatars`; permitted worktree: `.worktrees/pwa-crash-diagnostics`; exact base: `8feb515379cc6c572b5c98792285a3bc76ad5289`. The previous geometry branch remains at `034a82dd09d977ce023aa0b119720f505f8d78a7`; histories are preserved. Canonical main remains `920f223fae0216be6a92b6c3ad2199c87bad0c0a`.

The owner reports that nav-only `b899f35` and card-geometry `8feb515` work on the physical iPhone; combined `bda2b3c` hung. This task introduces author avatars alone. Reactions remain out of scope and no white-screen cause is established.

The author-avatar helper uses real `memory.author.avatarPath` through the existing `usePrivateImageUrl` hook, as in the combined version. Its existing private access, identity/family cache gates and owned URL lifecycle remain unchanged. The only extra hook call is the required avatar caller per memory; no new loader, cache, transport, API or provider integration. Missing photos show the first letter of the author's name.

A simple 40px circular avatar sits beside name/date. Only those fields gain an author-row wrapper; existing date/kind text, caption placement and card contents are retained. The previous single-line name/date area's geometry is kept (58.5px with 8px vertical padding), rather than introducing the combined version's unrelated 60px minimum. Card width 480px, radius, border, spacing and all media/dot sizing remain unchanged. Long names retain ordinary wrapping.

No reaction output/count/picker/button, new card capability, shadow, gradient, blur/filter, animation, forced CSS override or old visual CSS/component import. The child header and lower navigation are unchanged; the existing media/carousel code from `AttachmentProps` onward must remain byte-identical to the base. Auth, API, React Query, cache, SW, pagination and diagnostics are unchanged.

Allowed changes are the author row/helper in `DiagnosticFeed.tsx`, its local selectors in the sole `diagnostic-feed.css`, the existing narrow real-API E2E scenario and this document. No backend, schema/DB migration, ACL, contracts, Telegram/MAX business integration, Vite/package or release-helper change.

## Delivery and rollback

Preserve every prior checkpoint, especially the owner-confirmed geometry release `8feb515`. Required rollback:

```bash
/opt/memoly/experiments/minimal-feed/minimal-feed-release.sh activate 8feb515379cc6c572b5c98792285a3bc76ad5289 root
```

The original product rollback remains `minimal-feed-release.sh off`. Do not merge main. After activation and verification, stop until the physical iPhone result; reactions require a separate owner instruction.

## Local verification and review

- `bun run typecheck:webapp`: application and E2E types passed, exit 0.
- With `VITE_MAX_BOT_USERNAME=id911018762027_bot`, `bunx vite build --config vite.diagnostic.config.ts` and `node scripts/verify-diagnostic-build.mjs`: exit 0. The module/CSS import guard accepts only diagnostic source UI and `diagnostic-feed.css`; the emitted three-file artifact has one stylesheet, `assets/diagnostic-feed-DKl1iDya.css`. No product CSS, forced override, external CSS or decorative effect appears in it.
- `bunx playwright test --config playwright.diagnostic.config.ts --grep 'MAX identity opens'`: 1/1 passed, exit 0, 13.1 s. The existing 390×844 scenario restores a MAX identity against the real local API/PostgreSQL; uploads and finalizes an author JPEG through the existing avatar API; reads the actual feed author avatar path and verifies image decoding. A synthetic second family member and real note verify the no-photo initial after cursor pagination. All data are synthetic test materials, not production owner data.
- The same scenario retains child header/avatar, lower navigation, 58.5px author block and 40px avatar geometry, original card border/radius/spacing, full natural media proportions, carousel/dots/poster and existing SW/pagination checks. The pre-existing pending-video fixture is unchanged except for checking its real author DTO; it does not establish external-provider playback or iPhone acceptance. No new interception or diagnostics was introduced.
- Lead inspected the actual diff, build/typecheck/browser logs and `diagnostic-feed-carousel-poster-viewport.png`. A source comparison confirms that header/navigation files and all feed media/carousel code from `AttachmentProps` onward are unchanged. Removing only replaced name/date rules and new author selectors yields the original stylesheet verbatim.
- Evidence: allowed-worktree `.scratch/minimal-feed/author-avatars-{typecheck,build,smoke}.log`; screenshots under `webapp/e2e/.artifacts/minimal-feed/test-results/diagnostic-feed.experiment-0265a-d-the-existing-media-worker-chromium/`.
- Execution note: the worker accidentally appended one build-verifier output to `.scratch/minimal-feed/author-avatars-build.log` in the main checkout, outside the permitted worktree. It was disclosed; source files there were not changed, and that log was left untouched. All subsequent evidence is within the permitted worktree. This is a log-path mistake, not a product change.
- One fresh independent read-only GPT-6 Luna/high review of the entire active diff was clean, with no confirmed P0/P1/P2. No fix pass or repeated audit was needed. No migration, contract, backend, ACL or normal-product UI change.

## Delivered artifact

Active source SHA: `275acee42bd84bf723da950bd02c9e7f30ef71d7`, served in place at `https://app.memoly.ru/` in root mode. It retains the existing MAX/PWA entry and session; no new login mechanism. Reload/reopen the existing owner entry for the physical test. Local/browser checks do not substitute for that test.

The exact clean source commit was built with the same configuration after commit and verified again (exit 0). Three immutable files staged under `/opt/memoly/experiments/minimal-feed/releases/275acee42bd84bf723da950bd02c9e7f30ef71d7/`, then activated through the unchanged guarded helper. No main merge, server application checkout switch, normal static image replacement, backend/DB change or helper edit.

SHA-256:

- `dist/diagnostic.html`: `4dc765996b6b26252204298fbe567ef705699b27de89a996b9a0de6d6233ee3a`
- `dist/assets/diagnostic-feed-DKl1iDya.css`: `07b484369a72a3b97dee45e31ac90f9a8c939b61d3acc3b5c7c0223674279412`
- `dist/assets/index-DfrxD-fd.js`: `1b1ff5d3a875f491e00899e0094a04f679c101baed51d2a854542b057f750172`

Immediately before activation, the helper and public HTML confirmed `8feb515`. Activation validated permissions, manifests, host preflight/lock, gateway configuration/backup/reload, public three-file checksums, root HTML/no-store and live/ready health. The real rollback `275acee → 8feb515` succeeded, including public root hash `28e7386d443a8b69b706086ec040e3905c3aa58ecf6ec7a860849555d5fa62b2` and health; subsequent `8feb515 → 275acee` succeeded. Both operations exited 0, and the new version is active.

After reactivation, all three public artifact checksums match; `/health/live` and `/health/ready` return `{"status":"ok"}`. The existing signed-out public browser smoke passes: root HTTP 200, MAX entry, preserved query/fragment, one diagnostic stylesheet, no page errors. No production challenge or private owner session was used.

Normal service image/container identities, public SW/runtime-witness hashes, original rollback files and helper checksum are identical to the pre-delivery snapshot. All 15 manifest entries across `78da662`, `97a6fa2`, `bda2b3c`, `b899f35` and `8feb515` remain valid. The working `8feb515` checkpoint and all previous artifacts are retained. Evidence: allowed-worktree `.scratch/minimal-feed/author-avatars-{activate,rollback,reactivate,public-checksums,public-smoke}.log`, production before/after snapshots and source-build log.

Reactivate this version with:

```bash
/opt/memoly/experiments/minimal-feed/minimal-feed-release.sh activate 275acee42bd84bf723da950bd02c9e7f30ef71d7 root
```

Delivery is complete; physical iPhone acceptance is pending. Stop here. Do not add reactions until a separate owner instruction. This receipt-only commit does not alter tested product source or the delivered artifact.
