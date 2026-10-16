# MAX forwarded voice recovery — implementation plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` with one bounded implementation task. Owner policy requires one independent product review, one bounded fix pass, and narrow closure verification.

**Goal:** Import a voice forwarded by an authorized MAX user when authenticated ingress contains audio but the original provider lookup is missing and later envelope lookup omits audio.

**Architecture:** Retain a single normalized forwarded voice locator only in the existing encrypted inbox. Re-fetch the outer message to verify sender, dialog recipient, outer MID and referenced original MID; permit ingress audio recovery only after the original returns `message_not_found`, never as an authorization-error fallback. Reuse current envelope source claim, private voice ingestion and publication.

**Tech Stack:** Bun/Hono/Prisma/PostgreSQL 18, existing private storage and ffmpeg pipeline.

**Spec:** User task MEMOLY-MAX-VOICE-ROOT-CAUSE and coordinated structural evidence 2026-10-16. Runtime/base `0ed7ac70cd1f1d0e245995f26a9c275ba830eebd`; isolated branch `fix/memoly-max-voice-root-cause`.

## Evidence and rulings

- A controlled direct native voice was published once with stored OGG and ready MP4; no direct product defect reproduced. Preserve this path and run its existing narrow regressions.
- A controlled forwarded voice contains one `message.link.message.attachments[0]` of type audio with valid ID/token/HTTPS allowed-host URL. Its source was denied, no staged media/Memory. Later provider outer lookup confirms actor/dialog/original reference but omits attachments; original lookup returns nonretryable 404/message_not_found.
- Normalizer currently drops forwarded audio. Envelope fallback and attachment claim only handle image/video.
- Ruling: authenticated ingress audio is trusted input from MAX, as for direct voice; later provider identity must still match. Audio recovery from ingress is limited to a missing original and absent provider envelope attachments. Present conflicting provider media, failed outer identity lookup, wrong identities and accessible foreign bindings do not qualify. This is a private user import, not a verified channel-origin claim; do not invent a channel ID or use nested sender/chat hint as authority.

## Global constraints

- No production DB writes/replays, webhook/subscription/channel-binding edits, merge or deploy.
- Disposable local test DB only; no native/cloud DB substitution contrary to local database rules.
- No schema/migrations, shared public contracts, dependencies/lockfile, root config, frontend or photo/video refactoring.
- No raw URLs/tokens/PII in tracked fixtures, logs, report or durable source rows. Tests use synthetic domains/data only. Voice URL remains in encrypted inbox until terminal cleanup.
- Primary lead owns plan, security rulings, diff inspection and final checks; worker owns production implementation.

## Review focus

- Outer provider MID, authenticated sender, recipient and original reference must all match before any ingress media download.
- Ingress-only audio recovery must not run for authorization failure, accessible foreign channel or conflicting/nonempty provider envelope media.
- Only one audio attachment is eligible; reject mixed voice sets without changing existing image/video behavior.
- Generic persisted attachment kind is `file` for voice: source claims and repeated forwards must compare canonical identities consistently.
- FULL/current family access, publication recheck, private storage, deterministic asset recovery and source dedupe remain enforced.

## Task 1: Preserve and safely process one forwarded voice

**Allowed production files:**
- `backend/src/modules/max/transport/update-mapping.ts`: retain strictly validated audio within forwardedFrom.attachments.
- `backend/src/modules/max/infrastructure/process-task.ts`: missing-original-only voice fallback; provider identity verification; canonical voice routing; envelope attachment claim maps voice to file.
- `backend/src/modules/max/infrastructure/process-voice.ts`: only if required to reuse verified outer voice; no broad direct resolver changes.

**Allowed tests:**
- `backend/src/modules/max/forward-import.test.ts`: small wire-normalization regression for observed forwarded audio shape, malformed payload rejects.
- `backend/src/modules/max/forward-import.integration.test.ts`: actual encrypted ingress to private voice Memory using synthetic audio and real test DB.
- `backend/src/modules/max/capture.integration.test.ts`: change only if a unique direct regression is missing; existing native-audio cases preferred.

