# Children stage 1 completion plan

> Agentic execution: teamlead-development with sequential bounded Luna High workers and one independent read-only review. Owner verification policy overrides repeated formal review loops.

**Task:** MEMOLY-CHILDREN-STAGE1, continuing PR #231.
**Goal:** Complete the accepted several-children experience and publish only after actual required checks pass.
**Spec:** `.autopilot/2026-10-23-children-linked-families/spec.md`; stage 2 remains deferred.
**Architecture:** Preserve Bun/Hono/Prisma, React/Vite and existing family isolation. Keep additive child tags, legacy anchor, optimistic tag version and opt-in response fields. Preserve current main's wishlist and album functionality.
**Initial PR HEAD:** 80808fee7d8f5c889e52a2b02ad5958f1dc48ff4.
**Integration base:** origin/main 954640d34f73103a577b497ec237c7701fcfad56.
**Branch/worktree:** feat/children-linked-families / .worktrees/children-families. This is continuation of the same task/PR, not a new feature branch. Untracked `.claude/` belongs to prior work and must remain untouched.

## Constraints and acceptance

- Only stage 1; no linked families, sharing or new dependencies.
- One-child families retain their existing flow and automatic server-side tags.
- Owner manages profiles; Full members tag memories; tags never extend media or mutation permissions.
- No destructive migration, real-data test, secret disclosure, guard bypass or unrelated cleanup.
- Shared schema/contracts/composition changes require lead acceptance. No concurrent source writers.
- FULL required because schema, privacy boundaries and persistence change. Missing infrastructure is NOT RUN, never PASS.

## 1. Integrate current main

- [x] Merge origin/main into existing task branch, preserving published history (846ff5ae).
- [x] Resolve App, composer, albums, feed and private-cache conflicts by combining both behaviors, never bulk ours/theirs.
- [x] Preserve current main's generic autopilot tooling/status; keep child specification and task records and add an accurate children progress record.
- [x] Confirm additive schema/contracts and chronological migrations; generate Prisma client normally.
- [x] Run typecheck and architecture check plus focused composer/cache/wishlist tests; browser integration remains in final acceptance.

Allowed paths: merge-conflicted files plus directly coupled existing children/wishlist consumers/tests. Forbidden: secrets, unrelated worktrees, existing migrations' semantics, release guards.

## 2. Close confirmed first-stage defects

- [x] Reproduce upload/deleted-child behavior before fixing it; keep invalid-child failures distinct from retryable provider failures and preserve safe publication/idempotency.
- [x] Verify expired uploads do not indefinitely block profile removal; protect valid in-flight targets without introducing schema churn.
- [x] Apply established avatar retirement/quota lifecycle on profile removal when safe and proven by integration tests.
- [x] Correct child-filter 404 recovery and family-wide unread count presentation; preserve family-access-loss handling.
- [x] Restrict multi-child management to the accepted UI version while preserving the one-child path.
- [ ] Add only valuable real-PostgreSQL regressions and short browser scenarios; run each narrow check after its fix.

Allowed paths: families and max upload application/infrastructure/tests; gifts repository and its integration tests for the live-child seam; children memory/feed tests; family/feed/cache UI and relevant browser tests; task documentation. Lead adjudicates data, ACL, concurrency and idempotency choices before worker changes.

## 3. Verify, review and release

- [ ] Run `bun run verify:local --profile full --base df03a3730ad77e94ab65db687cacbc0058768371` in isolated Linux on exact committed candidate; record command, source SHA, exit status and test counts.
- [ ] Run targeted children journey and visually inspect relevant mobile screens; protect wishlist/album integration.
- [ ] One fresh independent review of entire PR diff, original specification and current main. One bounded fix pass for confirmed P0/P1/P2 followed by narrow closure checks.
- [ ] Extend the existing children compatibility probe to the designated accepted v4 recovery runtime 33a0054c3c71372aa5509ee8ebfa4578ad512ea1; verify multi-child/attachment tags and soft-deleted profile data across current -> frozen recovery -> current. Retain the existing album and gift-photo recovery probes.
- [ ] Register the measured final executable-input hash under the existing exact target/image/source-anchor checks, with a narrowly extended wishlist migration catalog validator. Combined catalog is exactly 56 migrations: existing 53 baseline + wishlist + gift-photo guard + children. The deployed 55 set already contains the later-timestamped gift-photo guard, so it is not an ordered prefix of the new sorted catalog. Guarded pre-SQL may recognize the existing explicit 53/54/55 states and final56; complete mode must require the exact candidate catalog (56 for children). Missing/extra/modified/duplicate/unfinished rows and unauthorized phases must still fail closed. Existing 55-catalog sources keep their original checks. No mutable descendant allowlist or changed historical pin.
- [ ] Fetch main; merge any new source changes and repeat only affected checks with exact-SHA evidence.
- [ ] Update PR evidence, publish task branch, mark Ready and squash merge only when mandatory gates pass; verify main SHA/tree.
- [ ] Apply exact-final-release FULL requirement and Selectel guarded release with host lock, backup/migration/recovery safeguards and smoke. No direct Compose promotion or database restoration.
- [ ] Confirm deployed source/images/manifest, safely synchronize local main without touching unrelated untracked files, delete only owned clean temporary resources when permitted.

## Review focus

Cross-family/deleted-child references; concurrent child removal and video publication; memory tag idempotency and unread ordering; family-access loss versus stale child filter; wishlist and direct-album-photo behavior after conflict resolution. Migration rollback compatibility must preserve accepted UI v4 and existing data.

## Ledger

