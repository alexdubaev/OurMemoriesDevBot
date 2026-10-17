# Проверки, ревью и выпуск
Канонический GitHub repo: `alexdubaev/OurMemoriesDevBot`; SSH `git@github.com:alexdubaev/OurMemoriesDevBot.git`, HTTPS `https://github.com/alexdubaev/OurMemoriesDevBot.git`. `origin` обязан быть одним из них; см. [REPOSITORY.md](REPOSITORY.md). Vibe — только read-only template source.

Нормативные правила Git находятся в корневом `AGENTS.md`, порядок в `TASK_INDEX.md` и `PARALLEL_WORK.md`. GitHub Actions CI/CD не используется.

## Профили проверок

| Профиль | Когда | Минимальный набор |
|---|---|---|
| FAST | Цвета, отступы, иконки, тексты, локальный CSS, docs-only | `git diff --check`, быстрые проверки затронутого участка; production UI дополнительно собирается и при необходимости визуально проверяется |
| STANDARD | Обычные React-компоненты, формы, навигация и некритичная backend-логика | Typecheck, применимый lint/build, unit tests затронутого модуля, узкий integration/browser test по изменению |
| FULL | Auth/session, семейные роли и ACL, приватные медиа, schema/data, критические транзакции, публичные контракты и инфраструктура | Architecture, dependency audit, TypeScript/lint/build, активные MAX и платформонезависимые tests, PostgreSQL integration, MAX/Web/PWA browser journeys и Selectel safety |

Профиль задаётся наиболее рискованной частью diff. Неизвестные пути требуют FULL; `--profile` не может понизить автоматически определённый минимум. Команды `bun run verify:local --profile fast|standard|full`; dry-run доступен через `--dry-run`, показывает только план и не считается PASS. Перед merge в PR фиксируются профиль, причина, фактические команды, результат и source SHA. Pre-push hook повторно классифицирует публикуемый diff main/master относительно SHA, полученного от Git. PR merge не вызывает локальный hook, поэтому проверка на точном source SHA прикладывается отдельно. Перед production deploy запускается FULL на точном итоговом релизном SHA, который включает совместное состояние ранее слитых PR.

Текущий полный продуктовый профиль требует Bun 1.4, Node, PostgreSQL с именем `*_test`, браузерную инфраструктуру Playwright и необходимые Selectel guard dependencies. Недоступная обязательная инфраструктура означает BLOCKED/FAIL; пропущенная проверка не становится PASS. Для отдельного worktree используй отдельные тестовую БД, Compose project, порты и storage. Проверяется только MAX Bot, MAX Mini App, Web/PWA с MAX authentication и browser-link MAX. Каталог исключает `auth/telegram-auth`, Telegram-only backend modules, provider-only тесты и legacy `critical-smoke.spec.ts`; shared ACL/media fixtures запускаются на синтетическом MAX principal. Исторический код сохраняется и не удаляется ради профиля. FULL дополняет, а не отменяет backup, readiness, migration guards, health checks и другие меры релиза. Не повторяй широкие suite/review без нового изменения, ошибки или установленного риска.

## Воспроизводимость
Pin upstream SHA, Bun, lockfile, контейнерные digest после проверки. Тестовые среды отделены от разработки и production. Для двух worktrees отдельные порты/БД/Compose project; teardown удаляет только ресурсы своего run. Не `docker compose down -v` для общего стека.

## Отчёты
`../../templates/review/BLOCK_REPORT.md` — отчёт текущей задачи; `../../templates/review/RELEASE_REPORT.md` — выпуск. Локальные изменения, наличие PR, merge и deployed — разные статусы. Не приравнивать готовую документацию к готовому коду.

## Развёртывание
Перед пилотом владелец выбирает регион/сервер/домен и утверждает расходы. Reverse proxy/TLS, backend, worker, PostgreSQL и приватное media storage. Backend и worker могут использовать один образ с разными entrypoints; это не микросервисы на каждый домен.
Из staging в production продвигать тот же проверенный image digest и web artifact. Один мигратор, журнал выполненных миграций, health/readiness, алерт на возраст очереди и ошибки удаления. Production bot token отдельный. Rollback previous digest без автоматического отката БД; destructive restore только по отдельному плану с оценкой потери новых данных.