**Interfaces:** Reuse MaxInboundAttachment voice `{ kind, providerAttachmentId, url }`, MaxResolvedMessage, current source claims and voice processor. Add only internal helper options as necessary, not public wire contracts or unchecked casts.

- [x] Add a failing ingress boundary regression for audio in link.message.attachments. Observe meaningful failure before implementation.
- [x] Add integration coverage for original 404 + provider-confirmed outer identity with omitted audio; successful one voice Memory/private stored asset, no capability persistence in source rows, encrypted payload cleared after terminal processing. Re-forward same original from same actor dedupes; concurrency/retry uses existing claim boundary.
- [x] Cover provider-confirmed forwarded audio when present; reject mismatched outer sender/recipient/original ref and missing outer lookup; no media download on denial.
- [x] Cover ingress-only recovery denied for accessible foreign channel/authorization failure and conflicting provider attachments; viewer/revoked membership denial can reuse neighboring integration tests where exact boundary is already covered.
- [x] Implement minimal changes after relevant failing test signals. Treat only an omitted provider forwarded attachment list as recoverable only with exactly one validated ingress voice and original missing-message cause. Present provider audio must agree with ingress identity. Do not merge/filter mixed sets into a valid voice.
- [x] Run narrow ingress/unit checks, full forward-import integration file and existing direct-native-audio integration cases. Run typecheck and diff check.

**Commands:**
- `bun run --cwd backend test:unit -- src/modules/max/forward-import.test.ts`
- `bun run --cwd backend test:integration -- src/modules/max/forward-import.integration.test.ts`
- `bun run --cwd backend test:integration -- src/modules/max/capture.integration.test.ts -t "native audio|recognized audio"`
- `bun run --cwd backend typecheck`
- `git diff --check`

Do not run DB-backed files directly under bun without the managed runner; skip/zero tests is not a pass. If DB infrastructure remains unavailable, record that blocker without claiming integration success. No commits/push until lead checks staged scope; no merge/deploy under this task.

## Acceptance and closure

Lead inspects actual diff, runs relevant deterministic checks, then requests one fresh independent product review with original requirements and evidence. Reviewer may fix confirmed in-scope P0/P1/P2 findings; run narrow closure check after any fix. Final report separates direct successful physical sample, forwarded root/fix/local validation and outstanding physical acceptance on a separately authorized deployed build.

## Final verification and review

One fresh independent product reviewer fixed two P2 findings: distinguish an omitted provider list from an explicit empty list; retain an unsupported sentinel for mixed audio so it cannot collapse to an image-only import. No second whole-change review was required by owner policy. Lead inspected actual fixes and ran narrow closure checks.

- Ingress unit regression: initial RED (3 pass, 1 fail), final 4 pass / 0 fail / 14 assertions; exit 0.
- Backend typecheck: exit 0 after production review fixes. A later test-only byte-array assertion correction did not change product source.
- Forward integration: 27 pass / 1 test assertion failure in the first real PostgreSQL run. The failure was Buffer versus Prisma Uint8Array comparison, after voice publication already succeeded. Corrected assertions verify zero ciphertext/IV/tag byte lengths.
- Narrow closure: the previously failed recovery/dedupe case passes (1 pass), plus existing direct-native audio success/failure cases (2 pass); exit 0. The other 27 unchanged integration cases were not repeated.
- Docker Desktop was started by owner. Automatic project network creation was blocked by address-pool exhaustion. A task-owned PostgreSQL 18 container used the existing bridge with a unique localhost port and tmpfs storage; the documented TEST_SKIP_DOCKER/test-only URL mode ran the same integration runner. The task container and its temporary DB were removed after tests.
- No schema/migrations, dependency, frontend or direct voice processor changes. No production state/config changes, replay, merge or deployment. No public publication requested/performed; deliver a local reviewable commit.
- Before any later main integration, run the repository's required `bun run verify:local` against the exact source. After separately authorized deployment, verify one forwarded voice plays and repeating it produces no duplicate. Current production remains unchanged.
