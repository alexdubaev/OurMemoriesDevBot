# Границы и правила проекта

Читать первым. Пути — относительно корня рабочей копии `D:\codex\TG_OurMemoriesDevBot\OurMemoriesDevBot-workspace\.worktrees\astryx-screens`. Карта кода — `notes.md` в этой папке.

## Правила проекта (не нарушать)

- `AGENTS.md` в корне — правила репозитория. Главное для этой сборки:
  - Иконки — только WebP через существующий `WebpIcon`. Никаких SVG и inline SVG, новых пиктограмм не создавать.
  - UI v4/Astryx — канонический интерфейс. Внешний вид вне перечисленного в спецификации не менять.
  - Текст интерфейса только на русском, в существующем стиле.
  - Не коммитить `.env`, токены, signed URL, приватные данные. В тестах только синтетика.
  - Не трогать auth/session/ACL, контракты (`packages/contracts`), backend, миграции БД, `deploy/`.
- Из прошлых сборок (договорились, не пересматривать):
  - R10: автоматически не объединять MAX и Telegram identities; членства и роли не менять административно.
  - R11/G01: обновлять только URL меню Telegram на https://app.memoly.ru/; webhook отсутствует; сообщения не отправляются.
  - Telegram auth-only использует TELEGRAM_AUTH_BOT_TOKEN; TELEGRAM_ENABLED=false сохраняет выключенный message lifecycle.
  - Docker/образы/локальные среды находятся на D; одна задача, одна ветка/PR, один общий выпуск.
  - Принятые акварельные альбомы, пять пунктов навигации, AlbumEntry discussions и Owner/Full/Viewer policy сохраняются.
  - Recovery/S3/locks и запрет отката БД сохраняются. Legacy recovery pair не меняется.
- Команды (из `webapp/`, если не указано иное):
  - Типы: `bun run typecheck` (в webapp).
  - Линт: `bun run lint`.
  - Unit: `bun test tests`, или один файл: `bun test tests/<file>.test.ts`.
  - Сборка: `bun run build`.
  - E2E: `bunx playwright test -c e2e/<name>.playwright.config.ts`. Конфиги сами поднимают Vite на своём порту.
  - Браузеры Playwright уже установлены (`%LOCALAPPDATA%\ms-playwright`). Зависимости установлены, `bun install` не запускать.

## Границы, решённые в спецификации

### U1 — Фильтр жестов карусели и просмотрщика (`webapp/src/features/feed/FeedPage.tsx`)
- Владеет решением «начинать ли свайп от этой цели» для `MixedMediaCarousel` (инлайн) и `MixedMediaViewer` (полноэкранный).
- Выставляет одну функцию в модуле рядом с каруселью: `isSwipeBlockingTarget(target: EventTarget | null): boolean`. Её вызывают оба `watchDrag` и `onMediaTouchStart`. Списки селекторов не дублируются.
- Блокирующие цели: `input, select, textarea, a, [role="slider"], [data-slot="video-playback-controls"]`, а также кнопки, кроме целей запуска видео (`[data-slot="max-video-play"]`, `.memoly-private-video-v2-play`, постер-кнопка неактивного слайда): по ним свайп начинается, а тап без движения запускает видео (клик после перемещения уже гасится `pointerGesture`/`onClickCapture` — проверить, что в просмотрщике это тоже так). Мёртвый `video[controls]` убрать.
- Скрывает: пороги осей и откат при вертикальном жесте — менять только если регрессионный тест докажет, что они ломают свайп.

### U2 — Раскладка полноэкранного просмотра (`MixedMediaViewer` + `webapp/src/features/feed/presentation/memoly-feed.css`)
- Владеет одинаковой геометрией фото для 1 и N слайдов: при одном слайде место миниатюр и навигации зарезервировано (`visibility: hidden` или эквивалент), не убрано.
- Путь открытия: `onOpen` карточки одиночного фото (FeedPage.tsx, около строки 477) открывает `MixedMediaViewer` вместо `setDetail`. `MemoryDetail` не удалять: он остаётся для видео, голоса и заметок.
- Зависит от U1 только тем, что живёт в том же файле: тикеты U1 и U2 последовательны.

### U3 — Кэш приватных картинок (`webapp/src/platform/persistence/private-cache.ts`)
- Публичные имена сохраняются: `readPrivateImage`, `cachePrivateImageResponse`, `removePrivateImage`, `eligiblePrivateImage`, `clearPrivateUserCache`, `removePrivateFamilyCache`, поколения и инвалидация. Сигнатуры можно расширить, не ломая вызовы.
- Новое, экспортируемое:
  - `readPrivateImageEntry(userId, path): Promise<{ blob: Blob; etag: string | null } | null>` — то же, что `readPrivateImage`, плюс ETag.
  - `markPrivateImageFresh(userId, path, etag: string | null): Promise<void>` — подтверждение актуальности без перезаписи байтов.
