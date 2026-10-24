# Предложение правок к AGENTS.md

Сборка: несколько детей в семье, отметки детей, лента по ребёнку, страница ребёнка. Ветка `feat/children-linked-families`, уровень T2. `AGENTS.md` не изменялся: решает владелец. Каждая строка ниже готова к вставке, раздел указан в скобках. Коды: N новое, L ловушки, C неверное в тексте, G git-разделы, M архитектура.

## N. Что добавить

Новый раздел «6A. Несколько детей в семье» после §6 (строки N1–N19).

N1. Словарь — `CONTEXT.md` (корень). Решения — `docs/adr/0001-tablica-otmetok.md` … `docs/adr/0006-otdelnaya-versiya-otmetok.md`. Перед правкой логики детей и отметок прочитай ADR 0001–0006.
N2. Связь «воспоминание — ребёнок» — таблица `memory_child_tags` (`MemoryChildTag` в `backend/prisma/schema.prisma`). `attachment_id IS NULL` — ребёнок на всём воспоминании, иначе — на одном фото или видео. Два частичных unique-индекса лежат только в SQL миграции `backend/prisma/migrations/20261024100000_memory_child_tags/migration.sql`, в `schema.prisma` их нет.
N3. `Memory.childId` — опорный ребёнок, оставлен ради отката на старый runtime (ADR 0002). Он не значит «чьё воспоминание»: смысл несут только отметки.
N4. Правило по умолчанию при создании воспоминания живёт в одной функции `resolveCreationChildTags` (`backend/src/modules/memories/infrastructure/child-tags.ts`): `childIds` переданы (даже пусто) — ровно они; не переданы — единственный живой ребёнок, иначе без отметок. Её зовут `PrismaMemoryRepository.create` и `source-memory-publisher.ts`. Не писать отметки в обход неё (ADR 0003).
N5. Правка отметок — `PUT /api/v1/families/:familyId/memories/:memoryId/child-tags` (`MemoryService.replaceChildTags` → `PrismaMemoryRepository.replaceChildTags`); только full, чужая версия — 409 VERSION_CONFLICT. Нормализация — `normalizeChildTags` в `child-tags.ts`. Версия отметок — отдельный `Memory.childTagsVersion`, `Memory.version` и порядок непрочитанного не меняются (ADR 0006).
N6. Лента: `GET …/memories?childId=` — отметка любого уровня; `?untagged=true` — без отметок; вместе — 422. Курсор подписывает фильтр (`backend/src/modules/memories/domain/memory-cursor.ts`); `childId` попадает в подписанные фильтры только когда задан, чтобы старые курсоры оставались действительными. Чужой или удалённый ребёнок в ленте — 404 (F1).
N7. «Живой ребёнок» — `Child.deletedAt IS NULL` (мягкое удаление, ADR 0004). «Старший по созданию» — первый живой по `created_at, id`: его берут `FamilyResponse.child`, `backend/src/bot-family-target.ts`, `backend/src/modules/max/infrastructure/source-target.ts`. Любой новый код с «первым ребёнком» обязан фильтровать `deletedAt`.
N8. `DELETE /api/v1/families/:familyId/children/:childId` (`FamilyService.deleteChild`, `backend/src/modules/families/application/family-service.ts`) отвечает 409, если есть отметки на неудалённых воспоминаниях, живые альбомы, активная загрузка MAX-видео или это последний живой ребёнок.
N9. Опт-ин заголовок `X-Memoly-Children: 1` (константа `MEMOLY_CHILDREN_HEADER` в `packages/contracts/src/children.ts`, список CORS в `backend/src/storage/config.ts`): только с ним `GET /families/:familyId` отдаёт `children`, а воспоминания — `childTags` и `childTagsVersion` (ADR 0005). Читают заголовок `backend/src/modules/families/transport/routes.ts`, `backend/src/modules/memories/transport/routes.ts` (`wantsChildTags`), `backend/src/modules/max/transport/direct-video-upload-routes.ts`. Новое поле в строгом ответе без такого условия ломает открытый старый клиент.
N10. Старые маршруты `PUT /families/:familyId/child` и `PATCH /families/:familyId` (поле `child`) остались и работают со старшим по созданию ребёнком. Не удалять: на них держатся старые клиенты.
N11. Видео из Mini App: `childIds` передаются только в финализации (`backend/src/modules/max/application/direct-video-upload.ts`); в резервировании они запрещены (422), там остался необязательный устаревший `childId`.
N12. Альбомы: `GET …/albums?childId=` (`backend/src/modules/albums`). Альбомы year/events/workshop принадлежат ребёнку (`Album.childId`, FK Restrict), семейные — без ребёнка.
N13. Контракты детей — `packages/contracts/src/children.ts` (`MAX_FAMILY_CHILDREN = 12`), схемы запросов и ответов — в `families.ts`, `memories.ts`, `albums.ts` рядом.
N14. Тестовая фикстура «семья + N детей + воспоминания с отметками» — `childrenFixtures()` в `backend/src/test-support/children-fixtures.ts`, с `cleanup()`. Образец — `backend/src/modules/families/children-api.integration.test.ts`.
N15. Webapp, семья: `webapp/src/features/family/` (через `index.ts`: `familyChildren`, `hasManyChildren`, `canAddChild`, `createChild`, `updateChild`, `deleteChild`). «Много детей» = `children.length >= 2`; при одном ребёнке интерфейс не меняется: ни шапки семьи, ни фильтров, ни выбора детей.
N16. Webapp, лента и страница ребёнка: `webapp/src/features/feed/child-filter.ts` (`normalizeChildFilter`, `childFilterChips`, `composerInitialChildIds`, `missingChildFilterId`), `child-tag-editor.ts` и `MemoryChildTagsEditor.tsx` (действие «Отметить детей»), `ChildAlbumsStrip.tsx`; в `webapp/src/components/ui-v2/` — `FamilyHeaderV2.tsx`, `ChildTagPicker.tsx`. Групповые альбомы по детям — `webapp/src/features/albums/child-groups.ts`.
N17. Состояние фильтра `childFilter` живёт в `webapp/src/App.tsx` и в `PersistentFamilyPresentation` (`webapp/src/platform/persistence/private-cache.ts`); непригодное значение превращается в `null`, презентация не отбрасывается. Не путать с `filter` (вид контента).
N18. Ключ ленты `feedQueryKeys.list(...)` (`webapp/src/features/feed/queries.ts`) — 9 элементов, `childFilter` последний; на диск попадает только `key[8] === null` (`isPersistableQueryKey`). Меняешь длину ключа — проверь `isPersistableQueryKey`, `matchesReactionFeedScope`, `removePrivateFamilyQueries`. Меняешь форму сохранённых данных — подними `PRIVATE_CACHE_SCHEMA` (сейчас 2).
N19. Интерфейс детей включается только при `VITE_MEMOLY_UI_VERSION=v2` (`webapp/src/features/ui-version/ui-version.ts`); без флага (значение по умолчанию в `deploy/selectel/Dockerfile.webapp` — `legacy`) семья ведёт себя как с одним ребёнком. Локально: `VITE_MEMOLY_UI_VERSION=v2 bun run dev:webapp`.

