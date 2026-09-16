# Session Identity Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development`. This is one tightly coupled security task; preserve RED evidence before production edits and report every command/result.

**Goal:** Bind every provider-authenticated session to the exact `ExternalIdentity` used for authentication and make `family.create` evaluate pilot admission only for that session-bound provider and subject.

**Architecture:** Add one nullable `AuthSession.externalIdentityId` relation with no backfill, set it atomically from the exact Telegram/MAX identity already resolved during exchange, and keep the access token unchanged (`sub + sessionId`). Resolve a minimal nullable external identity projection server-side when authenticating the access token, pass it only to the family-create authorization boundary, and deny provider-scoped admission when provenance is null.

**Tech Stack:** Bun 1.4, TypeScript, Hono, Prisma 7/PostgreSQL, Bun test.

**Spec:** Owner HANDOFF dated 2026-09-16 in the current task; repository `AGENTS.md`, `docs/mvp/00_START_HERE.md`, and relevant auth/family contracts remain binding.

## Global Constraints

- Base is exactly `362425f05471ddf8533b6861bb15f92f0b749e74` on `fix/session-identity-provenance` in `D:\codex\TG_OurMemoriesDevBot\worktrees\session-identity-provenance`.
- Add exactly one new migration: `backend/prisma/migrations/20260916120000_session_identity_provenance/migration.sql`.
- Do not edit any historical migration, migration ledger, lockfile, generated Prisma source, frontend, HostBridge, SDK bootstrap, Caddy, webhooks, media/storage behavior, invites, staging data, deployment, or MAX-10.
- `AuthSession.externalIdentityId` is nullable. Existing and password/non-provider sessions remain null; never backfill or infer an identity by `userId`.
- Provider exchange binds the exact already-resolved `ExternalIdentity.id` in the same transaction that creates the session.
- Refresh rotates credentials on the same logical `AuthSession`; it must preserve `externalIdentityId` exactly.
- Access JWT remains `sub + sessionId`; provider and subject are resolved server-side and never added to client-carried tokens or public user DTOs.
- `family.create` accepts only an active, non-revoked `PilotAdmission` matching both the session-bound provider and subject. Null provenance denies with existing `ROLE_FORBIDDEN` semantics.
- Never authorize by subject alone, an arbitrary/first identity, or any admitted identity owned by the user.
- Preserve Telegram/MAX verification, replay handling, account-linking behavior, current family idempotency, and current admission lifecycle semantics. The current schema has no admission expiry column; do not invent one.
- Worker may edit only the plan-listed backend schema/migration/auth/family files and directly affected focused test fixtures. Stop before expanding outside those paths or changing representation away from one nullable exact identity FK.

---

### Task 1: Exact session identity provenance and provider-aware family pilot gate

**Files:**

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260916120000_session_identity_provenance/migration.sql`
- Modify: `backend/src/modules/auth/application/ports.ts`
- Modify: `backend/src/modules/auth/domain/user.ts`
- Modify: `backend/src/modules/auth/application/auth-service.ts`
- Modify: `backend/src/modules/auth/infrastructure/auth-repository.ts`
- Modify: `backend/src/modules/families/application/family-service.ts`
- Modify: `backend/src/modules/families/transport/routes.ts`
- Test: `backend/src/modules/auth/auth.integration.test.ts`
- Test: `backend/src/modules/auth/telegram-auth.integration.test.ts`
- Test: `backend/src/modules/auth/max-auth.integration.test.ts`
- Test: `backend/src/modules/auth/application/auth-service.test.ts`
- Test: `backend/src/modules/families/family-access.integration.test.ts`
- Test only if existing fixtures require exact provider provenance: `backend/src/modules/families/family-review-fixes.integration.test.ts`, `backend/src/modules/memories/memories.integration.test.ts`, `backend/src/modules/media/media-access.integration.test.ts`, `backend/src/modules/telegram/capture.integration.test.ts`, `backend/scripts/block01-upgrade.integration.test.ts`

**Interfaces:**

- Produce schema relation conceptually equivalent to:

```prisma
model ExternalIdentity {
  // existing fields
  authSessions AuthSession[]
}

model AuthSession {
  // existing fields
  externalIdentityId String?             @map("external_identity_id") @db.Uuid
  externalIdentity   ExternalIdentity?   @relation(fields: [externalIdentityId], references: [id], onDelete: SetNull, map: "auth_sessions_external_identity_id_fkey")
  @@index([externalIdentityId], map: "auth_sessions_external_identity_id_idx")
}
```

- Migration adds only nullable `external_identity_id`, its index, and FK to `external_identities(id)` with `ON DELETE SET NULL`; it performs no data update/backfill.
- Produce a narrow domain shape:

```ts
type SessionExternalIdentity = {
  id: string
  provider: 'telegram' | 'max'
  subject: string
}

