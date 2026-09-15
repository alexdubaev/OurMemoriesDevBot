# HANDOFF — memoLy / MAX migration after MAX-07

Prepared: 2026-09-15

## Status

- MAX-01: APPROVED
- MAX-02: APPROVED
- MAX-03: APPROVED
- MAX-04: APPROVED
- MAX-05: APPROVED
- MAX-06: APPROVED
- MAX-07: APPROVED
- MAX-08: APPROVED
- Publication state: local only

## Repository state

Canonical repository: `alexdubaev/OurMemoriesDevBot`
Branch: `feat/max-adapter`
Worktree: `D:\codex\TG_OurMemoriesDevBot\worktrees\max-adapter`
Original MAX feature base / origin/main / merge base: `7927c6e11c8444a658c819325c97bc586696778b`
MAX-06 task base: `c8c6202e09453703fe71477ac95d3c4501dd43e8`
MAX-06 implementation head: `3c407cffb16b696756d32f514469cd6b4ca00927`
MAX-07 task base: `4b3595d739be144ced9adef437e7d5fec3d83353`
MAX-07 video implementation/review head: `c225dc588f8a1a8034f5fb807e94ecc90334f798`
MAX-07 owner-decision documentation base: `a7de0d7bd10089ff026f4453078708f354c888cf`
MAX-07 final code and verification head: `5ec8965380f8dc9a9fccf3fe767d10aec807c927`

The branch and worktree must be preserved. Do not switch this branch in another checkout, create nested isolation, reset, rebase, clean, or remove the worktree. No push, PR, merge, deployment, webhook registration, or subscription mutation has occurred.

## MAX-06 result carried forward

MAX direct-dialog image capture is implemented and approved for both proven native send modes:

1. Quick/ordinary `type=image`: 1–10 attachments are one ordered shared photo Memory. The limit is memoLy's application boundary, not an official MAX guarantee. memoLy stores the exact MAX rendition bytes.
2. Uncompressed `type=file`: exactly one file attachment per message is supported when shared byte/MIME/decode validation proves it is an image. memoLy stores the exact delivered file bytes. Separate messages remain separate Memories; there is no heuristic grouping.

Caption text becomes the photo Memory body. Provider URL/token are transient only. Stable message + attachment identity, deterministic MediaAsset IDs, durable claims, private storage, quota, final authorization, row locking, guarded source transition, independent responses, and terminal cleanup provide retry safety without partial Memory publication.

New undeployed migration:

`backend/prisma/migrations/20260915130000_max_image_capture/migration.sql`

There are now four additive MAX-related migrations:

1. `20260914100000_max_auth_identity`
2. `20260914130000_max_text_ingestion`
3. `20260915130000_max_image_capture`
4. `20260915150000_max_video_reference`

Clean test databases applied all 26 repository migrations. Do not edit applied migration history.

## MAX-07 owner decision — superseding approval, 2026-09-15

The owner explicitly unblocked MAX-07 VIDEO implementation and accepted the MVP dependency on
MAX-hosted video despite the absence of a proven or documented indefinite archival-retention
guarantee. The 24-hour and seven-day retention checks are informational only and must not block
implementation, review, merge readiness, or the MVP roadmap.

Approved architecture:

MAX stores and retains video
→ memoLy stores stable `{ mid, payload.id, attachment position, type=video }`
→ memoLy resolves a current token and supported playback URL when an authorized user requests it.

Rotating tokens and signed provider/media URLs are transient transport data. They are never durable
identity, task payload, public DTO state, log data, or report data. MAX video originals are not
downloaded on ingest and are not copied to Selectel/private storage.

OWNER-ACCEPTED MVP RISK: MAX does not currently provide a proven/documented indefinite archival
retention guarantee for inbound video. This is not a blocker.

## MAX-07 VIDEO result

VIDEO implementation was initially approved at `c225dc588f8a1a8034f5fb807e94ecc90334f798` and final cancellation hardening was verified at `5ec8965380f8dc9a9fccf3fe767d10aec807c927`.

- one normal direct-dialog MAX video is published as a provider-owned `MaxVideoReference`;
- durable identity is limited to message `mid`, `payload.id`, attachment position, and video type;
- playback authorizes memoLy session, family, published Memory, and reference ownership before any MAX lookup;
- current message/token and MP4 URL are resolved on demand; transient token and signed URL are not persisted or exposed;
- CDN requests use HTTPS, the exact approved MAX CDN host family, no MAX authorization/cookies, manual redirects, bounded single-range streaming, caller cancellation, exact byte-length validation, and sanitized failures;
- publication remains DB/outbox/idempotency authoritative and creates no `MediaAsset`, `MemoryMedia`, or private/MAX-original copy.

