# FIX-MAX-CHANNEL-ADD-THEN-ADMIN-ONBOARDING

Base: decc5d45ec78b26d735e03894601ed63ff86141f, fresh origin/main reconciled from initial 4b5760ed1f5b7215b8241384142d9ed3c4e562d1.
Branch: fix/max-channel-add-then-admin-binding.
Worktree: .worktrees/max-channel-add-then-admin-binding.
Lead model: GPT-6. Discovery delegated to scout; bounded implementation to worker; independent review to fresh reviewer.

## Production evidence and owner ruling

At 03.10.2026 01:29 MSK production accepted only one current permissions_changed lifecycle inbox. It finished successfully and created the target channel connected/version=1/familyId=null, without decision or response. No bot_added is persisted for this attempt. Payload redaction prevents establishing the historical permissions actor. Subscription includes all three lifecycle types; current verifyChannel passes. Why bot_added did not persist remains unknown; provider non-delivery must not be asserted. Specific production identifiers remain in the local diagnostic report rather than tracked design documentation.

Owner APPROVED OPTION 2: authenticated outer MAX actor + current active Full Family membership + bot channel verification + authoritative provider proof that that same actor is owner/admin of that exact channel + explicit confirmation. Callback rechecks all proofs and current Family/binding versions. This adds a permitted trust source, not automatic binding from bot rights. No manual SQL repair or production Memory creation.

## Design

1. Extend canonical max-channel-provider with verifyActorAdmin(channelId, actorSubject). GET /chats/{chatId}/members/admins is authoritative; check exact signed int64 user_id, explicit is_owner/is_admin, reject bot actors, malformed IDs and ambiguous/incomplete responses. Use raw int64 parser to avoid unsafe numeric rounding. Treat network/provider failures as retryable where appropriate, never as authorization success. Official contract: https://dev.max.ru/docs-api/methods/GET/chats/-chatId-/members/admins . Existing bot verifier stays mandatory.
2. Hook only a verified forwarded ORIGINAL from provider GET after validateMaxForwardedMessage and current Full target resolution. Actor is authenticated OUTER event.senderId and its mapped userId, never nested forward sender/channel hints. For missing or nullable-family binding, invoke canonical onboarding recovery offer. A foreign historical Family association remains denied.
3. Persist explicit actor-bound consent in existing MaxChannelDecision; phases for recovery must remain distinguishable through subsequent replacement, so actor owner/admin is checked again on every mutating recovery callback. Existing actorUserId/actorSubject, selectedFamilyId/candidates, expectedActiveChatId/version and expectedChannelVersion capture durable proof provenance and CAS expectations. No schema change.
4. First offer is always “Подключить канал … к семье …?” with Подключить/Отмена, even a single eligible Family. Multiple Families first use existing actor-bound target selection; no first-Family fallback. Lock and reread MAX identity/current Full/active Family before creating a decision. Save exact current active pointer/version. Do not assign Family or change routing on offer.
5. Callback rejects other actor, expired/cancelled/completed decision, foreign channel, changed version, changed active pointer/version, identity remapping, revoked/viewer/deactivated Family. Reverify private active channel, bot owner/admin/write and same actor channel owner/admin outside locks; reread persisted state/ACL under canonical advisory and row locks before final mutation. Increment target binding version on completed recovery to fence competing decisions.
6. If selected Family already has another healthy channel, connection confirmation must lead to existing explicit replacement confirmation; do not silently replace. Preserve unavailable/disconnected old-channel semantics, historical Family association, backlog detach/requeue and send-intent protection via bindMaxChannelAndQueue and existing helpers. Recheck actor admin on replacement callback too.
7. First forward is terminalized without generic-denied response when a connection offer exists; no original claim, Memory, media processing or backup. After confirmed binding, instruct actor to forward again. New outer forward then uses unchanged original claim/duplicate/processor pipeline. This is the owner-allowed simpler architecture. Historical date, playback identity, original uniqueness and zero repost remain unchanged.
8. Preserve trusted bot_added provenance when rights are missing using a pending MaxChannelDecision phase (await_permissions), actorSubject/userId, eligible candidate IDs and expected binding version. Do not mark Family connected before provider verification. permissions_changed may consume valid bot_added provenance only after current identity/Full/Family/versions revalidation. No prior provenance means unbound. Keep already-admin path immediate.
9. Lifecycle ordering: removed invalidates pending/choice/recovery decisions. Old permissions cannot resurrect removal. Duplicates are idempotent; concurrent delivery serialized; same timestamp favors removal. A delayed bot_added may supplement provenance for a newer verified unbound permissions event only if there is no intervening removal and current verification passes; it must not downgrade current lifecycle time or restore stale history. If exact ordering cannot be proven with existing models, fail closed and use approved recovery instead of guessing.
10. Safe diagnostic output: lifecycle kind/inbox/channel, state, familyAssociated boolean, decision category. Never payload, titles/text, tokens, URLs or private content.

