# Блок 00 — Адаптировать Vibe и зафиксировать границы

**Исполнитель:** Terra. **Ревью:** Sol — границы, auth/storage риски и план проверок.
**Зависимости:** Нет; это первая задача.
**Цель:** Получить запускаемый локальный каркас выбранного шаблона без чужих продуктовых функций и без реальных семейных данных.
**Правила работы:** корневой `AGENTS.md`; `../PARALLEL_WORK.md`; для UI также `../ASSET_GUIDE.md`.
**Спецификация:** `../00_START_HERE.md`; дополнительно прочитать: 00_START_HERE.md, 01_PRODUCT.md, 02_ARCHITECTURE.md, 06_REUSE.md, 07_DELIVERY.md, TELEGRAM_BOT_SETUP.md.
**Стек:** выбранный Vibe — Bun/Hono, PostgreSQL/Prisma, React/Vite, общие Zod-контракты.

## Границы
Этот блок — единица сдачи, но внутри выполнять маленькие шаги и сохранять контрольные результаты. Пакет содержит спецификацию; пути ниже — ожидаемые создаваемые/изменяемые файлы, не утверждение их наличия до начала. Если аналогичный файл уже существует по REPO_MAP, использовать его и указать mapping, не создавать дубль. Все пути относятся к корню проекта.

MVP: только личный бот, Telegram Mini App, четыре формата, full/viewer, семейные лайки. Без AI, групп, платежей и реализации будущих платформ. Новые семейные данные — только synthetic fixtures до приёмки закрытого пилота.

## Файлы
README.md; AGENTS.md; .env.example (или существующий backend env example с Telegram placeholders, без секретов); GIT_SETTINGS.md; CHECKLIST.md; UPSTREAM.md; REPO_MAP.md; DEPENDENCIES.md; package.json; выбранные template config; docs/mvp/ (этот комплект).

## Потребляемые и производимые интерфейсы
Производит локальные команды разработки и проверки, перечисленные в package.json. Не производит фиктивную Telegram-авторизацию.

## Порядок выполнения
1. Прочитать `../REPOSITORY.md`. Канонический repo уже задан: `alexdubaev/OurMemoriesDevBot`; SSH `git@github.com:alexdubaev/OurMemoriesDevBot.git`, HTTPS `https://github.com/alexdubaev/OurMemoriesDevBot.git`. Проверить `git remote get-url origin` и `git ls-remote origin`; `origin` должен быть одним из этих адресов, Vibe — только read-only `vibe-template`. Проверить выбранный upstream SHA и актуальные requirements Bun/PostgreSQL, сохранить Apache LICENSE/NOTICE. Если remote пустой — показать владельцу план первого `main` push и дождаться явного разрешения; если remote уже содержит историю — сравнить её и не перезаписывать.
2. Установить locked dependencies, поднять только тестовую/локальную PostgreSQL по README. Запустить и записать baseline: типы, архитектура, auth-unit/integration, webapp build. Если baseline падает — сообщить конкретно, не маскировать.
3. Активные surfaces: backend/webapp/contracts. Website/mobile deferred. Не устанавливать Expo/Capacitor/VK/AI SDK. Убрать demo-продуктовые меню из активного webapp, не удаляя полезные primitives.
4. Обновить CHECKLIST именем и scope; создать REPO_MAP с реальными путями вместо выдуманных. AGENTS описывает узкие импорты, no real data, no automatic deployment, профили проверок. Не создавать пустые слои каждому модулю.
5. Зафиксировать существующие команды проекта в REPO_MAP и выбрать проверки по изменяемой области; локальный publication gate назначается отдельной задачей и не считается существующим до реализации.
6. Зафиксировать в `GIT_SETTINGS.md` canonical repo/remotes, фактический default branch, push permission и результат чтения remote. GitHub Actions CI/CD не используется. Сохранить PR и branch protections без обязательного Actions status. Перед каждым попаданием в main, включая PR merge, выполнить локальную проверку точного source SHA командой `bun run verify:local`. Pre-push hook запускает gate для main/master pushes; PR merge не вызывает локальные hooks.
7. Зафиксировать публичную конфигурацию development-бота: `TELEGRAM_BOT_EXPECTED_USERNAME=OurMemoriesDevBot`. Перенести только пустые placeholders секретов из `templates/telegram/backend.env.example`; реальный token не просить и не коммитить. На этом блоке не вызывать `setWebhook` и не требовать живой Telegram-интеграции.
8. Сохранить registry лицензий кандидатов. Ничего не мигрировать из старого широкого ТЗ; продуктовый scope задаёт этот комплект.

## Обязательные сценарии проверки
F00.1 docs-only diff → только document/link checks. F00.2 media adapter diff → storage contract + media unit/integration. F00.3 shared contracts diff → backend + web consumers. F00.4 unknown path → явное расширение. F00.5 path/аргумент не превращается в shell injection. F00.6 build webapp без cloud credentials. F00.7 никаких native/AI jobs в pipeline.

## Проверочный цикл каждого изменения
- [ ] Найти существующие границы и перечислить затронутые файлы до редактирования.
- [ ] Для каждого сценария выше написать или уточнить тест на ближайшем подходящем уровне.
- [ ] Запустить новый тест до реализации и убедиться, что падение относится к нужному поведению, а не к случайной ошибке окружения.
- [ ] Реализовать минимальное изменение в указанном модуле, не менять контракт без согласования его потребителей.
- [ ] Запустить тот же тест, затем связанные проверки из плана области влияния.
- [ ] Проверить diff и выполнить самостоятельный review. При назначенном Sol review получить отдельный проход без опоры только на отчёт исполнителя.
- [ ] Записать команды, результаты и ограничения в отчёт по `../review/BLOCK_REPORT.md`.
- [ ] Передать владельцу результат и остановиться до следующего блока. Commit — в своей ветке, без автоматического merge/deploy.

## Команды проверки
Проверять только полезные границы; точный набор локальной publication-команды будет определён отдельной задачей.
```bash
bun run architecture:check
bun run typecheck
bun run build:webapp
```

## Что показать владельцу
Открывается локальный webapp; backend отвечает health; виден честный экран подключения, а не вымышленная рабочая семья.

## Критерий готовности
UPSTREAM SHA закреплён, baseline описан; новый проект не связан push-remote с автором шаблона; локальные команды воспроизводимы.

## Стоп-условия
Не начинать реализацию пользователей, бота и медиа. Если выбранный template runtime недоступен, сначала согласовать минимальную замену, не переписать весь стек.

Невозможность запустить обязательный тест отмечается `BLOCKED` с причиной; не заменять его проверкой синтаксиса. Успех в локальной БД не доказывает готовность production-конфигурации.
