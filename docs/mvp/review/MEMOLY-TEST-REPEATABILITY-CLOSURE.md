# Repeatable verification closure after PR #201

Task: MEMOLY-TEST-AUDIT; continuation, not a new product change.
Base: `8284937e678527f67b57a7ca6fdcb435b79c3540` (merged audit PR #201).
Branch: `test/audit-repeatable-gate`, same owned isolated worktree.

The required exact-main FULL did not pass. It reached PostgreSQL, then all 17 auth
cases failed in `beforeEach`, before their API assertions: a global user deletion
encountered `families_owner_user_id_fkey`. The prior feature FULL's browser stage
had left legitimate synthetic family fixtures in the same task-owned disposable
`_test` database. A newly empty database would hide this repeatability defect.
Production services/data were untouched; release was not started.

A focused search found the same incomplete global cleanup in MAX auth, users and
uploads. The four fixtures now clear family/media dependents before families and
users, using the existing fixture ordering, and clear their final case before
closing connections in `finally`. Their module-level strict database guard still
runs before Prisma construction or mutation. The whole supplied database belongs
to the isolated test invocation; no other agent or production database is used.
All original endpoint, persistence, ACL, auth/session, race and failure assertions
remain unchanged. No application, schema, migration or release guard is modified.

Uploads also created one temporary storage directory per test but removed only
the last. Guarded `afterEach` now removes each directory, including after failed
assertions or partial setup, without attempting `rm(undefined)`.

Acceptance requires narrow execution on the retained dirty database, existing-family
fixtures before each affected suite, repeated runs on that same database, independent
review and the documented local verification gate. Exact commands, results, source
SHAs and the final guarded release are recorded with the follow-up PR/final handoff.
The previous main FULL remains a recorded FAIL; earlier passing evidence is not
substituted for this follow-up's final verification.

Narrow closure: each of the four suites passed with a seeded synthetic owner/family
on the retained database (17 auth, 3 MAX auth, 18 users, 18 uploads). Two consecutive
real integration-runner invocations passed all 56 cases each; one historical provider
case per run remains the declared MAX exclusion. Raw logs were preserved. Fresh
independent reviewer `repeatability_review` inspected the final diff and found no
P0–P2; it confirmed unchanged application assertions, strict guard placement,
dependency ordering and teardown behavior. This narrow evidence does not replace
the final exact-commit gate or authorize a failed release gate to pass.
The post-fix upload delta run passed 18/18 and created no extra temporary-directory
residue (34 pre-existing directories before and after; they were not deleted by the
check). Backend typecheck passed after the optional-root typing adjustment. These
are narrow closure results, not the final release gate.
