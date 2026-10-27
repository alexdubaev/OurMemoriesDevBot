# Testing memoLy

Tests protect observable behavior, access control, data and recovery contracts. A correct
implementation rewrite should not require changing assertions about CSS, decorative assets,
private helpers or SQL call order. Preserve distinct negative and concurrent cases.

## Local verification profiles

The default command for development and review is:

```bash
bun run verify:local --dry-run
bun run verify:local
```

Read the profile, per-path `REASON` lines and commands before execution. Dry-run exits 2 and
never establishes a PASS. “Full review” or “complete verification cycle” means the complete
cycle for the assigned change: the automatic profile, relevant scenarios and independent
review. Those phrases do not request the named FULL profile.

Run from the repository root with Bun 1.4.0, Node and Git. Install the dependencies and
browser/PostgreSQL infrastructure required by the selected plan. The runner records the source SHA and working-tree fingerprint
before and after execution. Evidence belongs to that source. There is no hosted CI or deploy step.

| Command | Scope |
| --- | --- |
| `bun run verify:local` | Classifies changes against origin/main and selects the required profile. |
| `bun run verify:fast` | Documentation, styles and raster assets; patch checks and affected frontend builds. |
| `bun run verify:standard` | Scoped source changes; affected packages, nearby tests, changed browser specs and architecture boundaries. |
| `bun run verify:full` | Cross-cutting, auth/ACL/private-data, release and test-infrastructure changes. |

A requested profile cannot downgrade the risk classification. A manual FULL upgrade above the
automatic minimum requires a concrete single-line `--reason` (at most 240 characters): an explicit
request for the named FULL profile or a sensitive risk established by review of the diff. It is
recorded in the command output and PR. Automatic FULL for known sensitive paths needs no extra
argument. Example of an explicitly requested upgrade:

```bash
bun run verify:full --reason "Owner explicitly requested the FULL profile for this change"
```

Unknown paths, unavailable classification and an empty comparison scope return `REVIEW_REQUIRED`
before any verification stage starts. Even an explicit FULL cannot bypass this state. Review the
file's role and risk, then add a narrow tested classification rule; for an empty scope choose the
intended comparison base. Unresolved scope remains a blocker. Do not whitelist a whole directory.
The progress journal `.autopilot/PROGRESS.md` is already FAST metadata; adding it to an ordinary
UI change does not raise STANDARD to FULL.

 FULL runs architecture/dependency
checks, typechecks, lint, production builds, repository/Selectel tools, MAX/neutral contracts and
backend units, frontend/website units, PostgreSQL integrations and configured MAX/PWA browser
journeys. Each command appears once. The tools suite already owns verification-runner tests.
See [the actual plans](../scripts/verify-local.mjs). Verification/release tooling remains a
critical FULL boundary. Production FRONTEND scope/receipts and deployment guards are separate
from merge verification and are unchanged by this policy.

STANDARD runs each existing changed `webapp/e2e/*.spec.ts` or `*.max-e2e.ts` through its dedicated
basename config, the Control config, or a recognized MAX config. The exact file is passed to
Playwright; the dedicated family-audit config avoids the portfolio's `MAX-FULL:` filter. Deleted
specs are omitted and renamed specs use their existing new path. An unmapped spec/config blocks
planning with `REVIEW_REQUIRED`; zero/skipped journeys cannot pass. FULL retains its existing
portfolio and also includes these changed journeys, so requesting more checks cannot omit the
changed scenario. Relevant scenarios not represented by changed specs remain the task author's
explicit responsibility.

Missing infrastructure, zero selected files, skipped required tests, unrecognized summaries and
failed child processes are failures. Declared historical Telegram exclusions are checked
explicitly. Optional provider contracts and inactive hosting plans are separate signals.
A dry run or syntax-only check does not replace required execution.

When a check fails, first establish its relation to the diff and task. Record an out-of-scope
failure, evidence and its effect on the gate without automatically expanding the task to repair
another module. Mandatory failures remain FAIL/BLOCKED; do not skip stages or weaken assertions
to make a result green. Repeat checks when changes or findings justify them.

## Focused tests and discovery

```bash
bun run test:contracts:max
bun run test:backend:unit -- src/outbox/drain.test.ts
bun run test:backend:integration -- src/modules/media/media-access.integration.test.ts
bun run --cwd backend test:integration -- --max-only
bun run test:webapp
bun run test:website
```

