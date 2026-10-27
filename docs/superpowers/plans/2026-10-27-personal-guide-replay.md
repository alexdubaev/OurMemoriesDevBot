# Personal Guide Replay Implementation Plan

> For agentic workers: implement via bounded subagent-driven-development. Owner policy takes precedence over formal repeated review loops.

Goal: the configured owner can repeatedly inspect latest bot greeting and FamilyGuide while tuning.
Architecture: reuse existing Control identity eligibility without changing permissions; compose existing FamilyGuide after normal app startup gates; route plain owner /start through durable welcome response delivery.
Tech stack: existing Bun/Hono/Prisma/React/MAX.
Spec: docs/superpowers/specs/2026-10-27-personal-guide-replay.md

## Global constraints
Preserve original user work and other users. Work only in feat/personal-guide-replay, dedicated worktree. No personal IDs/secrets in Git; no auth/ACL/schema/migration/dependency changes; no first-welcome resets; one short browser case rather than broad screenshot matrices. Backend/message handling changes require FULL per risk gate. New backend runtime requires exact independent recovery compatibility proof before production attestation; never broaden a profile blindly.

## Bounded task: repeated owner instruction
- [ ] Inspect only relevant owners from scout map; pin BASE2fc3abd4.
- [ ] Add and run red real PostgreSQL regression around owner/ordinary bot-start behavior and plain command boundary, preserving idempotency and contextual payload priority.
- [ ] Implement minimal owner eligibility mapping and response marker/CTA in existing MAX processor/delivery; no media pipeline refactor.
- [ ] Add short real browser regression on current MAX/Control fixtures; implement minimal app composition hook and FamilyGuide rendering without altering host auth/welcome claims or private cache.
- [ ] Verify narrow tests, architecture/typechecks and actual diff; record evidence outside Git.
- [ ] Lead review of actual diff and useful deterministic checks; one fresh independent safety review and bounded fix pass if required.
- [ ] Commit clean explicit paths; calculate profile/dry-run and execute applicable exact-source release checks on isolated *_test infrastructure.
- [ ] If needed, measure current->d299->current recovery for exact new runtime, then separate bounded exact binding+frozen regression task; no gate bypass.
- [ ] Push task branch/create PR with evidence, expected-head squash after main sync; final release gate, guarded manual deployment; verify manifest/smoke/recovery and preserve local history on sync; remove only own temporary resources.

## Owner-directed reduced verification
The later direct request for minimal checks overrides the broad FULL tasks above for this task only. No whole FULL run or redundant full-matrix repeat. Complete only targeted owner PG regression, current short Chromium case (twice on same DB proves the requested replay), typechecks, one focused independent review, and indispensable exact recovery/host safety checks. Record FULL NOT RUN honestly, retain default classifier and all deploy guards. No mandatory host safety bypass.