- Константы: `PRIVATE_CACHE_LIMIT_ENTRIES = 500`, `PRIVATE_CACHE_LIMIT_BYTES = 40 МБ`, `PRIVATE_CACHE_MAX_IMAGE_BYTES` без изменений.
- Скрывает: соединение (одно переиспользуемое), раздельное хранение метаданных и байтов либо обновление без перезаписи байтов, пакетное вытеснение, версию схемы IndexedDB.
- Шов теста: `webapp/tests/private-cache.test.ts` с `tests/indexeddb-fake.ts`.

### U4 — Загрузка картинки (`webapp/src/platform/media/use-private-image-url.ts`)
- Не-аватарная ветка: чтение кэша и сетевая проверка параллельно. Условный запрос с `If-None-Match` по ETag кэша. Ответ 304 или тот же ETag дают `markPrivateImageFresh` без скачивания тела. 401/403/404 сохраняют текущее поведение очистки и событий.
- Транспорт через ref: эффект не зависит от identity `transport`.
- Поведение аватарной ветки (пул `AvatarResourcePool`) не менять.
- Нужно проверить заранее: пропускают ли `transport.raw` и `webapp/public/private-media-sw.js` заголовок `If-None-Match` и статус 304. Если SW подменяет кэш-режим, правку SW делать минимальной и покрыть `tests/private-media-sw.test.ts`.

### U5 — Альбомы (`webapp/src/features/albums/`)
- `AlbumsPage.tsx`: `api` не пересоздаётся при смене транспорта (транспорт через ref), дозагрузка в `FreeAlbumGallery` не обрывается.
- `WorkshopGallery.tsx`: `measure` не вызывает `setViewport`, если видимый диапазон не изменился.

### U6 — Нижние листы (`webapp/src/components/ui/drawer.tsx` или общий компонент Vaul-листа)
- Закрытый лист (`data-state="closed"`) не перехватывает нажатия: оверлей и контент получают `pointer-events: none` в состоянии закрытия.
- `webapp/src/features/memoly-ui/AddSheetPresentation.tsx` (или место, где задан заголовок): «Добавить воспоминание» виден один раз. Доступное имя диалога сохраняется (sr-only, если нужно).

## Что построили законченные тикеты

### T01 (b64787b)
- `features/feed/swipe-target.ts`: `isSwipeBlockingTarget(target: EventTarget | null): boolean` — общий фильтр для инлайн-карусели и просмотрщика; кнопки кадра (запуск видео, постер, «Открыть фото» `button.ml-media-button`) не блокируют свайп.
- Харнесс `e2e/fixed-carousel.harness.tsx`: режимы `?video-chain`, `?viewer-geometry`.
- `components/ui/drawer.tsx`: закрытый лист `pointer-events-none` (с `!`).
- `features/albums/ComposerHost.tsx`: запасной блок «Добавить воспоминание» не рисуется при открытом листе.

### T03 (5946fc3)
- `private-cache.ts`: чтения кэша в одном кадре объединяются в одну readonly-транзакцию; публичные сигнатуры прежние. Фейк IndexedDB: `log.transactions`, хук `beforeGet`.

### T02 (коммит после плана, «T02: альбомы показывают фото из кэша сразу…»)
- `private-cache.ts`: `readPrivateImageEntry(userId, path): Promise<{ blob: Blob; etag: string | null } | null>` · `markPrivateImageFresh(userId, path, etag: string | null): Promise<void>` · `privateImageValidator(userId, path): { cached: boolean; etag: string | null } | undefined`. IndexedDB версии 2: байты в отдельном хранилище `imageBytes`, индекс `imageUserId`; одно переиспользуемое соединение; метаданные без перезаписи байтов; лимиты 500 записей / 40 МБ / 2 МБ.
- `use-private-image-url.ts`: не-аватарная ветка — кэш и сеть параллельно, `If-None-Match`, 304 / тот же ETag → `markPrivateImageFresh`; транспорт через ref.
- `features/albums/latest-transport.ts`: `useLatestTransport(transport): AuthenticatedTransport` — стабильный объект, который делегирует к последнему транспорту.
- `features/albums/WorkshopGallery.tsx`: `nextWorkshopViewport(layout, current, measured)`, `visibleHeadings(layout, top, height)`, тип `WorkshopViewport`.
- `tests/indexeddb-fake.ts`: несколько хранилищ, именованные индексы, upgrade, журнал открытий, записей, транзакций и курсоров (обратно совместим).
- Замер: `webapp/e2e/album-timing.local.spec.ts` + `album-timing.local.playwright.config.ts` (порт 5231), `album-timing.local.albums.playwright.config.ts` (5232); не закоммичены, вспомогательные. Фикстура `e2e/fixtures/albums.ts`: параметр `rawDelay`, заголовок ETag.
