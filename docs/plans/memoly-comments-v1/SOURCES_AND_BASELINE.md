# Проверенные источники и границы подготовки

Пакет составлен после read-only чтения GitHub. Это источники существующих паттернов, а не отчёт о выполнении новых задач.

## Git и delivery

- https://github.com/alexdubaev/OurMemoriesDevBot/pull/185 — OPEN/DRAFT на момент проверки, feature HEAD a52ba972018a5f56bfe098b81489cd8889d760d4.
- https://api.github.com/repos/alexdubaev/OurMemoriesDevBot/git/ref/heads/main — main f0a4e8ba3fa174f43c661ab2a70a6b744c6543f4.
- https://github.com/alexdubaev/OurMemoriesDevBot/blob/a52ba972018a5f56bfe098b81489cd8889d760d4/AGENTS.md — правила источников, задач, проверок, data/privacy, merge и delivery.
- https://github.com/alexdubaev/OurMemoriesDevBot/blob/a52ba972018a5f56bfe098b81489cd8889d760d4/.agents/skills/teamlead-development/SKILL.md — границы задач и bounded review.

## Данные и сервер

- `backend/prisma/schema.prisma`: Memory имеет составной unique `(id, familyId)`, relations family/member, version/status/deletedAt. Новая комментарная модель — проектируется этим ТЗ.
- `packages/contracts/src/memories.ts`: MemoryDto и вложенные contracts строгие; отдельный API summaries выбран для сохранения существующих ответов.
- `backend/src/modules/memories/index.ts`: точка сборки модуля, public families/auth/idempotency dependencies.
- `backend/package.json`: текущие команды typecheck, integration, Prisma.
- `backend/scripts/test-integration.mjs`: существующая изоляция test DB и file-selectors.

Исходники по зафиксированному reference:
https://github.com/alexdubaev/OurMemoriesDevBot/tree/a52ba972018a5f56bfe098b81489cd8889d760d4

## UI

Из прочитанных текущих исходников и handoff: React/Vite/TanStack Query, MemoryCardPresentation/FeedPage, private avatar loading/crop, v4 styling и ранее исправленный long-press. Конкретные интеграционные строки агент заново проверяет на своём принятом baseline. Не копировать историческую версию целого FeedPage ради добавления callback.

## Не делалось при подготовке

Не создавались ветки и PR, не публиковались эти документы в GitHub, не менялись зависимости или продуктовый код. Новые API/schema/tests не реализованы и не запускались. Production и реальные семейные записи не изменялись; активные серверные SHA в отчёте PR заново через SSH не проверялись. Библиотека react-comments-section для реализации не выбирается.

Документы являются проектом правил реализации, в частности новых прав комментирования для Viewer и удаления чужих сообщений для Owner. Эти права не названы уже существующими.
