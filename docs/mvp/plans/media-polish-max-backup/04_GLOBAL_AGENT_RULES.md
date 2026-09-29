# Global agent rules

## Models
Implementation:
- GPT-6 Sol
- medium
- non-Pro

Reviewer:
- GPT-6 Luna
- high
- read-only

Global:
**maximum ONE Luna High reviewer simultaneously across memoLy.**

## Routine delegation
Main Sol owns task.

Delegate when useful:
- inventory;
- component/API search;
- CSS/token mapping;
- test discovery;
- constants/copy search;
- provider endpoint inventory;
- evidence;
- CI inventory;
- read-only logs.

Do not routine-delegate:
- architecture;
- data model;
- security/ACL;
- migration semantics;
- production data;
- complex race/idempotency.

No nested subagents.

## GitHub autonomy
Owner pre-authorizes for code tasks:
- branch/worktree;
- commit/push;
- PR;
- CI;
- routine subagents;
- one queued Luna High review;
- bounded fixes;
- fresh-main reconciliation;
- autonomous squash merge if green.

## Merge criteria
1. acceptance complete;
2. affected tests green;
3. verify-required green final HEAD;
4. Luna complete;
5. unresolved P0/P1/P2 = 0;
6. fresh-main reconciliation complete;
7. post-reconcile checks green;
8. PR mergeable;
9. no new escalation category.

## Escalation
Only new unresolved:
- architecture;
- data model;
- security/ACL;
- migration semantics;
- production data;
- complex race/idempotency;
- contradiction with locked owner decisions.

## Production
CAR-1/PERF-1/MAX-1/INT-1 are CODE-ONLY unless separate owner deploy authorization.

## Handoff
One fenced text block.
After HANDOFF: STOP.
