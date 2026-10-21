# MEMOLY-TEST Backend Closure (B1–B10)

This note records the bounded backend closure work for `MEMOLY-TEST-AUDIT` against base `dc3201096998f366a88a296d13914abf6047604b`. It does not claim a full-suite pass; final whole-suite and publication checks remain with the lead.

## Changes

- B1: comments release scenario dispatch now rejects unknown modes before database setup and executes the actual post-SQL failure branch. Failure assertions use process status, committed migration/data state, and URL secrecy rather than incidental CLI prose. The no-admin case returns after its own assertions.
- B2: all script migration fixtures that call `requireIntegrationDatabaseUrl` import the shared guard from the appropriate source-relative path, including historical fixtures.
- B3: F12 accepts omitted PostgreSQL `schema` (the default) and rejects an explicitly non-public schema; IPv6 URL hostname `[::1]` is recognized. Its owned family teardown removes synthetic dependent rows.
- B4: advisory-lock waiter observation filters `pg_locks.database` by the current database OID.
- B5: provider-send and capability races keep the first provider call held while the second service finishes its competing operation. Assertions cover one send/capability, processing/no early publication, and durable final state.
- B6: runtime grants assert `SELECT`, `INSERT`, `UPDATE`, and `DELETE` individually; a combined privilege string would test only whether any listed privilege is present.
- B7: the read-denial control uses a real PostgreSQL client and SQLSTATE `42501`.
- B8: the fake unknown-task unit case was removed because the real PostgreSQL integration test covers that branch; no-admin exits after its own checks.
- B9: budget test clock reads are stable; time advances only while handler work runs.
- B10: timeout regression runs the real wrapper in a probe process with an independent outer watchdog and child PID marker/cleanup.

## Verification

Checks below ran on the isolated Linux audit container (`memoly-audit-linux-20261021`) against synthetic PostgreSQL only. The Linux checkout was a prior backend snapshot with only changed backend files copied into it; these checks are focused evidence, not a substitute for lead's exact-source acceptance.

- `bun run typecheck` — pass (source typecheck).
- `bun test scripts/test-integration-catalog.test.ts src/outbox/drain.test.ts` — pass, 13 tests, 56 expectations.
- `bun test scripts/comments-release-compatibility.integration.test.ts --test-name-pattern="unknown comments release|MAX existing database fails after SQL|MAX migration works without a global|comments migration applies every expected|runtime role has only application"` — pass, 5 tests, 21 expectations. After the final individual-grant change, `--test-name-pattern="runtime role has only application privileges"` — pass, 1 test, 3 expectations.
- `bun test scripts/int1-max-upgrade.integration.test.ts` — pass, 1 test, 20 expectations; demonstrates a real migration fixture imports/runs the shared database guard.
- `bun test src/modules/auth/max-session-replacement.integration.test.ts` — pass, 10 tests, 133 expectations. Focused default-schema control after IPv6 normalization: `--test-name-pattern="accepts PostgreSQL default schema"` — pass, 1 test, 1 expectation.
- `bun test src/modules/max/direct-video-upload.integration.test.ts --test-name-pattern="two service instances share one durable capability claim|concurrent finalize sends once and publishes one fixed Memory in the real database"` — pass, 2 tests, 8 expectations before final finalize sequencing refinement. After that refinement, `--test-name-pattern="concurrent finalize sends once"` — pass, 1 test, 10 expectations.
- `bun test src/modules/memories/unread.integration.test.ts --test-name-pattern="database read denial leaves family cards available"` — pass, 1 test, 4 expectations.
- `bun test src/outbox/outbox.integration.test.ts --test-name-pattern="unsupported task types remain pending and are reported"` — pass, 1 test, 2 expectations.
- `bun test src/modules/users/users.integration.test.ts --test-name-pattern="keeps queued role transitions|makes an old-password login wait|revokes a password login that wins|issues a fresh-role login"` — pass, 4 tests, 23 expectations.
- Controlled B1 disposable-snapshot mutation swallowed postmigration failure; comments failure test returned red because the CLI exited zero (`Expected: not 0`, actual 0). Snapshot source was restored and fixture database cleanup completed. This is expected-red mutation evidence, not a passing product check.
- Controlled B10 disposable-snapshot mutation removed the wrapper's inner timeout. Regression failed at the independent outer watchdog around 3 seconds with `ETIMEDOUT`; the probe's `finally` cleaned the marked child. The mutant file was removed. This is expected-red mutation evidence, not a passing product check.

The first B1 scenario was initially reported under a stale `sql-failure` name; that was a false-green. It is corrected to `failure-after-sql`; the explicit unknown-mode test now ensures future stale scenario names fail before database setup. No 7/7 claim is made for the former false-green run.

## Limits

The lead owns final exact-source acceptance, broader FULL/review/publication checks, and the final task report. No production database, host, account, deployment, or source-mutant was used.