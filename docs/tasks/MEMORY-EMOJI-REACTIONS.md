# MEMORY-EMOJI-REACTIONS

Base: `d8cdb139df8fc488fb822105a2034cb935adc763`

Branch: `feat/memory-emoji-reactions`

Worktree: `.worktrees/memory-emoji-reactions`

The owner authorized implementation through squash merge and canonical production
release. Owner smoke remains a separate reported result.

## Implementation plan

1. Evolve the existing MemoryLike table with a typed reaction and HEART default.
   Preserve its composite primary key, rows, and creation timestamps. Add a desired
   state reaction endpoint and aggregate Feed fields. Keep the legacy like endpoint
   on the same persistence path. Verify contracts, add/remove/replace/retries,
   concurrent writes, viewer permissions, and clean/upgrade migrations.
2. Integrate a shared compact reaction zone under Memory content, using Unicode
   emoji and semantic theme tokens. Provide an explicit plus picker with keyboard,
   focus, Escape, and outside dismissal. Serialize rapid desired-state requests
   per Memory and guard optimistic reconciliation/rollback against stale responses.
   Verify all five content types, all six themes, and 320/390/430 widths.
3. Run deterministic local checks, inspect the actual diff, and obtain fresh
   independent read-only review of migration, concurrency, permissions, layout,
   and accessibility. Resolve confirmed P0/P1/P2 through a worker, then fresh review.
4. Commit explicit paths, push the task branch, open PR, reconcile with freshly
   fetched main, rerun affected checks and required CI, then squash merge.
5. Use the guarded Selectel release procedure with migration enabled for the
   additive migration. Verify migration status, deployed SHA, and public health.

## Ownership boundaries

Allowed: Memory contracts, MemoryLike schema/new migration, memories module,
Feed reaction API/cache/presentation/tests, relevant acceptance docs.

Excluded: Family header, member profile, membership access, ACL, participants,
seen/unread identity, unrelated root configuration and dependencies.

Stop on conflicting schema changes, unexpected secrets, unsafe migration,
unexplained dirty work, or a failed required gate. Preserve unrelated main changes
through semantic merge reconciliation; never force-push or reset.
