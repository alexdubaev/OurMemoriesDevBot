# MEMOLY-CONTROL — стартовый промпт для Codex (shadcn)

Продолжай разработку **существующего** memoLy. Задача: полностью реализовать отдельную закрытую административную панель владельца сервиса, по **новому исправленному shadcn-дизайну**; прежний зелёный макет отвергнут.

Репозиторий: https://github.com/alexdubaev/OurMemoriesDevBot
Пакет: PR #207 (`docs/mvp/owner-dashboard/`), ветка `docs/memoly-control-handoff-20261022`.
Main при подготовке: `48e0d9e8c307a6958a19f6139133ba7026b63f14` — НЕ полагаться на него как на текущий.

1. Получи свежий origin/main и точную production revision, проверь активные PR и чужие worktree. Прочитай `AGENTS.md`, `.agents/skills/teamlead-development/SKILL.md`, `docs/DEPLOYMENT.md`, `deploy/selectel/README.md`.
2. Если PR #207 открыт, проведи обязательные применимые docs checks/независимое review и штатно интегрируй его по AGENTS.md; docs-only deploy не нужен. Затем создай task worktree от нового main. Не переключай грязной чужой работы и не форсируй ветку.
3. Прочитай `README.md`, `SPEC.md`, `DESIGN_SHADCN.md`, `DATA_MAP.md`, `PLAN.md`, `VERIFICATION.md` и референсы. Применяй новое оформление, а не отвергнутый архив.
4. Реализуй самостоятельный `/control/` React/Vite entry, owner-only API с точным server allowlist и MAX browser-link login. Обычный владелец семьи и admin без allowlist не видят общие данные.
5. Подключи реальные списки семей/пользователей, поиск, detail sheets, безопасный CSV; пользователей считать по User.id, членства/сессии/приглашения отдельно.
6. Подключи реальные metric sources PostgreSQL, media, host, MAX binding, health/release, с `source/status/observedAt/coverage`. Нет источника = «не настроен», а не ноль/зелёный статус; disk+DB+backup не суммировать.
7. Введи минимальное наблюдение человеческой активности в синтетически проверенных пределах, не собирая частные медиа, тексты, IP, токены; не рисуй историю до начала измерений.
8. Реализуй UI с Sidebar, Card, Table, Sheet, Command, графиками Recharts, светлой/тёмной темами и мобильной навигацией. Не копируй standalone React18/runtime/demo data, не меняй UI v4.

Работай максимально автономно: минимальные real integration tests + UI browser checks → независимое review → bounded fix → PR → squash merge → FULL на итоговом SHA → штатный guarded production deploy → public/owner/nonowner smoke и recovery. Новое правило #209 о коротких frontend-only выпусках для этой задачи **не подходит**, ведь меняются auth/backend/data. Разрешённая точная rollback attestation при доказанной совместимости — часть задачи; guards не обходить. Не останавливаться на MERGED, если штатный выпуск разрешён.

Если действительно нет полномочий, производственных credentials или подтверждения конкретного owner identity, подготовить безопасный checkpoint и задать владельцу один короткий вопрос, не запрашивая секреты в чате. Продолжить ту же задачу после ответа. Итог: ссылка на живую панель, SHA, PR, числа тестов, реально подключённые источники, ограничения.