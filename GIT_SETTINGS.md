# Git and GitHub settings

## Observed bootstrap state

- Canonical repository: `alexdubaev/OurMemoriesDevBot`
- Fetch/push origin: `https://github.com/alexdubaev/OurMemoriesDevBot.git`
- Default branch: `main`
- First push: `f2731e02547fb1118e233c99c47b4ec7c5fc8ba6` was pushed to an empty remote without force.
- Template comparison remote: `vibe-template` fetches `https://github.com/di-sukharev/vibe.git`; its push URL is disabled.

## GitHub and publication verification

The remote was readable and push permission was confirmed by the first normal push. GitHub Actions CI/CD is disabled and removed from this repository. Main retains PR and branch protections, without a required Actions status check.

Before publication to `main`, including PR merge, run `bun run verify:local` on the exact source SHA/tree. The diff selects FAST for cosmetic/docs changes, STANDARD for ordinary development, and FULL for auth/session/ACL/private media/data/contracts/infrastructure; unknown paths require FULL. `--profile fast|standard|full` may raise but cannot lower that minimum. Record the profile, reason, command, result, and environment limits. Install the local pre-push hook with `git config core.hooksPath .githooks`; it verifies a clean matching source and applies the same classification to main/master pushes against their remote old SHA. PR merges do not execute local hooks. After merge, record the merge SHA and confirm it contains the verified product source; a docs/metadata-only difference does not require rerunning unchanged product checks.

Before production deployment, run FULL on the exact combined release SHA, preserving backup, readiness, migration, health and Selectel safeguards. FULL needs Linux/Bash, Bun 1.4.0, Node.js >=22.12.0, Docker, and Playwright Chromium. An isolated PostgreSQL may be supplied through `TEST_DATABASE_URL` with a `*_test` name and `TEST_SKIP_DOCKER=1 E2E_SKIP_DOCKER=1`. Only MAX Bot, MAX Mini App and Web/PWA with MAX authentication/browser-link are acceptance platforms; historical integrations are retained outside the required test catalog.

No production deploy, automatic merge, webhook registration, or cloud resource creation is configured by this block.
