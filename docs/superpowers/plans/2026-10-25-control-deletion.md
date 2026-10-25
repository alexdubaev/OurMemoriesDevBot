# memoLy Control Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner-only recoverable account deletion for 30 days, plus separately confirmed irreversible family deletion, delivered to production.

**Architecture:** Persistent lifecycle operations fence access in PostgreSQL and application authentication. Reversible membership snapshots retain only prior live grants; bounded cleanup records every storage key before destroying its source. Control uses existing MAX owner authorization, tables and dialogs.

**Tech Stack:** Bun/Hono/Prisma/PostgreSQL, React/Vite/TypeScript/Tailwind/shadcn; existing storage port and scheduler.

**Spec:** `docs/superpowers/specs/2026-10-25-control-deletion-design.md` (owner approved).

## Global Constraints

- Preserve all agreed data-fate, authorization, 30*24h UTC deadline and irreversible-family rules in the spec.
- No real-user deletion/restore, no production test fixtures, no destructive migration or existing-migration edits.
- One isolated task branch/worktree; one delegated writer at a time; no unrelated work or dependency additions.
- New schemas/contracts/composition changes are accepted by lead; workers implement bounded decisions, escalate conflicting constraints.
- Existing family UI v4 remains; current sessions/invites are never revived by restore.
- Only new Control lifecycle operations qualify for purge; legacy deleting families are never swept automatically.
- One independent whole-change implementation review after deterministic checks, bounded fix pass and narrow closure.
- FULL source and final release SHA verification, guarded Selectel deploy, public/owner smoke and recovery readiness.

## Review Focus

1. An old runtime or concurrent MAX login must never recreate a live session for an account in trash.
2. Previously revoked membership and overlapping user/family lifecycle must never grant unintended access.
3. Failed object deletion or process restart must never lose the only durable copy of a storage key.
4. MAX-retained media must remain protected in ordinary cleanup and be removable only by explicit irreversible family purge.
5. Stale confirmations/retries/restore at the deadline must not retarget, extend retention or reverse irreversible cleanup.

---

### Task 1: Reversible lifecycle and access fences

**Files:**
- Modify `backend/prisma/schema.prisma`; create one new additive migration in `backend/prisma/migrations/`.
- Create `backend/src/modules/control/infrastructure/control-lifecycle.ts` and `control-lifecycle.integration.test.ts`.
- Modify `backend/src/modules/auth/infrastructure/auth-repository.ts` and auth service as necessary for safe error mapping.
- Modify `backend/src/modules/families/application/family-service.ts` only for user-state check and explicit snapshot cancellation.

**Interfaces:**
- Export `previewUserDeletion(db, userId, protectedIds)`, `previewFamilyDeletion(db, familyId)`.
- Export `trashControlUser(db, { actorId, targetId, protectedIds, key, fingerprint, confirmation }, now?)`.
- Export `restoreControlUser(db, { actorId, targetId, protectedIds, key, deletionId }, now?)`.
- Export `purgeControlFamily(db, { actorId, targetId, protectedIds, key, fingerprint, confirmation }, now?)` to initiate irreversible state only.
- Return public-safe lifecycle DTOs; no keys/MAX subjects/session credentials in DTOs.
- Persistent deletion record ID scopes each cycle; command UUID/hash/result deduplication never toggles a later cycle.
- `User.controlState` (active/trashed/purging/purged) defaults active; family existing status follows lifecycle and ordinary retirement guard remains effective.
- Durable access snapshot is keyed family/user, records exact prior live role + expected revoked version/epoch, cancelled by independent revocation; overlapping trash retains it until both principals active or cancelled.
- Lock order: lifecycle serialization, existing auth authority where needed, user row before family rows (sorted). DB session fence must share auth serialization without introducing inverse lock order; grant checks serialize on the user row like create/join.

- [ ] Write integration tests for owner protection, account trash retaining ready archive, revoke/access denial, restore preserving pre-revoked member, overlapping lifecycle, idempotency and stale cycle.
- [ ] Run narrow PostgreSQL test and capture genuine missing-feature FAIL.
- [ ] Add state/tables/indexes and scoped DB fences; enforce auth/redeem/refresh rejection and safe application errors.
- [ ] Implement previews, trash/restore/family-purge initiation with atomic scope check and deduplication.
- [ ] Test concurrent MAX admission, create/join, restore/purge boundary and revoked grant handling on real PostgreSQL.
- [ ] Run targeted tests/typecheck and inspect migration diff before commit.

### Task 2: Durable bounded purge

**Files:**
- Create `backend/src/modules/control/infrastructure/control-purge.ts` and `control-purge.integration.test.ts`.
- Add durable storage-delete model/migration in task-owned schema if not already included in Task 1.
- Modify `backend/src/modules/control/index.ts`, `backend/src/jobs.ts` and existing schedule registration only to expose/schedule lifecycle job.
- Modify `backend/src/job-schedules.json`; narrowly adjust `backend/src/modules/media/index.ts`, the relevant MAX infrastructure task entry points or `backend/src/outbox/` only where lifecycle task fencing requires it; add focused integration coverage for those changes.
- Scoped family purge exception in a new retention migration; never disable ordinary retention protection.