`backend/scripts/test-files.mjs` discovers backend/src and backend/scripts:
`*.integration.test.*` requires PostgreSQL, `*.live.test.*` requires a deliberate provider
configuration, and other `*.test.*` files are units. Explicit file arguments must match discovered
files. MAX discovery includes new neutral suites by default, excludes declared historical/provider
suites and checks that critical categories remain represented.

Business rules, auth, ACL, persistence, idempotency, leases and concurrency use real endpoints/
services with PostgreSQL and private test storage. Assert responses and durable state. Small units
remain useful for transforms, retry/deadline policies, controlled time/state, resource lifecycle and
provider protocol handling. A fake Prisma client does not establish database locking or retention.
Coordinate races using deferred events or observed PostgreSQL lock waits, not assumed overlap.

## Database ownership and safety

The integration runner creates a unique Compose project, waits for PostgreSQL, generates Prisma,
applies migrations and executes files sequentially. Per-case/child-process bounds are exported
from `backend/scripts/test-integration.mjs`; a real hanging-child test checks termination.
Cleanup removes only its own service, named volume and network, including partial startup failures.
It never uses `docker compose down`. `TEST_KEEP_DOCKER=1` preserves that invocation for diagnosis.
Worktrees need separate ports and storage; do not run two managed invocations on one derived port.

For a separately owned disposable instance, set these variables using your shell's syntax:

```bash
export TEST_DATABASE_URL='postgresql://test_user:synthetic_password@127.0.0.1:5432/memoly_task_test'
export DATABASE_URL="$TEST_DATABASE_URL"
export TEST_SKIP_DOCKER=1
bun run test:backend:integration -- src/outbox/outbox.integration.test.ts
```

The skip flag requires an explicit URL and leaves resource lifecycle to its owner. The runner and
direct fixtures validate the input before clients, migrations or cleanup: PostgreSQL scheme,
loopback target, a database ending in `_test`, and matching DATABASE_URL if set. Legacy override
flags cannot bypass the strict integration boundary. Never use development/production data.
Migration fixtures create uniquely named child databases/roles and remove only their own names.

On Windows, investigate Docker/WSL/native-process failures. An isolated Linux runner with an owned
PostgreSQL container is valid local infrastructure: use the exact source SHA and native dependencies,
record the environment, and never remove unrelated resources. Missing infrastructure remains FAIL/
NOT RUN during recovery, not PASS.

## Browser portfolio

```bash
bun run --cwd webapp e2e:install
bun run e2e:webapp:max
bun run --cwd webapp e2e -- comments.spec.ts -g 'draft'
```

Playwright owns backend/Vite ports, database setup and scoped storage. E2E_SKIP_DOCKER=1 requires
an explicitly owned safe test database. MAX configuration selects active critical journeys.
Browser tests protect session restoration, navigation, draft/conflict behavior, private-cache
invalidation, playback, file transfer, focus and stale responses. ACL/data permutations primarily
belong to endpoint integrations. Avoid routine theme/viewport screenshot matrices, decorative
byte comparisons, fixed labels and pixel geometry. Preserve useful functionality when retiring
visual suites; targeted manual visual acceptance can supplement functional evidence.

## Optional signals and release compatibility

```bash
bun run test:storage:s3
bun run --cwd backend test:live
bun run test:terraform
bun run smoke:backend:docker
bun run --cwd backend test:integration -- --historical
```

Run live providers deliberately with authorized synthetic accounts. Partial configuration or a
configured provider with no matching discovered tests fails closed. Terraform mock-provider plans
for inactive DigitalOcean/Yandex alternatives are separate from Selectel acceptance. Docker smoke
builds an image and owns only its smoke resources.

Historical recovery probes may remain outside daily FULL when they no longer represent an allowed
release boundary. Mandatory compatibility must exercise the current candidate and actually allowed
recovery runtime against PostgreSQL, including preservation, migration and grant postconditions.
Immutable artifact attestation, compatibility evidence and mutable test fixtures are separate.
Image provenance and the prohibition on rollback to pre-v4 UI remain mandatory.

## Evidence

Record command, exact SHA/tree, platform, execution counts, exit code and meaningful timings.
Separate source review from execution and cold dependency setup from runtime. Different machines/
scopes do not establish a speedup. For important replacement tests, inject the intended fault in a
disposable copy, prove the test red for that fault, restore and rerun the narrow control.

See [the audit dispositions and evidence](mvp/review/MEMOLY-TEST-SUITE-AUDIT.md).
