# MEMOLY-ALBUMS · план реализации

**Goal:** четыре настоящих семейных вида альбомов в существующем memoLy с вкладкой между Лентой и Добавить.
**Architecture:** отдельный albums module в действующем модульном монолите, ссылки на Memory/его вложения, без копий media bytes и без второго ACL/auth/storage.
**Stack:** текущие Bun/Hono/Prisma/PostgreSQL, shared contracts, React/Vite/TanStack Query. Новые зависимости не нужны по умолчанию.
**Spec:** SPEC.md. **Release:** FULL; есть API/contracts/schema/data. Этапы ниже — внутренние шаги одной задачи, а не четыре последовательных разрешения владельца.

## Проверенный контекст

main `ea7d9149055e3632a7b9279c9a4e37021955318e` (2026-10-23). `backend/src/modules` ещё не содержит albums. `BottomNavigation.tsx` имеет `active: 'feed' | 'family'`, три колонки и capabilities-aware кнопку добавления. `webapp/src/App.tsx` содержит реальный `FamilyController`, selectionVersion/membershipEpoch и сохранение экранов; `features/navigation/model.ts` описывает другой workspace router и НЕ заменяет этот экранный контроллер. При реализации проверить actual usages, не выбирать одноимённый legacy renderer.

Канонические границы: `backend/src/modules/memories` (доступные Memory/attachments), `media` (приватные пути), `uploads`/существующий composer, `families` (access policies), `max` (provider video). Изучить их публичные порты; не импортировать внутренние repository соседнего домена.

## Предлагаемая additive модель

Названия ниже — конкретная проектная схема; согласовать имена с текущими conventions без изменения семантики.

- **Album**: id, familyId, childId nullable (для семейного free), kind enum `year/events/workshop/free`, templateVersion=1, title, description, version, createdAt/updatedAt, deletedAt. Cover ссылается на выбранную разрешённую связь, не на произвольный URL. Composite (id,familyId), FK childId+familyId, индексы family/kind/deletedAt.
- **AlbumEntry**: id, familyId, albumId, monthNumber nullable (только year, 1…12), title, caption, childQuote, category, dateValue/datePrecision, orderKey, version. Глава year — entry. Создание year + 12 entries одной транзакцией; unique(albumId,monthNumber), запрет добавления 13-й/удаления номера месяца. Очистка месяца удаляет содержимое, не слот.
- **AlbumEntrySource**: id, familyId, albumId, entryId, memoryId, attachmentId nullable, attachmentKind/source kind при необходимости текущих контрактов, position. Nullable attachment только для ссылки на целую note/voice Memory. Обе составные ссылки (entry,family)/(memory,family) ограничивают одну семью. Существующие MAX video attachments не считать private MediaAsset: определить ссылку через текущий MemoryAttachment, не только mediaId и не ordinal слайда. Source adapter внутри memories проверяет реальную принадлежность attachment Memory. Не вводить публичный media URL в модель.

Проверки source entry: живой published Memory этой семьи, разрешённый kind, уникальная пара (entryId,memoryId,attachment identity), idempotent attach. Дубли одной фото в разных альбомах разрешены. No cascade from album to Memory/media. Delete Memory делает связи недоступными немедленно на read; физическая очистка metadata не является условием privacy. Cover выбирается только среди доступных источников, иначе fallback.

Дата событий/workshop: `datePrecision=day|month|year|unknown`, календарная строка, а не выдуманный timestamp. Например day `2026-10-12`, month `2026-10`, year `2026`, unknown null; strict validation. Все унаследованные даты берутся из occurredAt с timezone семьи. Сортировка partial dates сохраняет видимую точность, неизвестные в конце. Изменение birthDate не мутирует slots.

Нужны только новые таблицы/индексы/FK. Не backfill старых Memories, не меняется single-child контракт, не переписывать авторство, source dates и существующие migration ledger. Реальную additive SQL migration провести штатным способом; сначала disposable DB. Старый runtime может не знать новые таблицы, но это НЕ доказательство безопасного rollback: проверить действующие recovery guards и принятую UI v4 baseline.

## API contracts v1

Создать `packages/contracts/src/albums.ts` и экспорт. Strict request validation; title≤80, entry title≤120, description≤2000, caption/quote≤8000 Unicode code points. Пустая/неизвестная дата допустима по SPEC. Request limits bounded. Использовать существующие Idempotency-Key и If-Match/version conventions.

Рекомендуемые family-scoped endpoints:
- GET/POST `/api/v1/families/:familyId/albums` — курсорный каталог/создание;
- GET/PATCH/DELETE `.../albums/:albumId` — metadata/обложка/soft delete;
- GET/POST `.../albums/:albumId/entries` — paged entries/создание события или работы;
- PATCH/DELETE `.../albums/:albumId/entries/:entryId` — редактирование/удаление; для year DELETE очищает содержимое через явную операцию clear, не стирает номер;
- PUT `.../albums/:albumId/entries/:entryId/sources` — bounded validated ordered selection с expectedVersion;
- POST `.../albums/:albumId/entries:reorder` — только free, полный permutation переданных текущих sibling IDs или документированное stable move, атомарно;
- GET `.../albums/:albumId/workshop-groups` — метаданные годов/месяцев и количества без выдачи всех originals;
- GET scoped media picker на публичном query-порту memories: cursor, kind, optional search/date range. Не расширять global search.

Источник истины — API. DTO содержит только текущие разрешённые reference paths, capabilities и count; response не раскрывает чужие family IDs, storage keys/tokens/provider URLs. `pageSize` default48 max96 для gallery; catalogue default20 max50. Stable cursor: sort+ID, scoped to family/album/category/year and invalidated/restarted when filter changes. Обложки/list thumbnails загрузить batch, избежать N+1 provider lookups. Ни одного MAX запроса на каждую плитку.