**Interfaces:**
- Export `runControlDeletionMaintenance({ db, storage }, now?, batchSize?)` from Control public entry point.
- Process expired trash → purging atomically; explicitly purging families run immediately, without extending parent account deadline.
- Persistent object-delete rows independent of source record retain each key until confirmed deletion; storage requests outside DB transaction, idempotent retries.
- Previously initiated maintenance continues if CONTROL_ENABLED is subsequently disabled; the feature flag blocks new owner commands, not approved cleanup obligations.
- Do not finalize account until all its relevant owned families and private profile storage are purged.
- Keep minimal anonymous User/Family/owner membership tombstones if required by RESTRICT integrity; purge all private content and names from own-family subtree.

- [ ] Write real DB/storage tests: no ready-media deletion before deadline; restore deadline; separately purged family never restored; avatar/original/variant/derived keys; MAX-retained originals; own vs other family archive.
- [ ] Capture pre-implementation FAIL, then implement bounded stage/cursor cleanup and durable keys.
- [ ] Prove transient storage failure and process restart resume; no false purged status; duplicate cleanup does not double-charge storage accounting.
- [ ] Fence delayed media/outbox/MAX jobs so they cannot recreate data or fetch/send trashed archive; retain ordinary active-family behavior.
- [ ] Integrate recurring job into existing scheduler; test actual registry reachability.
- [ ] Run narrow integration and architecture/type checks; inspect full cleanup diff before commit.

### Task 3: Owner API, counts and Control UI

**Files:**
- Modify `packages/contracts/src/control.ts` and contract tests.
- Modify `backend/src/modules/control/index.ts`, `application/control-helpers.ts`, `infrastructure/control-read-repository.ts`, relevant integration tests.
- Modify `webapp/src/control/ControlApp.tsx`, `api.ts`, `queries.ts`, scoped components/styles as needed.
- Modify `webapp/e2e/control.spec.ts` and synthetic fixtures only as needed for one short lifecycle journey.

**Interfaces:**
- `GET /control/users/:id/deletion-preview`, `POST /control/users/:id/trash`, `POST /control/users/:id/restore`.
- `GET /control/families/:id/deletion-preview`, `POST /control/families/:id/purge`.
- All routes behind the exact existing MAX owner guard, JSON validation/no-store and mutation rate limiting.
- List/detail lifecycle DTO exposes state, deletion ID, server deadline, operation status and safe error code; search/cursors include lifecycle filter.
- Typed family confirmation `УДАЛИТЬ НАВСЕГДА`, displayed target + irreversible archive warning + current preview fingerprint.
- Typed account confirmation `УДАЛИТЬ ПОЛЬЗОВАТЕЛЯ`, displayed affected families/people/archive/storage and deadline policy.
- Existing overview totals remain correctly labelled; separate active/trash/purging counts; anonymous purged technical users excluded from ordinary accounts and activity.

- [ ] Add API integration tests for anonymous/ordinary/family-owner/legacy-admin denial, actor protection, target mismatch, body limits, stale preview and retries.
- [ ] Implement contract/API wrappers, mutation limiter and status-aware counts/filters.
- [ ] Add trash/restore and family purge dialogs to existing detail sheets with pending/error states, query invalidation and accessible keyboard behavior.
- [ ] Add short synthetic browser journey covering trash → access denial → restore and explicit family confirmation/cancellation.
- [ ] Run contracts, targeted API tests, web checks/browser journey; inspect desktop/mobile light/dark once without screenshot matrix.
- [ ] Update `.autopilot/PROGRESS.md` and task evidence with actual delivered behavior and limitations.

### Task 4: Verification, review, merge and release

**Files:** Task evidence/PR template; existing verifier and Selectel scripts used unchanged unless a concrete compatibility blocker requires an in-scope fix.

- [ ] Lead inspects complete diff, migration/state transitions and credentials exposure; check clean task scope.
- [ ] Run `bun run verify:local --profile full --base <current origin/main>` on exact task source SHA using isolated PostgreSQL `*_test`, ports/storage and existing Linux runtime/cache.
- [ ] Fresh independent read-only Luna high implementation review; adjudicate P0/P1/P2, one bounded fix pass and relevant closure checks.
- [ ] If main moves, merge origin/main normally and repeat only required affected verification.
- [ ] Publish own branch/PR with exact SHA evidence; expected-head squash, confirm main tree, sync primary safely.
- [ ] Determine actual backend/static production revisions, run FULL on final release SHA and complete recovery compatibility proof including trashed/purging lifecycle against recovery runtime.
- [ ] Execute existing guarded FULL Selectel release with host lock, disk guards, backup/migration/readiness/immutable manifest; do not bypass guards.
- [ ] Public health/readiness/Control guard + real owner read-only smoke; record actual production SHA and recovery readiness.
- [ ] Remove only own clean merged temporary resources when safe; HANDOFF includes actual tests/exit codes, PR, base/main/production SHA, deploy/recovery/branch cleanup.

## STOP conditions

Unspecified irreversible data scope, inability to prove pre-deadline preservation, unsafe retained-video exception, lost storage keys, privilege bypass, incompatible unprotected recovery, unavailable mandatory test infrastructure or unreviewed P0/P1/P2 prevent publication. Investigate/recover independently before escalating; do not weaken guards or ask owner to do routine technical work.

## Execution decision

Teamlead delegation is already required by AGENTS.md and the owner requested autonomous implementation. Use one bounded worker at a time and one final independent code review; no extra execution-method approval or repeated design questions. Lead owns schema/security/concurrency rulings, worker reports conflicting evidence before changing those rulings.
