# MEMOLY full test suite audit

Task: `MEMOLY-TEST-AUDIT`, started 2026-10-21.
Base: `dc3201096998f366a88a296d13914abf6047604b` (fresh origin/main).
Branch: `test/full-suite-audit`.
Worktree: `D:/codex/TG_OurMemoriesDevBot/worktrees/test-suite-audit`.

Owner amendment during this task: the initial production-deploy prohibition was explicitly
revoked. After successful review, verification and squash merge, a normal guarded release on
the exact final main SHA is authorized if all existing release/recovery guards pass. No unsafe
migration, data restore, ACL weakening or guard bypass is authorized. Earlier no-deploy notes
below describe the original scope and the actions actually taken at those checkpoints.

## Scope and implementation plan

One implementation worker at a time in the task checkout; read-only discovery may run alongside it.
Allowed paths: tests and runners across backend/webapp/website/contracts/root, test-support,
Selectel script refactors preserving guards, and related testing documentation.
Forbidden: production hosts/configuration/data, secrets, unrelated owner work, UI changes,
schema/migration edits without an explicit lead ruling, dependency churn and hosted CI.

1. Inventory all discovered test files, runner ownership and required exclusions. Record evidence,
   unique protections, uncovered paths and baseline failures; never equate file discovery with review.
2. Fix infrastructure false positives first: MM0 stage injection, Caddy production validation,
   migration invocation and backup observability; separate test fixtures from immutable release
   attestations. Preserve v4, image provenance, writer shutdown and migration/rollback guards.
3. Repair runners: eliminate duplicate executions and fabricated infrastructure tests; exercise
   actual child termination and preserve fail-closed infrastructure and nonempty-run semantics.
4. Replace weak backend persistence/ACL/lease tests with HTTP + isolated PostgreSQL/storage
   tests. Split migration compatibility into independent failures with actual data postconditions.
   Keep valuable algorithm, deadline, resource, retry and lifecycle units.
5. Refactor frontend/E2E into compact behavior journeys; remove decorative assertions and
   geometry matrices, use controlled clocks, preserve drafts/media/cache/async guarantees.
6. Audit remaining suites independently, recording keep/change/remove rulings and why.
7. Verify changed boundaries and controlled negative mutations. Commit stabilized source, run
   the required local FULL against that exact SHA, obtain a fresh independent technical review,
   fix confirmed P0-P2 with narrow closure checks. Fetch/synchronize if main moved. Push, PR,
   squash merge, verify main and safely remove only this task's branch/worktree. No deployment.

## Baseline evidence

The initial tree has 41 backend integration files, 28 unit/runner files and 3 live files;
19 webapp unit files and 14 E2E specs (scout discovery, counts to be reconciled with final inventory).
Historical FULL evidence from 2026-10-17 is at a different SHA and is not current acceptance.
Docker 29.6.2, WSL Ubuntu, Bun 1.4.0 and GitHub authentication are available.
The caller directory was a non-Git packaging snapshot; canonical main checkout is its sibling
`OurMemoriesDevBot-workspace`. Its untracked owner artifacts remain untouched.

## Findings and acceptance evidence

Implementation and narrow verification are recorded below. This source record is not a release PASS report; final independent review, exact-commit FULL and publication evidence belong to the PR and final handoff.

### Initial narrow measurements

Unmodified frontend/contract source on base, Windows Bun 1.4.0:

| Command | Result | Bun elapsed |
| --- | --- | --- |
| `bun run test:webapp` | 98 pass, 0 fail, 420 assertions, 19 files | 8.41 s |
| `bun run test:website` | 4 pass, 0 fail, 1 file | 26 ms |
| `bun run test:contracts:max` | 59 pass, 3 declared historical exclusions, 266 assertions, 7 files | 274 ms |

Logs: ignored `.scratch/baseline-{webapp,website,contracts}.log`. Commands ran concurrently;
these are narrow baseline timings, not a FULL runtime or cross-platform comparison.
Root tools baseline exposed a Windows/WSL worktree path interpretation failure, subsequently
fixed in the Bash test harness; the failed baseline is not counted as a passing product check.

Linux baseline used a new clone exported from `origin/main` ancestry, Bun 1.4.0,
Node 22.20.0 and a new PostgreSQL 18 instance (synthetic fixtures only):

