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