Read API повторно проверяет членство/эпоху и доступность оригинала. Mutations атомарно проверяют Full+active family и expectedVersion; гонка revoke/write не даёт сохранить после утраты прав. Server 403/404/409 — штатные ошибки проекта. Idempotency replay не возвращает private DTO без fresh access check.

## 1. Backend + контракт + миграция

Create: `backend/src/modules/albums/{application,domain,infrastructure,transport}/`, `index.ts`, `albums.integration.test.ts`, `packages/contracts/src/albums.ts`, контрактные tests. Modify: `backend/prisma/schema.prisma`, новая timestamp migration, `packages/contracts/src/index.ts`, `backend/src/app.ts` либо текущий composition root; минимальный публичный memory lookup port.

- [ ] RED: year создаёт ровно12 слотов; duplicate create не создаёт второй album; Viewer/outsider/revoked denied; чужое attachment не прикрепляется.
- [ ] Additive migration только на явных DATABASE_URL/TEST_DATABASE_URL одной task-owned `*_test` DB. Проверить schema и rollback semantics без production writes.
- [ ] Реализовать routes/service/repository, typed source projection и пагинацию; в транзакциях переиспользовать актуальную family access блокировку.
- [ ] GREEN: повтор того же набора, cross-family source/cover, конкурирующее редактирование, delete original и aggregate counts.
- [ ] Отдельный commit законченной границы; не выкатывать промежуточный нефункциональный раздел.

## 2. Навигация и четыре вида альбомов

Create: `webapp/src/features/albums/` с `api.ts`, `queries.ts`, `AlbumsPage.tsx`, templates registry, presentation/catalog/year/events/workshop/free, editors и source picker. Module boundaries, не giant App и не копия HTML-router.
Modify: `BottomNavigation.tsx`, её real callers в `FeedPage`/FamilyScreen и controller `App.tsx`, существующие nav tests; новая WebP icon если штатной нет. Canonical family selection/epoch сохраняется.

- [ ] RED/visual baseline: четыре кнопки по порядку; active albums во вложенных экранах; Plus возвращает origin; Viewer читает, не мутирует; поздний ответ A не заменяет B.
- [ ] Изолированные query keys `[account,family,membershipEpoch,'albums',...]`; abort+reset на scope switch. Не записывать private album content в demo localStorage. На первом этапе не добавлять новый persistent offline слой.
- [ ] Переносить только album surfaces из эталона. Current feed/family/settings остаются настоящими. Реальные palette/icons/Typography/theme, focus и MAX Back.
- [ ] Реальные source selection и state mutations, не фиктивные счётчики; loading/empty/error/conflict/saved-read-error.
- [ ] Actual React screenshots и узкие journey, включая one-photo-from-carousel и text-only event.

## 3. Мастерская и media integration

Use current protected thumbnail/display/playback transports и current viewer/lifecycle. При необходимости выделить тонкий reusable gallery adapter из действующего viewer без общего рефакторинга движков.

- [ ] RED: изменение zoom сохраняет focal item; category/year не смешивают cursor; undefined metadata не меняет рамку после load; закрытие viewer возвращает к tile; batch retry не дублирует работы.
- [ ] Paged workshops + bounded window/virtualized rows там, где нужно. Обязательная приёмка 2000 синтетических работ: число одновременно смонтированных preview tiles не растёт до2000 (ориентир ceiling320 на 390px), нет оригиналов в initial gallery и нет полного preload video. Использовать текущую библиотеку виртуализации только если она уже есть; не добавлять зависимость ради моды.
- [ ] Детерминированная row-based collage, устойчивые keys по entry ID; годы/месяцы — separators. Много ракурсов одной работы открываются одной viewer group.
- [ ] Pinch только внутри gallery, один палец — scroll, cancel/gesture suppression, кнопки−/+ как альтернатива. Не ломать системный browser zoom и fullscreen gesture.
- [ ] Новый файл публикуется существующим pipeline и затем attach; lost response retries по тому же key; сохранённая Memory не удаляется при неудачном attach.
- [ ] Зафиксировать before/after + сетевую/DOM проверку и state tests.

## 4. Совместное закрытие и выпуск

Один implementation PR от актуального main, один lead writer. Аддитивные contracts/schema принадлежат lead/integrator. Не запускать четыре независимых full reviews по этапам.

- [ ] Целевые backend/contract/UI tests, typecheck/lint/build; local integration runner из package.json. Новые tests использовать MAX/neutral fixtures.
- [ ] Один независимый read-only review реального diff с фокусом foreign attachment/cover, revoke race, idempotency, cleanup и layout/lifecycle. Один bounded fix pass и narrow closure.
- [ ] FULL точного готового SHA; не наследовать PASS старого prototype или PR #185. После обновления main проверять затронутые стыки.
- [ ] PR/merge/разрешённый deployment — по актуальному AGENTS.md. Здесь не добавлены искусственные запреты штатных шагов и не переносится исторический запрет merge UI #185.
- [ ] Перед release FULL и действующий Selectel runbook: фактические backend/frontend SHA и весь accumulated diff, migration ledger, backup, disk, lock, immutable images, совместимость и recovery. Не использовать branch-static operator для задачи с backend/schema.
- [ ] Smoke без фиктивных семейных записей; физическая MAX/iPhone проверка владельцем отдельно. При production blocker сообщить конкретную причину без расширения задачи.

## Что не включать в diff

Auth/F12, existing family role semantics, MAX import/bindings/webhooks, memory author attribution, comments/reactions, медиадвижки и worker queues, новый SW, переработка чужих тестовых окружений, сторонние dependencies. Узкий public port для выбора медиа допустим, но не новая схема выдачи приватных файлов.