Команды (раздел §6 «Реализация и проверки», новый абзац «Проверки по детям»):

N20. Установка и Prisma-клиент: `bun install --frozen-lockfile && bun run --cwd backend prisma:generate`.
N21. Общая проверка без БД (на 2026-10-24: contracts 73, backend unit 179, webapp 184): `bun run typecheck && bun run lint && bun run architecture:check && bun run test:contracts && bun run test:backend:unit && bun run test:webapp && bun run build:webapp`.
N22. Один интеграционный файл (нужна база PostgreSQL `*_test` на loopback; примеры файлов — `child-feed`, `child-tags-edit`, `child-tags` в `backend/src/modules/memories/`): `TEST_DATABASE_URL=<postgres *_test> DATABASE_URL=$TEST_DATABASE_URL TEST_SKIP_DOCKER=1 bun run test:backend:integration -- src/modules/memories/child-feed.integration.test.ts`.
N23. Браузерный сценарий детей (4 теста, из каталога `webapp/`, нужен `TEST_DATABASE_URL`/`DATABASE_URL` на базу `*_test`, перед этим N20): `E2E_SKIP_DOCKER=1 MEMOLY_E2E_DATABASE_URL_EXPLICIT=1 NODE_ENV=test bunx playwright test --config=playwright.max.config.ts --project=max-core e2e/children.spec.ts`. Проект `max-core` берёт только файлы из `testMatch` в `webapp/playwright.max.config.ts`; `e2e/critical-smoke.spec.ts` туда не входит и в проверке этой сборки не запускался.
N24. Совместимость отката на предыдущий runtime проверяют `backend/scripts/children-release-compatibility.integration.test.ts` (закреплён SHA прошлого runtime) и `backend/scripts/memory-child-tags-upgrade.integration.test.ts`. Миграция по детям — только expand; уже применённую не править.
N25. Связанные семьи (передача фото между семьями, альбом «Вас отметили») — второй этап, в коде их нет. Не добавлять без отдельного задания (`CONTEXT.md`).

