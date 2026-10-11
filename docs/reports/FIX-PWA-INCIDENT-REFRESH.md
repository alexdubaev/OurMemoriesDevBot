# FIX-PWA-INTERFACE-LOSS/INCIDENT-REFRESH

Base: `8fb522c32e7a9eca6faf00826ad77e8025feb1a4`; branch `fix/pwa-incident-refresh`; worktree `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/pwa-crash-diagnostics`. Allowed production paths are the diagnostics bootstrap and its behavioral test. Implementation delegated to Luna worker; lead owns diagnosis and verification.

## Physical report received after the watcher release

Installed PWA on iOS18.7, both current/previous build `index-DHAU24jT.js`. Owner reported white screen at23:07 MSK on2026-10-11. Failed prior run began23:06:49.954 and mounted23:06:50.171. Last root heartbeat recorded healthy at23:07:10.174; last saved activity was media-load at23:07:14.303. Root present, identity1; authenticated/notbootstrapping, cachehydrated, active/visible, error and lastFailure null. Next run began23:08:09.412. Counts at23:07:12.572:69 loaded images,0 ready videos/audio,31 blob-source elements. These do not measure bytes, decoded pixel memory or unique URLs.

The report establishes that the deployed watcher executed on the physical device before the failure. It does not establish the actual DOM or JavaScript state at the white screen. No screen-loss/root-replaced/pagehide was captured. Last saved activity is not proof of the last JavaScript instruction. A subsequent navigate timing entry does not prove spontaneous navigation during the failed run. Native process termination, renderer presentation failure, storage/recording loss, OOM and server fault remain unproved.

## Confirmed diagnostic defect

Pinned `incident` still refers to a legacy build with missing run identity and timestamps, inferred on the first new launch. Bootstrap creates inferred unclosed evidence only when no incident exists, so an old inferred incident blocks newer ones indefinitely. This stale field must not be attributed to the23:07 failure.

Correction: update inferred `previous-run-unclosed` evidence for a different latest eligible prior run; preserve actual `screen-loss` incidents, normal pagehide behavior and repeated same-source fallback evidence. Preserve bounded storage, privacy and failure isolation. No automatic reload, delay, media/auth/cache behavior, database/ACL/schema or Telegram changes. This corrects evidence attribution; it does not fix or identify the physical white-screen mechanism.

Verification and review results are recorded below.

## Actual verification and independent review

Lead baseline using the same focused new behavioral harness with base bootstrap: `bun test ./.scratch/pwa-incident-refresh-baseline.test.ts --test-name-pattern 'inferred unclosed incident refreshes'`, exit1,0pass/1fail (14filtered). Failure: expected new runId/latest observations, got legacy runId=null/build index-legacy1.js. Evidence `.scratch/pwa-incident-refresh-baseline.log`.

Lead `bun test webapp/tests/pwa-diagnostics.test.ts`, exit0,15pass/87assertions. Worker `bun run --cwd webapp typecheck`, exit0; lead inspected actual diff and `git diff --check` passed. Includes distinct runIds sharing startedAt, normal-pagehide retention, confirmed screen-loss retention and same-source fallback evidence. Evidence `.scratch/pwa-incident-refresh-unit.log`.

One fresh ephemeral read-only CLI review, gpt-6-luna/high (requested default tier, billing not independently verified): APPROVE, no confirmedP0/P1/P2. Reviewer reran15tests successfully. No second formal review. Evidence `.scratch/pwa-incident-refresh-review.txt` and `.scratch/pwa-incident-refresh-review.log`.

Publication verification on the committed source is recorded below. There are no migrations or changed shared contracts. Rollback target is the previous accepted watcher release8fb522c32e7a9eca6faf00826ad77e8025feb1a4; database rollback not required.


## Publication gate on committed product source

Source `25069e322faa13de0cf389e4953faf775b09441b`. First `bun run verify:local` exited1 because Bun1.4.0/Windows x64 process crashed with native segmentation fault0x32 during the memories PostgreSQL integration file; the gate correctly stopped before browser checks. Log `.scratch/pwa-incident-refresh-verify-local.log` retained. This local test-runner crash does not identify the iPhone WebKit mechanism.

One unchanged-source retry `bun run verify:local`: exit0, all16stages,304 nonintegration Bun tests,369 PostgreSQL integration tests and4Chromium browser scenarios; tools/Selectel guards also passed. Evidence `.scratch/pwa-incident-refresh-verify-local-retry.log`. Environment Windows PowerShell/Bun/Docker plus existing WSL bash, not native iOS. No tests skipped/quarantined or runtime/product configuration changes made to obtain the pass.

This following documentation-only commit leaves the checked product source unchanged. PR/squash SHA and actual guarded deployment outcome will be reported after execution.
