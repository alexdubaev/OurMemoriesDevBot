# UI v2 migration ledger

Task: MEMOLY-UI-V2-PRODUCTION-MIGRATION.
Base: 329d6b9ccb7616adc6c5c75d2781db62400a5f32.
Branch: feat/ui-v2-production-migration.
Worktree: D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/ui-v2-production-migration.
Scope: start production migration and prepare full staged roadmap; no hosting/main merge in this turn.

| Block | Status | Evidence / owner |
|---|---|---|
| Repo isolation | Complete | New worktree from fetched canonical origin/main; old Lab dirty files retained |
| Source scout | Complete | Live presentation seams and six-ID preference contract mapped read-only |
| Delivery scout | Complete | Main-only production guard; no documented staging; separate origin required |
| Baseline | Complete | Frozen install; 91 tests / 578 assertions / 3 files, exit 0 |
| Spec/roadmap | Complete | SPEC.md and PLAN.md; lead owns architecture, scope and task briefs |
| UIM-01 header/flag/assets | REVIEW | First slice complete; owner acceptance of the full UI remains later |
| UIM-01 lead verification | Complete | 95 tests / 600 assertions; typecheck/lint/architecture/template; both builds + 2 contracts each; 18 browser cases and callbacks |
| UIM-01 independent review | Complete | uim01_review and fresh uim01_confirmation_review: no findings; no source fixes needed |
| UIM-02…06 | NOT_STARTED | Explicit separate tasks/worker briefs; full UI not yet migrated |
| Preview hosting | NOT_STARTED | Separate destination/runtime/auth configuration needed before actual hosting changes |
| Main merge / production deploy | NOT_STARTED | Requires current-head checks, review and owner approval after preview |

Ruling: six persisted theme IDs now represent six covers in v2 — avoid public contract changes.
Ruling: one common fixed palette applies in v2; legacy mode remains untouched during the migration.
Ruling: no production branch-deploy workaround — Selectel production remains restricted to current main.
Ruling: mode is a Vite BUILD choice, not a runtime environment switch; preview artifacts record mode/checksum.
Ruling: do not reuse production SHA image tags for different-mode builds. Before first production release,
the owner-approved activation commit changes the default; exact final ordinary-build SHA is verified again.
Ruling: after production promotion prefer the compatible previous frontend artifact or a new accepted
rollback commit; no database restore and no destructive Git history operations.

No private deployment credentials, production data, migrations or extra bot/infrastructure were created.
