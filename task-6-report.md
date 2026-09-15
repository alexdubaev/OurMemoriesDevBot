# MAX-06 — Image and multiple-image capture

Date: 2026-09-15
Status: APPROVED
Model/workflow: Codex lead engineer; bounded scout, one TDD worker, independent reviewers
Branch: `feat/max-adapter`
Worktree: `D:\codex\TG_OurMemoriesDevBot\worktrees\max-adapter`
Task base: `c8c6202e09453703fe71477ac95d3c4501dd43e8`
Implementation head: `3c407cffb16b696756d32f514469cd6b4ca00927`
Origin/main and merge base: `7927c6e11c8444a658c819325c97bc586696778b`
Publication: local only; not pushed, no PR, no merge, no deployment

## Product result

- A direct MAX message with 1–10 ordered `type=image` attachments produces one shared Core `photo` Memory with ordered shared `MediaAsset` records. The 1–10 rule is a memoLy application limit, not an official MAX guarantee.
- A direct MAX message with exactly one `type=file` attachment produces one `photo` Memory only when the downloaded bytes pass the shared image security pipeline. Separate file messages remain separate Memories; multiple file attachments remain unsupported.
- Quick-send photos preserve exactly the rendition bytes returned by MAX. Uncompressed image files preserve exactly the file bytes returned by MAX.
- Message text is the photo Memory body/caption and is never also published as a note.
- Non-image, mixed, over-limit, and otherwise unsupported attachment shapes terminate safely without partial publication.

## Architecture and contracts

- Preserved `MaxInbox` / `MaxSource` / `MaxOutgoingResponse` and reference-only `TaskOutbox` payloads.
- Added provider-specific `MaxSourceAttachment` persistence with received position, stable provider attachment identity, deterministic planned MediaAsset ID, durable claim lease, and processing status.
- URL/token remain transient transport metadata and are never the durable identity or persisted source of truth.
- Added credential-free, no-redirect media download from the exact observed HTTPS hosts only; the MAX bot token is never sent to media hosts.
- Reused shared private storage, quota reservation, byte/MIME/decode/pixel validation, photo derivative generation, `MediaAsset`, family authorization, and trusted-source Memory publication.
- Publication uses a predetermined Memory ID, ordered deterministic MediaAsset IDs, final family/member/child authorization, Family-before-MediaAsset row locks, and guarded source transition.
- Partial failures publish no Memory. Retries reuse stored assets, recover expired claims, and do not duplicate downloads, MediaAssets, Memories, or logical responses.
- Terminal cleanup is retryable and removes deterministic original/display/preview objects even when a failed finalization did not commit `MediaVariant` rows.
- Telegram production behavior was not changed. MAX-07 and MAX-08 scope was not expanded.

## Migration

Added the undeployed additive migration:

`backend/prisma/migrations/20260915130000_max_image_capture/migration.sql`

It adds:

- `max_source_attachment_kind` and `max_source_attachment_status`;
- `media_source_kind = max`;
- `max_source_attachments`;
- unique `(source_id, position)` and `planned_media_id` identities;
- provider-identity and claim-recovery indexes;
- the foreign key to `max_sources`.

All 25 repository migrations were applied successfully to clean test databases. Existing migration history was not edited; the MAX-06 migration has not been deployed.

## Changed paths

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260915130000_max_image_capture/migration.sql`
- `backend/src/modules/max/**`
- `backend/src/modules/media/**` on the existing trusted private-media boundary
- `backend/src/modules/memories/infrastructure/source-memory-publisher.ts`
- `docs/superpowers/specs/2026-09-15-max-06-image-capture-design.md`
- `docs/superpowers/plans/2026-09-15-max-06-image-capture.md`
- `docs/superpowers/SDD_LEDGER.md`

## Verification

- Focused MAX/media suite: 56 passed, 0 failed, 215 assertions, exit 0.
- Lead final focused policy/provider/media suite: 32 passed, 0 failed, 121 assertions, exit 0.
- Clean-database MAX capture integration: 36 passed, 0 failed, 203 assertions, all 25 migrations, exit 0; repeated twice successfully.
- Cleanup-first race: 1 test / 3 assertions, repeated three clean runs.
- Six-test contention matrix: 6 passed / 27 assertions, repeated three clean runs.
- Telegram capture regression: 36 passed, 0 failed, 221 assertions, all 25 migrations, exit 0.
- Backend unit: 432 passed, 0 failed, 1,282 assertions, exit 0.
- Backend typecheck: PASS, exit 0.
- Contracts typecheck: PASS, exit 0.
- Architecture check: PASS, 665 source files, exit 0.
- `git diff --check`: PASS.
- Secret/forbidden-scope inspection: PASS; no credential, Authorization header, signed media URL, MAX-07 behavior, webhook/subscription mutation, or provider-specific Core model was added.

No visual UI change required screenshots.

## Independent review

- Fresh whole-change reviews found and drove fixes for guarded terminal transitions, provider-response matching, retry classification, streamed-byte cancellation, durable attachment claims, publication/cleanup serialization, lost-publication cleanup, terminal cleanup retry, and lock order.
- The second fresh whole-change review found one P2: photo derivatives written before final DB commit could be orphaned. Fixed with deterministic object cleanup and a clean-database regression.
- Fresh scoped re-review of `f4b4719..3c407cf`: `production_ready`, no P0/P1/P2. It independently passed derivative cleanup, cleanup-first, publication-first, pending finalization overlap, and media lifecycle tests.
- Remaining P3: the test-only failure-path gate cleanup is bounded at five seconds; it does not affect production behavior.

## Residual boundaries

- MAX physical response delivery remains intentionally at-least-once after an unknown provider outcome.
- Inbound attachment order is preserved as received; it is not documented here as an official unlimited MAX ordering guarantee.
- The accepted MAX quick-send rendition is not called an original. No attempt is made to reconstruct higher quality.
- No live MAX calls were made during implementation or verification.
- Docker container TLS trust for a future staging deployment remains a separate pre-deployment gate.

## Next step

Do not start MAX-07 automatically. The owner must first approve its bounded real-MAX feasibility investigation described in `MAX_07_HANDOFF.md`.
