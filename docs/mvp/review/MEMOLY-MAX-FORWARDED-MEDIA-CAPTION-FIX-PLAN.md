# MEMOLY-MAX-FORWARDED-MEDIA-CAPTION-FIX

Base: `3fce2739205da927b95eb3379b1d066b61282965` (fresh origin/main).
Branch: `fix/max-forwarded-media-caption`.
Worktree: `.worktrees/max-forwarded-media-caption` in the owner's workspace.

1. Reproduce RED using synthetic documented MAX forward payloads through webhook normalization, real API response normalization and the PostgreSQL import boundary. Confirm missing caption in the single video Memory before production edits.
2. Carry the linked caption separately from outer-message text in the existing MAX application types. Select it only with verified linked attachments after existing identity/provenance checks. Preserve text exactly and retain existing caption limits and rejection behavior. Missing provider content must never borrow webhook or outer text.
3. Verify video/private forward, bound channel, no caption, photo album, mixed media, direct video, duplicate forward, identity/attachment mismatch, malformed and boundary-length Unicode captions. Use an isolated runner-managed *_test PostgreSQL database and temporary synthetic storage.
4. Lead inspects actual diff and runs the required FULL local profile. One fresh read-only review; one bounded fix pass and narrow closure check only if needed.
5. Publish one PR, squash after passing checks/review, run FULL on the exact release SHA and use the existing Selectel guarded deployment. Record manifest/smoke evidence.

Allowed production paths: `backend/src/modules/max/application/ports.ts`, `backend/src/modules/max/infrastructure/max-api.ts`, `backend/src/modules/max/infrastructure/process-task.ts`. Tests: MAX API and MAX forward/capture integration tests. Documentation: this task's plan/report only.

Forbidden: ACL/F12, other messengers, schema/migrations, downloader/transcoding, duplicate claim algorithms, existing production memories. Stop for storage-model changes, production-data risk, unexpected source drift or unavailable mandatory checks. Production repair of an existing memory requires a separate exact owner confirmation.

Primary focused checks: `bun test ./backend/src/modules/max/max-api.test.ts`; `bun run test:backend:integration -- src/modules/max/forward-import.integration.test.ts`. Release gate: `bun run verify:full --base 3fce2739205da927b95eb3379b1d066b61282965`.
