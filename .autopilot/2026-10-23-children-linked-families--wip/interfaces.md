# Интерфейсы

Читать первым. Факты о коде — `notes.md` (пути и строки там). Спецификация — `spec.md`.

## Правила проекта (из AGENTS.md, обязательны каждому исполнителю)

- Слои backend `modules/<m>/(domain|application|transport|infrastructure)`; между модулями — только через `index.ts`; проверка `bun run architecture:check`.
- Фичи webapp импортируются только через `features/<f>/index`.
- Миграции — сырой SQL в `backend/prisma/migrations/<UTC>_<snake>/migration.sql`, имена ограничений совпадают с `map:` в `schema.prisma`. Уже применённые миграции не трогать. Только expand: никаких `DROP`, `SET NOT NULL`, смены типа существующих столбцов.
- Составные FK `(x_id, family_id) → (id, family_id)`; каждый запрос проверяет `familyId` (IDOR, `docs/mvp/03_DATA_API.md:44`). Чужая семья — 404, не 403.
- Ошибки — существующие коды из `packages/contracts/src/errors.ts`, тексты по-русски.
- Иконки только WebP RGBA, никаких SVG (AGENTS §11). Текст — настоящий HTML.
- Новый экран или значение в `App.tsx` → `PersistentFamilyPresentation` и `validatePresentation` (`webapp/src/platform/persistence/private-cache.ts`); новые ключи приватных запросов семьи → `removePrivateFamilyQueries`.
- Тесты только на синтетике. Интеграционные тесты — PostgreSQL `*_test`; без Docker: `TEST_DATABASE_URL` + `DATABASE_URL` = тот же + `TEST_SKIP_DOCKER=1`.
- Platforms: только MAX Mini App, Web/PWA с MAX-авторизацией. Telegram-код исторический: должен компилироваться, новые функции туда не добавляются.
- UI делается для v2 (`VITE_MEMOLY_UI_VERSION=v2` в production). Legacy компилируется и ведёт себя как семья с одним ребёнком.

## Стек и команды

- Bun (версия в `.bun-version`), Hono, Prisma, PostgreSQL; React/Vite; общий пакет `packages/contracts`. Новых зависимостей не нужно — любая новая зависимость = `BLOCKED`.
- Установка: `bun install --frozen-lockfile`. Prisma-клиент: `bun run --cwd backend prisma:generate`.
- **Одна команда проверки:** `bun run typecheck && bun run lint && bun run architecture:check && bun run test:contracts && bun run test:backend:unit && bun run test:webapp`.
- Интеграционные тесты одного файла: `TEST_DATABASE_URL=<postgres *_test> DATABASE_URL=$TEST_DATABASE_URL TEST_SKIP_DOCKER=1 bun run test:backend:integration -- src/modules/<m>/<file>.integration.test.ts`. Docker на этой машине может не создать сеть — тогда поднять отдельный PostgreSQL с базой `*_test` на loopback (см. `docs/TESTING.md`).
- Браузер: `webapp/playwright.max.config.ts` (backend через `backend/scripts/max-verification-server.ts`, `NODE_ENV=test`), не базовый конфиг — он требует настоящий MAX API.
- Не трогать: `deploy/`, `.githooks/`, `scripts/` релиза, `bun.lock`, `package.json`, применённые миграции, Telegram-функциональность сверх компиляции.

## Границы, решённые в спецификации

### Термины
- **Живой ребёнок** — `Child.deletedAt IS NULL`.
- **Порядок детей** — `birthDate` по возрастанию (null — в конце), затем `createdAt`, затем `id`.
- **Старший по созданию** — живой ребёнок с минимальным `createdAt, id`. Используется везде, где код сегодня берёт `children[0]` (опорный ребёнок, `FamilyResponse.child`, `setupStatus`, хаб, MAX-кандидаты).
- **Отметка** — строка `memory_child_tags`. `attachmentId = null` — ребёнок на всей публикации; иначе — на конкретном вложении.
- **Вложение** — элемент `memory.attachments` из DTO: id = `MediaAsset.id` (private_storage), `MaxVideoReference.id` (max), `TelegramVideoReference.id` (telegram).

