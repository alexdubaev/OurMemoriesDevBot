# COM-1 implementation brief

Task: COM-1 only. BASE: `afdb408f8bbf22b564c86bb8d33a83261f55cc48`.
Branch: `feat/com-1-comments`; worktree: `D:/codex/TG_OurMemoriesDevBot/worktrees/com-1-comments`.
Normative comments specification: documentation commit `1b998e1a0da1fa63507cd25e8be4503919169572`, `docs/plans/memoly-comments-v1/` (read through `git show`; PR #186 remains unmerged).

## Accepted design and ownership

One implementation worker owns the COM-1 paths, including schema/contracts, under lead review. No concurrent edits of shared files. No UI, MemoryDto, auth/MAX/media behavior, dependency, lockfile, production or deployment changes. The lead owns architecture, verification, review adjudication and publication as a Draft PR; no merge.

1. Contracts and storage: strict, separately exported comment DTO/request/response schemas, including future PATCH/DELETE shapes but no handlers. Normalize CRLF and trim, count code points, reject NUL/unknown fields. A single additive MemoryComment table uses millisecond timestamps, a durable unique `(familyId, authorId, createRequestId)` marker, initial normalized payload fingerprint, composite Memory FK, and composite FamilyMember FK. Both FKs cascade on physical parent deletion. Revocation is soft and preserves history; hard account/member purge cascades comments instead of introducing a new restrictive FK. No changes to Memory data or triggers. Test the actual SQL upgrade on a synthetic isolated database and prove parent purge behavior.
2. Server path: service `list/create/summaries`, repository and routes inside memories. All active members, including Viewer, may comment. Recheck active family/member and published nondeleted Memory under row locks in transaction. Respect established user -> family -> member -> memory ordering; never acquire the feed/publication lock or update publication ordinals for comments. A memory row lock can serialize comment creation/counting and exclude concurrent Memory deletion. Bind cursors to family/memory with HMAC and exact `(createdAt,id)` position, independent of row existence.
3. Idempotency: use the existing executor with an operation scoped to family but not memory, only a comment reference in its snapshot, and a payload hash covering memory ID plus normalized body. Under its transaction, check the durable marker before insert; mismatch conflicts, a deleted marker conflicts, and replay returns the current row. Executor snapshot restore must never expose text; resolve the reference through a fresh authorized transaction after the executor, including on replay. Return 200 for both temporary and durable replay, 201 only for a new insert. Do not change global idempotency behavior.
4. Privacy and HTTP: human author from session; batched same-family membership/profile/avatar projection; no avatar for a revoked author, existing private avatar path/crop rules. edit/delete capabilities false. Reuse existing global auth/origin/rate limiting. Add explicit <=16 KiB JSON bound and comment validation 400 in the existing envelope. Comment success and failure responses, including pre-handler auth/validation failures, must carry `private, no-store`; inspect existing middleware order and use a bounded comment-specific fix if needed. Counters use a constant number of queries and skip inaccessible memories.

## Verification and acceptance

Write behavioral contract and PostgreSQL tests first. Establish baseline/red on a functioning isolated database, then implement. Cover every mandatory scenario in COM-1, especially concurrent duplicate create, durable replay after temporary records are cleared, changed payload/memory conflict, stale replay after edit/deletion/revocation, membership revoke/Memory delete races, composite FKs, >50 equal-timestamp keyset pagination, batch query count, legacy Memory contracts and unchanged publication/unread state.

Target commands (root):

```sh
bun test packages/contracts/src/comments.test.ts
bun run --cwd backend test:integration src/modules/memories/comments.integration.test.ts src/modules/memories/comments-idempotency.integration.test.ts
bun run --cwd backend typecheck
git diff --check
```

Use the existing integration runner and its own disposable test dependencies; never reuse another checkout's DB/storage. The worktree-derived PostgreSQL port is 36824 and S3 port 27364. Do not inherit external database/storage overrides. Add only necessary test catalog/fixture or architecture allowlist changes with explicit reason. Generated Prisma client uses the existing generation command.

After targeted green and actual diff inspection, create the implementation commit, run the required existing `bun run verify:local --profile full` on the exact clean source SHA, and record real results. One independent read-only review, one bounded confirmed-finding fix pass and one narrow closure check. Preserve a truthful blocked gate if mandatory infrastructure or baseline failures cannot safely be resolved within scope. No repeated global runs without a new failure/change/risk.

STOP/escalate: unresolved security, purge, lock ordering, race or migration ambiguity; need to change auth policy/MemoryDto/dependencies/production; unexpected dirty files or conflicting ownership. Do not invent infrastructure or broaden COM-1.
