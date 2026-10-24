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

- [ ] Merge origin/main into existing task branch, preserving published history.
- [ ] Resolve App, composer, albums, feed and private-cache conflicts by combining both behaviors, never bulk ours/theirs.
- [ ] Preserve current main's generic autopilot tooling/status; keep child specification and task records and add an accurate children progress record.
- [ ] Confirm additive schema/contracts and chronological migrations; generate Prisma client normally.
- [ ] Run typecheck, architecture check and focused children/wishlist browser and contract boundaries as applicable.

Allowed paths: merge-conflicted files plus directly coupled existing children/wishlist consumers/tests. Forbidden: secrets, unrelated worktrees, existing migrations' semantics, release guards.

## 2. Close confirmed first-stage defects

- [ ] Reproduce upload/deleted-child behavior before fixing it; keep invalid-child failures distinct from retryable provider failures and preserve safe publication/idempotency.
- [ ] Verify expired uploads do not indefinitely block profile removal; protect valid in-flight targets without introducing schema churn.
- [ ] Apply established avatar retirement/quota lifecycle on profile removal when safe and proven by integration tests.
- [ ] Correct child-filter 404 recovery and family-wide unread count presentation; preserve family-access-loss handling.
- [ ] Restrict multi-child management to the accepted UI version while preserving the one-child path.
- [ ] Add only valuable real-PostgreSQL regressions and short browser scenarios; run each narrow check after its fix.

Allowed paths: families and max upload application/infrastructure/tests; gifts repository and its integration tests for the live-child seam; children memory/feed tests; family/feed/cache UI and relevant browser tests; task documentation. Lead adjudicates data, ACL, concurrency and idempotency choices before worker changes.

## 3. Verify, review and release

- [ ] Run `bun run verify:local --profile full --base 954640d34f73103a577b497ec237c7701fcfad56` in isolated Linux on exact committed candidate; record command, source SHA, exit status and test counts.
- [ ] Run targeted children journey and visually inspect relevant mobile screens; protect wishlist/album integration.
- [ ] One fresh independent review of entire PR diff, original specification and current main. One bounded fix pass for confirmed P0/P1/P2 followed by narrow closure checks.
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
