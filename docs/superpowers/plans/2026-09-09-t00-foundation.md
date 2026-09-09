# Block 00 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the selected Vibe revision into a reproducible, local-only MVP foundation for «Наши воспоминания» without product features or secrets.

**Architecture:** Keep Vibe's Bun/Hono, PostgreSQL/Prisma, React/Vite, and shared-contract workspace boundaries. Replace template product decisions with the supplied MVP documentation, and add a fail-closed verification planner that selects existing checks without executing them.

**Tech Stack:** Bun 1.4.0, Hono, Prisma/PostgreSQL, React/Vite, Zod, GitHub Actions.

**Spec:** `docs/mvp/tasks/00_FOUNDATION.md`

## Global Constraints

- `origin` is only `https://github.com/alexdubaev/OurMemoriesDevBot.git`; `vibe-template` is fetch-only.
- Preserve Apache-2.0 `LICENSE` and `NOTICE`; record Vibe SHA `f2731e02547fb1118e233c99c47b4ec7c5fc8ba6`.
- Active surfaces are backend, webapp, and contracts. Website and mobile are deferred; do not add Expo, Capacitor, VK, or AI SDKs.
- Commit only synthetic fixtures and public Telegram configuration. `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` stay blank.
- No deployment, webhook registration, migration, family, media, or authentication implementation belongs to this block.

---

### Task 1: Preserve product package and record the template boundary

**Files:**
- Create: `START.md`, `WORKPLAN.xlsx`, `UPSTREAM.md`, `REPO_MAP.md`, `DEPENDENCIES.md`, `GIT_SETTINGS.md`
- Modify: `README.md`, `AGENTS.md`, `CHECKLIST.md`, `.env.example`, `package.json`
- Copy: `docs/mvp/`, `assets/`, `references/`, `templates/`

**Interfaces:**
- Consumes: the supplied documentation package and existing Vibe workspace paths.
- Produces: an accurate project map, completed scope ledger, public environment template, and traceable upstream record.

- [ ] **Step 1: Inventory existing Vibe names and baseline configuration**

Run: `rg -n "web_app_demo|web-app-demo|vibecoding-template|Vibe Coding Template" package.json backend webapp docker-compose.yml scripts`

Expected: a finite list of product-specific template identifiers to map or rename deliberately.

- [ ] **Step 2: Copy only the approved documentation and assets**

Copy the supplied `docs/mvp`, `assets`, `references`, and `templates`, plus `START.md` and `WORKPLAN.xlsx`; omit `archive`.

- [ ] **Step 3: Replace template product decisions without changing runtime surfaces**

Set the project name and scope in README/CHECKLIST, remove bootstrap-only Vibe instructions from AGENTS, and retain active backend/webapp/contracts boundaries.

- [ ] **Step 4: Define public environment values**

Create root `.env.example` with:

```dotenv
TELEGRAM_BOT_EXPECTED_USERNAME=OurMemoriesDevBot
TELEGRAM_BOT_MODE=polling
TELEGRAM_WEBHOOK_URL=
TELEGRAM_MINI_APP_URL=
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
```

- [ ] **Step 5: Verify product documents and template boundary**

Run: `bun run template:check`

Expected: documentation links and completed project intake pass, or reported Vibe-check incompatibilities are documented in `GIT_SETTINGS.md`.

- [ ] **Step 6: Commit the foundation metadata**

```bash
git add README.md AGENTS.md CHECKLIST.md .env.example UPSTREAM.md REPO_MAP.md DEPENDENCIES.md GIT_SETTINGS.md START.md WORKPLAN.xlsx docs/mvp assets references templates package.json
git commit -m "chore(foundation): adopt Vibe for Our Memories MVP"
```

### Task 2: Add a fail-closed verification-plan selector

**Files:**
- Create: `verification-map.json`, `scripts/verify-plan.mjs`, `tests/verify-plan.test.ts`
- Modify: `package.json`, `REPO_MAP.md`, `DEPENDENCIES.md`

**Interfaces:**
- Consumes: changed paths supplied as CLI arguments and a JSON map of allowed path classes and existing Bun commands.
- Produces: `bun run verify:plan -- <changed-path...>`; JSON/text plan with no shell execution; unknown paths select explicit expansion/failure.

