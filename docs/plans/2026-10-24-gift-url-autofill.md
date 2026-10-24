# Gift creation from a product link

Task: GIFT-URL-AUTOFILL. Base: `55bc9053494523ed546fcc28ce38ecef36abd0ac`.
Branch/worktree: `fix/gift-url-autofill`, `.worktrees/gift-url-autofill`.

## Accepted result

Creating a gift in the app requires only a valid product link. Shared text with a title and URL remains supported. Title, price and photo can be edited manually. Fetch available product metadata; price is optional and must represent a reliable current RUB price. Do not use recommendations, stale price history or conditional wallet discounts. Never replace manual input with a late response.

The owner selected this fallback: if the store does not return a card, save its link with the existing gift icon and store name; allow editing later. This also applies to unsupported stores. No bot message ingestion, browser service, paid provider or new infrastructure.

## Implementation decisions

Keep the persisted Gift and existing create/update contracts unchanged: each gift still has a private, verified, uniquely owned photo. A new authenticated family endpoint returns bounded metadata and a normalized WebP photo inline. The app uploads that photo, or the existing owned gift WebP icon, through the normal purpose=gift upload/finalize pipeline when saving. No schema/migration change or relaxation of media ACL is needed.

An outbound metadata reader supports recognized Wildberries, Ozon and Yandex Market links only. Wildberries uses its published basket routing map and exact product card/image IDs. Ozon and Yandex Market use inert Product structured data when accessible. Production probes show Ozon and Yandex Market may block access, so fallback is an expected successful flow. No assertion that all shops or all prices are obtainable. The owner added Yandex Market short link `/cc/BNpQaH` during implementation: local extraction returned title, photo and RUB Offer price; production returned a captcha. Yandex identity must use the matching Offer URL/card ID because its SKU differs from its card ID. Allow only `market.yandex.ru` redirects and `avatars.mds.yandex.net/get-mpic/` images through the same bounded public-IP-pinned reader.

Security: authenticate and require full family access before any outbound operation. Allowlist HTTPS hosts and redirect destinations; resolve and pin public IPs for each request, reject private/reserved/mapped addresses, credentials, alternate ports and off-domain redirects. Bound time, bytes, redirects, image pixels, response size and per-user/concurrent work. Decode/re-encode images, never execute downloaded HTML/scripts. Return unavailable metadata on upstream failure; retain normal permission errors and private/no-store responses. No upstream cookies or user credentials.

## Bounded tasks

1. Backend/contracts: typed metadata contract, injected provider, route and family authorization; safe HTTP reader, exact-product parsing and image normalization. Tests cover extraction, stale/generic card rejection, SSRF/redirect/size boundaries and denied family access before fetching. Allowed paths: gifts backend module, app composition, contracts gifts/export/tests, backend gift integration/tests. Integrator owns package/lock changes. Stop and report if a migration, new privilege or ACL weakening appears necessary.
2. Frontend: debounced cancellable metadata lookup, stale response protection, manual input precedence, visible loading/fallback, URL-only save with existing icon fallback and ordinary private upload. Preserve editing and clipboard behavior. Allowed paths: gift feature and focused browser tests. Tests must exercise actual URL-only save with metadata and unavailable metadata, not source-text assertions.
3. Delivery: review unchanged schema/data compatibility; add a narrowly pinned recovery attestation and corresponding regression without weakening old pins or guards. No destructive recovery. Run deterministic checks, one fresh independent review, bounded fixes, FULL on exact source; publish evidence, squash merge, FULL on final release and guarded Selectel FULL deployment. Cleanup only this task's clean branch/worktree after confirmed merge.

## Acceptance and verification

- Valid link can always reach Save without manual title/photo/price; validation and upload failures are visible.
- Exact product metadata populates available fields; fallback persists store name and icon. Existing gifts remain editable.
- Manual values survive delayed lookups and URL/family changes cannot attach stale metadata.
- Metadata requires authorized full membership, creates no MAX outbox message and does not leak family media.
- Existing private media verification/quota/cleanup protections and 55-entry migration ledger remain intact.
- Narrow backend/contracts/frontend checks first; local `bun run verify:full` on source and release SHA before publication/deployment. Use isolated PostgreSQL database ending `_test`, Docker fallback per AGENTS §13. No CI introduction or skipped mandatory checks.

Evidence is kept outside source in `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/output/gift-url-autofill-2026-10-24/`. Report actual commands, exit codes, source/release SHAs, review, PR, deployment and cleanup in HANDOFF.
