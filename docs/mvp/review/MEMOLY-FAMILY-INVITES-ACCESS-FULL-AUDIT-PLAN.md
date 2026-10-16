# MEMOLY-FAMILY-INVITES-ACCESS-FULL-AUDIT — execution plan

Base / fresh main: `e383d79269a3595f4c6cabedf167335aea042cf3`.
Branch: `fix/family-invites-access-audit`.
Worktree: `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/family-invites-access-audit`.

## Boundaries

Only MAX and browser/PWA with MAX authentication are acceptance evidence. Historical platform suites are excluded, including the existing critical smoke suite. No changes to ACL policy, schema/migrations, auth/media architecture, channel bindings, subscriptions, or production data. No merge/deploy. Source discovery and production checks are read-only. Only one implementation worker writes in this worktree at a time.

Disposable database: task-labelled Docker container `memoly-family-audit-pg18-20261016`, loopback port `56550`, database `memoly_family_audit_test`. Explicit TEST_DATABASE_URL and DATABASE_URL are required on every DB command. The database was created for this task; all 48 existing migrations applied successfully. No implicit local environment URL is used. Synthetic media remain in ignored task-local storage.

Allowed paths: `backend/src/modules/families/application/family-service.ts` (expiry predicate and owner-approved video capability), new MAX-only family integration tests and `test-support/`; `webapp/src/App.tsx`, supported MAX/browser methods in `features/auth/{api.ts,provider.tsx}`, `features/family/{FamilyScreen.tsx,InvitationScreens.tsx,api.ts,model.ts}`, `features/memoly-ui/{FamilyPresentation.tsx,AddSheetPresentation.tsx}`; new dedicated MAX E2E config/fixtures/tests, two narrow frontend boundary tests; this report/plan and synthetic screenshots. Any newly confirmed defect outside these paths requires a lead scope ruling; forbidden architecture/schema/platform boundaries remain unchanged.

## Outcomes and acceptance

1. Trace family/invite/member/media APIs and UI controls. Record actual role matrix and video policy with file/PR evidence. The owner explicitly resolved the conflict during this task: **Owner and Full may upload video; capabilities/UI must agree with the server**. Keep the existing server requireFull rule, project canPublishVideo for ready full memberships, and verify full non-owner and viewer paths separately. This later direct decision supersedes the earlier uncertainty and does not authorize owner-only video restrictions.
2. Reproduce R1–R5 before fixes. Worker owns narrowly necessary App/family UI/API/helper files and the expired-invite predicate in FamilyService. Add behavioral regression coverage, demonstrate failures, implement minimal changes, rerun those tests. No membershipEpoch semantic change; no automatic mutation retry after an uncertain result; no repeated automatic invite acceptance from the terminal-error recovery action. Existing accepted browser-flow behavior is preserved.
3. Add a separate MAX audit integration/E2E suite with actual API, PostgreSQL, private filesystem storage and real application components. Cover viewer/full acceptance, old history, multi-family isolation, role changes, expired/revoked/used invites, retry ambiguity, access revocation/rejoin, conditional/ranged media requests and relevant concurrent transactions. Existing unsupported-platform tests are neither adapted nor counted.
4. Lead inspects diff and runs targeted deterministic checks, type checks and browser journeys with explicit disposable DB settings. A single fresh independent reviewer reviews the full diff. One bounded fix pass and narrow closure check if warranted.
5. Produce report with matrices, exact commands/counts/exit codes, evidence limits and physical-device checklist. Commit explicit paths, push task branch, create draft PR with repository template and attach it. Local full publication gate is required before any later merge to main; this task does not merge.

## Stop conditions

Unexpected origin; foreign dirty changes; non-disposable DB; secrets in tracked history; fix requiring forbidden architecture/ACL/schema changes; non-fast-forward push. Physical MAX iPhone/Android acceptance cannot be replaced by desktop emulation. Production metadata is read-only and must exclude tokens, private links, user content and family identifiers.