## L. Ловушки (раздел §6, абзац «Известные ловушки окружения»)

L1. Windows: чистый клон — `git -c core.longpaths=true clone <url>`; без этого длинные пути `node_modules` и worktree ломаются.
L2. После `bun install` до любых браузерных тестов нужен `bun run --cwd backend prisma:generate`: `backend/scripts/max-verification-server.ts` клиент не генерирует. Каталог `backend/src/generated/prisma/` игнорируется git — не править руками.
L3. Windows: `sharp` не грузится из слишком длинного пути. Playwright запускай через короткий диск: `subst X: "D:\codex\TG_OurMemoriesDevBot\OurMemoriesDevBot-workspace\.worktrees\children-families"`, затем из `X:\webapp`. Снять: `subst X: /d`.
L4. `backend/scripts/*-release-compatibility*` используют `tar` (`git archive` прошлого runtime) и под Windows не идут: гонять в Linux в составе `bun run verify:full`.
L5. После браузерных прогонов база может не очиститься: FK Restrict `albums` → `children` и `memory_child_tags` → `children` блокируют удаление семьи. Для каждого прогона бери свежую базу `*_test`.
L6. Docker на этой машине может не создать сеть: поднимай отдельный PostgreSQL с базой `*_test` на loopback и `TEST_SKIP_DOCKER=1`; раннер принимает только loopback и имя `*_test` (`docs/TESTING.md`).
L7. Браузер: только `webapp/playwright.max.config.ts` (проект `max-core`, backend — `max-verification-server.ts`, `NODE_ENV=test`); базовый `playwright.config.ts` требует настоящий MAX API.

## C. Что в тексте теперь неверно или требует уточнения

C1. `AGENTS.md`, «Release preconditions и сохранение принятого продукта»: «UI v4» в коде называется флагом `v2`. Заменить предложение «Принятый в PR #185 memoLy UI v4 — канонический интерфейс.» на: «Принятый в PR #185 memoLy UI v4 — канонический интерфейс; в коде он включается `VITE_MEMOLY_UI_VERSION=v2` (`webapp/src/features/ui-version/ui-version.ts`, значения `legacy`/`v2`), `legacy` — только режим совместимости.»
C2. `AGENTS.md` §1 отправляет читать `docs/mvp/`, а `docs/mvp/03_DATA_API.md:13` утверждает «API MVP не создаёт второго активного ребёнка», и строка 15 описывает `Memory.child_id` как владельца воспоминания. Добавить в §1 после первого абзаца: «`docs/mvp/03_DATA_API.md` в части ребёнка устарел: детей в семье до 12, воспоминание связано с детьми через `memory_child_tags`, `Memory.childId` — опорный ребёнок. Актуально: `CONTEXT.md` и `docs/adr/0001…0006`.» Сам файл `docs/mvp/03_DATA_API.md` не правился.
C3. Других противоречий в тексте `AGENTS.md` по этой сборке не найдено: детей он не упоминает, правила миграций (§10 expand → compatible → contract) и границ модулей (§6) сборка соблюла.

## G. Git-разделы (в `AGENTS.md` их нет)

Новый раздел «13. Правка после автопилота» с двумя подразделами. Вставить как есть.

G1. До первой сдачи сборки `.autopilot/PROGRESS.md` в корне `.autopilot/` отсутствует, а коммита `Autopilot: сборка сдана` ещё нет, поэтому команда «что правили после последней сборки» до сдачи вернёт ошибку. Это нормально: оба появляются при сдаче.

