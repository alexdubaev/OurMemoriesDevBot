# COM-2 implementation brief

Task COM-2 only; BASE 88062393a4a6dafa8a7a292900f458e12ebbf621.
Branch feat/com-2-comments; worktree D:/codex/TG_OurMemoriesDevBot/worktrees/com-2-comments.
Spec: docs/plans/memoly-comments-v1 at documentation commit 1b998e1a0da1fa63507cd25e8be4503919169572, read via git show; COM-1 accepted in main through #187. Owner explicitly authorizes squash merge after green gates and forbids production migration/deploy.

## Accepted design

Extend existing comment ports/service/repository/routes, no new subsystem/schema/migration. Preserve COM-1 create/read/summaries, MemoryDto, auth policy, MAX/media/UI/feed/reactions. One worker owns the implementation allowlist; no concurrent shared-file edits.

1. Transactional owner source: existing lockScope returns whether locked active family.owner_user_id equals actor. Preserve user -> family -> active member -> published nondeleted Memory lock order, then comment update. Use existing Memory FOR UPDATE for mutations (as create does), scoped target lookup and atomic version predicate; do not introduce feed/global locks or change transaction isolation.
2. Authorization: all active roles may edit/delete own; only actual family Owner deletes foreign; no actor edits foreign. Check scope/memory and target before operation permissions. Determine capabilities inside same transaction from actor/owner. Use existing forbidden 403 ROLE_FORBIDDEN, invisible 404 NOT_FOUND, 409 VERSION_CONFLICT and existing conflict mapping; no new envelope.
3. PATCH: {body,expectedVersion}, existing schema normalization/strictness; atomic version increment, server updatedAt, unchanged authorId/createdAt/create marker/hash. Deleted target =>409 CONFLICT; invalid input400. Return current comment plus summary, status200.
4. DELETE: existing numeric positive If-Match required, applies to live row. Atomically clear body, set deletedAt/updatedAt server time and increment version once, retaining original create marker/hash. Already deleted row returns200 {deletedId,summary} after current scope/Memory and author-or-Owner permission checks; stale valid If-Match does not block authorized tombstone replay. Never return tombstone body. Later old POST must return current edited row or existing409 IDEMPOTENCY_CONFLICT after delete, including after snapshot expiry/cleanup.
5. PATCH/DELETE use existing auth/origin/rate-limit, private no-store and <=16KiB body limit. New routes must actually match requireAuth/body-limit middleware including commentId suffix. Add OpenAPI403 response and version/conflict descriptions. Do not log bodies.
6. Tests: own/foreign role matrix including cross-family Owner isolation; strict requests/If-Match/status/privacy; successful server dates/version and unchanged publication fields; stale conflicts; double delete; old POST replay after real PATCH/DELETE with and without temp record; deterministic edit/edit, edit/delete, revoke/write and Memory-delete/write in both relevant lock orders using PostgreSQL blockers/observed lock waits, not random sleeps. Assert no resurrection/count corruption and after completed revoke no successful mutation. Check existing Memory/family/user physical purge leaves no orphan comments; soft revoke preserves history. Change purge code only for a proven new defect.

## Implementation sequence and verification

Baseline native Linux on clean BASE: comment contracts4pass/0fail; COM-1 integration11pass/0fail. Evidence outside repo /root/memoly-com2-verification/evidence.
- Tests first, meaningful red with functioning PostgreSQL. Commit tests checkpoint, transfer source through Git bundle to isolated Linux verification clone and run exact-file selectors.
- Implement minimal design, update COM-1 capability expectation only where product behavior intentionally changes, register both new suites in existing MAX integration catalog and its fixture arrays. Test all four comments integration files + contracts/catalog/typecheck. Inspect actual diff.
- Commit final implementation, one fresh independent GPT-6 Luna High review of COM-2 BASE..HEAD and relevant joins with COM-1. One bounded fix pass/narrow closure if needed.
- Run risk classifier FULL on exact clean final HEAD using existing bun run verify:local --profile full; all19 required stages must pass. No extra broad runs without a new failure/change/risk.
- Fetch and confirm main; if advanced, safe merge and relevant checks. Push task branch, PR evidence with expected HEAD; ready + squash merge when gates green, confirm main tree/source relationship and merge SHA. No production. Retain evidence outside repo; safely remove own clean worktree/branch only after confirmed merge, no force-delete.

Linux verification: WSL2 Ubuntu native ext4 root, existing verified Bun1.4/Node24 tools; own repo/Compose project memoly-com2-linux, test DB *_test literal127.0.0.1, memory cap1GiB and nonoverlapping task subnet10.251.188.0/24. Frozen lockfile, no dependencies changed. Never reuse other test containers/DBs or touch foreign worktrees.

Allowed: comment-service.ts, comment-ports.ts, prisma-comment-repository.ts, comment-routes.ts, comment-errors.ts; two new comments mutations/races integration suites; bounded comment fixture/COM1 expectation adjustments; integration runner/catalog fixture registration; this plan. Contracts only for a proven local defect, otherwise unchanged.
STOP for unapproved architecture/data model/security decisions, unexpected dirty ownership, need for production or scope expansion; investigate routine technical problems autonomously. Do not start COM-3/4.
