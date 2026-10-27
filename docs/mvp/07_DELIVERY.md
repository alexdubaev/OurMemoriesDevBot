# Проверки, ревью и выпуск
Канонический GitHub repo: `alexdubaev/OurMemoriesDevBot`; SSH `git@github.com:alexdubaev/OurMemoriesDevBot.git`, HTTPS `https://github.com/alexdubaev/OurMemoriesDevBot.git`. `origin` обязан быть одним из них; см. [REPOSITORY.md](REPOSITORY.md). Vibe — только read-only template source.

Нормативные правила Git находятся в корневом `AGENTS.md`, порядок в `TASK_INDEX.md` и `PARALLEL_WORK.md`. GitHub Actions CI/CD не используется.

## Профили проверок

| Профиль | Когда | Минимальный набор |
|---|---|---|
| FAST | Цвета, отступы, иконки, тексты, локальный CSS, docs-only | `git diff --check`, быстрые проверки затронутого участка; production UI дополнительно собирается и при необходимости визуально проверяется |
| STANDARD | Обычные React-компоненты, формы, навигация и некритичная backend-логика | Typecheck, применимый lint/build, unit tests затронутого модуля, узкий integration/browser test по изменению |
| FRONTEND | Только presentation-only изменения из строгого allowlist, весь diff относительно работающих backend/frontend SHA; решение владельца 2026-10-22 | Frontend typecheck/lint/build, узкие тесты, выполненный короткий browser journey и целевая визуальная проверка; guarded static-only promotion и точный frontend recovery |
| FULL | Auth/session, семейные роли и ACL, приватные медиа, schema/data, критические транзакции, публичные контракты и инфраструктура | Architecture, dependency audit, TypeScript/lint/build, активные MAX и платформонезависимые tests, PostgreSQL integration, MAX/Web/PWA browser journeys и Selectel safety |

Профиль задаётся наиболее рискованной частью diff. Неизвестные пути блокируют запуск с `REVIEW_REQUIRED` до независимого разбора и узкого проверенного правила классификации; `--profile` не обходит этот блокер и не понижает известный чувствительный минимум. Команда по умолчанию — `bun run verify:local`; перед запуском прочитай `--dry-run` с причинами по путям. Ручное повышение до FULL требует конкретного `--reason`; «полное ревью» само по себе таким основанием не является. STANDARD включает изменённые браузерные сценарии. Канонические подробности: [TESTING.md](../TESTING.md). отдельный строгий FRONTEND-путь запускается с `--profile frontend --base <работающий backend SHA> --journey <существующий E2E>`. Его scope gate не допускает backend, auth/ACL/API, приватные медиа, зависимости, build/deploy и неизвестные пути. Dry-run показывает только план и не считается PASS. Перед merge в PR фиксируются профиль, причина, фактические команды, результат и source SHA. Pre-push hook повторно классифицирует публикуемый diff main/master относительно SHA, полученного от Git. PR merge не вызывает локальный hook, поэтому проверка на точном source SHA прикладывается отдельно. Перед production deploy на точном итоговом SHA применяется FRONTEND для доказанного presentation-only выпуска, FULL для остальных runtime-изменений. Сравнение охватывает все ещё не выпущенные PR относительно фактического production. Правило и команды: [AGENTS.md](../../AGENTS.md), [Selectel runbook](../../deploy/selectel/README.md).

Текущий полный продуктовый профиль требует Bun 1.4, Node >=22.12.0 (Astro), PostgreSQL с именем `*_test`, браузерную инфраструктуру Playwright и необходимые Selectel guard dependencies. Недоступная обязательная инфраструктура означает BLOCKED/FAIL; пропущенная проверка не становится PASS. Для отдельного worktree используй отдельные тестовую БД, Compose project, порты и storage. Проверяется только MAX Bot, MAX Mini App, Web/PWA с MAX authentication и browser-link MAX. Каталог исключает `auth/telegram-auth`, Telegram-only backend modules, provider-only тесты и legacy `critical-smoke.spec.ts`; shared ACL/media fixtures запускаются на синтетическом MAX principal. Исторический код сохраняется и не удаляется ради профиля. FULL дополняет, а не отменяет backup, readiness, migration guards, health checks и другие меры релиза. Не повторяй широкие suite/review без нового изменения, ошибки или установленного риска.

## Воспроизводимость
Pin upstream SHA, Bun, lockfile, контейнерные digest после проверки. Тестовые среды отделены от разработки и production. Для двух worktrees отдельные порты/БД/Compose project; teardown удаляет только ресурсы своего run. Не `docker compose down -v` для общего стека.

## Отчёты
`../../templates/review/BLOCK_REPORT.md` — отчёт текущей задачи; `../../templates/review/RELEASE_REPORT.md` — выпуск. Локальные изменения, наличие PR, merge и deployed — разные статусы. Не приравнивать готовую документацию к готовому коду.

## Развёртывание
Перед пилотом владелец выбирает регион/сервер/домен и утверждает расходы. Reverse proxy/TLS, backend, worker, PostgreSQL и приватное media storage. Backend и worker могут использовать один образ с разными entrypoints; это не микросервисы на каждый домен.
Из staging в production продвигать тот же проверенный image digest и web artifact. Один мигратор, журнал выполненных миграций, health/readiness, алерт на возраст очереди и ошибки удаления. Production bot token отдельный. Rollback previous digest без автоматического отката БД; destructive restore только по отдельному плану с оценкой потери новых данных.