type AuthenticatedPrincipal = UserDto & {
  sessionId: string
  externalIdentity: SessionExternalIdentity | null
}
```

- `findActiveAccessSession` returns only the authenticated user, session id, and minimal related identity projection (`id`, `provider`, `subject`) or null.
- `userDtoFromPrincipal` and `/me` family projection must explicitly strip both `sessionId` and `externalIdentity` so provenance is not leaked in public DTOs.
- Keep broad `FamilyScope` unchanged if possible. Give `createFamily` a narrow principal extension whose `externalIdentity` is required but nullable; other family operations must not need provider provenance.

- [ ] **Step 1: Add mandatory failing provider-session tests (RED)**

Add integration assertions/tests proving the exact persisted FK after successful Telegram and MAX exchange, password registration/login stores null, and refresh leaves the same exact FK unchanged. Include public-response assertions proving `externalIdentity` is not returned.

Run:

```powershell
bun run --cwd backend test:integration src/modules/auth/auth.integration.test.ts src/modules/auth/telegram-auth.integration.test.ts src/modules/auth/max-auth.integration.test.ts
```

Expected RED: assertions fail because `externalIdentityId` is absent/unavailable before the schema and repository change. Record the failing test names and reason.

- [ ] **Step 2: Add mandatory failing pilot-isolation tests (RED)**

In `family-access.integration.test.ts`, exercise the real HTTP family-create route for literal fixtures covering:

1. exact active MAX admission passes for a MAX-bound session;
2. exact active Telegram admission still passes for a Telegram-bound session;
3. equal subject on Telegram and MAX with only Telegram admission denies the MAX session;
4. one user owning Telegram and MAX identities authorizes only the identity bound to the current session, including the inverse provider direction;
5. a legacy/null session denies even when the user owns admitted identities;
6. password/non-provider session denies without crash or invented provider;
7. revoked admission continues to deny and active admission continues to pass (no expiry field exists in the current schema).

Run:

```powershell
bun run --cwd backend test:integration src/modules/families/family-access.integration.test.ts
```

Expected RED: MAX exact admission is rejected by the hardcoded Telegram lookup and/or collision/null cases expose the old arbitrary user-identity behavior. Record the expected failures; if a proposed test passes under old code, redesign it until it catches the actual unsafe branch.

- [ ] **Step 3: Add the nullable schema relation and one migration (GREEN foundation)**

Implement the exact nullable relation and migration described above. Do not touch historical migration files. Run:

```powershell
bun run --cwd backend prisma:validate
bun run --cwd backend prisma:generate
```

Expected: both exit 0.

- [ ] **Step 4: Bind exact provider identities and expose server-side provenance (GREEN)**

In each provider exchange transaction, set `externalIdentityId: externalIdentity.id` on the new session. Leave password session creation and generic password login unchanged so the database default remains null. Make `findActiveAccessSession` include/select only the minimal related identity projection and return it on `AuthenticatedPrincipal`. Do not change access-token payloads. Refresh must continue updating the same row and must not write `externalIdentityId`.

Update test doubles/types with explicit `externalIdentity: null` or exact provider values. Run focused unit tests:

```powershell
bun run --cwd backend test:unit src/modules/auth/application/auth-service.test.ts src/modules/auth/application/telegram-auth-service.test.ts src/modules/auth/application/max-auth-service.test.ts
```

Expected: all pass.

- [ ] **Step 5: Make `family.create` use only session-bound provider+subject (GREEN)**

Replace the `externalIdentity.findFirst({ userId, provider: 'telegram' })` inference with a null check on the authenticated principal followed by one admission query whose predicate contains the exact session-bound `provider`, exact session-bound `subject`, and `revokedAt: null`. Preserve the existing `FamilyFailure('forbidden', ...)` and HTTP `ROLE_FORBIDDEN` behavior. Route projection passes the provenance to create-family but strips it from public user responses.

Run the RED suites again and require all mandatory cases to pass.

- [ ] **Step 6: Repair only directly affected exact-provenance fixtures**

Search focused backend tests for fixtures that create both a provider identity and a session used to create a family. Bind those session rows to the exact fixture identity rather than relying on inference. Do not alter unrelated product behavior.

Run:

```powershell
bun run --cwd backend test:integration src/modules/families/family-access.integration.test.ts src/modules/families/family-review-fixes.integration.test.ts src/modules/memories/memories.integration.test.ts src/modules/media/media-access.integration.test.ts src/modules/telegram/capture.integration.test.ts backend/scripts/block01-upgrade.integration.test.ts
```

Expected: pass; the upgrade test proves legacy rows remain null and preserved.

- [ ] **Step 7: Deterministic verification and self-review**

Run, in order:

```powershell
bun run --cwd backend prisma:validate
bun run --cwd backend prisma:generate
bun run --cwd backend test:unit src/modules/auth/application/auth-service.test.ts src/modules/auth/application/telegram-auth-service.test.ts src/modules/auth/application/max-auth-service.test.ts
bun run --cwd backend test:integration src/modules/auth/auth.integration.test.ts src/modules/auth/telegram-auth.integration.test.ts src/modules/auth/max-auth.integration.test.ts src/modules/families/family-access.integration.test.ts src/modules/families/family-review-fixes.integration.test.ts src/modules/memories/memories.integration.test.ts src/modules/media/media-access.integration.test.ts src/modules/telegram/capture.integration.test.ts backend/scripts/block01-upgrade.integration.test.ts
bun run typecheck:backend
bun run lint
bun run build:backend
git diff --check
git status --short
```

Inspect `git diff --name-status 362425f05471ddf8533b6861bb15f92f0b749e74...HEAD` and the working-tree diff. Confirm exactly one new migration, no historical migration changes, no lockfile/generated/frontend changes, no subject-only/admitted-any-identity query, and no JWT provider data.

- [ ] **Step 8: Commit explicit paths only**

Stage only the task files after checking `git diff --check`, `git diff --stat`, staged diff, and secrets. Create one conventional commit such as:

```text
fix(auth): bind pilot admission to session identity
```

Do not push, open a PR, merge, deploy, change staging data, or start MAX-10.

## STOP Conditions

- `origin/main` or worktree base differs from `362425f05471ddf8533b6861bb15f92f0b749e74`.
- Safe implementation requires a representation other than one nullable exact `ExternalIdentity` FK or requires guessed backfill.
- A historical migration or migration ledger would need editing.
- Required work expands into frontend/bootstrap/webhooks/media/storage/invite product behavior/staging/deploy/MAX-10.
- Provider verification, replay protection, account linking, or access-token contents would need weakening or broadening.