| Boundary | Base result |
| --- | --- |
| `bun run test:tools` | **FAIL**, 82 pass / 6 fail / 88 executed, 20.49 s; missing historical producer Git object, not a product regression |
| media-access API/PG | 11 pass / 0 fail, 3.99 s |
| outbox PG | 9 pass / 0 fail, 559 ms |
| unread API/PG | 16 pass / 0 fail, 2.76 s |

All 36 PostgreSQL baseline cases ran through the integration runner with explicit matching
test-only database URLs and `TEST_SKIP_DOCKER=1` for the separately owned container.
No production database or credential was used. Logs remain in ignored `.scratch`.

### Inventory accounting

At base `dc320109`, Git discovery plus TypeScript AST/HCL registration inspection identifies
**135 test files and 929 static scenario declarations**. Parameterized loops generate additional
runtime cases; declaration counts are not an execution count. Runners/helpers/configs were
inspected separately. Counts include the separately configured MAX family browser audit.

| Area | Files | Static declarations |
| --- | ---: | ---: |
| Backend unit/integration/live | 72 | 594 |
| Shared contracts | 7 | 62 |
| Root scripts and Selectel | 8 | 78 |
| Webapp unit/E2E/legacy visual suites | 39 | 169 |
| Website | 1 | 4 |
| Optional Terraform mock-provider plans | 8 | 22 |

This table is inventory, not by itself a claim of complete body review or a passing run.
Body-review dispositions and final execution evidence are recorded after implementation.

### Controlled negative verification

The lead copied the changed shell tests and scripts into a separate Linux mutation directory;
the task checkout and deployed systems were never mutated.

| Fault | Control | Mutant | Restored |
| --- | --- | --- | --- |
| Ignore Caddy candidate validator failure (`|| true`) | Caddy suite 4/4 PASS, 101 ms | Required rejection test FAIL: actual exit 0, expected injected validator exit 42 | 4/4 PASS, 99 ms |
| Disable MM0 marker failure branch | Migration failure case PASS, 54 ms | FAIL: expected writer-quiescence event absent | Same case PASS, 49 ms |

The MM0 control reaches the injected database job failure before asserting recovery; an early
unset-variable failure cannot provide the required stage evidence. Mutation logs are ignored
`.scratch/mutation-{caddy,mm0}-{red,restored}.log`.

The first complete post-infrastructure Windows tools check returned **FAIL**: 85 pass / 1 fail,
86 cases, 265.35 s. The compound five-boundary rollback negative case exhausted Bun's default
5 s budget mid-process. The case was split into independent failure-boundary cases; the failed
run is not reported as PASS and the timeout was not raised.

### Additional runner finding

`backend/scripts/test-live.mjs` can select zero files for a configured provider even though
unrelated live files exist, then issue bare `bun test`. The replacement fails closed on an empty
provider selection, so unrelated tests cannot provide the live provider's evidence.

### Additional inventory: inactive infrastructure plans

The lead read all eight `infra/{digitalocean,yandex}/**/*.tftest.hcl` files and their 22 `run`
blocks, plus `scripts/terraform-test.mjs`. These are optional mock-provider Terraform plan
contracts for inactive hosting alternatives, outside MAX/Selectel FULL. Keep their distinct
private-state/versioning, privilege separation, image digest, firewall and explicit-CDN guards;
no real provider operations or cloud credentials were used. This is source review only;
Terraform execution has not been claimed. `scripts/repo-env.test.mjs`'s six bodies were also
read: keep test-database/storage destination guards and Compose teardown-volume contract.

### Direct execution safety finding

The managed integration runner checked the database name, but direct `bun test <file>` bypassed
that boundary. Module fixtures could silently skip without a URL or accept an arbitrary host;
the deployment-grants suite could even create roles and change default privileges in the supplied
database. Migration fixtures' generated child database names did not protect their administrator
connection. The replacement boundary rejects missing URLs, non-PostgreSQL schemes,
non-loopback hosts, non-`_test` input databases and mismatched `DATABASE_URL` before connecting.
The legacy override flag cannot bypass this test-only guard. Database fixtures and E2E
bootstrap use it; generated isolated child databases retain their own scoped cleanup.

