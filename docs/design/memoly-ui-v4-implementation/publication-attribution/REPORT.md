# Publication attribution implementation evidence

Task: `MEMOLY-PUBLICATION-AUTHOR-ATTRIBUTION`. Base: `aa8e6a2ae6688e025fdb04c1a743dc389058be72`; existing v4 branch `feat/memoly-ui-v4-implementation`, worktree `D:/codex/TG_OurMemoriesDevBot/worktrees/memoly-ui-v4-implementation`, PR185 retained open by owner instruction. Product paths are memories backend/read transport, memory contracts, feed client/presentation and dedicated WebP assets; no migration, importer, permission or media behavior changes. Lead: GPT-6; implementation and independent review use separately dispatched Luna agents. Final exact-source Linux verification, review and preview activation/rollback evidence are recorded in PR185 after verification.

The read contract adds optional `MemoryDto.publicationAttribution` (`channel` or `user`). New feed and detail reads request it with `X-Memoly-Publication-Attribution: 1`; legacy reads, create, and update responses retain the prior DTO shape. Feed and delete preview use the attribution label, channels use the dedicated neutral broadcast WebP glyph, and user cards retain their avatar path and crop.

The resolver reads published `MaxSource` rows in one page batch, scoped by both family and memory, and reads same-family bindings and active family display names in batches. Direct provenance requires both original fields to be null and a matching recipient binding. Confirmed forwards require both original channel and original message IDs. Envelope forwards never use recipient fallback. Multiple channel IDs, missing/blank titles, or foreign bindings fall back to the user's same-family display name, then profile name. The implementation does not infer provenance from timestamps or outbound backup records. It rechecks family membership under the repository transaction before exposing attribution.

Existing importer writes confirm the persisted field semantics: confirmed forward claims set `originalChannelId` to the provider-validated channel and store `originalMessageId`; envelope claims store `originalMessageId` with `originalChannelId` null. Direct message sources retain both as null. No schema, migration, author ID, permission, media, backup, or importer changes were made.

Channel labels come from the live same-family `MaxChannelBinding.title`. A read-only production metadata check confirmed the stored binding title matches the provider's current title; no channel name is hardcoded.

The PostgreSQL API regression covers direct posts, confirmed forwards, envelope fallback, ambiguous provenance, blank title, foreign-family binding isolation, both family display names and profile fallback, an app-created memory with an outbound backup and non-null `sourcePublishedAt`, unchanged author identity, and opted-in versus legacy list/detail shapes. The browser scenario verifies a decoded channel glyph, no private avatar request for the channel author, a decoded cropped member avatar, and legacy author fallback. Its screenshot is [publication-attribution.png](publication-attribution.png). The six channel icon variants are mirrored byte-for-byte into Vite's public asset directory.

## Verification

| Command | Result |
|---|---|
| `bun run --cwd packages/contracts test` | Pass: 56 tests at baseline. |
| `bun test packages/contracts/src/memories.test.ts` | Pass: 17 tests, 71 assertions. |
| `bun run --cwd packages/contracts typecheck` | Pass. |
| `bun run typecheck:backend` | Pass. |
| `bun run typecheck:webapp` | Pass. |
| `bun run lint` | Pass with one existing warning in `webapp/src/features/auth/provider.tsx:89`. |
| `bun architecture:check` | Pass: 748 source files. |
| `bun test --timeout=60000 --test-name-pattern 'opted-in list and detail resolve same-family publication provenance' backend/src/modules/memories/memories.integration.test.ts` | Pass against dedicated PostgreSQL: 1 test, 19 assertions. |
| `bun run --cwd backend test:integration -- src/modules/memories/memories.integration.test.ts` | Final bounded-fix run: 22 tests, 191 assertions, exit 0. An earlier attempt crashed in Bun after 17 tests and was not counted as passing. |
| `bun run --cwd webapp e2e --config=e2e/memoly-v4.playwright.config.ts -g 'publication attribution renders channel glyph'` | Pass: 1 browser scenario, including image decode, avatar crop bounds, channel label in the mixed viewer, next/previous navigation and close. |

No migrations or generated source files were changed. PR 185 remains open; this worker did not commit, push, merge, or deploy.

Independent review and bounded closure: [REVIEW.md](REVIEW.md). A published source with incomplete provenance now forces user fallback even alongside a known channel source. The mixed viewer uses the same display label as its card. Final Linux FULL evidence belongs to the exact final committed source and is recorded separately in PR185.
