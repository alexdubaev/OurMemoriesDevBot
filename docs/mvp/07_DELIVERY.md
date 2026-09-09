# Проверки, ревью и выпуск
Канонический GitHub repo: `alexdubaev/OurMemoriesDevBot`; SSH `git@github.com:alexdubaev/OurMemoriesDevBot.git`, HTTPS `https://github.com/alexdubaev/OurMemoriesDevBot.git`. `origin` обязан быть одним из них; см. [REPOSITORY.md](REPOSITORY.md). Vibe — только read-only template source.

Нормативные правила Git находятся в корневом `AGENTS.md`, порядок в `TASK_INDEX.md` и `PARALLEL_WORK.md`. Этот документ не утверждает, что удалённый CI уже настроен.

## Профили проверок
| Изменение | Обязательный минимальный набор |
|---|---|
| Только docs | Markdown links, scope consistency, пути файлов |
| UI карточка | компонент/логика, web typecheck, targeted visual, затронутый journey |
| Контракты | validators + backend producer + frontend consumers + typecheck |
| Auth/семьи | unit + real DB auth/IDOR + revoke/role integration + session browser flow |
| Медиа | storage contract + HEAD/Range/permissions + quota/retry/delete + browser playback |
| Schema/migration | migration test на чистой и существующей тестовой БД + зависимые домены |
| Worker/бот | retry/idempotency/late message/permissions + реальная локальная DB |
| Shared config/unknown | безопасное расширение вплоть до FULL; явно объяснить |
| Релиз | FULL активных surfaces + ручной Telegram iOS/Android + restore smoke |

Точные команды взяты из реально установленного Vibe и записаны в REPO_MAP/verification-map.json этапом00. Не устанавливать лишние будущие SDK, не запускать неактивные website/mobile pipelines. `verify:plan` выдаёт план, а не доказательство.

## Воспроизводимость
Pin upstream SHA, Bun, lockfile, контейнерные digest после проверки. Тестовые среды отделены от разработки и production. Для двух worktrees отдельные порты/БД/Compose project; teardown удаляет только ресурсы своего run. Не `docker compose down -v` для общего стека.

## Отчёты
`../../templates/review/BLOCK_REPORT.md` — отчёт текущей задачи; `../../templates/review/RELEASE_REPORT.md` — выпуск. Локальные изменения, наличие PR, merge и deployed — разные статусы. Не приравнивать готовую документацию к готовому коду.

## Развёртывание
Перед пилотом владелец выбирает регион/сервер/домен и утверждает расходы. Reverse proxy/TLS, backend, worker, PostgreSQL и приватное media storage. Backend и worker могут использовать один образ с разными entrypoints; это не микросервисы на каждый домен.
Из staging в production продвигать тот же проверенный image digest и web artifact. Один мигратор, журнал выполненных миграций, health/readiness, алерт на возраст очереди и ошибки удаления. Production bot token отдельный. Rollback previous digest без автоматического отката БД; destructive restore только по отдельному плану с оценкой потери новых данных.
