# MEMOLY-PR181-ROLLBACK-ATTESTATION

Base/current production: `3fce2739205da927b95eb3379b1d066b61282965` (#180).
Measured caption candidate: `39e8af7bb9e9a5949ada3c32dad31d38f9439505` (#181).
Safety branch: `fix/pr181-rollback-attestation`; separate worktree `.worktrees/pr181-rollback-attestation`.

## Work and acceptance

1. Complete final forward-import/capture integration and attempt FULL on exact #181 head. Record failures as failures. Do not review or develop the caption change again.
2. Extend the existing real-module PostgreSQL roundtrip to candidate -> #180 -> candidate, with only synthetic data, a unique loopback `*_test` database and separate storage. Assert exact captions/attachments and no data loss, ACL/multiple families, unread, MAX/browser-link sessions and independent devices, private media and old-worker outbox publication. Exercise fresh authentication on #180 explicitly before deciding its gate policy.
3. RED: existing release safety must reject candidate -> #180 before a new attestation exists. Implement only the measured pair, pinning source runtime identity independent of squash commit IDs and the exact #180 target SHA, immutable image IDs and OCI labels. Preserve the existing measured e383 pair and its authentication maintenance gate separately; unknown pairs/runtime changes fail closed. Keep schema/dependency/config/migration/forward-only and failure-path guards.
4. Targeted tests exercise actual rollback and ci-release failure handlers, both gate policies, altered source/target/images/labels/schema/dependencies/config, missing protected artifacts, pending migrations, failed database reads and failed restoration. No test-only production bypasses or broad ancestry allowlists.
5. One fresh independent read-only review of the new safety diff and evidence; one bounded fix/recheck if needed. Lead verifies actual diff and test results.
6. Integrate safety PR first if required by #181's gate: its legacy application tree stays #180, while the new exact candidate fingerprint is dormant. Merge main into #181 without rebase; require FULL on the resulting head. Squash #181, verify its runtime identity equals the measured candidate, run FULL on final main SHA, then use the unchanged guarded Selectel entry point. Never deploy the intermediate safety-only revision as part of this task.
7. Check four active application service revisions, health/public smoke, backup, protected rollback readiness and release manifest. No existing Memory backfill.

## Design rulings

- The source binding must survive squash through exact Git runtime content identity, not a list of descendant SHAs. Retain the existing runtime scope and narrowly declared exclusions for test/support scripts; do not exclude application files. A NUL-delimited `git ls-tree` fingerprint with deterministic output is an acceptable implementation.
- The legacy e383 target retains its proven auth gate. A #180 target may run without it only after real MAX and browser-link session replacement/recovery tests pass in the old-runtime phase. Gate policy belongs to the verified exact pair and is not read from operator-supplied switches.
- #180 backend image: `sha256:d8fada3265507cc8ee1ae76b83bf851187aaad19c126b3f4fec4cead92c9106c`.
- #180 webapp image: `sha256:9a31bb3f071ae2f11654671fce4a262a37fb4a039e7d7f3c422ed824a7787a66`.
- Both production image revision labels were read-only verified as the exact #180 SHA.

## Allowed paths and checks

Allowed: `deploy/selectel/redeploy.sh`, necessary minimal `ci-release.sh` changes, `deploy/selectel/README.md`, `backend/scripts/selectel-rollback-compatibility.integration.test.ts`, its `test-support/rollback-runtime-probe.mjs`, related `tests/selectel-*.test.mjs`, and task-specific report/plan. Lead owns integration and shared files. No application auth/ACL/F12, caption, schema/migrations, dedupe, production SQL or manual rollback.env edits.

Checks: focused MAX integration; actual PostgreSQL compatibility integration; focused Selectel guard/failure tests; backend typecheck where test sources change; mandatory `bun run verify:full --base 3fce2739205da927b95eb3379b1d066b61282965` on published safety/caption/final release source as applicable. No infrastructure skips presented as PASS.

Stop if compatibility is unproven, production image identity drifts, a guard would need bypassing, data/schema/auth changes become necessary, or mandatory infrastructure is unavailable. Existing data/rollback.env are never edited manually.
