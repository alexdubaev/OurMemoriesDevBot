# Documented release stdin entry closure

Task: MEMOLY-TEST-AUDIT, continuation after PRs #201/#202.
Base: `34aec985adb19b1cb0f99681a92bdb82920c2f6a`.
Branch: `fix/audit-release-stdin`; same owned isolated worktree.

A local check of the documented Git-show/SSH `bash -s -- ...` transport found a
startup defect in the sourceable entry guard: Bash has no BASH_SOURCE[0] when
reading stdin, so nounset rejected the script before guarded main execution.
No SSH release or production mutation was attempted. The preceding main FULL
passed PostgreSQL (105.5 s), proving the retained-database cleanup closure, then
its remaining browser stage was deliberately cancelled once this release
candidate became obsolete. That run is NOT a completed PASS.

The dispatch now falls back to $0 only when BASH_SOURCE[0] is absent/empty.
Source imports remain quiet; direct file and documented stdin execution invoke
the same existing main. No input, ownership, lock, backup, provenance, migration,
v4, rollback or smoke guard is removed or bypassed.

A regression feeds the complete actual script to Bash stdin, with controlled
required-command availability. It must reach the specific invalid-SHA rejection
before creating a lock or any server fixture files. An unbound-variable or
missing-command failure cannot satisfy the assertions. The regression was RED
before the dispatch fix and GREEN after it. All six Selectel safety files passed
in a separate Linux clone: 76 tests, 0 failures, 31.08 s; raw log preserved.
Final independent narrow review, exact-commit verification, PR and guarded release
evidence are recorded in the PR/handoff, rather than substituted by these controls.