The original `docs/TESTING.md` also describes removed template commands (`check`,
`test:build-contracts`) and an obsolete integration timeout. Runner documentation now describes
actual FAST/STANDARD/FULL commands and removes these dead instructions.

Lead narrow unit closure on the working tree: outbox policy, authentication service,
repository environment, integration catalog and live selection — **26 PASS / 0 FAIL**, 91
assertions, 1.152 s (Windows). A direct outbox integration launch with synthetic loopback port 1
and a non-test database name intentionally returned exit 1 at the common guard before Prisma
construction (507 ms). This expected refusal is boundary evidence, not a passing database suite.

## Required issue disposition ledger

The following checklist is acceptance tracking, not execution evidence. Domain reports provide
the final commands and retained/replacement scenarios.

| Requirement | Acceptance boundary | Status |
| --- | --- | --- |
| Duplicate verify runner invocation / fabricated infrastructure result | One tools invocation; actual missing-infrastructure refusal | Implemented; final tools gate pending |
| Migration CLI and backup failure observability | Actual shell entrypoint and persisted invocation event | Narrow executable controls passed |
| Duplicate legacy rollback and mocked data-state matrix | One complete refusal; real current/recovery PostgreSQL state | Replaced; PG current/recovery verification passed |
| Historical e383/#181 roundtrips | Explicit historical opt-in; daily current/permitted boundary | Historical isolation implemented; daily boundary verified |
| Immutable attestations vs test/source compatibility | Frozen artifact pins, test-only mutations accepted, production drift rejected | Frozen-source and mutation controls passed |
| MM0 injection reaches intended failure | Persisted stage event and actual quiescence, no unsafe rollback | Narrow and mutation checks passed |
| Caddy rejection protects active bytes/inode | Production validator path, positive/negative control | Narrow and mutation checks passed; final gate pending |
| Bash extraction brittleness | Sourceable interfaces / executable verifier boundary | Actual helper/payload boundary checks passed |
| Child timeout and mandatory catalog | Real child termination, discovery/category completeness | Narrow checks passed |
| Comments migration scenario split | Independent no-admin, SQL/grant failure, retry, preservation, grants and recovery cases | Dispatch defect fixed; focused PG closure passed; final gate pending |
| Family unread fallback | Real HTTP/PG with actual permission failure | SQLSTATE control and API fallback passed; final gate pending |
| Media cleanup / ETag / membership / Range | Real HTTP/PG/private storage and durable postconditions | Narrow API/PG/storage verification passed |
| Outbox fake persistence | Real PostgreSQL lease/due/retention/concurrency; useful policy units retained | Narrow PG and policy checks passed |
| Comments browser matrices and oversized setup | Compact client actions/drafts/conflicts; ACL/pagination remain in backend | Implemented; browser closure in progress |
| v4 geometry and mixed family tests | Navigation/roles/profile/crop/viewer without decorative geometry | Implemented; browser closure in progress |
| Header illustration paths / website button labels | Theme behavior and valid destination URL contracts | Narrow unit checks passed |
| Playback inactive-owner test | A different owner actually playing before unmount | Narrow lifecycle unit checks passed |
| Cache notifications and real delays | Actual private-data isolation and controlled clocks | Narrow isolation/timer checks passed |
| PhotoSwipe prefetch counts | Correct slides and reuse of already loaded resources | Implemented; actual browser closure in progress |

Additional independently found issues include direct database URL bypasses (including query-host
overrides), configured live suites with zero matches, deleted-test planning, Windows Bash path
handling, unreachable historical Git fixtures, test-helper compatibility inputs, weak race
overlap, incomplete fixture cleanup, copied advisory-lock keys and stale testing instructions.

### Backend implementation notes

Daily release compatibility now runs against the only permitted healthy recovery source (`33a0054…`); the older e383/#181 round-trips are in `backend/scripts/historical/` and run on demand with `bun run test:backend:integration -- --historical`. The release fixture creates its pre-comments schema from the migration prefix before `_memory_comments`, so it exercises additive upgrade failure and retry without repeatedly installing an obsolete application. Runtime checks use real endpoints and PostgreSQL, including a second family with an unread publication.

