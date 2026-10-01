# Channel phase engineering decisions

Task MAX-ONBOARDING-INVITE-CHANNEL; same branch/worktree/base as main plan. Sequential implementation owner only after invite worker finishes.

Canonical authorization: active Family role full, via exported requireFull policy; owner-only member administration does not apply. Channel eligibility independent of child-profile readiness. Add canManageMaxChannel only as derived current full capability, never membership existence alone.

Persistence: minimal additive signed-int64 channel history and actor-bound expiring setup decision. Keep canonical Family.maxBackupChatId pointer compatible; retain all existing bindings/provider references/content. Track channel title, connected/disconnected/permission_problem/replaced plus last lifecycle timestamp/provider check version. Pending setup carries opaque UUID, actor external subject/internal user, channel id, candidate family ids, expected previous active id/version, expires and CAS terminal status. No channel setup invitation tokens. History selects Family but never grants capability.

Lifecycle: authenticated webhook raw body preserves exact numeric int64; enqueue new lifecycle events; do not replay all historic captured updates on production. Queue uses existing max task architecture. bot_removed clears/deactivates current publication routing atomically but retains historical relation. bot_added checks current provider channel private/type/active plus bot owner-or-admin/write through canonical verifier, maps actor MAX external identity, selects current full candidates. Same signed-channel history and current authorization reconnects without selection. One candidate auto first-bind. Multiple candidates one tap. Healthy active A plus B always explicit replacement confirmation; revalidate A/B, ACL, actor, history, expected active pointer and version at final callback. Previously disconnected A and unambiguous B automatically replaces, preserving A history. Old/reordered events cannot overwrite newer state.

Service: extract CLI verifier/binding/backlog into MAX reusable exported application/infrastructure service; CLI thin compatibility adapter, preserves dry-run and emergency diagnostic. CLI and automatic flow call one transactional binding method. The sequential worker is assigned sole owner of schema, MAX composition, family contracts/routes for this phase. No dependency/lock or generated manual edits.

Concurrency: exact-chat/family serialization and current DB uniqueness; consistent actor then Family then membership locks to match canonical family changes, avoid advisory lock deadlock. Callback list is not grant. Wrong actor, revoked role, expired setup, cross-family occupied channel, duplicate events/callbacks and concurrent switch fail safely. Save decision and output/outbox atomically, process task retries idempotent. Keep provider diagnostics out of user text/log tokens. Prefer safe category observability.

Backlog: retain existing canonical media-only send-intent/ambiguous safety and attachment order. Rebind/reconnect may queue only provably unsent rows (never replay sent/ambiguous/send_intent). Existing outbox permanent dedupe key means terminal task needs explicit CAS reactivation or generation-key approach. Disconnect during upload/pacing/send must gate current pointer/state; no unsafe provider retry, no new self-loop path. Channel ingest active pointer/state only, regress current image/mixed/video/voice paths.

Permissions without event: authoritative API on added/callback plus a bounded current-state refresh (status-read or periodic existing scheduler) must detect missing rights even when bot_admin_permissions_changed absent. Transient provider failure must not overwrite known disconnected/history with fake connected state.

UI contract: compact backend-authoritative status with title/state/canManage; omit signed IDs, internal binding/provider diagnostics. Viewer read status without management CTA. Authorized instruction only: add memoLy bot as administrator of Family MAX channel. No wizard, QR, code, chat ID input.

Acceptance: tests for all spec sections31-32 and ACL/races/backlog; clean migration chain and upgrade existing bindings signed IDs preserved. Relevant deterministic tests first, full final lead checks; synthetic disposable DB only. UI worker later handles responsive320/390/430 and snapshot/e2e. No production data operations. No commits/push by worker.

## Implemented provider contract and final rulings

- Personal entry is https://max.ru/<public-bot-username>?start=invite_<token>. The canonical 64-character token makes a 71-character payload, below the current official 128-character limit.
- Valid bot_started delivery uses the official inline-keyboard open_app button with web_app set to the public bot username and payload set to the identical invite_<token>. Authenticated Mini App preview/accept remains the only membership-creation boundary. Already-member opens memoLy without a consumed invitation payload.
- The response worker decrypts the retained actor-bound invitation context and resolves current validity again before each send; ciphertext is cleared only after successful delivery persistence.
- Channel decisions use an opaque UUID, actor subject and mapped User, live full/active membership, 15-minute expiry, old/target binding versions and active-pointer CAS. A current historical relation never grants permission by itself.
- Channel mutations serialize through the shared advisory lock, then current actor identity, Family and membership row locks. Provider I/O runs outside DB locks. Concurrent stale preflight retries before making a decision, so a uniquely resolved Family gets direct Replace/Cancel rather than a redundant Family selector.
- Explicit replacement requires fresh target provider rights and locked old/target versions; a separate old-channel provider request does not block an already authorized explicit replacement. Automatic replacement requires authoritative old loss or existing disconnected state. Transient failures never manufacture loss.
- Every eligible Family gets a callback button. Delivery batches at most 30 buttons per message with original indexes and an abort-aware 550ms interval between batches.
- Channel send intent revalidates the active Family pointer and connected history under the same lock. Reconnect/switch resumes only provably unsent backups and uses chat+version generation keys; sent, ambiguous, send-intent and provider references are preserved.
- A senderless webhook with unresolved outbound correlation is encrypted and captured durably. Processing waits for correlation, suppresses only the exact own message, and publishes a different human message through the existing canonical publisher after settlement.
- Minimal additive migration 20261001130000_max_channel_onboarding preserves existing signed Family routing pointers and seeds their history. No historical Inbox replay is enabled.

Official sources verified for this task:
- https://dev.max.ru/docs/chatbots/bots-coding/prepare
- https://dev.max.ru/docs-api/use-cases/sending-messages/keyboard
- https://dev.max.ru/docs-api/objects/Update
- https://dev.max.ru/docs-api/methods/GET/chats/-chatId-/members/me
- https://dev.max.ru/docs-api/methods/POST/messages
- https://github.com/max-messenger-bot/max-bot-api-schemas/blob/main/schema_2026_07_01.json

Owner deferred LOCAL-DB-CROSS-PROJECT-RECOVERY. All local PostgreSQL validation uses the explicitly assigned, owned, disposable memoLy task database; VIBE database/container/volume/snapshot operations are excluded. Production release is separately authorized through the canonical release script after review and CI. Physical MAX acceptance remains owner-driven.