- Initial inventory: main checkout has unrelated untracked review files/worktrees; feature has only unrelated untracked `.claude/`. No cleanup authorized.
- SSH BatchMode/strict-host-key read-only access succeeded; Docker and WSL Ubuntu are available. Isolated Linux prerequisites are being prepared without production changes.
- Current main includes wishlist and follow-ups through 954640d3. A read-only merge preview identifies 11 conflict paths; no schema/contract conflicts in the preview.

### Lead rulings after focused investigation

- Reserve/delete race: reservation must validate the live same-family legacy anchor inside its persistence transaction under the existing family/child lock ordering. A preflight check outside that transaction is insufficient. Preserve session idempotency and existing provider send/recovery logic; no schema extension is needed.
- Selected tags arrive at video finalization, so an unpersisted UI selection cannot be protected by the legacy session anchor. Reject a removed selected child as a non-retryable not-found target, including deletion during provider I/O. Preserve the recorded provider message/outbound source so a corrected retry does not resend. Do not convert this into a generic provider 503 or block unrelated children indefinitely.
- Expired uploads: use expiry as well as active state when checking whether profile deletion is blocked. Publication still validates live targets transactionally; test the race rather than assuming state cleanup has already run.
- Removed profile avatar: apply the existing retired-avatar/outbox lifecycle, with immediate private-media denial and quota reclamation by the existing physical-delete worker. Do not directly rewrite quota or destroy unrelated originals. Test failed/replayed deletion and photo-only edit conflicts.
- Wishlist integration: soft deletion must refuse while gifts still reference that child. Wishlist list/create must select the oldest live child. Use existing child/family locks and regressions for both serializations; no new wishlist behavior, contract or data migration.
- Filtered unread UI: preserve access to the unread view but do not label a family-wide total as the selected child's count. Use a count-free existing unread label on filtered lists, retaining the total for the all-family feed; no new count API.
- Stale child filter: deterministic 403/404 responses should not wait through transient-network retries. Preserve real family-access-loss behavior and add targeted browser coverage for family removal and child-album 404.
- Legacy UI: gate the multi-child section at the existing UI-version boundary; production v2 behavior and existing single-child header remain intact.
- Read-only production inventory: backend df03a3730ad77e94ab65db687cacbc0058768371; frontend/clean checkout 954640d34f73103a577b497ec237c7701fcfad56. Final FULL must cover the deployed backend range. Disk was 4,779,100 KiB available at inventory, not a release-readiness guarantee.
- Integration evidence before 846ff5ae: typecheck PASS; architecture PASS (856 files); composer/cache/gifts boundaries 27 tests / 84 assertions PASS. Lead caught omitted current-main photo-upload guards in the first provisional resolution; worker restored them and reran typecheck plus composer tests (9 tests / 20 assertions PASS). The actual diff was rechecked before commit. An earlier temporary UTF-8/Vite failure was repaired; browser acceptance is still pending.
- Test infrastructure: isolated PostgreSQL `memoly-children-stage1-pg` on localhost:25630; only synthetic `*_test` data. Source-safe Linux clone and pinned runtimes are prepared separately. Backend worker owns narrow database checks while active.
- Linux prerequisite closure: actual Node 22.23.4, Bun 1.4.0 and Chromium 151.0.7922.34 verified. A CRLF on the helper script's final exec line was diagnosed and normalized; no product source or guard was changed for this infrastructure issue. Use `setpriv --reset-env --reuid 1000 --regid 1000 --groups 986` to retain correct user HOME without overriding reserved variables. Linux clone is clean; exact historical commits and Git archive prerequisites are present. Final source sync is via Git from the canonical Windows common object store, without publishing unverified code.
- Backend safety evidence: expired-upload regression failed 409 versus expected204 before the fix. Final narrow PostgreSQL runs passed children-api 16 tests/87 assertions, direct-video-child-tags 9/41, gifts12/257; backend typecheck and architecture PASS. Real lock-wait tests exercise deletion/reservation ordering and gift creation; provider-I/O deletion regression verifies corrected retry sends once. Lead inspected four source diffs and regression assertions. A temporary orderly shutdown of the task PostgreSQL interrupted one attempt before tests; only the owned container was restarted, then the combined narrow check passed. FULL remains pending.
- Infrastructure root cause: WSL shut down while idle between Windows commands, stopping its PostgreSQL container cleanly. A persistent task-owned WSL session now holds the distro open during checks; no daemon, socket, production, or authentication policy was changed.
- Browser configuration: use the existing `playwright.max.config.ts` synthetic verification server. The base configuration starts provider identity validation and cannot use synthetic signing credentials. No authentication bypass or provider change is needed.
- Browser regression found during integration acceptance: `AlbumsPage` had replaced current main's capability-based direct-upload predicate with `Boolean(child)`. Existing family albums support photo upload before a child profile is completed. Restore the main predicate; preserve the test's real no-child setup and verify the failing browser scenario rather than changing the fixture to conceal the regression.
- UI narrow evidence: 36 unit tests / 97 assertions, webapp typecheck, changed-path lint, build and diff check passed. Correct MAX browser run passed 17 of 19 scenarios, including all six children scenarios, direct album-photo publication and all five gift journeys. The two failed existing album scenarios exposed the capability regression above; their closure is pending. Lead visually inspected fresh 390px family-feed, selected-child, per-photo tag editor and grouped-albums screenshots from 2026-10-25; readable layout and accepted gift navigation remain present.
- Album closure: after restoring the existing capability predicate, the two failed scenarios and direct-photo/central-Add journey passed (3/3, exit0, 29.7s). Other children/gift scenarios were not redundantly repeated. UI source is frozen for the recovery fingerprint; the recovery worker owns only disjoint release/probe paths and now receives the task database.
