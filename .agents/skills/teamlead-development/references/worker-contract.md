# Worker contract

A worker gets one bounded task.

The lead supplies:
- task id and goal
- explicit worktree/branch
- BASE SHA
- relevant files/symbols
- accepted interfaces and prior decisions
- acceptance criteria
- exact verification commands
- STOP conditions

Worker output is compact JSON with:
status, BASE/HEAD, files_changed, tests, decisions, known_risks, blockers.

The lead independently checks the diff and evidence before moving on.