- [ ] **Step 1: Write failing tests for required path classifications**

Cover `docs/mvp/` as docs-only, a media adapter path as storage/media coverage, contracts as backend plus webapp coverage, unknown paths as fail-closed, and an argument containing shell metacharacters as data rather than executable shell input.

- [ ] **Step 2: Run the new test file before implementation**

Run: `bun test tests/verify-plan.test.ts`

Expected: FAIL because `scripts/verify-plan.mjs` does not yet exist.

- [ ] **Step 3: Implement the selector with an allowlisted command registry**

Read command names only from `verification-map.json`; use `process.argv.slice(2)` without spawning a shell; return non-zero for unknown paths and malformed maps.

- [ ] **Step 4: Run required focused scenarios**

Run: `bun test tests/verify-plan.test.ts`

Expected: all six F00.1–F00.5 behaviors pass.

- [ ] **Step 5: Commit the planner**

```bash
git add verification-map.json scripts/verify-plan.mjs tests/verify-plan.test.ts package.json REPO_MAP.md DEPENDENCIES.md
git commit -m "feat(verification): add fail-closed verification planner"
```

### Task 3: Add minimal pull-request verification

**Files:**
- Create: `.github/workflows/verify.yml`, `.github/pull_request_template.md`
- Modify: `GIT_SETTINGS.md`, `README.md`, `REPO_MAP.md`

**Interfaces:**
- Consumes: the existing Bun scripts and `verify:plan` command.
- Produces: a pull-request workflow with no top-level paths skip and one fail-closed `verify-required` result.

- [ ] **Step 1: Write the workflow policy in `GIT_SETTINGS.md`**

Record the empty remote bootstrap, the observed default branch, confirmed first push, unavailable branch-protection evidence, and the condition that protections can only be enabled after a successful run exposes `verify-required`.

- [ ] **Step 2: Create workflow and PR template**

Use official pinned GitHub Actions SHAs only after verifying the upstream action references; run existing architecture, typecheck, verification-plan tests, and webapp build. Make the aggregator depend on every required job with `always()` and fail for failure, cancellation, or missing output.

- [ ] **Step 3: Validate workflow structure locally**

Run: `bun run architecture:check && bun run typecheck && bun run build:webapp`

Expected: each command exits 0; no native or AI job appears in `.github/workflows/verify.yml`.

- [ ] **Step 4: Commit CI metadata**

```bash
git add .github/workflows/verify.yml .github/pull_request_template.md GIT_SETTINGS.md README.md REPO_MAP.md
git commit -m "ci: add required pull-request verification"
```

### Task 4: Run Block 00 validation and review

**Files:**
- Modify: `GIT_SETTINGS.md`, `docs/mvp/review/BLOCK_REPORT.md` only if the supplied report template explicitly permits a task result record.

**Interfaces:**
- Consumes: completed Task 1–3 commands.
- Produces: a factual validation record with no claim about unrun GitHub protections or production readiness.

- [ ] **Step 1: Install locked dependencies and check local prerequisites**

Run: `bun install --frozen-lockfile; docker compose version; docker info`

Expected: dependency install succeeds; Docker failure is recorded as BLOCKED rather than substituted.

- [ ] **Step 2: Run required Block 00 commands**

Run: `bun run architecture:check; bun run typecheck; bun test tests/verify-plan.test.ts; bun run build:webapp`

Expected: each required command has a recorded exit code; build runs without cloud credentials.

- [ ] **Step 3: Inspect the final diff and secrets boundary**

Run: `git diff --check origin/main...HEAD; git diff --stat origin/main...HEAD; git status --short; rg -n "TELEGRAM_BOT_TOKEN=.+|TELEGRAM_WEBHOOK_SECRET=.+" --glob '!*.example'`

Expected: no whitespace errors, no real Telegram credentials, and only scoped files.

- [ ] **Step 4: Commit final factual records**

```bash
git add GIT_SETTINGS.md
git commit -m "docs(foundation): record validation results"
```

- [ ] **Step 5: Request independent review and report without merge**

Report the branch, base/head SHAs, changed paths, exact checks, GitHub limitations, and no migration/contract changes beyond the new verification planner.

