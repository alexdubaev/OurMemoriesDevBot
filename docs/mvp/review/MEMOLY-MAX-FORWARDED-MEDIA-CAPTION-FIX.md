# MEMOLY-MAX-FORWARDED-MEDIA-CAPTION-FIX

Status: REVIEW / release BLOCKED by local test infrastructure.

Model: GPT-6 Codex lead; GPT-6 Luna implementation; one independent read-only review to be recorded in the PR.
Base: `3fce2739205da927b95eb3379b1d066b61282965`.
Branch: `fix/max-forwarded-media-caption`.
Worktree: `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/max-forwarded-media-caption`.
The PR records the exact published head SHA and review result.

## Confirmed cause and source

MAX's [Message documentation](https://dev.max.ru/docs-api/objects/Message) and [official SDK types](https://github.com/max-messenger/max-bot-api-client-ts/blob/main/src/core/network/api/types/message.ts) define `link.message` as `MessageBody`: its `text` and `attachments` belong to the forwarded original. The outer `body.text` is separate content. A verified original obtained with `getMessage` uses its own `body.text`.

Webhook normalization deliberately does not trust forwarded text. The provider lookup previously retained linked attachments but discarded their caption, and the verified envelope fallback explicitly assigned `text: null`. A real PostgreSQL synthetic test reproduced a published video Memory with an empty body.

The existing internal `MaxResolvedMessage` now carries optional `forwardedText` separately from outer text. The fallback uses it only with provider-confirmed linked attachments after existing identity and provenance checks. The ingress-only voice fallback remains caption-free. The existing 8,000-code-point policy is unchanged; invalid linked text types fail closed. No caption is borrowed from the outer or webhook message.

## Changed boundaries

- `backend/src/modules/max/application/ports.ts`: internal optional linked-caption field.
- `backend/src/modules/max/infrastructure/max-api.ts`: parse and validate linked caption.
- `backend/src/modules/max/infrastructure/process-task.ts`: select verified caption with linked attachments.
- MAX API and forward-import integration tests: synthetic regression scenarios.
- This report and task plan.

No public contracts, ACL/F12, schema/migrations, download/transcoding, duplicate claim algorithms, or other messengers changed. No real family data, photos, names or screenshot content were used. Screenshots: not applicable to this backend change.

## Verification evidence and limitation

| Signal | Observed result |
| --- | --- |
| API RED, before production edits | 40 pass / 2 fail, exit 1: missing linked caption and malformed type accepted |
| PostgreSQL RED, personally reproduced by lead | 0 pass / 1 fail, exit 1: video Memory persisted `body: ""` instead of synthetic caption |
| API GREEN, personally run by lead | 42 pass / 0 fail, 159 assertions, exit 0 |
| Backend typecheck, personally run by lead | exit 0 |
| Two focused PostgreSQL caption cases, worker-run before outage | 2 pass / 0 fail, exit 0: exact text, 8,000 boundary, 8,001 denial, no-caption isolation and repeat-forward dedupe |
| Complete final forward-import integration suite | BLOCKED: task-owned PostgreSQL became unavailable (P1001); this is not a test pass |
| FULL release gate | BLOCKED; not completed. No merge or deployment permitted on this evidence |

All database tests used a newly created isolated `memoly_caption_test` database, PostgreSQL 18, loopback port 56592, and temporary filesystem storage. Compose could not create another network because its address pools were exhausted; the supported explicit external test-database mode was used instead. During Linux FULL environment preparation, the local C drive exhausted free space and Docker returned `input/output error`. Even removal of the task's own verification container failed. No global prune, deletion of others' resources, or Docker restart was performed.

Task-owned resources for cleanup after Docker recovery: `memoly-caption-test-pg18-20261017`, `memoly-caption-verify-linux-20261017`. A failed pull/run attempt used `memoly-caption-pg18-20261017`; no container was created under that name. Other containers and networks must remain untouched.

Required continuation after infrastructure recovery: run the complete MAX forward/capture integration checks, then `bun run verify:full --base 3fce2739205da927b95eb3379b1d066b61282965` on the exact final head, record evidence in PR, squash, and run FULL on the accepted release SHA before the existing Selectel guarded deployment. Do not use missing infrastructure or syntax-only checks as a substitute.

## Existing memories and rollback

Existing memories were not modified. Repeat forwarding intentionally remains a duplicate and does not backfill an old Memory body. A separate precisely approved repair could re-fetch the stored MAX source/envelope identity, verify it and the attachment IDs, and update only that existing Memory's body, preserving source rows and duplicate keys. This is possible only if MAX still returns a verifiable caption; otherwise recovery cannot be promised without the original text. No repair script or automatic backfill is included.

Production source was confirmed read-only at the base SHA before development. Deployment was not attempted. Application rollback remains the existing guarded release mechanism; no database rollback is needed for this change.
