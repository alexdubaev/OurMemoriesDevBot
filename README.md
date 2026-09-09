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

```powershell
bun run architecture:check
bun run typecheck
bun test tests/verify-plan.test.ts
bun run build:webapp
```

`bun run verify:plan -- <changed-path>` только печатает план проверок. Он не исполняет команды и возвращает fail-safe результат для неизвестных путей.

Подробные границы MVP, архитектура и порядок задач находятся в `docs/mvp/`. Происхождение шаблона зафиксировано в [UPSTREAM.md](UPSTREAM.md); правила GitHub — в [GIT_SETTINGS.md](GIT_SETTINGS.md).
