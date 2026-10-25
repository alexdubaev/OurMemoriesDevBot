{
  "status": "complete_local_task1",
  "task": "CONTROL-USER-DELETE / Task 1",
  "base": "6de40cf28cfac11f477e0d87eede6a49af1ff446",
  "head": "90ccbf1a9c6e6f7eba0903d41a893865fb0043bf",
  "branch": "feat/control-user-deletion",
  "worktree": "D:/codex/TG_OurMemoriesDevBot/worktrees/control-user-deletion-20261025",
  "commits": ["14f3460d", "6af262fc", "98fa0a69", "8928b90b", "069f6768", "e544907f", "d91447c2", "01c92580", "c0d3d03e", "0a5f0879", "5799b302", "1e3f3078", "cde6d99c", "8e64f9a6", "90ccbf1a"],
  "files_changed": [
    "backend/prisma/migrations/20261025160000_control_user_lifecycle/migration.sql",
    "backend/prisma/schema.prisma",
    "backend/src/modules/auth/application/ports.ts",
    "backend/src/modules/auth/application/telegram-auth-service.ts",
    "backend/src/modules/auth/domain/user.ts",
    "backend/src/modules/auth/infrastructure/auth-repository.ts",
    "backend/src/modules/control/control-lifecycle.integration.test.ts",
    "backend/src/modules/control/infrastructure/control-lifecycle.ts",
    "backend/src/modules/families/application/family-service.ts"
  ],
  "tests": [
    {"command": "run-linux.sh 90ccbf1a9c6e6f7eba0903d41a893865fb0043bf t1-final2-90ccbf1a task1", "result": "PASS", "details": "11 passed, 0 failed, 50 assertions; Ubuntu WSL2, isolated PostgreSQL 18 *_test DB; includes lifecycle, overlapping restore, DB fences, memory FK race, late restore lock wait, browser race, exact DST deadline, irreversible family purge guard"},
    {"command": "run-linux.sh 90ccbf1a9c6e6f7eba0903d41a893865fb0043bf t1-type-90ccbf1a typecheck", "result": "PASS", "details": "workspace typecheck; 0 errors (one existing deprecation hint)"},
    {"command": "git diff --check", "result": "PASS"}
  ],
  "interfaces": {
    "previewUserDeletion": "(db, userId, protectedIds) -> UserDeletionPreview {targetId,targetVersion,state,families,activeFamilies,members,memories,storageUsedBytes,fingerprint,confirmation}",
    "previewFamilyDeletion": "(db, familyId) -> FamilyDeletionPreview {familyId,targetVersion,state,members,memories,storageUsedBytes,fingerprint,confirmation}",
    "trashControlUser": "(db, {actorId,targetId,protectedIds,key,fingerprint,confirmation}, optional now) -> LifecycleResult & {deletionId,purgeAfter}",
    "restoreControlUser": "(db, {actorId,targetId,protectedIds,key,deletionId}, optional now) -> LifecycleResult",
    "purgeControlFamily": "(db, {actorId,familyId,key,fingerprint,confirmation}, optional now) -> LifecycleResult"
  },
  "decisions": [
    "Account deletion records every owned family with original status and restore eligibility; inactive legacy families remain inactive on restore, while their data remains in the operation scope.",
    "Access snapshots are independent of deletion cycle and remain pending across overlapping user/family trash until both are active. Explicit member removal cancels snapshots, including idempotent removal; subsequent legitimate rejoin refreshes the snapshot metadata.",
    "Control user locks use FOR NO KEY UPDATE before family locks; auth fences serialize only session insertion, binding changes, or reactivation. Existing live refresh writes do not acquire the authority lock.",
    "UTC grace is 2,592,000 seconds with exact epoch CHECK. Service writes ISO timestamps cast to timestamptz; real trash test passes under Europe/Berlin across DST.",
    "Configured Control owner IDs protect account trash, not explicit owner-family purge. Database restore exception permanently rejects families with separate ControlFamilyDeletion intent. Family purge is staged; physical cleanup is out of Task 1."
  ],
  "risks": [
    "Task 1 exports service APIs only; Control transport routes/UI and physical media/object cleanup remain later phase work.",
    "Existing family cleanup behavior does not remove ready originals merely because family status is deleting. Task 2 must preserve ready/not-deleted originals across the grace window for all linked families, including legacy inactive families; previously deletion-marked media is outside this restore archive."
  ],
  "blockers": [],
  "publication": "Local commits only; not pushed, reviewed, merged, or deployed. Unrelated dirty docs/superpowers/plans/2026-10-25-control-deletion.md was left untouched."
}
