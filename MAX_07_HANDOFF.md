# HANDOFF — memoLy / MAX migration after MAX-06

Prepared: 2026-09-15

## Status

- MAX-01: APPROVED
- MAX-02: APPROVED
- MAX-03: APPROVED
- MAX-04: APPROVED
- MAX-05: APPROVED
- MAX-06: APPROVED
- MAX-07: WAITING — NOT STARTED
- MAX-08: APPROVED
- Publication state: local only

## Repository state

Canonical repository: `alexdubaev/OurMemoriesDevBot`
Branch: `feat/max-adapter`
Worktree: `D:\codex\TG_OurMemoriesDevBot\worktrees\max-adapter`
Original MAX feature base / origin/main / merge base: `7927c6e11c8444a658c819325c97bc586696778b`
MAX-06 task base: `c8c6202e09453703fe71477ac95d3c4501dd43e8`
MAX-06 implementation head: `3c407cffb16b696756d32f514469cd6b4ca00927`

The branch and worktree must be preserved. Do not switch this branch in another checkout, create nested isolation, reset, rebase, clean, or remove the worktree. No push, PR, merge, deployment, webhook registration, or subscription mutation has occurred.

## MAX-06 result carried forward

MAX direct-dialog image capture is implemented and approved for both proven native send modes:

1. Quick/ordinary `type=image`: 1–10 attachments are one ordered shared photo Memory. The limit is memoLy's application boundary, not an official MAX guarantee. memoLy stores the exact MAX rendition bytes.
2. Uncompressed `type=file`: exactly one file attachment per message is supported when shared byte/MIME/decode validation proves it is an image. memoLy stores the exact delivered file bytes. Separate messages remain separate Memories; there is no heuristic grouping.

Caption text becomes the photo Memory body. Provider URL/token are transient only. Stable message + attachment identity, deterministic MediaAsset IDs, durable claims, private storage, quota, final authorization, row locking, guarded source transition, independent responses, and terminal cleanup provide retry safety without partial Memory publication.

New undeployed migration:

`backend/prisma/migrations/20260915130000_max_image_capture/migration.sql`

There are now three additive MAX-related migrations:

1. `20260914100000_max_auth_identity`
2. `20260914130000_max_text_ingestion`
3. `20260915130000_max_image_capture`

Clean test databases applied all 25 repository migrations. Do not edit applied migration history.

## MAX-07 owner decision — preserve exactly

MAX video нельзя автоматически начинать постоянно хранить в Selectel/private storage.

MAX-07 должен СНАЧАЛА на реальном MAX доказать, можно ли:

- оставить оригинал видео в MAX;
- хранить в memoLy стабильный provider reference/token;
- позже надёжно получать/redeliver то же видео;
- обновлять временные URL через стабильный reference.

Предпочтительно:

MAX stores original video
→ memoLy stores stable provider reference
→ memoLy retrieves/redelivers video from MAX when needed.

Если это невозможно или ненадёжно:

STOP и вернуть результаты owner.
Не выбирать альтернативное хранение без отдельного одобрения.

## MAX-07 required first action

MAX-07 is not authorized to implement video ingestion yet. After a new explicit owner assignment, begin with a bounded real-MAX feasibility investigation only:

- verify the current branch/worktree/HEAD/status and canonical origin;
- read `AGENTS.md`, MVP start/index, relevant private-media documentation, MAX-05 and MAX-06 design/plan/report;
- verify the official and observed stable video identity/reference contract;
- verify whether MAX can retain the original while memoLy later retrieves or redelivers the same video;
- verify temporary URL refresh through the stable reference;
- distinguish documented guarantees from short live observations;
- use synthetic video only and perform no webhook/subscription mutation;
- make no production-code or migration change before the owner adjudicates the evidence.

If stable provider-hosted retrieval/redelivery is not proven, STOP. Do not choose Selectel/private permanent original storage, proxy storage, download-on-ingest, or any other fallback architecture without separate owner approval.

## MAX-07 exclusions

- no automatic permanent storage of MAX video originals;
- no image-pipeline refactor;
- no audio/voice, generic file, stickers, contacts, or locations;
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

STOP now. Do not begin MAX-07 automatically. Wait for explicit owner authorization for the bounded MAX-07 real-provider feasibility investigation.