## Bounded execution

Task A — recovery trust, consent, callback and forward hook.
Allowed: backend/src/modules/max/application/channel-onboarding.ts; infrastructure/max-channel-provider.ts and tests; infrastructure/process-task.ts and tests; index.ts (lead accepts only provider/recovery wiring); forward-import.integration.test.ts; optional channel-recovery.integration.test.ts within same module.
Tests first: Full+admin+bot rights confirm; member/viewer/revoked/no linked identity/forged actor/other callback actor; actor loses admin/Full, bot loses write; version/Family active-pointer changes; foreign Family denial; connected/null and absent recovery; explicit cancel/expiry; healthy replacement confirmation; multiple Family selection; confirmed retry video historical date and zero backup/repost/duplicates; provider malformed/exact IDs.

Task B — lifecycle trusted pending provenance, ordering and regressions.
Allowed: channel-onboarding.ts; capture.integration.test.ts; optional channel lifecycle tests in same module. Depends on Task A accepted diff.
Tests first: admin-at-add immediate; missing rights preserves provenance; actorless permissions completes single/multiple Family flow; current revocation/viewer/identity reassignment prevents bind; no provenance stays unbound; removed/older/same-time permissions, duplicate and reordered/concurrent delivery; reconnect/replacement regression. Use existing lifecycle models, no migration.

Lead inspects actual diff and reruns deterministic checks after both tasks. Fresh independent reviewer checks full change; fixes confirmed in-scope P0/P1/P2 with meaningful regression coverage; re-review if fixes made. No styles-only loop.

## Verification and release

Dedicated disposable local test DB: loopback port 46139, synthetic materials only, runner-owned Compose project. Never inherited production DATABASE_URL. Commands: bun run --cwd backend test:integration with MAX capture/recovery/forward/direct-video/media-flow/backup files; bun run --cwd backend test:unit (or relevant MAX unit subset plus full backend unit gate); bun run typecheck:backend; bun run lint; bun run architecture:check; bun run template:check; git diff --check. Record actual counts/exit codes.

Fresh-main reconciliation before commit/push and final release. Explicit add paths, reviewed staged diff, task branch push, PR template, required verify-required CI on actual head. Squash merge authorized by owner. Canonical Selectel ci-release.sh only, immutable SHA/images, preflight applied migration set/admin guard, no bypass of failures or unrelated production data manipulation. If unrelated main has unapplied migration or release in progress, reconcile safely rather than overwrite it. Task adds no migration.

After deploy verify frontend/backend/worker/scheduler revisions, live/ready, startup errors, queue, migration parity and unchanged authorization failures. Do not create production Memories automatically. Owner forwards their old video to trigger explicit recovery; confirms channel (and replacement if required), then repeats forward. Verify the original historical date/video/no repost/duplicate one Memory through owner acceptance.

STOP conditions: new schema required; destructive migration; unapproved authorization change; secret leakage; unexpected origin; conflicting shared schema/contract; unsatisfied canonical deploy guard. No next task after handoff.
