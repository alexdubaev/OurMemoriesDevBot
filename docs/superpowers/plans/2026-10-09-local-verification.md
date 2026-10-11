# Local verification and useful tests implementation plan

> **For agentic workers:** Execute the assigned bounded task only; the lead owns integration and final verification.

**Goal:** Remove GitHub Actions CI/CD and replace the costly test surface with useful local verification before publication to main.

**Architecture:** Keep the current isolated worktree and PR so the earlier product fixes remain preserved. Remove the remote planner/API gate, retain the guarded manual Selectel release path, and use one local command with a pre-push hook. Backend integration tests remain the main regression layer; three simple browser journeys and a small unit supplement cover boundaries the backend cannot observe.

**Tech Stack:** Bun, Hono, Prisma/PostgreSQL, React/Vite, Playwright Chromium, local Docker, Bash.

**Spec:** Owner decision in this conversation dated 2026-10-09; global `.codex/AGENTS.md` owner policy of the same date supersedes previous mandatory Actions/repeated-review rules.

## State and constraints

- Task: `LOCAL-VERIFICATION-20261009`; implementation base: `354243ccefa027763723ae67215d2005807dc545`; release base: `c5f289fb9d4d9f3d97206d3e7b2e823e69efaf2d`.
- Branch: `fix/preprod-20261008`; worktree: `.worktrees/preprod-audit-20261007`; existing PR: 157.
- One tracked writer at a time. Explicit path ownership in each worker brief.
- Preserve all 32 backend database integration files, all applied migrations, product behavior, private data, and release safeguards. MAX is active; only historical MAX import is deferred.
- Delete low-value tests and their dead fixtures/baselines/commands; do not skip or quarantine them.
- Keep crypto/protocol, authentication, privacy and real concurrency boundaries where database integration cannot provide an equivalent check. Unit file count is a consequence of value, not a quota.
- Do not force push, reset, stash, clean, change foreign worktrees, or remove database/rollback safeguards.
- No GitHub workflow/check prerequisite remains. PR review and no-force/no-delete branch protection are independent and remain.

## Review focus

- Removed test code must not contain a uniquely valuable private-data or identity guard without a retained equivalent.
- The local command must fail on any failed stage or unavailable infrastructure and must execute actual tests, not a zero-test discovery.
- Three E2E must use the real backend and synthetic identities/materials, without mocked auth or persistence.
- Manual release must preserve SHA identity, locking, backup/migration boundaries, immutable images, readiness and failure handling.
- Active agent/runbook instructions and command names must no longer require Actions, removed fixtures, or the obsolete planner.

### Task 1: Local delivery policy and removal of Actions

**Files:** `.github/workflows/*`, `scripts/verify-plan.mjs`, `scripts/require-release-verification.mjs`, `verification-map.json`, their tests, root `package.json`, `AGENTS.md`, active delivery/runbook documents and templates, `deploy/selectel/ci-release.sh` header.

- [x] Cancel the owned running Verify, disable both workflows and repository Actions, remove only the required Actions status from main protection.
- [x] Update global agent instructions with local verification and test-value policy.
- [x] Delete Actions workflows, CI planner/map and GitHub API gate with dead tests/commands.
- [x] Update repository instructions and active delivery documentation to local verification and manual release; preserve host safeguards.
- [x] Verify no active executable dependency on the removed workflow/API gate remains; check affected scripts and whitespace only.

### Task 2: Small frontend regression layer

**Files:** `webapp/e2e/critical-smoke.spec.ts` (new), existing E2E harness/config, `webapp/e2e/helpers/`, existing E2E specs/fixtures/snapshots, `webapp/tests/`, `website/tests/`, affected package scripts and READMEs.

- [x] Extract three short real-backend scenarios: signed host entry and note publish/readback; photo upload and private readback; viewer mutation denial and anonymous private-media denial.
- [x] Remove the former broad E2E suites, companions, visual baselines and dead test-only fixtures/helpers.
- [x] Retain focused browser-only regressions for playback lifecycle, touch compatibility clicks, service-worker credentials, private cache identity, stale host auth and seen queue epochs; remove presentation/markup/matrix duplication.
- [x] Retain the website URL validation boundary; delete presentation inventory and duplicate build-output assertion tests.
- [x] Run the retained unit supplement and the three E2E once on the actual final source; fix only concrete failures.

### Task 3: Backend and manual-release test value

**Files:** backend local test files, `tests/selectel-*.test.mjs`, `scripts/*.test.mjs`, root command registry.

- [x] Retain all 32 real-DB integration files; prune mock-only domain/wiring duplication only where the retained integration or boundary supplement covers the risk.
- [x] Retain the audited protocol/security supplement and unique cursor/timing/cache/normalization regressions; consolidate useful exceptions rather than discard them blindly.
- [x] Delete source-string Prisma wrappers and code-generation-counter tests; retain real parser semantic parity.
- [x] Retain actual shell migration/ownership/rollback tests; remove source-text/runbook-order tests and obsolete provider/mobile/template test gates.
- [x] Publish a concrete before/after inventory with reasons and remaining risk; do not label all nonselected tests useless without assertion evidence.

### Task 4: One local publication command and acceptance

**Files:** `scripts/verify-local.mjs` (new), `.githooks/pre-push` (new), package scripts and local verification documentation.

- [x] Add `bun run verify:local` using useful type/lint/build checks, retained integration/unit tests and three critical E2E; no remote API, planner, screenshot matrix or duplicate build-contract run.
- [x] Add/install the pre-push hook for main; document that PR merge also requires local verification because server-side merges do not invoke Git hooks.
- [x] Lead inspects the actual diff and runs the final local command once. Reuse unchanged prior evidence honestly; no repeated complete suite after docs-only changes.
- [x] One fresh independent review; one bounded fix pass and narrow closure check if findings exist.
- [ ] Commit/publish the completed change using existing authorization. Deployment follows the retained manual safeguards only after local verification; do not resume the canceled Actions gate.
