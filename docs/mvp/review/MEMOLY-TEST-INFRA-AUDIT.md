# Test infrastructure audit slice

Task slice: root verification runners, backend integration child/catalog, and Selectel release/deploy safety tests. This is evidence for the assigned infrastructure slice, not a claim that the full project audit is complete.

## Inspected coverage

Read the complete bodies and harnesses for six `tests/selectel-*.test.mjs` files (checkout hygiene, prebuilt release, Caddy activation, deployment ownership, MM0 recovery, and release exit/rollback), `scripts/verify-local.mjs` and its tests, plus `backend/scripts/test-integration.mjs` and `backend/scripts/test-integration-catalog.test.ts`. Read related Selectel deploy scripts `deploy/selectel/redeploy.sh` and `deploy/selectel/ci-release.sh` to replace source extraction with guarded source interfaces where practical. The catalog file contains seven focused declarations including the required missing-PostgreSQL check. Release-exit’s complete file passed in the final root `test:tools` run; that run covered all six Selectel files and the runner suite.

## Findings and changes

- FULL invoked `verify-local.test.mjs` a second time after `test:tools`; removed the second invocation. FAST's webapp and website style+asset path combination could append the same production build twice; deduplicated equivalent command+argument entries and added both regressions.
- The “missing infra” runner test injected a fabricated failed status. Removed it; retained the real fail-closed missing PostgreSQL integration catalog check and replaced the timeout constant assertion with a child process that signals it started, hangs, then is verified terminated by the runner.
- MM0's failure fixture previously could fail earlier at an unset `SERVER_ROOT`. It now sources the production functions, gives the fixture a valid server root, injects a durable `FAULT_EVENT` immediately at each named failing boundary (backup, database migration, startup, readiness, and revision), and verifies that boundary was reached before asserting the forward marker persists, writers quiesce, and rollback is absent. It no longer relies on production log wording. The focused suite passed 25/25 after this closure.
- Caddy failure coverage now calls production `validate_candidate_caddy`, `backup_gateway_caddyfile`, and `activate_gateway` using a controlled Docker boundary. Invalid and valid controls verify validator reachability, no reload on validation failure, and active bytes/inode preservation. All four Caddy tests passed. All temp directories are cleaned.
- Backup failure coverage now checks a persisted invocation marker rather than searching stdout. Migration and backup tests source the real redeploy script and assert the concrete job invocation. Ownership tests passed 4/4.
- Release tests no longer duplicate the legacy UI rollback-readiness scenario or the mock unread/multiple matrix. Five rollback refusal boundaries now have independent assertions so each child stays within the runner's default timeout. Compatibility tests distinguish unchanged full artifact/source attestations from a compatibility-only input fingerprint. They accept changes to discovered test-only helpers/runners and `webapp/tsconfig.e2e.json`, while rejecting mutations to production `legacy-test-routes.ts` and worker code. Frozen source refs are used; image ID pins and production artifact/source full attestations remain intact. The frozen `91f487…` source keeps its comments profile for the `3fce…` target.
- The comments migration ledger verifier is a named function in the real redeploy script; tests source and invoke that function, capture the exact `bun -e` program passed to Compose, and execute it with a controlled `pg` module. The production old-image inline invocation remains intact. Tests no longer slice the heredoc or rewrite its import.
- `ci-release.sh` and `redeploy.sh` have guarded entry points and can be sourced to exercise their actual functions. Cleanup traps are installed only when the redeploy entry point runs. Forward-marker recovery and promotion are named functions; tests call the production marker recovery path instead of slicing a block from `main`.
- Windows harnesses use Git Bash when installed, and path conversion follows the actual Bash family; tests requiring Linux ownership/mode semantics remain on WSL/root. This resolves the linked worktree path mismatch observed in the initial Windows tools baseline.

## Evidence

- Initial Windows `bun run test:tools`: 67 passed, 21 failed over 168 seconds because WSL Git resolved the Windows `.git` worktree pointer as a Linux literal path. This was an environment/harness defect; the Git Bash path behavior was repaired.
- Focused post-change checks: integration catalog 7/7 (including real missing PostgreSQL and child termination); `bun run test:tools` passed 93/93 across eight files, including the MM0, Caddy, ownership, prebuilt, checkout, and verify-local scenarios.
- Release-exit closure checks: source profile mapping passed; compatibility test-only and production-drift fixture passed; migration ledger checksum success/failure cases passed; the five isolated refusal cases passed individually. A complete post-change `test:tools`/FULL run is delegated to the lead's final environment verification.
- Intentional negative cases remain active: MM0 Compose migration failure, invalid production Caddy candidate, backup failure, rollback guards, empty catalog/missing PostgreSQL, and timed child termination.

## Residual scope

The embedded Node verifier remains inline so existing rollback images do not depend on a new in-image file; the test invokes the actual production helper and captures that executable payload through the Compose boundary. Historical revision roundtrips and all unrelated test directories were not audited here. Do not interpret this ledger as a whole-repository completion claim.