### Данные (владелец — T01)
```prisma
model MemoryChildTag {            // @@map("memory_child_tags")
  id           String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  familyId     String   // FK (memoryId, familyId) → memories Cascade; (childId, familyId) → children Restrict
  memoryId     String
  childId      String
  attachmentId String?  // без FK: три источника; проверяется сервисом
  createdBy    String   // userId
  createdAt    DateTime
  // partial unique: (memory_id, child_id) WHERE attachment_id IS NULL
  // partial unique: (memory_id, attachment_id, child_id) WHERE attachment_id IS NOT NULL
  // index: (family_id, child_id, memory_id); index: (family_id, memory_id)
}
Memory.childTagsVersion Int @default(1) @map("child_tags_version")
Child.deletedAt DateTime? @map("deleted_at")
```
Миграция `20261024100000_memory_child_tags`: таблица, два столбца, перенос `INSERT INTO memory_child_tags (family_id, memory_id, child_id, created_by) SELECT family_id, id, child_id, author_id FROM memories`.

### Нормализация отметок (memories, сервер)
- Для одного ребёнка в одной публикации — либо одна отметка на всю публикацию, либо отметки на вложениях, не обе: при наличии отметок на вложениях общая отметка того же ребёнка удаляется.
- В публикации без фото и видео отметки на вложениях запрещены (422).
- Ребёнок — живой и той же семьи; вложение — этой публикации; дубликаты в запросе — 422; не больше 12 детей × (вложения + 1) строк.
- Правка отметок не меняет `Memory.version`, `occurredAt`, порядок непрочитанного; увеличивает `childTagsVersion`.
- Доверенная перепубликация (`replaceOrderedMedia`) удаляет отметки вложений, которых больше нет.

### Правило по умолчанию при создании публикации (memories, одно место)
Функция в memories (`resolveCreationChildTags`), вызываемая и из `PrismaMemoryRepository.create`, и из `source-memory-publisher`:
- переданы `childIds` (в т.ч. пустой массив) → отметки на всю публикацию ровно для них;
- не переданы → если у семьи ровно один живой ребёнок, отметка на всю публикацию для него; иначе без отметок;
- `Memory.childId` (опорный) = первый из `childIds`, иначе старший по созданию живой ребёнок.
Устаревшее поле запроса `childId` без `childIds` = «не переданы» (старые клиенты).

### Контракты (`packages/contracts`, владелец — T01)
- `families.ts`: `createChildRequestSchema {name, birthDate, sex, avatarMediaId, avatarCrop}` (все обязательны, как у завершённого профиля); `updateChildRequestSchema` (частичный) + `expectedVersion`; `childResponseSchema {child}`; `familyResponseSchema` + необязательное `children: childSchema[]` (в порядке детей). `childSchema` не меняется.
- `memories.ts`: `memoryChildTagSchema {childId: uuid, attachmentId: uuid | null}`; `memoryDtoSchema` + необязательные `childTags: memoryChildTagSchema[]`, `childTagsVersion: int`; `memoryBaseInputSchema`: `childId` необязательный, + `childIds?: uuid[]` (уникальные, ≤12); `listMemoriesQuerySchema` + `untagged?: boolean` (вместе с `childId` — 422); `replaceMemoryChildTagsRequestSchema {tags: memoryChildTagSchema[], expectedChildTagsVersion: int}` → ответ `{childTags, childTagsVersion}`.
- `albums.ts`: `listAlbumsQuerySchema` + `childId?: uuid`.
- Заголовок клиента `X-Memoly-Children: 1`: только с ним сервер кладёт `children` в `FamilyResponse` и `childTags`/`childTagsVersion` в DTO публикаций. Добавить в разрешённые заголовки `backend/src/storage/config.ts`.

