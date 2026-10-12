# FIX-PWA-RUNTIME-WITNESS

## Scope and source

Task: FIX-PWA-RUNTIME-WITNESS, continuation of FIX-PWA-INTERFACE-LOSS.
Base: `1be08daaad914de13233150d5bbbdc6e88651553`.
Branch: `fix/pwa-runtime-witness`.
Worktree: `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/pwa-crash-diagnostics`.
Lead: GPT-6; delegated implementation: GPT-6 Luna high; independent review: fresh GPT-6 Luna high.
Allowed product paths: diagnostics bootstrap, its public Worker, diagnostics unit tests and existing PWA browser scenario. This report records acceptance evidence.

The owner requested a proper interceptor after another physical iPhone 18.7 standalone incident on build `index-BL6nEPD2.js`. The previous run was mounted, authenticated, cache hydrated and root present at its last recorded observation. This does not establish memory exhaustion, a native crash, navigation or a media-triggered failure. Existing observations execute on the same main thread whose loss must be investigated.

## Concrete hypothesis and implementation

A separate classic Worker probes the mounted visible application, correlates run ID and probe sequence, and records an unanswered main-thread probe independently. Worker timer lateness is recorded separately as `monitorGap`; after suspension a fresh acknowledgement is required. Neither observation is labelled an operating-system crash or OOM. Root missing/empty/startup-placeholder incidents remain separate from application loading; document time origin and persisted page lifecycle are included.

Persistence uses a preopened native OPFS synchronous access handle. Its own 16 KiB file has two alternating 8 KiB slots, generation/checksum validation and synchronous write, flush and readback. It retains at most two runs. Hidden/pagehide releases the exclusive handle; unavailable APIs, storage denial and an occupied handle are explicit optional-diagnostics states. Reports remain synchronous for clipboard user activation, sanitize metadata and are capped at 8192 UTF-8 bytes. There is no automatic reload, interaction delay or change to media rendering, business rules, database, ACL, MAX storage or Telegram.

An initial IndexedDB design was rejected by an actual Windows WebKit full-application experiment: a healthy periodic write waited during the main-thread stall, timed out, and disarmed the monitor before evidence was recorded. Its completion occurred after the main thread resumed. Increasing a timeout would not establish independent persistence. No IndexedDB fallback is shipped.

## Verification evidence before release

All logs below are local ignored artifacts in this worktree.

- Baseline: `.scratch/pwa-runtime-witness-baseline-valid.log`. The same real application fixture used the exact base diagnostics bootstrap (Git blob `407562cc6ec0d231cdc1898c74989cd33d3f7ffa`); waiting for the new witness failed as expected, exit 1. An earlier baseline invoked from the wrong checkout is excluded from evidence; it was not a product edit.
- Native primitive: `.scratch/pwa-runtime-opfs-chromium.log`, 1 pass. During an 18-second main-thread busy loop the Worker synchronously wrote, flushed and read back 104 bytes; a fresh Worker reopened the same bytes.
- Final real-application scenario: `.scratch/pwa-runtime-witness-opfs-final-gap.log`, Chromium 1 pass, exit 0. Native evidence readback occurred inside the 18-second main-thread block. Reload recovered the same immutable run/evidence identity. A later readback timestamp may advance when that evidence is reread.
- Separate controlled conditions: Worker-only suspension produces neutral monitor-gap evidence; forced absent OPFS API and a separate SecurityError produce explicit unavailable states without losing the application. `.scratch/pwa-runtime-witness-opfs-capability-chromium.log`: 2 pass, exit 0.
- Installed Windows WebKit: `.scratch/pwa-runtime-witness-opfs-capability-webkit.log`, 1 pass, exit 0. This port exposes no OPFS API; the truthful unsupported branch retained the working interface. This is not a positive persistence test or physical iPhone acceptance.
- Lead-run diagnostics/journal checks: `bun test ./webapp/tests/pwa-diagnostics.test.ts ./webapp/tests/pwa-runtime-journal.test.ts`, 20 pass, 0 fail, 130 expectations, exit 0; `.scratch/pwa-runtime-witness-lead-opfs-unit.log`. Boundaries include slot corruption/partial writes, record/report limits, unavailable storage and asynchronous-method rejection.
- Worker implementation checks: typecheck, targeted ESLint and JavaScript syntax checks passed. Final release gate below verifies the published product source.

## Independent review and final local gate

Pending at the time this source snapshot was prepared. Publication requires the actual fresh-review verdict, closure of confirmed findings and `bun run verify:local` on the exact product source. Those results will be recorded before publication.

## Remaining observation limit

This implementation supplies independently persisted main-response-gap evidence when the native storage API is available and the Worker continues running. A process termination that stops both threads cannot execute a final JavaScript handler. Unsupported or busy storage is explicitly reported. The exact physical iPhone failure remains unproved; successful desktop checks are not described as a fix for that failure.

No migrations or shared-contract changes. Rollback uses the previously deployed immutable release at `1be08daaad914de13233150d5bbbdc6e88651553`; diagnostic journal content is optional and versioned.

### Fresh independent review

`.scratch/pwa-runtime-witness-review.log` identifies the requested model `gpt-6-luna`, high reasoning, read-only CLI session; exit 0. The reviewer reported two P2 findings: asynchronous journal opening can outlive hidden/pagehide, and an overdue matching ACK can clear an expired probe before its timer callback runs. Both findings were accepted by the lead and assigned for one bounded correction with deterministic regression checks. No second whole-change review is required by owner policy. Final closure evidence is pending.

### Bounded closure

Both reviewer P2 findings were corrected: serialized generation-cancelled opening closes late handles and requires current eligibility, while overdue ACK handling preserves main-response-gap only with a timely Worker monitor. The lead also confirmed and closed an adjacent error in the same deadline path: stopProbes cleared pendingProbe before neutral-gap fields were read; the probe is now captured first.

The first closure browser run exposed a recovery regression (persisted records were not republished after a cancelled startup opening). The successful-reopen path was corrected and the same positive native/reload proof passed again, Chromium 1 pass, exit 0, 30.8 seconds. The earlier failed intermediate run is not acceptance evidence. Worker-only suspension passed in that two-case run; the final gate covers the final source again.

Lead personally ran the final narrow boundary checks: `bun test ./webapp/tests/pwa-diagnostics.test.ts ./webapp/tests/pwa-runtime-journal.test.ts`, 24 pass, 0 fail, 161 expectations, exit 0; `.scratch/pwa-runtime-witness-lead-closure-unit.log`. The seven journal tests include the exact overdue-monitor clearing boundary, late ACK with/without Worker suspension, and hidden-opening cancellation followed by visible recovery. Actual closure diff was inspected. No unresolved confirmed P0/P1/P2 remains; no second formal whole-change review was launched.
