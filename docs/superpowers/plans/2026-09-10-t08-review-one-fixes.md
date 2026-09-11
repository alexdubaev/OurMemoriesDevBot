# T08 Review 1 Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the functional blockers from the authorized Spark review without broadening T08 beyond the canonical package.

**Architecture:** Preserve the existing Families module and T03 media lifecycle. The client treats an invite token as transient intent, obtains only the existing safe preview endpoint, and performs acceptance only from an explicit screen. Backend guards and optimistic versions remain authoritative; UI mirrors their state without relying on client-side role data.

**Tech Stack:** Bun, Hono, Prisma/PostgreSQL, Zod contracts, React/Vite, Playwright.

**Spec:** `D:/codex/TG_OurMemoriesDevBot/info/OurMemories_T08_Package_extracted/OurMemories_T08_Package/docs/mvp/tasks/08_FAMILY_UI.md`

## Global Constraints

- Work only in `feat/t08-family-ui` at the existing linked worktree.
- No automatic invite acceptance, family leave, or family bootstrap.
- Do not put raw invite tokens into durable client state, analytics, or snapshots.
- Keep T03's `child_avatar` upload/finalize/cleanup lifecycle and safe avatar replacement.
- Use explicit owner/full/viewer backend guards and return `VERSION_CONFLICT` for stale child/member writes.
- Do not change packages, lockfile, CI, unrelated contracts, or T01–T06 architecture.
- Stop after commit and verification; do not run a replacement Spark review or Sol.

---

### Task 1: Contract and persistence safeguards

**Files:**
- Modify: `packages/contracts/src/families.ts`, `backend/prisma/schema.prisma`, a new Prisma migration
- Modify: `backend/src/modules/families/application/family-service.ts`, `backend/src/modules/families/transport/routes.ts`
- Test: `packages/contracts/src/families.test.ts`, `backend/src/modules/families/family-access.integration.test.ts`

- [ ] Write failing integration tests for incomplete child invite rejection, safe preview/other-family behaviour, stale child/member writes, and usage.
- [ ] Run the focused contracts and family integration tests; verify each new assertion fails for the missing guard/data.
- [ ] Add minimal expectedVersion/versions, completed-child validation, usage DTO/service, and conditional updates that return `VERSION_CONFLICT`.
- [ ] Re-run focused tests until green.

### Task 2: Invite routing and explicit UI state

**Files:**
- Modify: `backend/src/modules/telegram/infrastructure/process-task.ts`, `webapp/src/platform/telegram/host-bridge.ts`
- Modify: `webapp/src/App.tsx`, `webapp/src/features/family/api.ts`, `webapp/src/features/family/FamilyScreen.tsx`
- Test: `webapp/tests/telegram-host-bridge.test.ts`, new/updated family UI tests

- [ ] Write failing tests that show a startapp invite reaches preview, refresh does not accept/bootstrap, and completed invite creation reaches INVITE_READY.
- [ ] Run the focused tests; verify failures distinguish routing/state behaviour from test setup.
- [ ] Use the existing T04/HostBridge startapp path, a transient invite state machine, and the existing preview endpoint; wire copy/share success only after their actual promise resolves.
- [ ] Re-run focused tests until green.

### Task 3: Child profile, crop, age, and access-loss UI

**Files:**
- Modify: `webapp/src/features/family/FamilyOnboarding.tsx`, `webapp/src/features/family/FamilyScreen.tsx`, `webapp/src/features/family/model.ts`, `webapp/src/features/family/api.ts`
- Test: `webapp/tests/family-model.test.ts`, relevant media/family integration tests

- [ ] Write failing unit tests for timezone/date-only age output, and integration tests for crop/ready avatar/version paths.
- [ ] Run those tests and observe expected failures.
- [ ] Add panning/crop persistence with current-avatar preview, retry reuse of finalized avatar id, local access-loss state, local usage retry, and no owner alias editor.
- [ ] Re-run focused tests until green.

### Task 4: Required browser coverage and verification

**Files:**
- Create: `webapp/e2e/specs/family.spec.ts`
- Modify: only test helpers needed by the existing E2E runner

- [ ] Write the required Family E2E scenarios for onboarding, invite ready, private preview, explicit accept, role/alias/owner guard and revoke/leave without bootstrap.
- [ ] Run `bun run --cwd webapp e2e -- family.spec.ts` and verify it discovers and executes tests.
- [ ] Run contracts, family/media integration, webapp/unit, E2E, typechecks, builds, migration upgrade, architecture, lint, audit, and affected T04/T05 regressions.
- [ ] Inspect `git diff --check`, stage explicit paths, commit the verified change, and stop before Sol.
