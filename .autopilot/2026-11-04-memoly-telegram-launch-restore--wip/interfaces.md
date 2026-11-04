# Границы, решённые в спецификации

## Task identity

MEMOLY-TELEGRAM-LAUNCH-RESTORE; base f70448a0a0156697fbe1b6e98d0214efe655c271; branch feat/telegram-launch-restore-20261104; owned worktree D:/codex/TG_OurMemoriesDevBot/worktrees/memoly-telegram-launch-restore-20261104. Existing canonical dirty main и чужие worktrees не изменять.

## Project rules

Current AGENTS.md + docs/development/SMALL_CHANGE_WORKFLOW.md + docs/TESTING.md apply. Telegram exclusion is overridden only for owner-assigned login restoration. Bun/Hono/Prisma, React/Vite, existing contracts and provider-scoped ExternalIdentity stay. No account linking, migrations, dependency upgrades, webhook registration, bot messages or production fixture membership. FULL for auth/config changes; existing release gates and rollback safeguards unchanged. User explicitly authorizes implementation/isolated verification/commit/PR/merge/safe deployment; no repeated permission ritual for already authorized actions.

Из carried.md: «Докер и образы перенесены на диск D; всё необходимое искать и делать на D». «Одна задача, ветка и implementation PR, один общий выпуск. Никаких промежуточных production этапов.» Accepted album stories/permissions/navigation are retained; unrelated previous-run work is not resumed.

## Configuration/auth seam

- env.ts owns optional `TELEGRAM_AUTH_BOT_TOKEN`. Presence opts in existing auth without message lifecycle; `TELEGRAM_ENABLED` semantics and validation for message-only keys stay intact.
- Auth composition resolves the auth-only token or existing legacy bot token. Differing simultaneous values are invalid. No new public token field or endpoint.
- Existing verifyTelegramInitData(raw, {botToken, now}) and TelegramAuthService exchange contract unchanged; signed provider subject -> ExternalIdentity -> User -> AuthSession. No runtime network identity check for auth-only mode.
- telegram-startup.ts, telegram module/webhook/polling must remain disabled when TELEGRAM_ENABLED=false. No worker/capture side effects.
- .env.example/backend .env.example and targeted deployment/operator documentation describe only variable names and safe mode. No secret values.

## Session/family/media boundaries

Existing /api/v1/auth/telegram and refresh API remain. Frontend auth/epoch, host bridge and family UI are reused; change only if actual regression is proven. Family ACL uses current userId membership per request; Telegram and MAX subjects remain distinct. Photos/private media and MaxVideo routes retain bearer/SW and short-lived media-cookie auth, GET/HEAD/Range guards and provider CDN validation. No CDN URLs/secrets in DTO/browser.

## Test seams

Existing commands: install only locked existing dependencies with `bun install --frozen-lockfile`; focused backend tests `bun run --cwd backend test:integration -- src/modules/auth/telegram-auth.integration.test.ts` with isolated matching TEST_DATABASE_URL/DATABASE_URL and TEST_SKIP_DOCKER=1. Focused unit `bun test backend/src/telegram-auth-only.test.ts backend/src/modules/auth/infrastructure/telegram-init-data.test.ts`. Backend typecheck `bun run --cwd backend typecheck`. New journey uses its dedicated existing-style Playwright config. Final lead check command is `bun run verify:local --profile full --base f70448a0a0156697fbe1b6e98d0214efe655c271 --reason "Restore protected Telegram auth-only runtime configuration and signed session exchange"`; this is a real FULL, not syntax-only or dry-run. No new check wrapper or classifier exception. Source/task owns all isolated services; no production variables in local tools.

Real isolated PostgreSQL and public routes for config/auth/replay/session/identity/family/media integration. Synthetic secrets only. Existing focused scripts, no mock Prisma evidence for protected persistence. A short dedicated Telegram browser journey can use existing verification-server safeguards and synthetic MAX CDN fixture; the UI/auth path must execute instead of mocked successful login. New tests should prevent unique failures, not inspect source text.

## Delivery ownership

Subagent owns all project code/tests/config/docs in explicit ticket allowlist. Root owns .autopilot artifacts, git integration, verification orchestration and protected operational configuration handling. Root never prints/copies token into repo, tests, prompt, image or arguments. Protected runtime alias token is sourced only from the preserved existing-bot secret. Original source file stays intact. Rollback env compatibility is proved before production mutation. Canonical host entrypoint, disk/host lock/image/source/readiness/migration-history/recovery checks stay required.
