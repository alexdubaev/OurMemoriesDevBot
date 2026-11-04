# Memory proposal — Telegram auth-only launch restore

- Scope: the owner-assigned Telegram login restoration permits auth-only use. `TELEGRAM_AUTH_BOT_TOKEN` is independent of `TELEGRAM_ENABLED=false`; Telegram message startup, webhook, polling, Telegram message workers and capture stay disabled. Auth resolves auth-only token or legacy token; conflicting values are invalid. Treat any broad Telegram exclusion as overridden only for this login task. No broader Telegram support change.
- Config pointer: optional variable name is `TELEGRAM_AUTH_BOT_TOKEN` (also document in both `.env.example` files and operator docs); never store or repeat secret values. Keep signed init-data verification, session/identity boundaries, family ACL and private media checks intact.
- Blind acceptance commands/results were on clean Linux clone `091d01453fc3c8a6396393cf4f8fb997d35f7804`, synthetic fixtures and isolated `memoly_telegram_blind_test` only:
  - `bun install --frozen-lockfile --ignore-scripts` — PASS.
  - With `NODE_ENV=test`, `TEST_SKIP_DOCKER=1` and matching loopback `TEST_DATABASE_URL`/`DATABASE_URL` for that isolated DB: `bun run --cwd backend prisma:generate && bun run --cwd backend prisma:deploy` — PASS.
  - `bun test backend/src/telegram-auth-only.test.ts backend/src/modules/auth/infrastructure/telegram-init-data.test.ts` — PASS, 11/11.
  - `bun run --cwd backend test:integration -- src/modules/auth/telegram-auth.integration.test.ts` — PASS, 3/3.
  - `bun run --cwd backend typecheck` — PASS.
  - With unique `E2E_BACKEND_PORT=53801`, `E2E_WEB_PORT=53802`, `E2E_SKIP_DOCKER=1`, Chromium at `/opt/playwright`: `bunx --no-install playwright test --config webapp/e2e/telegram-auth-only.playwright.config.ts` — PASS, 1/1.
- Acceptance limits: real existing-bot token/identity, production promotion, physical iPhone and Telegram Desktop were not independently verified. Do not conflate synthetic MAX video journey with Telegram-hosted video. The canonical FULL on clean source `091d01453fc3c8a6396393cf4f8fb997d35f7804` passed on Linux Node24/Bun; runtime/device facts remain separate from synthetic acceptance.
- AGENTS already contains `Правка без автопилота` and `История git` sections with pointers/commands; no new pointer is needed. No explicit blanket Telegram exclusion appears in current AGENTS; the scoped task override is recorded above.