Mock-only family unread and media lifecycle units were removed where real endpoint/PostgreSQL/storage tests cover the same guarantees. The unread fallback now injects a real database permission denial using a temporary restricted role. Outbox due selection, fresh lease exclusion, stale recovery, unsupported task selection, retention and concurrent claims are exercised against PostgreSQL; controlled-clock policy units remain.

Initial Linux PostgreSQL narrow execution on the isolated audit container: unread API/PG 16/16, media API/storage/PG 12/12 and outbox PG 12/12 passed. The initial comments run reported 7/7 (62 assertions, 31.61 s), but lead inspection invalidated its named SQL-failure case as explained below; it is not accepted evidence for that boundary. Backend source typecheck passed. Focused units/catalog/guard suites passed 33/33; direct integration entrypoint probes reject unsafe and missing database URLs before client construction. The first Windows Docker attempt failed before starting tests because Docker reported that all predefined address pools were exhausted. No shared Docker resources were deleted; actual DB test execution moved to the isolated Linux audit container.

### Lead handoff inspection and backend closure

The reported seven-case pass is **not accepted as complete SQL-failure evidence**: actual source
registered `sql-failure` while the branch accepts `failure-after-sql`, so that named case followed
the success path. The backend TypeScript configuration covers src, not scripts, and did not catch
this error or missing imports of the new guard in migration script fixtures. These must be fixed
and checked against the actual source before acceptance. Direct-call mode validation must fail
closed, rather than interpreting an unknown scenario as the happy path.

Lead-managed PostgreSQL execution from a new backend snapshot confirmed users 18/18 (7.08 s),
MAX capture 100/100 (9.01 s), direct video 21/21 (1.12 s). It then **failed before F12 scenarios**
because the duplicate session fixture guard requires a literal `schema=public` even when an
otherwise safe URL uses PostgreSQL's public default. The family audit was not reached in that
command. Log: ignored `.scratch/backend-lead-pg.log`. The F12 guard was corrected and its
narrow checks passed; no broad rerun of the three passing suites was needed without a change.

Backend closure queue after infrastructure releases the shared writer:

- B1: correct the SQL-failure scenario registration and reject unknown helper modes before DB work.
- B2: import the shared guard in every changed script fixture; src-only typecheck is not script evidence.
- B3: allow the public default schema in F12 while rejecting an explicitly different schema.
- B4: scope advisory waiter observations to the current database, so another test database cannot supply evidence.
- B5: keep the first direct-video provider call held until the second operation has actually observed the durable claim.
- B6: assert positive application-table privileges as well as forbidden privileges after the migration CLI.
- B7: use PostgreSQL SQLSTATE for the read-denial control, rather than localized error text.
- B8: remove the now-duplicated fake unknown-task selection check and avoid running legacy preservation probes in the no-admin-only case.
- B9: advance the outbox budget's controlled clock from simulated handler work, not on each clock read.
- B10: put an independent watchdog around the hanging-child timeout regression; removing the timeout under test must fail promptly rather than block the test runner itself, and its own child must be cleaned up.

These are lead inspection findings in the active change, not final independent-review results.
They were closed in the bounded backend pass documented in
[MEMOLY-TEST-BACKEND-CLOSURE.md](MEMOLY-TEST-BACKEND-CLOSURE.md). Actual final diff inspection
also caught early release in the finalize provider gate and PostgreSQL's any-privilege semantics;
the corrected race now holds the first send until the contender returns, and grants are checked
individually. Focused PostgreSQL checks passed after both corrections. Backend source typecheck,
catalog/outbox 13/13, SQL-failure/no-admin/grants controls, migration import, F12, unread SQLSTATE
and database-scoped lock observations passed. Disposable post-migration-error and timeout-removal
mutations failed at their intended boundaries and were restored.

The lead additionally ran the actual working-tree catalog and repository guard tests on Windows:
**14 PASS / 0 FAIL**, 68 assertions, 1.103 s, exit 0. This proves the nested timeout probe also
works on the supported host rather than relying only on a Linux snapshot. Whole-tree exact-SHA
acceptance remains pending.

### Infrastructure closure and refreshed mutation proof

