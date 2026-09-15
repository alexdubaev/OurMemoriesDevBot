# MAX-08 Invite and Start Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-correct MAX invite links and durable MAX `bot_started` invite guidance while preserving the existing authenticated preview/explicit-accept Core flow and Telegram behavior.

**Architecture:** `HostBridge` owns provider-specific public link serialization, with a validated build-time MAX bot username. A new families-owned read-only resolver classifies opaque invitation tokens without accepting them, and the MAX processor uses it before atomically clearing the inbox and creating one existing-kind `welcome` response.

**Tech Stack:** TypeScript, React/Vite, Bun test, Hono/Prisma/PostgreSQL, existing `MaxInbox`/`TaskOutbox`/`FamilyInvite` models.

**Spec:** `docs/superpowers/specs/2026-09-14-max-08-invite-start-routing-design.md`

## Global Constraints

- Work only in `D:\codex\TG_OurMemoriesDevBot\worktrees\max-adapter` on `feat/max-adapter` from the committed MAX-08 documentation base.
- Do not create another branch/worktree, modify Prisma schema/migrations, or touch the Telegram production processor.
- Do not perform live MAX calls, webhook/subscription mutations, deployment, push, PR, account linking, media work, group/channel work, MAX-06, MAX-07, MAX-09, or MAX-10.
- Public start payload is exactly `invite_<opaque-token>`; token syntax is `[A-Za-z0-9_-]{32,128}` and the complete MAX payload must not exceed 512 characters.
- MAX bot username syntax is `[A-Za-z0-9_]{5,32}` and comes from non-secret `VITE_MAX_BOT_USERNAME`.
- Signed MAX `start_param` remains authoritative; an invalid or duplicated signed value blocks query fallback.
- The raw invite token may exist only in the public link, signed start data, and encrypted `MaxInbox` pending payload. Never copy it into logs, task payloads, responses, fixtures, or another durable table.
- `bot_started` never accepts an invite or creates `User`, `ExternalIdentity`, `Family`, `FamilyMember`, `Child`, `Memory`, or media rows.
- Use test-driven development: record a relevant RED result before each production change, then the matching GREEN result.

---

### Task 1: Provider-aware invite link boundary

**Files:**
- Modify: `webapp/src/platform/host-bridge.ts`
- Modify: `webapp/src/platform/max/host-bridge.ts`
- Modify: `webapp/src/platform/telegram/host-bridge.ts`
- Modify: `webapp/src/features/family/FamilyScreen.tsx`
- Modify: `webapp/src/App.tsx`
- Modify: `webapp/src/main.tsx`
- Modify: `webapp/.env.example`
- Test: `webapp/tests/max-host-bridge.test.ts`
- Test: `webapp/tests/telegram-host-bridge.test.ts`
- Test: `webapp/tests/family-invite-link.test.ts`
- Test: `webapp/tests/host-bridge-selector.test.ts`

**Interfaces:**
- Consumes: existing `HostBridge.kind`, signed `inviteToken()`, and the Family screen invite creation response `{ rawToken, expiresAt }`.
- Produces: `HostBridge.inviteLink(rawToken: string): string | null`; `createHostBridge(host, options?)` with `{ maxBotUsername?: string }`; MAX and Telegram implementations of the same link method.

- [ ] **Step 1: Write failing provider-link tests**

Add assertions that a MAX bridge configured with `OurMemoriesMaxBot` returns:

```ts
expect(bridge.inviteLink('A'.repeat(32))).toBe(
  `https://max.ru/OurMemoriesMaxBot?startapp=invite_${'A'.repeat(32)}`,
)
```

Cover token lengths 31/32/128/129, invalid token punctuation, invalid/missing usernames, and verify the returned URL contains no family/user/child identifier. Add a Telegram assertion that the existing URL remains:

```ts
expect(bridge.inviteLink('A'.repeat(32))).toBe(
  `https://t.me/OurMemoriesDevBot?startapp=invite_${'A'.repeat(32)}`,
)
```

Assert the browser bridge returns `null`. Extend signed start tests so a valid 128-character token is accepted and invalid or duplicate signed `start_param` still blocks a valid query fallback.

- [ ] **Step 2: Run the focused web tests and record RED**

Run:

```powershell
bun test webapp/tests/max-host-bridge.test.ts webapp/tests/telegram-host-bridge.test.ts webapp/tests/family-invite-link.test.ts webapp/tests/host-bridge-selector.test.ts
```

Expected: non-zero exit because `HostBridge.inviteLink` and MAX username injection do not exist yet and the current MAX token parser rejects length 128.

- [ ] **Step 3: Implement the narrow HostBridge contract**

Add:

```ts
export type HostBridgeOptions = { maxBotUsername?: string }