### HTTP (backend)
| Метод и путь | Кто | Модуль | Таск |
|---|---|---|---|
| `POST /api/v1/families/:familyId/children` (Idempotency-Key) → 201 `{child}` | владелец | families | T02 |
| `PATCH /api/v1/families/:familyId/children/:childId` → `{child}` | владелец | families | T02 |
| `DELETE /api/v1/families/:familyId/children/:childId` (If-Match: версия) → 204 | владелец; 409 при отметках, живых альбомах, активной сессии загрузки MAX-видео или если ребёнок последний | families | T02 |
| `GET /api/v1/families/:familyId` | как сейчас + `children` по заголовку | families | T02 |
| `PUT /api/v1/families/:familyId/memories/:memoryId/child-tags` → `{childTags, childTagsVersion}` | full; 409 VERSION_CONFLICT при чужой версии | memories | T03 |
| `GET /api/v1/families/:familyId/memories?childId=…` / `?untagged=true` | участник; фильтр = есть / нет отметки (любого уровня) | memories | T03 |
| `POST /api/v1/families/:familyId/memories` | как сейчас + `childIds` | memories | T01 |
| `GET /api/v1/families/:familyId/albums?childId=…` | участник | albums | T02 |

`PUT /families/:id/child` и `PATCH /families/:id` (поле `child`) остаются и работают со старшим по созданию ребёнком — для старых клиентов.

### Webapp (владельцы — T04 семья и данные детей, T05 лента/страница ребёнка/форма добавления, T06 редактор отметок и альбомы)
- `features/family`: список детей в «Семье», «Добавить ребёнка», правка и удаление — переиспользуют поля и загрузку аватара из `FamilyOnboarding`. API: `createChild`, `updateChild`, `deleteChild`.
- Запрос семьи шлёт `X-Memoly-Children: 1`; везде, где нужен список детей, — `familyResponse.children ?? (child ? [child] : [])`. «Много детей» = `children.length >= 2`.
- `features/feed`: `FamilyHeaderV2` (название семьи + аватары детей; нажатие на аватар = выбор фильтра), `ChildFilterChips` (`Все`, дети, `Без отметки` для full при наличии), страница ребёнка = шапка ребёнка (существующий `ChildHeaderV2`) + `ChildAlbumsStrip` + отфильтрованная лента.
- Состояние фильтра: `childFilter: string | 'untagged' | null` в `App.tsx` и в `PersistentFamilyPresentation` (`validatePresentation`: id из `children` или `'untagged'` или null, иначе null — не отбрасывать всю презентацию). Не путать с существующим `filter` (вид контента).
- Ключ ленты: `feedQueryKeys.list(..., cycle, childFilter)` — новый элемент в конец; `isPersistableQueryKey` сохраняет только `childFilter === null`; `matchesReactionFeedScope` и `removePrivateFamilyQueries` проверены на новую длину. `PRIVATE_CACHE_SCHEMA` = 2.
- `features/composer`: `ChildTagPicker` (2+ детей) в формах фото, видео, заметки и голоса; начальное значение — выбранный ребёнок фильтра; отправка `childIds`. При одном ребёнке выбора нет и `childIds` не отправляется.
- Просмотр публикации: действие «Отметить детей» (full, 2+ детей) в меню публикации → `MemoryChildTagsEditor`: по выбору детей на каждое фото и видео; для публикации без фото и видео — один общий выбор. Отправка `PUT …/child-tags` с `expectedChildTagsVersion`.
- `features/albums`: при 2+ детях — группы по детям + «Семейные»; форма создания — выбор ребёнка для year/events/workshop.

### Швы для тестов
- Backend: интеграционные тесты модулей (`families`, `memories`, `albums`, `max`) через `createApp` + PostgreSQL `*_test`; один общий помощник фикстур «семья + N детей + публикации» в `backend/src/test-support/` (создаёт T01).
- Контракты: `packages/contracts/src/*.test.ts`.
- Webapp: `webapp/tests/*.test.ts(x)` для кэша, ключей и чистых функций выбора детей.
- Браузер: новый `webapp/e2e/children.spec.ts` (семья с двумя детьми: фильтры, добавление из фильтра, отметка на фото) и существующий `critical-smoke.spec.ts` как регрессия семьи с одним ребёнком.

## Что построили законченные таски
<!-- дописывается по ходу Разработки -->
