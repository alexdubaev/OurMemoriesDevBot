# Наши воспоминания

Закрытый MVP memoLy: MAX Bot, MAX Mini App и Web/PWA с MAX authentication для одной приватной семейной ленты. В этом репозитории нет реальных семейных данных, токенов или production-конфигурации.

## Активные границы

- `backend/` — Bun/Hono и Prisma/PostgreSQL.
- `webapp/` — React/Vite Mini App.
- `packages/contracts/` — общие Zod-контракты.

Поддерживаемая платформа — MAX; browser-link и Web/PWA используют MAX authentication. Исторический код других мессенджеров сохранён вне действующей разработки и приёмки. AI, платежи и новые платформы не входят в MVP.

## Локальный запуск

Требуются Bun 1.4.0 и Docker Desktop. Создайте локальный `backend/.env` из `backend/.env.example`; не коммитьте его.

```powershell
bun install --frozen-lockfile
docker compose --env-file backend/.env up -d postgres
bun run --cwd backend prisma:deploy
bun run dev:backend
bun run dev:webapp
```

MAX-конфигурация находится в `.env.example`. `MAX_BOT_TOKEN`, `MAX_WEBHOOK_SECRET` и `MAX_INBOX_ENCRYPTION_KEY` всегда остаются пустыми в Git. Исторические интеграции других мессенджеров не входят в действующую приёмку; их код не удаляется этой задачей.

## Проверки

GitHub Actions CI/CD не используется. Перед публикацией в `main`, включая
PR merge, запускайте `bun run verify:local` на точном source SHA: профиль выбирается
автоматически по риску diff. FAST — косметика/документация, STANDARD — обычная
разработка, FULL — auth/session/ACL/private media/data/contracts/infrastructure.
`--profile fast|standard|full` может повысить профиль, но не понизить требуемый.
Перед production deploy обязателен FULL итогового совместного release SHA плюс
существующие release safeguards. Отчёт фиксирует профиль, причину, команду,
результат и ограничения среды. Hook `.githooks/pre-push` запускает тот же выбор
при публикации ветки `main` или `master`; включите его командой
`git config core.hooksPath .githooks`. PR merge не вызывает локальные Git hooks,
поэтому подтвердите результат перед merge отдельно. Для FULL нужны Linux/Bash,
Bun 1.4.0, Node.js >=22.12.0, Docker и Playwright Chromium. Для изолированной тестовой PostgreSQL
задайте `TEST_DATABASE_URL` (`*_test`) и `TEST_SKIP_DOCKER=1 E2E_SKIP_DOCKER=1`.

Подробные границы MVP, архитектура и порядок задач находятся в `docs/mvp/`. Происхождение шаблона зафиксировано в [UPSTREAM.md](UPSTREAM.md); правила Git и branch protections — в [GIT_SETTINGS.md](GIT_SETTINGS.md).