### Правка без автопилота
Мелкий баг или доводка после сборки — обычная сессия, без прогона.
Сначала прочитай:
1. `.autopilot/PROGRESS.md` — что не доделано, известные баги, о чём договорились с пользователем.
2. Что правили после последней сборки — первая строка таблицы в «История git».
3. Только если правка их касается: почему сделано так — `docs/adr/`; что значат слова — `CONTEXT.md`; что именно просили — `manifest.md` в папке сборки (указана в начале `PROGRESS.md`).
После правки:
- коммит — по правилам из «История git»;
- строка в «Правки без автопилота» в `PROGRESS.md`: дата — что — почему;
- починенный пункт из «Не доделано» или «Известные баги» — удали;
- договорились с пользователем о том, что следующая сборка не должна пересматривать, — строка в «Договорились», его словами.

### История git
Целиком не читай — бери срез под вопрос:
| Вопрос | Команда |
|---|---|
| что правили после последней сборки | `git log --oneline "$(git log -1 --format=%h --grep='^Autopilot: сборка сдана')"..HEAD -- . ':(exclude).autopilot'` |
| всё, что делали ради требования | `git log --oneline --grep="R02"` |
| история файла | `git log --oneline -10 -- <файл>` |
| когда появился или исчез код | `git log --oneline -S "<фрагмент>"` |
| почему строка такая | `git blame -L <с>,<по> <файл>`, затем `git show <sha>` |
| что внутри коммита | `git show --stat <sha>` |
Коммит: Conventional Commits по §7 (заголовок — что, тело — почему), трейлер `--trailer "Requirements: R02"`, если правка касается требования из `manifest.md`. Заголовок `Autopilot: сборка сдана` пишет только автопилот.

## M. Для `docs/ARCHITECTURE.md` (или нового раздела AGENTS.md)

`docs/ARCHITECTURE.md` не создавался и не правился. Вставить в него как новый раздел «Children and memory tags» между «Backend» и «Runtime Shape And Real-Time»; две последние строки — в конец раздела «Frontend». Текст на английском, как весь файл.

M1. **Data.** `memory_child_tags(memory_id, child_id, attachment_id NULL)` is the only source of "whose memory". `attachment_id IS NULL` = child on the whole memory, else on one photo/video (id of `MediaAsset`, `MaxVideoReference` or `TelegramVideoReference`, no FK: the service checks it). `Memory.childId` is a compatibility anchor only (ADR 0002). Children are soft-deleted (`Child.deletedAt`); all child FKs are Restrict.
M2. **Create.** App form, MAX bot, Mini App video and historical paths all end in `resolveCreationChildTags` (memories/infrastructure/child-tags.ts), called under the family row lock: given `childIds` (even empty) are used as is, otherwise the only live child is tagged, otherwise none (ADR 0003). Mini App video sends `childIds` at finalize, not at reservation.
M3. **Edit.** `PUT …/child-tags` replaces the full set after `normalizeChildTags`; a child tagged on an attachment loses its whole-memory tag. It bumps only `Memory.childTagsVersion` (ADR 0006), never `Memory.version`.
M4. **Read.** `GET …/memories?childId=` matches a tag of any level; `?untagged=true` matches none. The cursor signs the filter. `childTags` / `childTagsVersion` and `FamilyResponse.children` are sent only with `X-Memoly-Children: 1` (ADR 0005), so stale clients keep their strict payloads.
M5. **Module boundaries.** `families` owns child CRUD and the delete guards (tags, live albums, active MAX video sessions, last child); `memories` owns tags, the default rule and the filtered feed; `albums` owns `Album.childId` and `?childId=`; `max` carries `childIds` from video finalize into memories through `modules/memories/index.ts` only. Old routes `PUT /families/:id/child` and `PATCH /families/:id` act on the oldest live child.
M6. **Client cache.** `childFilter` is a field of `PersistentFamilyPresentation` and the last element of the feed query key; only the unfiltered feed is persisted to IndexedDB; `PRIVATE_CACHE_SCHEMA` guards the stored shape. A 404 on a child's feed closes that child's page, not the family.
