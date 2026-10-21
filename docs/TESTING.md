# Testing memoLy

Tests protect observable behavior, access control, data and recovery contracts. A correct
implementation rewrite should not require changing assertions about CSS, decorative assets,
private helpers or SQL call order. Preserve distinct negative and concurrent cases.

## Local verification profiles

The supported release/audit command is:

```bash
bun run verify:full
```

Run from the repository root with Bun 1.4.0, Node, Git, installed dependencies, Chromium and
local PostgreSQL infrastructure. The runner records the source SHA and working-tree fingerprint
before and after execution. Evidence belongs to that source. There is no hosted CI or deploy step.

| Command | Scope |
| --- | --- |
| `bun run verify:local` | Classifies changes against origin/main and selects the required profile. |
| `bun run verify:fast` | Documentation, styles and raster assets; patch checks and affected frontend builds. |
| `bun run verify:standard` | Scoped source changes; affected packages, nearby tests and architecture boundaries. |
| `bun run verify:full` | Cross-cutting, auth/ACL/private-data, release and test-infrastructure changes. |

A requested profile cannot downgrade the risk classification. FULL runs architecture/dependency
checks, typechecks, lint, production builds, repository/Selectel tools, MAX/neutral contracts and
backend units, frontend/website units, PostgreSQL integrations and configured MAX/PWA browser
journeys. Each command appears once. The tools suite already owns verification-runner tests.
See [the actual plans](../scripts/verify-local.mjs).

Missing infrastructure, zero selected files, skipped required tests, unrecognized summaries and
failed child processes are failures. Declared historical Telegram exclusions are checked
explicitly. Optional provider contracts and inactive hosting plans are separate signals.
A dry run or syntax-only check does not replace required execution.

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
