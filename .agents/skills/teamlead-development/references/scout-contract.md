# Scout contract

The scout is read-only. It should return a compact map, not source dumps.

Required fields:
- repo_state: worktree, branch, head, dirty
- scope_summary
- entrypoints: path, symbol, reason
- files: path, role, symbols, why_relevant, confidence
- data_flow: from, to, description
- tests: path, covers
- constraints
- unknowns

The lead should normally receive enough information to narrow first-party inspection to roughly 5–15 files, not the entire repository.
