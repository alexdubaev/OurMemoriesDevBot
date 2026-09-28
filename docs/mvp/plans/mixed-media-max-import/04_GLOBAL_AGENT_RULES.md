# Global agent execution rules for this pack

Every task in this pack inherits these rules.

## Main implementation model

- GPT-6 Sol
- reasoning effort: medium
- non-Pro

## Independent reviewer

- GPT-6 Luna
- reasoning effort: high
- read-only
- non-Pro

At most one Luna reviewer simultaneously.

## Start of every task

The main agent must:

1. read current `AGENTS.md`;
2. `git fetch origin --prune`;
3. determine actual fresh `origin/main`;
4. use actual fresh main even if a task file contains an older informational SHA;
5. create a separate branch/worktree;
6. inspect real code before implementing;
7. use owner decisions in this pack unless fresh code proves a direct contradiction.

## Routine subagent delegation

Delegate genuinely separable low-risk/read-only/mechanical work when useful:

- inventories;
- code searches;
- test discovery;
- CSS/component mapping;
- provider docs audit;
- static/accessibility audit;
- migration inventory;
- evidence/screenshots;
- logs/health read-only checks;
- docs consistency.

Main agent remains owner and verifies subagent output.

Do not routine-delegate:

- architecture;
- data model;
- security/ACL;
- migration semantics;
- production data;
- complex race/idempotency.

No nested subagents.

## Autonomous GitHub integration

Owner pre-authorizes each task agent to:

- push its task branch;
- create/update its PR;
- act as integrator of its own task PR;
- squash merge autonomously when all gates pass.

Do not stop at `PR_READY` merely to ask the owner for merge permission.

Merge only if:

1. task acceptance is complete;
2. relevant tests pass;
3. `verify-required` passes on final HEAD;
4. Luna review completed;
5. unresolved P0/P1/P2 = 0;
6. fresh-main reconciliation completed;
7. affected checks after reconciliation pass;
8. PR is mergeable;
9. no new escalation category exists.

## Escalation

Only stop for a genuinely new unresolved issue involving:

- architecture;
- data model beyond owner-locked decisions;
- security/ACL;
- migration semantics beyond owner-locked decisions;
- production data;
- complex race/idempotency;
- direct contradiction of owner-approved requirements.

Do not ask the owner routine implementation questions.

## Production

Implementation task merge authorization is **not** production authorization.

Unless a task explicitly says otherwise:

- no production deploy;
- no production migration execution;
- no production data mutation;
- no feature-gate change;
- no webhook change.

## Handoff format

Every final task handoff must be exactly one copyable fenced `text` block.

All factual handoff content belongs inside that one block.

The main agent summarizes subagent results; do not send separate subagent handoffs to the owner.

After final handoff, stop. Do not start the next Task ID automatically.
