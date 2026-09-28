# Later release notes / infrastructure context

This pack does not itself authorize deployment.

Current project direction already includes a separate planned infrastructure improvement:

- CI builds immutable Docker images;
- CI installs dependencies and downloads Prisma engines;
- CI tests the exact images;
- registry stores immutable artifacts;
- production pulls exact digest;
- production runs guarded migrations;
- restart/reload;
- health/smoke.

Do not reintroduce production-host application builds as the normal path.

When mixed-media/import eventually reaches production, use the then-current release runbook and forward-fix rules.

Any new schema migrations from MM-0/HI tasks require normal guarded migration preflight.

Historical import is a production-data operation once used against real channel history. Its first real production execution must be a dedicated rollout/operation task with:
- explicit target family/child;
- read-only preview/count if implemented;
- idempotency evidence;
- owner authorization;
- bounded observation;
- no destructive cleanup.
