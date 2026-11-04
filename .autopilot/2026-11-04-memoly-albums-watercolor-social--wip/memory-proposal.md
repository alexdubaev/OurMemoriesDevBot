# Proposed task memory

- Public social contract entry: `packages/contracts/src/album-social.ts`; routes are `/discussion`, `/comments`, `/comments/:commentId`, and `/reaction`. Reaction returns `AlbumEntryDiscussionSummary`; do not adapt it into legacy likes.
- Album comment scope is discriminated by `target: 'albumEntry'` and carries account/family/epoch plus album/entry/generation; query keys include target and generation while feed keys stay unchanged.
- Social summary/list mount only in the open, filled `AlbumEntryDetail`; never fetch per gallery tile. Reused projected media payloads must still preserve each input association `ref.id`.
- Clear compatibility is intentionally two migrations: the additive recovery trigger recognizes only the legacy clear-shaped month reset; current ordinary edits set transaction-local `memoly.album_entry_edit=preserve`, including temporarily blank edits. The trigger must not clear discussion on reorder/nonempty edits and does not alter media.
- Existing S3 rollback ledger is complete-only. Do not pre-apply a pending migration to evade it; use only the approved exact-source compatibility path with guards intact.
- Fresh clone/raw verification setup needs `bun run --cwd backend prisma:generate` before starting the verification server.
- Verified: `bun install --frozen-lockfile`; `bun run architecture:check` (917 files); `bun run typecheck:webapp`.
- Verified with a matching isolated loopback `*_test` environment: `bun run --cwd webapp e2e --config=e2e/album-social.playwright.config.ts` (3 passed).
- Verified targeted backend social/recovery suites and current → pinned S3 → current existing live check (1 passed).
- Canonical FULL remains pending; do not report it as PASS.
