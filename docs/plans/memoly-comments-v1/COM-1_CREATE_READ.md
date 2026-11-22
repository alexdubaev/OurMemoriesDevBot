# COM-1 — данные, создание и чтение комментариев

**Цель:** рабочий серверный путь «создать → прочитать → получить счётчик» без дубликатов и межсемейных утечек.
**Архитектура:** комментарии — небольшой набор файлов внутри существующего модуля memories, не отдельный сервис. Общие схемы в contracts, существующие auth/family/idempotency механизмы, одна новая таблица PostgreSQL.
**Стек:** действующие Bun/Hono/Prisma/PostgreSQL/Zod. Версии не обновлять.
**Спецификация:** `00_START_HERE.md` + `01_COMMON_REQUIREMENTS.md`.
**Зависимости:** принятый актуальный main; UI v4 для этого этапа не требуется.
**Не входит:** PATCH/DELETE реализация, интерфейс, MAX changes, deployment.

## Поверхность изменений

Создать:
- `packages/contracts/src/comments.ts`, `comments.test.ts`;
- `backend/src/modules/memories/application/comment-service.ts`;
- `backend/src/modules/memories/application/comment-ports.ts`;
- `backend/src/modules/memories/infrastructure/prisma-comment-repository.ts`;
- `backend/src/modules/memories/transport/comment-routes.ts`, `comment-errors.ts`;
- `backend/src/modules/memories/comments.integration.test.ts`;
- `backend/src/modules/memories/comments-idempotency.integration.test.ts`;
- один каталог additive migration под `backend/prisma/migrations/` с фактическим новым timestamp.

Минимально изменить:
- `backend/prisma/schema.prisma`: MemoryComment, обратные relations, необходимые индексы;
- `packages/contracts/src/index.ts`: экспорт новых схем;
- `backend/src/modules/memories/index.ts`: сборка сервиса и подключение новых routes;
- только необходимые существующие test fixtures/architecture allowlists, если того требует штатное подключение, с объяснением каждого изменения.

Generated Prisma client получать штатной командой. Не менять generated code вручную. Не трогать MemoryDto, root dependency manifests, lockfile, auth-политику или инфраструктуру. Интегратор — единственный владелец общих schema/contracts файлов; не поручать их двум агентам одновременно.

## Интерфейсы следующему этапу

Произвести общие CommentDto/CommentSummary и схемы всех описанных в общей спецификации запросов, включая формы PATCH/DELETE для COM-2. Не создавать фиктивные PATCH/DELETE endpoints. Пока эти действия не подключены, возвращать `capabilities.edit/delete = false`; право create/read уже реальное.

Сервис реализует `list(scope, memoryId, query)`, `create(scope, memoryId, input, idempotencyKey)`, `summaries(scope, memoryIds)` с типизированными результатами по общему контракту. DTO и callbacks не содержат server secrets. В handoff зафиксировать фактические экспортируемые имена и route mounting.

## Порядок выполнения

- [ ] Проверить Git/права на task-ветку и прочитать относящиеся к задаче существующие Memory routes, idempotency executor, семейные locks и schema. Не читать весь архив истории.
- [ ] Написать контрактные тесты текста 0/1/2000/2001 code points, Unicode-эмодзи, CRLF, пробелы, NUL, неизвестные поля, лимиты batch/page, приватные avatar paths.
- [ ] Написать PostgreSQL integration tests перечисленных ниже сценариев; подтвердить baseline/red через реальное отсутствие функции, не через неработающую БД.
- [ ] Добавить таблицу/ограничения и миграцию. Проверить upgrade с текущей схемы и совместимость старого кода с расширенной схемой в изолированной test DB.
- [ ] Реализовать list/create/summaries, транзакционные проверки и долговременный create marker, опираясь на общий контракт. На повтор возвращать свежий авторизованный DTO, не слепой snapshot.
- [ ] Проверить план/количество запросов: batch не создаёт N+1 на записи и авторов, список ограничен limit. Без materialized counters и триггеров на Memory для первой версии.
- [ ] Запустить целевые проверки, затем профиль по classifier на точном source. Зафиксировать результаты, diff, миграцию и handoff.

## Обязательные тесты

`create_for_member_roles`: Owner, Full и Viewer создают комментарий; Viewer всё ещё не может публиковать медиа.

`private_scope`: outsider/revoked/неавторизованный не читают список и счётчики; подмена familyId/memoryId отвергается; несоответствующую составную связь не позволяет БД.

`server_authorship`: forged authorId/имя/дата не принимаются; комментарий под MAX-постом имеет автора-человека; личный avatar crop соблюдается.

`published_only`: типы note/photo/video/voice/media поддерживаются; processing/deleted/неактивная семья недоступны.

`idempotency_parallel`: параллельные одинаковые POST с одним ключом создают ровно одну строку и count=1. Потерянный ответ и retry дают тот же id. Другой текст или memoryId под тем же ключом — конфликт. После очистки временных idempotency records дубля нет.

`pagination`: >50 комментариев с одинаковыми createdAt и разными id — стабильный keyset, без дублей; cursor от другой семьи/поста отвергается; лимиты соблюдаются.

`batch_counts`: 1–50 уникальных ID, корректные числа, недоступные записи не раскрываются; нет 50 запросов вместо одного batch. Старые посты с нулём работают без backfill.

`legacy_unchanged`: старые list/get/create Memory ответы проходят прежние strict schemas без дополнительных полей; комментарий не сдвигает пост в ленте, не меняет Memory.version/ordinal/unread.

## Проверки

Из корня, после проверки изоляции окружения:

```sh
bun test packages/contracts/src/comments.test.ts
(cd backend && bun run test:integration src/modules/memories/comments.integration.test.ts src/modules/memories/comments-idempotency.integration.test.ts)
(cd backend && bun run typecheck)
git diff --check
```

Использовать действующий integration runner и его поддерживаемые file selectors. Если синтаксис runner на новом HEAD изменился, адаптировать только команду, не обходить test-DB safeguards. Перед merge — требуемый профиль, ожидается FULL из-за контракта/БД/ACL; запускать существующим `bun run verify:local --profile full`, не свой урезанный заменитель.

## Готовность и handoff

Готово технически, когда целевые сценарии проходят, миграция проверена, endpoints доступны в локальном API, старые контракты неизменны, review выполнен по применимым правилам и реальные exit codes записаны.

Передать COM-2: BASE/HEAD, migration name, схемы, idempotency semantics, query/cursor формат, порядок locks и список не реализованных PATCH/DELETE. Не объявлять интерфейс или всю функцию завершёнными. Production не трогать. Следующий этап самостоятельно не запускать.
