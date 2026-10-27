# MAX notifications pilot (#257)

Only the single project owner in protected `CONTROL_OWNER_USER_IDS` is eligible. The value must
contain exactly one internal UUID, with exactly one `ExternalIdentity(provider=max)`, active
family membership and a delivered bot-start welcome. No names, family-owner role, actor or
other recipients are fallback targets. Owner-created publications intentionally self-notify.
The protected `MAX_NOTIFICATIONS_PILOT_SUBJECT` pins that verified owner's MAX subject;
an absent or mismatched value blocks both enqueue and delivery. Identity rebinding cannot retarget
already queued work because its identity ID and subject hash must also match.

`MAX_NOTIFICATIONS_PILOT_ENABLED=false` is the default. `MAX_NOTIFICATIONS_PILOT_SINCE` is an
explicit UTC activation instant; an absent/invalid/future value fails closed. Each enqueue stores
this generation, identity, bot and membership epoch; delivery rechecks all of them. On every
activation use a fresh current instant, never reuse the previous value. This makes unsent work
from an earlier pilot ineligible after OFF/ON. Work committed while OFF is never queued or backfilled.

Album `createEntry` and `setSources` count only new photo sources in their real write transaction.
The existing permanent create/source-operation receipts protect replay after HTTP idempotency TTL;
album locks protect races. One committed operation writes one deduped TaskOutbox intent. Cover,
title, reorder, removal and upload alone do not notify. The actual stored album title is read at
delivery, normalized and limited to 100 Unicode code points.

HTTP memory creation and the trusted source publisher enqueue only the first successful published
transition, in that same transaction, after attachment/source writes. One memory means one feed
intent, independent of media count. The worker derives generic text from stored attachment kinds;
no body, media, filename, storage URL or private deep link is sent. Both messages use the existing
MAX adapter and a single `open_app` button, `Открыть memoLy`.

The small enum migration adds `bot_stopped` to MaxInbox. Stops are committed during authenticated
webhook acceptance, before acknowledgment, with a hashed recipient correlation and event instant;
there is no outgoing response. The webhook subscription must include `bot_stopped`. Started/stopped
event times prevent a stale start redelivery from reopening delivery after a stop. A fresh successful
start can reopen it. The worker verifies the actual MAX bot identity, active membership and stop
state immediately before sending. Family/member/identity locks protect against access revocation
during delivery. Pilot messages are serialized and spaced by at least 550 ms across workers.

Temporary MAX/429 failures use existing Outbox retries and Retry-After; blocked/unsupported recipients
are terminal skips. Terminal task payloads are redacted by the existing Outbox. A successful MAX API
response establishes provider acceptance, not physical phone rendering. A crash/timeout after provider
acceptance and before durable acknowledgment can duplicate delivery: MAX has no documented message
idempotency key, so exactly-once transport is not promised.

## Release and activation

Use FULL on the final source, independent scoped review, PR/squash and the normal locked Selectel
release with migration enabled. Keep the pilot OFF for initial promotion/smoke. Inspect actual running
backend/frontend SHA, accumulated main diff, host lock and recovery guards before release.

Inside the protected host environment, verify the existing Control owner resolves to one MAX identity,
the expected bot matches `/me`, and a delivered welcome exists. Check the current webhook subscription,
preserving all its update types and secret while adding `bot_stopped`. Never print identity/token values.
The image's `bun scripts/max-notifications-pilot.ts` performs these checks and prints booleans/counts
only; `--subscribe-stops` adds the stop subscription while preserving existing types. Neither sends.
Then set `MAX_NOTIFICATIONS_PILOT_ENABLED=true` and `MAX_NOTIFICATIONS_PILOT_SINCE` to the current UTC
instant in `/opt/memoly/env/backend.env`, and apply through the guarded release procedure so API and
worker share the same settings. No family records or synthetic publications are inserted in production.

Disable by setting `MAX_NOTIFICATIONS_PILOT_ENABLED=false` in that same protected file and applying
the guarded update. Pending tasks then skip, including after worker restart. A later activation requires
a fresh SINCE instant. Do not drain an earlier pilot generation for testing.

The owner then adds one photo to an album and creates one feed publication using the normal application.
Inspect their two Outbox outcomes and the owner's MAX chat. The owner confirms the actual phone text,
single delivery and working button. Never treat desktop/API evidence as device confirmation.

## Task/check boundary

Task `MEMOLY-MAX-NOTIFICATIONS-PILOT`; base `7032652dff512c28e0cf52f6c5e20fd9b00e0198`;
branch `feat/memoly-max-notifications-pilot`; isolated worktree
`D:/codex/TG_OurMemoriesDevBot/worktrees/memoly-max-notifications-pilot`.
Allowed scope: notification helper/delivery, album/publication/MAX composition, Outbox handler,
MAX stop ingress/enum migration, affected tests, public env example and these operating notes.
Dependencies, auth mechanisms, family ACL rules and UI remain outside scope.

Development checks: focused real PostgreSQL endpoint/publisher/worker tests, affected MAX capture and
protocol tests, backend typecheck and architecture. One final FULL on the reviewed complete source;
any confirmed fix reruns only affected checks, with final source evidence bound honestly. Deployment,
smoke, recovery readiness and physical acceptance are reported separately.
