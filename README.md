# Наши воспоминания

Закрытый MVP Telegram-бота и Mini App для одной приватной семейной ленты. В этом репозитории нет реальных семейных данных, токенов или production-конфигурации.

## Активные границы

- `backend/` — Bun/Hono и Prisma/PostgreSQL.
- `webapp/` — React/Vite Mini App.
- `packages/contracts/` — общие Zod-контракты.

Website и mobile deferred. В Block 00 не добавляются Expo, Capacitor, VK, AI, платежи, Telegram polling/webhook или media pipeline.

## Локальный запуск

Требуются Bun 1.4.0 и Docker Desktop. Создайте локальный `backend/.env` из `backend/.env.example`; не коммитьте его.

```powershell
bun install --frozen-lockfile
docker compose --env-file backend/.env up -d postgres
bun run --cwd backend prisma:deploy
bun run dev:backend
bun run dev:webapp
```

Публичная Telegram-конфигурация находится в `.env.example`. `TELEGRAM_BOT_TOKEN` и `TELEGRAM_WEBHOOK_SECRET` всегда остаются пустыми в Git. До живой интеграции backend обязан сверить токен через `getMe` с `OurMemoriesDevBot`; Block 00 этот вызов не выполняет.

## Проверки

GitHub Actions CI/CD не используется. Перед каждой публикацией в `main`, включая
PR merge, запускайте `bun run verify:local` на точном source SHA; отчёт фиксирует
команду, результат и ограничения среды. Hook `.githooks/pre-push` запускает gate
при публикации ветки `main` или `master`; включите его командой
`git config core.hooksPath .githooks`. PR merge не вызывает локальные Git hooks,
поэтому подтвердите результат перед merge отдельно. Нужны Linux/Bash, Bun 1.4.0,
Node.js, Docker и Playwright Chromium. Для изолированной тестовой PostgreSQL
задайте `TEST_DATABASE_URL` (`*_test`) и `TEST_SKIP_DOCKER=1 E2E_SKIP_DOCKER=1`.

Подробные границы MVP, архитектура и порядок задач находятся в `docs/mvp/`. Происхождение шаблона зафиксировано в [UPSTREAM.md](UPSTREAM.md); правила Git и branch protections — в [GIT_SETTINGS.md](GIT_SETTINGS.md).
