# MAX-07 — MAX-hosted video and native-voice boundary

Date: 2026-09-15
Status: APPROVED
Model/workflow: Codex lead engineer (GPT-5); bounded scout, implementation worker, two fresh independent reviewers
Branch: `feat/max-adapter`
Worktree: `D:\codex\TG_OurMemoriesDevBot\worktrees\max-adapter`
Task base: `4b3595d739be144ced9adef437e7d5fec3d83353`
Video implementation/review head: `c225dc588f8a1a8034f5fb807e94ecc90334f798`
Owner-decision documentation base: `a7de0d7bd10089ff026f4453078708f354c888cf`
Origin/main and merge base: `7927c6e11c8444a658c819325c97bc586696778b`
Publication: local only; not pushed, no PR, no merge, no deployment

## Product result

- MAX normal direct-dialog video is supported for MVP.
- memoLy persists only stable `{mid, payload.id, attachment position, type=video}` identity in a
  provider-owned `MaxVideoReference`; it does not persist rotating token or signed URLs.
- Authorized playback rereads the exact MAX message, verifies attachment identity, resolves the
  current token through `GET /videos/{encodedToken}`, selects a supported MP4 rendition, and streams
  it through memoLy's authenticated media boundary.
- MAX video originals are not downloaded on ingest, copied to Selectel/private storage, represented
  as `MediaAsset`/`MemoryMedia`, or charged to family private-storage quota.
- Native MAX voice is explicitly unsupported for MVP. Its live `message_created` exposed no
  `message`, `body`, `mid`, attachments, stable media identity, token, or URL. No undocumented
  retrieval path, fabricated identifier, provider hack, or retry loop was added.
- Ordinary attached MP3/M4A is undecided and remains an optional future probe. It is not a MAX-07
  blocker and this report makes no support claim about it.
- Telegram voice is unchanged and remains supported.

## Video architecture and security

- Session, active family membership, published Memory ownership, and provider-reference ownership
  are verified before any MAX or CDN request.
- Later playback uses the stored message `mid` and stable `payload.id`; token equality is never used
  for identity or idempotency.
- The CDN boundary permits HTTPS/default-port `maxvd<digits>.okcdn.ru` MP4 only, rejects redirects,
  sends no MAX Authorization/cookies/referrer/credentials, forwards one bounded Range, propagates
  cancellation, validates exact body length, and sanitizes network/stream errors.
- Public DTOs contain only an opaque reference UUID, safe metadata, and a relative memoLy playback
  path. No MAX identifier, token, signed URL, CDN host, or storage key is exposed.
- The existing DB-backed inbox, source uniqueness, fixed Memory ID, task outbox, guarded source
  transition, and independent logical response remain authoritative for retries and deduplication.
- Duration is normalized only by the tested live rule `7 seconds → 7000 milliseconds`; inconsistent
  evidence produces `durationMs = null` rather than a guess.

## Migration and configuration

Added the undeployed additive migration:

`backend/prisma/migrations/20260915150000_max_video_reference/migration.sql`

It creates `MaxVideoReference` with unique source/Memory linkage, family-consistent foreign keys,
stable attachment identity, position, and nullable safe metadata. Existing migration history was
not edited. There are four additive MAX migrations through MAX-07, and all 26 repository migrations
applied successfully to clean test databases.

`MAX_VIDEO_MAX_BYTES` is a bounded streaming ceiling with a 250 MB maximum, not storage quota. No
new secret was introduced.

## Changed paths

- `.env.example`, `backend/.env.example`
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260915150000_max_video_reference/migration.sql`
- `backend/src/modules/max/**` within the bounded video adapter
- narrow composition/playback changes in `backend/src/{app.ts,index.ts,env.ts,env.test.ts}` and
  `backend/src/modules/media/**`
- MAX video DTO serialization in
  `backend/src/modules/memories/infrastructure/prisma-memory-repository.ts`
- `packages/contracts/src/memories.ts` and its test
- `webapp/public/private-media-sw.js`
- MAX-07 design, plan, investigation, ledger, report, and handoff documents

No Telegram production path, dependency, lockfile, CI, deployment, webhook, or subscription code
was changed.

## Verification

- Backend unit: 447 passed, 0 failed, 1,316 assertions, exit 0.
- Contracts plus feed regression: 28 passed, 0 failed, 80 assertions, exit 0.
- Clean-database MAX capture integration: 38 passed, 0 failed, 218 assertions, exit 0.
- Clean-database Media integration: 7 passed, 0 failed, 70 assertions, exit 0.
- Clean migration deploy: all 26 migrations, exit 0.
- Backend typecheck: PASS, exit 0.
- Contracts typecheck: PASS, exit 0.
- Architecture check: PASS, 671 source files, exit 0.
- Prisma schema validation: PASS, exit 0.
- `git diff --check`: PASS.
- No visual UI change required screenshots.

An earlier combined integration run completed MAX 36/36 and Media 7/7, then the unchanged Memories
suite completed 12 green scenarios before the known Windows Bun 1.4.0 post-assertion segfault
(exit 3). Final scoped MAX and Media runs on the reviewed head completed normally with exit 0.

## Independent review

The first fresh reviewer fixed two P1 and four P2 findings: live `urls.mp4_720` normalization,
transaction rollback on a lost source transition, bounded rendition selection, exact stream length
and cancellation, stale attachment-shape rejection, UUID validation, and real-DB video coverage.

The second fresh whole-change reviewer fixed three P2 findings: malformed resolver responses now
terminalize safely, 416 Range responses preserve total metadata, and upstream stream read/cancel
errors are sanitized. Final verdict: `production_ready`; no unresolved P0/P1/P2.

## Live evidence and explicit limitations

- Video evidence: stable `mid`/`payload.id`/position/type, rotating token, encoded resolver token,
  live object-shaped `urls.mp4_720`, `7 → 7000` duration discrepancy, HTTPS MAX CDN, credential-free
  bounded MP4 retrieval.
- OWNER-ACCEPTED MVP RISK: MAX provides no proven/documented indefinite archival-retention guarantee
  for inbound video. Informational 24-hour/seven-day checks do not block MAX-07 or the MVP roadmap.
- Native voice evidence: from baseline marker `10503`, one synthetic voice yielded one
  `message_created`, next marker `10505`, and only `timestamp`, `update_type`, `user_locale`. Without
  `mid`, exact message lookup and retrieval cannot be established. The owner accepts native voice
  as unsupported.
- Physical provider response delivery remains at-least-once after an unknown MAX outcome; memoLy's
  logical DB idempotency remains authoritative.

## Final state and next step

MAX-07 is APPROVED with explicit MVP capability notes: MAX video is supported, native MAX voice is
unsupported, generic attached MP3/M4A is an optional future follow-up, and Telegram voice remains
supported and unchanged. Preserve this branch/worktree. No push, PR, merge,
deployment, webhook registration, or subscription mutation was authorized or performed. Do not
start MAX-10 automatically. Any future ordinary MP3/M4A probe or native-voice revisit is a separate
owner-assigned task with its own evidence and bounded design.