The infrastructure worker's complete Windows tools run executed **93 PASS / 0 FAIL** in
418.28 s. A later narrow closure checked the compatibility exclusions and MM0 **25/25 PASS**,
including central fault-stage assertions, the captured production parser payload and the
actual release-to-backup handoff. The broad run predates these final changes; FULL must check
their combined source.
MM0 fixture server state now lives under its JavaScript-owned directory, so its failure EXIT
trap cannot hide a temporary-directory leak by replacing the cleanup trap.

The lead repeated controlled faults against a fresh copy of the closed infrastructure source:

| Boundary | Control | Injected defect | Restored |
| --- | --- | --- | --- |
| Caddy | 4/4 PASS, 93 ms | Ignore the real validator result: rejection test FAIL, actual activation exit 0 versus expected 42 | Validator positive/negative controls PASS |
| MM0 migration | Intended fault stage reached, PASS | Disable marker recovery: FAIL because rollback occurs and writer quiescence is absent | Intended migration recovery PASS |

The combined restored controls executed 3 PASS / 0 FAIL in 89 ms. Only the disposable copy
was mutated. Logs: ignored `.scratch/infra-final-{caddy-red,mm0-red,restored}.log`.

### Final source-review closure queue

The lead's second source pass found a remaining MM0 inline-program regex extraction and a
source-text assertion for the release-to-backup handoff. These were replaced by invoking
the actual relation/parser and release handoff through controlled process boundaries. The
release fixture also copied the full fingerprint algorithm despite having a production helper
available; frozen-source checks now invoke the production helper.

The controlled timeout test's temporary module-override seam was removed after its negative
proof, so routine verification always imports the actual runner. Direct-video tests now settle
their first in-flight operation before fixture cleanup even if a contender assertion fails.
The frontend cache fixture now returns a valid same-family response; a mismatched setup ID
cannot manufacture the expected rejection before access switches. These are active-change
inspection findings, not evidence of production incidents or completed independent review.

The final timeout test now always imports the actual runner. The lead copied that exact test,
runner and dependencies into a new disposable directory and removed the inner timeout there:
control **1 PASS** (1.041 s), mutant **1 FAIL** at the independent `ETIMEDOUT` watchdog
(3.02 s), restored **1 PASS** (1.044 s). Its marked child is stopped in `finally`. The source
checkout was unchanged; logs are `.scratch/backend-final-timeout-{control,red,restored}.log`.

The lead's first actual Linux Chromium portfolio run executed all 36 selected journeys and
returned **FAIL: 32 PASS / 4 FAIL**, 3.0 min. Two assertions were still brittle: a role locator
excluded the correctly inert background while the comments dialog was open, and gallery URL
counts conflated legitimate background carousel prefetch with viewer reuse. Both family cases
also exposed a runner bug: worker config reload selected new ports instead of inheriting the
servers' selected ports. These require narrow closure; unchanged passing journeys will be
rechecked only in final exact-source FULL. Log: `/tmp/frontend-browser-run.log` in the owned
Linux container, copied to task evidence before teardown.

The browser closure now proves a decoded non-thumbnail full gallery image reuses its loaded
slide URL; that case passed. Comments' inert-background locator was corrected and its focused
case passed. The family server ports are inherited by worker config reloads. Owner family-switch
passed after explicit canonical chooser navigation; the final test also awaits the held response
before checking isolation. The revoke/rejoin case uses the existing supported card keyboard
reaction flow, rather than assuming a reaction button exists in v4. Final source typecheck passed;
both family journeys and changed optional gesture/avatar scenarios are being checked against
hash-matched copies. Their final results must be recorded with the PR, without treating a stale
snapshot's failures as evidence for different source.

## Retained coverage and reporting limits

The audit retained distinct MAX webhook protocol, forward-import, replay/idempotency, private
media, family ACL and concurrent-edit cases in the large suites. Repeated API endpoints do not
make these scenarios duplicates. It also retained useful units for signed init data, payload
encryption, cursor parsing, retry/deadline policy, playback ownership, stale async completion,
blob URL disposal, Service Worker private-response policy and controlled input gestures.

Removed checks pinned decorative geometry, image names, button copy, SQL call order or copied
fake persistence. Their behavior replacements and unique retained protections are described
above and in the domain reports. Historical rollback roundtrips remain available separately;
the mandatory release boundary is the current candidate and the explicitly permitted recovery
revision. No immutable deployed-image attestation was changed to accommodate a test edit.