Final verification: focused MAX/video/contracts/feed/Telegram-media 73/73; backend unit 452/452; clean-database MAX 38/38, Media 7/7, Telegram 36/36; all 26 migrations applied; backend/contracts typechecks, architecture check, Prisma validation, diff, secret, and forbidden-scope checks passed. Independent review plus lead adjudication fixed all confirmed P1/P2 findings; none remains unresolved.

## MAX-07 native voice decision

The separate bounded audio/voice investigation is recorded in `docs/superpowers/specs/2026-09-15-max-07-audio-voice-contract-investigation.md`. Official MAX docs confirm an `audio` upload/message type but do not establish the native voice event shape or an audio retrieval resolver. Do not assume that MAX audio or voice uses the video message/token/resolver contract.

The corrected authoritative ED25519 fingerprint matched. Secret-file checks, `GET /me`, and
`GET /subscriptions` passed; active subscriptions were zero. From baseline marker `10503`, one
synthetic native voice produced one `message_created` and next marker `10505`, but the event keys
were only `timestamp`, `update_type`, and `user_locale`. Repeated reads returned no `message`,
`body`, `mid`, or attachments. Without `mid`, exact `GET /messages`, stable identity, token/URL,
MIME/codec/container, duration, late retrieval/redelivery, and resolver behavior cannot be proven.

The native voice contract is insufficient for reliable MVP implementation. The owner accepted this
boundary: native MAX voice is unsupported for MVP. No undocumented retrieval path, fabricated
identifier, provider-specific hack, or unbounded retry path may be introduced. An ordinary MP3/M4A
attachment probe is optional follow-up and no conclusion about that distinct contract has been
made. Telegram voice is unchanged and remains supported.

## MAX-07 final status

APPROVED.

Explicit MVP capability notes:

Supported: MAX video through the approved provider-reference architecture.

Unsupported: native MAX voice.

Optional follow-up: ordinary attached MP3/M4A.

The unsupported native-voice capability is an accepted product limitation, not a P0/P1/P2 blocker.
The final block report is `task-7-report.md`.

## MAX-07 exclusions

- no automatic permanent storage of MAX video originals;
- no image-pipeline refactor;
- no native MAX voice implementation; no generic attached MP3/M4A, stickers, contacts, or locations;
- no invite/start work (MAX-08 is already approved);
- no account linking, groups, or channels;
- no Telegram refactor;
- no provider-neutral inbox/source/media replacement;
- no automatic webhook/subscription mutation;
- no deployment or production publication.

## Verification baseline from MAX-06

- MAX integration: 36/36, 203 assertions, all 25 migrations, two clean full runs.
- Focused MAX/media: 56/56, 215 assertions.
- Telegram capture regression: 36/36, 221 assertions, all 25 migrations.
- Backend unit: 432/432, 1,282 assertions.
- Backend/contracts typechecks: PASS.
- Architecture: PASS, 665 source files.
- Fresh final scoped reviewer: `production_ready`, no P0/P1/P2.

## Publication boundary

Remain local unless the owner explicitly authorizes publication. Do not push, create a PR, merge, deploy, register a webhook, mutate subscriptions, or clean/remove this worktree.

## Next action

STOP after this handoff. Do not start MAX-10, an audio-file probe, publication, deployment, webhook registration, or subscription mutation without a new explicit owner assignment.

## Complete repository handoff fields

- Project: memoLy / OurMemoriesDevBot
- Canonical repository: `alexdubaev/OurMemoriesDevBot`
- Origin: `https://github.com/alexdubaev/OurMemoriesDevBot.git`
- Branch: `feat/max-adapter`
- Worktree: `D:\codex\TG_OurMemoriesDevBot\worktrees\max-adapter`
- Original MAX feature base: `7927c6e11c8444a658c819325c97bc586696778b`
- Origin/main at finalization: `7927c6e11c8444a658c819325c97bc586696778b`
- Merge base: `7927c6e11c8444a658c819325c97bc586696778b`
- Final code and verification head: `5ec8965380f8dc9a9fccf3fe767d10aec807c927`
- Publication: local only; no push, PR, merge, or deployment.

The exact documentation HEAD, ahead/behind, and clean status must be read after the final handoff
commit; they are reported in the owner-facing RESULT + HANDOFF and must be reverified by the next
lead before any action.

## Remaining task states

- MAX-09: NOT STARTED
- MAX-10: NOT STARTED

## MAX migration inventory

None of these branch migrations has been deployed:

1. `backend/prisma/migrations/20260914100000_max_auth_identity`: adds `max` to the external identity provider enum; creates `max_auth_replays`, its 64-character fingerprint constraint, expiry index, primary key, and nullable cascading session foreign key.
2. `backend/prisma/migrations/20260914130000_max_text_ingestion`: creates MAX inbox/source/response enums and `max_inbox`, `max_sources`, `max_outgoing_responses`; adds permanent event/message/logical-response uniqueness, processing/delivery indexes, and cascading inbox foreign keys.
3. `backend/prisma/migrations/20260915130000_max_image_capture`: creates attachment kind/status enums and `max_source_attachments`; adds `max` to shared media source kind, ordered/planned-media uniqueness, stable provider identity and claim indexes, and cascading source foreign key.
4. `backend/prisma/migrations/20260915150000_max_video_reference`: creates `max_video_references`; enforces unique source/Memory links, non-negative position, positive nullable metadata, family index, and composite family-consistent cascading foreign keys to `max_sources` and `memories`.

Existing migration history was not edited.

## Relevant configuration names

MAX non-secret/public configuration: `MAX_ENABLED`, `MAX_BOT_EXPECTED_USERNAME`, `MAX_WEBHOOK_URL`,
`MAX_MINI_APP_URL`, `MAX_WEBHOOK_BODY_LIMIT_BYTES`, `MAX_FILE_MAX_BYTES`, `MAX_VIDEO_MAX_BYTES`.

MAX secrets: `MAX_BOT_TOKEN`, `MAX_WEBHOOK_SECRET`, `MAX_INBOX_ENCRYPTION_KEY`.

Telegram non-secret/public configuration: `TELEGRAM_ENABLED`, `TELEGRAM_BOT_EXPECTED_USERNAME`,
`TELEGRAM_BOT_MODE`, `TELEGRAM_WEBHOOK_URL`, `TELEGRAM_MINI_APP_URL`,
`TELEGRAM_WEBHOOK_BODY_LIMIT_BYTES`, `TELEGRAM_FILE_MAX_BYTES`.

Telegram secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
`TELEGRAM_INBOX_ENCRYPTION_KEY`.

No values belong in this handoff. Database/storage credentials and all provider secrets remain in
their approved secret sources only.

## Known limitations and accepted risks

1. MAX video long-term retention is provider-dependent and is not guaranteed indefinitely by public documentation.
2. The owner explicitly accepts that dependency for MVP; 24-hour/seven-day checks are informational only.
3. Native MAX voice is unsupported because the observed event has no usable message/mid/attachment/media identity.
4. Generic attached MP3/M4A is untested and remains an optional future probe.
5. MAX physical outgoing send remains at-least-once after an unknown provider outcome; DB logical idempotency remains authoritative.
6. Docker-container TLS trust for MAX must be verified before staging deployment; TLS verification must not be disabled.
7. No live webhook/subscription deployment has occurred.
8. No unresolved P0/P1/P2 or MAX-07-specific P3 review finding remains. Existing PostgreSQL client deprecation warnings observed in integration tests are outside MAX-07 scope.

## Next-task decision boundary

Do not choose or start the next task silently. Based on the owner-provided MAX roadmap, MAX-10
integration/E2E/real-device acceptance is the likely next functional task after MAX-07/MAX-08, but
its real-device/staging acceptance prerequisite is not yet satisfied. Publication/merge must first
follow an owner-approved sequence, and MAX-09 staging deployment must occur only after that approved
merge/deployment sequence. Neither MAX-09 nor MAX-10 is authorized by this handoff.

## Teamlead rules to preserve

- Lead/orchestrator does not write production implementation code.
- Use a fresh worker for each bounded implementation task.
- Lead inspects the actual diff, Git status, and exact verification output.
- Run deterministic checks before independent review.
- Use fresh independent and fresh whole-change reviewers; stop automatic loops after repeated significant P0/P1/P2.
- P3/style-only findings do not block.
- Never reset, stash, clean, rebase, force-push, or develop directly on main.

## New chat start instruction

Continue memoLy strictly from this HANDOFF and Codex Teamlead workflow.

First verify:
- branch;
- worktree;
- current HEAD;
- origin/main;
- merge-base;
- ahead/behind;
- full git status;
- canonical origin.

Do not repeat MAX-01 through MAX-08.

Do not start deployment automatically.

Do not change the approved MAX-07 video retention architecture.

Native MAX voice remains unsupported for MVP.

After verifying repository state, determine the next bounded task from the approved roadmap and STOP for owner authorization before implementation if the next step changes deployment/release state.
