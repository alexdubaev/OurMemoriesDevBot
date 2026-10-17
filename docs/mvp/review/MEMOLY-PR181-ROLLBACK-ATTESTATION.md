# MEMOLY-PR181-ROLLBACK-ATTESTATION evidence

Base and measured rollback target: `3fce2739205da927b95eb3379b1d066b61282965` (#180).
Measured MAX caption runtime: `39e8af7bb9e9a5949ada3c32dad31d38f9439505` (#181).
Worktree: `.worktrees/pr181-rollback-attestation`; branch: `fix/pr181-rollback-attestation`.
Scope and integration order: [plan](MEMOLY-PR181-ROLLBACK-ATTESTATION-PLAN.md).

## Confirmed blocker and initial checks

The old application rollback guard accepted only target `e383d79269a3595f4c6cabedf167335aea042cf3` and the runtime of producer `d4b69a5ce73a03eceb632f23fb9eb17801343ff9`. Candidate #181 changes that runtime, while guarded release preparation selects the actual running #180 images. Neither mismatch was bypassed.

The final MAX integration command on exact #181 HEAD was `bun run test:backend:integration -- src/modules/max/forward-import.integration.test.ts src/modules/max/capture.integration.test.ts`: 31 forward-import tests and 100 capture tests, exit 0. Only synthetic provider payloads, a task-owned PostgreSQL 18 database and private test storage were used.

Initial `bun run verify:full --base 3fce2739205da927b95eb3379b1d066b61282965` on that same HEAD exited 1 at Selectel/tool tests: 59 pass, 4 fail. Three failures exposed the existing exact runtime attestation mismatch; one came from running the verification container with `NODE_ENV=production`. The latter was isolated with `NODE_ENV=test bun test scripts/repo-env.test.mjs`: 6 pass, exit 0. This is not a FULL PASS.

## PostgreSQL compatibility evidence

On safety test-source `f70f9a114b0f3bf2c961f1ec43102b7fb05ac500`, `NODE_ENV=test bun test backend/scripts/selectel-rollback-compatibility.integration.test.ts` passed: 2 tests, 22 Bun assertions, exit 0. Each test creates and drops only its own unique `memoly_rollback_roundtrip_*_test` database and uses a separate private storage directory. The actual archived application modules execute in three separate processes against the same fixture data.

| Runtime roundtrip | New / old / return probe assertions | Result |
|---|---|---|
| d4b69a5 → e383d79 → d4b69a5 | 24 / 23 / 18 | PASS |
| 39e8af7 → 3fce273 → 39e8af7 | 30 / 69 / 25 | PASS |

The new phase imports a synthetic forwarded MAX video through the real accept-update/task processor and publication path. The #180 and return phases read the same memory, exact multiline Unicode caption, video reference, photo caption and provenance. They also exercise two families and roles, denied viewer writes, unauthorized access, unread/seen ordinals, revoked and independent sessions, private media access, old-runtime outbox publication and writes surviving return to the new runtime.

Fresh authentication on #180 is tested separately: MAX A→B replaces only the presented browser session; an independent A session remains active. A known revoked cookie rejects login (401) without setting a cookie; a fresh login recovers. An unknown malformed cookie plus valid signed MAX data issues a new session without revoking unrelated sessions, as specified by the existing refresh-family proof implementation. Invalid signed data with that cookie rejects (401), sets no cookie and creates no session. Browser-link redemption replaces only the presented browser session and preserves the approving device. No authentication implementation was changed to obtain these results.

Raw command logs are retained locally under task-owned `.scratch/` and are not committed because they contain synthetic session fixtures. Final attestation, review, FULL and deployment results are recorded in the PR/release evidence after they execute; this document alone does not declare the release ready.

## Release failure-path correction

Inspection found that `verify_application_rollback` loads MAX secrets in a subshell, while outer `rollback` subsequently invokes Compose without loading those required variables. The release entry point does not supply them. The old mocked Compose did not enforce its real required-variable contract. A regression on test-source `a003ab0` explicitly removes ambient MAX variables, exports synthetic values only through the mocked standard loader, and requires them at Compose configuration/promotion. The actual release-failure-handler scenario then fails as expected: 0 pass, 1 fail, exit 1. The bounded correction reloads secrets through the existing function in the rollback process; no secret files, authentication logic or production data are changed.

A read-only GET of production #180 `/api/v1/auth/max` returned 404 (curl exit 0). That is the normal-routing status used by the #180 rollback gateway check; the older e383 policy still requires 503 before application promotion. Runtime fingerprint exclusions are anchored to the original exact test/support scope; a production-shaped suffix is not excluded.

On implementation source `f7a934a1092d35ca7b16a4b7fce5bf337bdae245`, the focused Selectel suite passed: `bun test tests/selectel-release-exit.test.mjs`, 16 pass, 0 fail, exit 0. The secrets regression passed after the fix. Clean synthetic Git commits separately reach the actual runtime and service-configuration incompatibility errors; unknown/dirty sources cannot promote services. Both target-specific gateway policies, a non-mutating rollback-readiness action and failed restoration retaining original release status 42 are covered. Backend typecheck passed, exit 0. Final FULL and independent review remain release gates, recorded against their exact source SHA in the PR.