Optional live email/S3 operations, Terraform mock-provider plans, historical Telegram scenarios,
historical rollback roundtrips and a real Docker image smoke build were source-reviewed where
listed in the inventory but were not executed as acceptance evidence. They are outside the
active MAX FULL profile. The Docker smoke unit harness remains in the unit catalog. There is
no comparable before/after whole-FULL runtime, so this audit makes no numerical speedup claim.

The final PR and handoff must record the tested clean commit/tree, complete FULL result,
independent review, actual merge SHA and production/recovery outcome. Intermediate failures
and narrow passes above are preserved for traceability and do not substitute for that
exact-source gate. A production release additionally requires FULL on its exact final main
SHA, guarded backup/recovery readiness and smoke under the existing exclusive release lock.

## Independent review and final source freeze

A fresh reviewer started from committed `077fd88e9a836c3385816336e3b6f8cdb644a2f7`
against the original base, without implementation history. The bounded correction pass fixed:

- Native avatar pool timers used the pool as their browser receiver, causing an uncaught
  `Illegal invocation` on loader release. Defaults now call the actual global timers through
  wrappers. The real browser regression is part of mandatory MAX FULL (37 journeys / 8 files).
- The avatar fixture omitted App's real family-cache invalidation boundary. It now calls
  `removePrivateFamilyCache` and proves decoded scoped images and retired URLs, allowing both
  valid epoch-cache reuse and refetch behavior. The poster locator selects user media, not an icon.
- SQL identifiers decoded from a test URL were interpolated into two fixture GRANT statements.
  A small quoted-identifier boundary now escapes embedded quotes; real integration behavior
  remains checked by FULL, while focused identifier/database-isolation units passed 9/9.
- Normal repeat releases overwrote the designated attested recovery pair with an unattested
  captured running SHA. The preparation path now invokes the actual read-only verifier before
  selection, preserves a revalidated designated target where appropriate and fails before
  canonical-file mutation if neither target is valid. Legacy and forward-only decisions retain
  captured writer tags. Two focused shell regressions passed.

The actual timer fix requires a separate exact executable compatibility attestation for the
existing immutable `33a0054` recovery artifact. Full source/image pins remain unchanged. The
new content hash is anchored to the existing reachable `dc320109` full attestation; positive
fixtures read an immutable Git blob rather than the current development source. Test-only
changes still do not require changing production attestations, and other production drift fails.

The two final targeted carousel/avatar browser specs passed (14.4 s and 3.2 s, total 21.9 s)
after SHA256-matched snapshot copy. Whole-source exact-commit FULL and publication evidence
must be read from the PR/final handoff; none of the intermediate results is presented as that gate.

Read-only production preparation confirmed current checkout/images `dc320109`, a clean host,
more than 4 GiB free, no concurrent release process, public root/live/ready HTTP 200 and existing
`33a0054` rollback-readiness PASS. No services were promoted during these preparations.

### Verification gate recovery: newly reported Storybook advisory

The first clean-commit FULL at `99588c8a386f89f173f77466e306972f58b6ca8a` stopped at
dependency audit, before unit/integration/browser stages. It found critical
[GHSA-f2ph-cmg5-wxc8](https://github.com/advisories/GHSA-f2ph-cmg5-wxc8), added to the
reviewed advisory database on October 21. This was a FAIL, not a completed FULL.
The official [10.6.2 release](https://github.com/storybookjs/storybook/releases/tag/v10.6.2)
patches the affected Storybook dev-server functionality.

The bounded recovery upgrades the four existing direct development pins from 10.5.10 to
10.6.2 and regenerates only their lock closure. No audit exception or insecure feature flag
was added. Inspection found no unrelated production dependency version change; existing
magic-string versions were re-hoisted for the upgraded Storybook graph. Dependency audit
and both webapp/website Storybook builds passed. Existing website module-directive warnings
do not represent a build failure. The same independent reviewer checks this narrow delta and
the required exact compatibility content attestation; full immutable recovery pins remain intact.
The new manifest/lock fixture inputs are frozen blobs, not the changing current revision.