export type HostBridge = {
  // existing members
  inviteLink(rawToken: string): string | null
}
```

Thread `options.maxBotUsername` through `createHostBridge()` to `createMaxHostBridge()`. Validate raw tokens before serialization with `/^[A-Za-z0-9_-]{32,128}$/`, validate MAX username with `/^[A-Za-z0-9_]{5,32}$/`, and recheck that `invite_${rawToken}` is no more than 512 characters. Return `null` on any failure; do not fall back to Telegram in a MAX host. Telegram emits its existing `startapp` URL for valid tokens and browser emits `null`.

In `main.tsx`, construct the bridge with:

```ts
const hostBridge = createHostBridge(window, {
  maxBotUsername: import.meta.env.VITE_MAX_BOT_USERNAME,
})
```

Document `VITE_MAX_BOT_USERNAME=` as non-secret in `webapp/.env.example`. Do not hardcode an unverified MAX username.

- [ ] **Step 4: Route Family invite generation through the injected boundary**

Pass the narrow method from `FamilyController`:

```tsx
<FamilyScreen createInviteLink={hostBridge.inviteLink} ... />
```

Change `FamilyScreen` to call the supplied factory after invitation creation. When it returns `null`, show the existing generic create/share failure state and do not display or copy a malformed link. The component must not inspect `hostBridge.kind`.

- [ ] **Step 5: Run the focused web tests and record GREEN**

Run the Step 2 command. Expected: all selected test files pass with exit code 0.

- [ ] **Step 6: Commit the web boundary**

Stage only the Task 1 files, inspect the staged diff for tokens/URLs, then commit:

```powershell
git commit -m "feat(max): generate provider invite links"
```

---

### Task 2: Families-owned invite-start resolver

**Files:**
- Create: `backend/src/modules/families/application/invite-start.ts`
- Modify: `backend/src/modules/families/index.ts`
- Test: `backend/src/modules/families/invite-start.integration.test.ts`

**Interfaces:**
- Consumes: `DbClient`, `FamilyInvite.tokenHash`, `acceptedAt`, `revokedAt`, `expiresAt`, and `Family.status`.
- Produces: `createInviteStartResolver(db, now?)` returning `(rawToken: string) => Promise<'active' | 'invalid'>`.

- [ ] **Step 1: Write the failing resolver integration test**

Create fixtures using only synthetic opaque tokens and assert:

```ts
const resolveInviteStart = createInviteStartResolver(prisma, () => fixedNow)
expect(await resolveInviteStart(activeToken)).toBe('active')
expect(await resolveInviteStart(missingToken)).toBe('invalid')
expect(await resolveInviteStart(expiredToken)).toBe('invalid')
expect(await resolveInviteStart(revokedToken)).toBe('invalid')
expect(await resolveInviteStart(usedToken)).toBe('invalid')
expect(await resolveInviteStart(inactiveFamilyToken)).toBe('invalid')
```

Also assert the resolver leaves `acceptedAt`, memberships, and all Core row counts unchanged.

- [ ] **Step 2: Run the resolver test and record RED**

Run:

```powershell
bun run --cwd backend test:integration src/modules/families/invite-start.integration.test.ts
```

Expected: non-zero exit because the resolver module/export does not exist.

- [ ] **Step 3: Implement the read-only Core boundary**

Hash the raw token with SHA-256 inside the families module and query only for an invitation satisfying all of:

```ts
{
  tokenHash,
  acceptedAt: null,
  revokedAt: null,
  expiresAt: { gt: now() },
  family: { status: 'active' },
}
```

Return only `'active'` or `'invalid'`; expose no family or member fields and perform no write. Export the factory from `backend/src/modules/families/index.ts`.

- [ ] **Step 4: Run the resolver test and record GREEN**

Run the Step 2 command. Expected: the new integration file passes with exit code 0.

- [ ] **Step 5: Commit the Core resolver**

Stage only the Task 2 files, inspect the staged diff, then commit:

```powershell
git commit -m "feat(families): inspect invite start tokens"
```

---

### Task 3: Durable MAX `bot_started` routing

**Files:**
- Modify: `backend/src/modules/max/application/accept-update.ts`
- Modify: `backend/src/modules/max/infrastructure/process-task.ts`
- Modify: `backend/src/modules/max/index.ts`
- Test: `backend/src/modules/max/application/accept-update.test.ts`
- Test: `backend/src/modules/max/infrastructure/process-task.test.ts`
- Test: `backend/src/modules/max/capture.integration.test.ts`

**Interfaces:**
- Consumes: `createInviteStartResolver(prisma)`, encrypted `MaxInboundEvent`, guarded `terminalInbox`, existing `welcome` response kind, and reference-only outbox tasks.
- Produces: `createMaxTaskProcessor({ runtime, crypto, resolveInviteStart? })`; one terminal `welcome` response selected after payload classification.

- [ ] **Step 1: Write failing acceptance and processor tests**

Change the immediate-response expectation so every `bot_started` returns `null`. Add processor cases for:

```ts
{ payload: null, expected: ordinaryWelcomeText, resolverCalls: 0 }
{ payload: 'campaign_abc', expected: ordinaryWelcomeText, resolverCalls: 0 }
{ payload: `invite_${'A'.repeat(32)}`, resolver: 'active', expected: inviteGuidanceText }
{ payload: `invite_${'B'.repeat(32)}`, resolver: 'invalid', expected: invalidInviteText }
{ payload: 'invite_short', expected: ordinaryWelcomeText, resolverCalls: 0 }
```

Use exact safe Russian text constants local to the MAX processor. No response text may include the raw token or distinguish missing/expired/revoked/used.

- [ ] **Step 2: Run focused MAX unit tests and record RED**

Run:

```powershell
bun test backend/src/modules/max/application/accept-update.test.ts backend/src/modules/max/infrastructure/process-task.test.ts
```

Expected: non-zero exit because acceptance still emits an immediate welcome and the processor has no invite resolver.

- [ ] **Step 3: Implement classification and composition**

Make `selectMaxImmediateResponse()` return `null` for `bot_started`. Add a strict parser accepting only the complete `invite_<token>` form with the Global Constraints limits. In `createMaxTaskProcessor`, call the resolver only for syntactically valid invite payloads, choose ordinary/invite/invalid guidance, then call the existing guarded `terminalInbox()` once.

Inject `createInviteStartResolver(runtime.prisma)` from both `createMaxModule()` and `createMaxTasks()`. A resolver/database exception must escape before `terminalInbox()`, leaving the inbox encrypted and accepted for retry. Do not catch it as an invalid invite.

- [ ] **Step 4: Extend clean-database MAX integration coverage**

Add synthetic active, expired, revoked, used, and inactive-family invites. Verify all of the following:

```ts
expect(await prisma.familyInvite.count()).toBe(inviteCountBefore)
expect(await prisma.familyMember.count()).toBe(memberCountBefore)
expect(await prisma.user.count()).toBe(userCountBefore)
expect(await prisma.externalIdentity.count()).toBe(identityCountBefore)
expect(await prisma.maxOutgoingResponse.count({ where: { inboxId, kind: 'welcome' } })).toBe(1)
expect((await prisma.maxInbox.findUniqueOrThrow({ where: { id: inboxId } })).encryptedPayload.byteLength).toBe(0)
```

Run concurrent calls for the same process task and prove one logical response/task. Add a resolver-failure case proving no response is created and the encrypted payload remains. Add a delivery-failure case proving retrying delivery does not call the resolver or process the invite again.

- [ ] **Step 5: Run focused MAX tests and record GREEN**

Run:

```powershell
bun test backend/src/modules/max/application/accept-update.test.ts backend/src/modules/max/infrastructure/process-task.test.ts
bun run --cwd backend test:integration src/modules/max/capture.integration.test.ts
```

Expected: all selected unit and integration files pass with exit code 0.

- [ ] **Step 6: Commit MAX routing**

Stage only the Task 3 files, inspect the staged diff for raw token persistence and schema changes, then commit:

```powershell
git commit -m "feat(max): route invite start payloads"
```

---

### Task 4: Cross-provider regression and bounded verification

**Files:**
- Modify only if a regression test requires fixture adaptation: corresponding files under `webapp/tests/`, `backend/src/modules/max/`, or `backend/src/modules/families/`.
- Forbidden: any new production scope beyond Tasks 1–3.

**Interfaces:**
- Consumes: all Task 1–3 interfaces.
- Produces: verified MAX-08 change ready for lead review.

- [ ] **Step 1: Run the complete focused MAX-08 matrix**

Run:

```powershell
bun test webapp/tests/max-host-bridge.test.ts webapp/tests/telegram-host-bridge.test.ts webapp/tests/family-invite-link.test.ts webapp/tests/host-bridge-selector.test.ts webapp/tests/startup-routing.test.tsx
bun test backend/src/modules/max/application/accept-update.test.ts backend/src/modules/max/infrastructure/process-task.test.ts backend/src/modules/max/update-mapping.test.ts backend/src/modules/max/webhook.test.ts
bun run --cwd backend test:integration src/modules/families/invite-start.integration.test.ts src/modules/max/capture.integration.test.ts
```

Expected: all selected files pass with exit code 0 and non-zero test counts.

- [ ] **Step 2: Run provider and contract regressions**

Run:

```powershell
bun run --cwd backend test:integration src/modules/telegram/capture.integration.test.ts
bun run --cwd backend test:unit
bun run --cwd webapp test
bun run --cwd backend typecheck
bun run --cwd webapp typecheck
bun run --cwd packages/contracts typecheck
bun run architecture:check
```

Expected: each command exits 0. Do not substitute a syntax-only check for a failed environment-dependent suite.

- [ ] **Step 3: Inspect scope and secrets**

Run:

```powershell
git diff --check ea38614e37f7143787c117ed7698e4ec540411a7..HEAD
git diff --stat ea38614e37f7143787c117ed7698e4ec540411a7..HEAD
git status --short --branch
rg -n "MAX_BOT_TOKEN|Authorization|https://max\.ru/.+\?.*startapp=.*(familyId|userId|childId)" docs backend webapp
```

Interpret matches manually. Expected: clean diff formatting; no credentials, signed URLs, identifiers in invite payloads, migrations, media work, or live-call artifacts.

- [ ] **Step 4: Commit only any necessary test-fixture adaptation**

If Step 2 required an in-scope test-only correction, stage those explicit test paths and commit:

```powershell
git commit -m "test(max): cover invite start routing"
```

If no files changed, do not create an empty commit.
