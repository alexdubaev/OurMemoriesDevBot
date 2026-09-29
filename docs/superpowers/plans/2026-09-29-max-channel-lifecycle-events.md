# MAX Channel Lifecycle Events Implementation Plan

> **For agentic workers:** Implement the accepted steps task-by-task with tests first.

**Goal:** Persist the three official MAX channel lifecycle events in the webhook inbox while leaving message ingestion and all Family/Memory behavior unchanged.

**Architecture:** The webhook and existing subscription client will recognize only `bot_added`, `bot_removed`, and `bot_admin_permissions_changed`, retaining each exact request body as encrypted inbox payload. Lifecycle inbox rows will be deduplicated and stored without source rows, immediate responses, worker tasks, or family mutations. A forward-only Prisma enum migration will make the three lifecycle kinds queryable.

**Tech Stack:** Bun, TypeScript, Hono, Prisma, PostgreSQL.

**Spec:** User task `MAX-CHANNEL-EVENT-SUBSCRIPTION` (2026-09-29).

## Global Constraints

- Keep existing MAX update types and behavior unchanged.
- Preserve the exact raw lifecycle update JSON encrypted so signed 64-bit `chat_id` digits and actor fields are not rounded or lost.
- Do not create MAX source rows, immediate replies, outbox tasks, Memories, backup publication, Family bindings, or feature-gate changes for lifecycle updates.
- Unknown update types remain safely ignored; malformed recognized lifecycle events fail validation before persistence.
- Validate `bot_added` and `bot_removed` against their official signed-int64 chat ID, User actor, and `is_channel` fields. For `bot_admin_permissions_changed`, the current docs publish the type and semantics but no event-specific schema, so validate only common Update fields and retain the event opaquely.
- Use only synthetic fixtures in tests; do not touch production subscription or channel.
- Do not deploy the merge SHA in this task.

## Review Focus

- Redelivery of an identical lifecycle payload must deduplicate by stable event key and create no additional work.
- A `chat_id` beyond JavaScript's safe integer range must remain exact in the encrypted payload.
- Lifecycle updates must not reach the generic `max:process` worker path.
- Existing direct-message, bot-start, callback, and unknown-update behavior must remain unchanged.
- A migration must add enum labels without editing a previously applied migration.

---

### Task 1: Normalize and durably store lifecycle updates without side effects

**Files:**
- Modify `backend/src/modules/max/application/ports.ts`
- Modify `backend/src/modules/max/application/event-key.ts` and its focused test
- Modify `backend/src/modules/max/transport/update-mapping.ts` and its focused test
- Modify `backend/src/modules/max/transport/webhook.ts` and its focused test
- Modify `backend/src/modules/max/application/accept-update.ts` and its focused test
- Modify `backend/src/modules/max/infrastructure/prisma-max-repository.ts`
- Modify `backend/src/modules/max/infrastructure/max-api.ts` and `backend/src/modules/max/max-api.test.ts`
- Modify `backend/src/modules/max/capture.integration.test.ts`
- Modify `backend/scripts/int1-max-upgrade.integration.test.ts` to preserve the migration-39 upgrade assertion after adding migration 43
- Modify `backend/prisma/schema.prisma`
- Create `backend/prisma/migrations/20260929220000_max_channel_lifecycle_events/migration.sql`

**Interface:** Add the exact verified lifecycle event kinds to a durable accepted-event type separate from worker-processed MAX events. Carry raw webhook JSON alongside the recognized event kind. Allow these exact names in subscription validation while keeping unknown names rejected and current API behavior for existing event variants.

- [x] Write failing unit and webhook tests for all three lifecycle type names, raw-body preservation, malformed-event rejection, unknown-event ignoring, and unchanged legacy events.
- [x] Verify the new tests fail for the intended reason.
- [x] Write a failing persistence integration test proving lifecycle delivery creates one encrypted inbox row and no source, response, task-outbox item, Memory, or MAX backup; identical redelivery creates no additional row or work.
- [x] Add exact lifecycle enum labels with a new additive Prisma migration; do not edit historical migrations.
- [x] Implement stable deduplication and a stored-only lifecycle path that leaves encrypted payload available for follow-up inspection and does not queue the worker.
- [x] Allow only the three verified lifecycle names in the existing MAX subscription client; preserve the previous supported types and reject unknown names.
- [x] Run focused tests, MAX capture and migration-upgrade integration tests, TypeScript check, Prisma schema validation, and diff whitespace check.

**Stop conditions:** Any documented required event field cannot be validated without assuming undocumented fields; any test shows a lifecycle event can create a Memory, response, or worker task; or the repository reveals a migration conflict.
