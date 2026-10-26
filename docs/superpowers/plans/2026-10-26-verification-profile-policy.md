# Verification Profile Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent unjustified FULL runs while retaining sensitive-change gates and completing scoped UI browser verification.

**Architecture:** Keep the existing verifier and release scope classifier. Add per-path explanations and a blocking unknown state; keep the current rank protection. Extend STANDARD with exact changed browser specs using their existing configs.

**Tech Stack:** Node/Bun JavaScript, Bun tests, Git fixtures, existing Playwright configs.

**Spec:** `docs/superpowers/specs/2026-10-26-verification-profile-policy.md`

## Global Constraints

- Base `7e60ba15b5e42f2bce351c24b806a22c7d4c1613`; branch `fix/verification-profile-policy`.
- No production app, schema, dependencies, deployment allowlist or FULL-stage removals.
- Luna does research and one independent final review; root implements. No permission loop after owner approved the design.
- Existing journal classification is correct; test it, do not invent a whitelist fix.

## Review Focus

- Mixed unknown and known-sensitive files must remain blocked, not implicitly downgraded.
- A missing/malformed frontend classifier must not silently permit a lower profile.
- Manual FULL must provide a reason; auto FULL and downgrade protection remain intact.
- An E2E filename must select a config that actually discovers it, without portfolio grep hiding tests.
- Removed/renamed specs and zero/skipped test summaries must not manufacture a passing journey.

## Task 1: Classification and execution guard

Files: `scripts/verify-local.mjs`, `scripts/verify-local.test.mjs`.

Interfaces: add `explainChanges(paths, {repositoryRoot}?) -> {required, reasons}`; preserve `classifyChanges(paths)` convenience API with additional `review-required` value; extend `selectProfile` with optional `reason` and reasons result. REVIEW_REQUIRED throws before plan execution. CLI `--reason` is single-use/single-line and required only for manual FULL above minimum.

- [x] Baseline: `bun test scripts/verify-local.test.mjs` — 20 passed.
- [x] Add failing tests for unknown/mixed blocking, original UI range, journal, known FULL, manual FULL reason and real CLI no-execution behavior — 9 failures reproduced.
- [x] Implement explanations, selection guard and CLI output; run the same tests green — 24 passed.

## Task 2: Scoped browser plan

Files: same verifier and tests.

Interface: internal changed-browser-spec planner for STANDARD; existing `.spec.ts` and `.max-e2e.ts` files only, dedicated config first, explicit Control and supported MAX fallback. Unknown route blocks planning. Existing FULL and guarded FRONTEND plans stay intact.

- [x] Add failing plan tests: actual family-audit config, Control/MAX/dedicated paths, unknown config, deletion/rename, no full portfolio command.
- [x] Implement route selection and include exact spec arguments; run verifier suite green.
- [x] Playwright discovery with the actual family config found 12 tests in one file, including both invited-role guide scenarios. This is discovery, not browser execution.

## Task 3: Rules and delivery

Files: `AGENTS.md`, `docs/TESTING.md`, `docs/mvp/07_DELIVERY.md`, `docs/mvp/08_CODEX_START.md`, `.autopilot/PROGRESS.md`, spec/plan above.

- [x] Align default command, terminology, manual reason, unknown-path stop, scoped E2E and out-of-scope failure handling; retain critical FULL and release rules.
- [x] Verifier suite and actual original-range plan check: original 16 paths select STANDARD with dedicated family E2E. Final counts/commit are recorded in the task PR.
- [ ] One Luna review, bounded corrections, commit candidate and execute required gate once. Record baseline failures without repairing unrelated application modules.
- [ ] Push task branch and PR; merge only with actual required gates PASS. No production deploy for this tooling task.

## Execution ledger

- Design approved in conversation; root uses inline execution with Luna research/review.
- Confirmed journal FAST and original feature diff STANDARD by real classifier calls before coding. Earlier diagnosis corrected to owner.
- Ruling: update the delivery/start documents too — they repeat the old unknown-path escalation and otherwise contradict the new canonical instructions.
- Ruling: FULL also appends changed journeys and validates their config mapping — the existing MAX portfolio filters family cases; explicit escalation must not omit the changed scenario. Existing mandatory FULL stages remain intact. Two additional regressions were observed red before this correction.
- Independent review reproduced an existing downgrade on a staged/committed rename from `backend/src/modules/auth/session.ts` to `docs/session.md`. Bounded fix reuses the existing NUL/name-status path parser, preserving both sides and rejecting ambiguous names. The same parser hashes untracked Unicode filenames correctly. Rename and Unicode CLI tests were observed red before the fix; the reviewer's initial newline-only hypothesis was not treated as a reproduced bug.
- The same boundary also preserves literal backslashes returned by Git (which already uses slash separators). A real CLI regression reproduced `docs\\outside.bin` being normalized into documentation; normalization was removed and the invalid-path guard now blocks it.
