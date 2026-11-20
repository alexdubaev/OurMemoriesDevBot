# Заметки: карусель, альбомы, кэш (read-only разведка)

Ветка fix/carousel-albums-smoothness, HEAD 07229917. Пути относительно `webapp/` (если не указано иное). Код не запускался, всё ниже получено чтением кода. Гипотезы помечены H, факты F.

## 0. Карта кода

- F0.1 `src/features/feed/FeedPage.tsx` (1548 строк) содержит всё: `MixedMediaCarousel` (562), `MixedSlideMedia` (656), `MixedMediaViewer` (686, экспорт), `ViewerThumbnail` (929), `Attachment` (938), `TelegramVideo`, `MaxVideo` (1106), `MaxVideoPreviewContent` (1190), `PrivateImage` (1328), `PhotoImage`, `PrivateVideo` (1398), `MemoryDetail` (1476), `usePrivateObjectUrl`, `useFeedVideoPosterUrl`.
- F0.2 Контролы видео: `src/features/feed/video-presentation.tsx` (`VideoPlaybackControls`, `data-slot="video-playback-controls"`). Жизненный цикл: `video-lifecycle.ts` (`useVideoViewportLifecycle`, `releaseVideoSource`). Готовность MAX: `max-video-readiness.ts` (`withMaxVideoReadinessSlot`, лимит 3 параллельных проверки).
- F0.3 Карусель = Embla 8.6 (`useEmblaCarousel`). Embla вешает `touchstart`/`mousedown` на корень и вызывает `watchDrag(api, evt)`. Если вернуть false, перетаскивание не стартует вообще (`node_modules/embla-carousel/esm/embla-carousel.esm.js:305-307`).
- F0.4 CSS: `src/features/feed/presentation/memoly-feed.css` (строки 154-246 база, 363-374, 405-435, 497, 531-562 блок `html[data-ui-version='v2']`, который побеждает). Режим v2 включён (e2e задают `VITE_MEMOLY_UI_VERSION=v2`).
- F0.5 Поверхности App.tsx остаются смонтированными после первого посещения (`visitedSurfaces`, App.tsx:269, 879-889), скрыты через `hidden`. Скролл: `window.scrollTo(0, surfaceScroll.current[screen])` (App.tsx:294).

## 1. Карусель: фото -> видео -> нельзя листать

### Два места, где это может случиться

**Инлайн-лента** (`MixedMediaCarousel`, FeedPage.tsx:562-654):
- `watchDrag` (580) исключает цели: `input, select, textarea, a, [role="slider"], [data-slot="video-playback-controls"], .memoly-private-video-v2-play, .memoly-video-viewer-v2-open`.
- `[data-slot="max-video-play"]` (полноразмерная кнопка MAX) в списке НЕТ, значит инлайн MAX-видео листается. `.memoly-private-video-v2-play` в списке есть, но это кнопка 56x56 по центру (css:234), потеря небольшая.
- Контейнер `.memoly-mixed-viewport { touch-action: pan-y pinch-zoom }` (css:155). Активное видео внутри `MixedSlideMedia` (675-678): `.memoly-mixed-slide-inline-video` -> `Attachment feedPreview`. Для telegram-видео и неактивных видео слайд = постер-кнопка (`.memoly-mixed-slide-poster > button`), это обычный button, drag разрешён.
- `onClickCapture` + `pointerGesture` (633-636): глотает click после перетаскивания >10 px. Свайп не блокирует.

**Полноэкранный просмотр** (`MixedMediaViewer`, 686-927): основной подозреваемый.

### F1.1 Двойная блокировка жеста на полноразмерной кнопке «Смотреть видео» (MAX)
- `MaxVideoPreviewContent` (1256): `<button aria-label="Смотреть видео" data-slot="max-video-play" className="absolute inset-0 z-20 ...">`. Кнопка перекрывает весь кадр видео, показывается пока `!started` (и готовность не processing/unknown/unavailable/check-error).
- В просмотрщике видео, до которого дошли свайпом, не стартует автоматически: `autoplay={position === startIndex && kind==='video'}` (FeedPage.tsx:913). Значит после свайпа с фото на MAX-видео на слайде лежит именно эта кнопка.
- Слой 1: `watchDrag` просмотрщика (716-720) возвращает false, если `target.closest('button, input, select, textarea, a, [role="slider"], video[controls]')`. Цель касания = кнопка (или её `span`), `closest('button')` истина, Embla не стартует.
- Слой 2: `onMediaTouchStart` (766-785): то же условие `target.closest('button, ...')` -> `swipeStart.current = null`. Собственный трекинг оси тоже отключён.
- Итог: на всём кадре видео нельзя листать ни вперёд, ни назад. Жест работает только по полям слайда вне кадра. Это точно совпадает с симптомом «с видео не могу листать ни вперёд, ни назад».
- Для видео из private storage (`PrivateVideo`, 1398) такого нет: кнопка `.memoly-private-video-v2-play` 56x56 по центру, постер `div[aria-hidden]` не button. Значит баг сильнее проявляется на MAX-видео (основной источник видео семьи).

### F1.2 Мёртвые селекторы `video[controls]`
- `<video>` в `MaxVideoPreviewContent` (1242) и `PrivateVideo` (1451) без атрибута `controls`; используются кастомные `VideoPlaybackControls`. Исключение `video[controls]` в `watchDrag` (719) и `onMediaTouchStart` (781) никогда не срабатывает. Это след прежней нативной реализации (git: `3fce2739`, `0dbc4c48`).

### F1.3 После старта воспроизведения
- Кнопка play исчезает. Экранные цели: `<video>` (не исключён), нижняя панель `.memoly-video-playback-controls` (z-index 30, `button` + `input[type=range]`, исключены, css:245-246; в слайде `padding 5px 9px 7px`, range min-height 44 px, итого около 100 px высоты снизу). Свайп по `<video>` работает, по панели нет.
- Свайп с проигрываемого видео в e2e есть: fullscreen-swipe.spec.ts:259, 273 (private-видео, уже запущенное). Свайпа по НЕзапущенному MAX-видео в просмотрщике НЕТ ни в одном тесте. Тест 345 («fullscreen MAX video keeps its preview…») только `play.click({trial:true})` и кнопка «Далее».

### H1.4 Дополнительные слабые кандидаты (проверять после H1)
- touch-action в просмотрщике: `.memoly-mixed-viewer-media[data-media-kind='photo'] { touch-action: none }` (css:204, 552), для видео `pan-y pinch-zoom` (203, 551). Переключается по `data-media-kind={media.kind}` (906). После свайпа на видео браузер получает право на вертикальный pan; контейнер просмотрщика `overflow-y: auto` (css:199). Возможен `touchcancel` при вертикальной составляющей. Обработчик `onTouchCancelCapture` (906) ставит `axis='cancelled'` и откатывает `embla.scrollTo(indexRef.current, true)`.
- Откат в `select` (735-746): если `swipeStart.axis` = 'vertical' или 'cancelled', слайд возвращается на `indexRef.current`. Любая вертикальная составляющая >0.8 горизонтальной (порог `dx >= dy*1.25`) на видео отменяет переключение. Для 4:5 видео в узком кадре люди чаще свайпят по диагонали.
- `photoZoomRef.current > 1 || pinchStart.current` -> watchDrag false (716). `pinchStart` сбрасывается только в `touchend` при `touches.length<2` и в `onTouchCancel`. Если touchend потерян (системный жест), просмотрщик залипает без drag. Нужен рантайм-тест, по коду это только возможность.
- Инлайн: `inert={position !== index}` на соседних слайдах. При `select` активный слайд монтирует `MixedSlideMedia` по-новому (кнопка-постер -> inline-видео). Embla `MutationObserver` смотрит только прямых детей контейнера, так что reInit не вызывается. Влияние не подтверждено.
- `window.__MEMOLY_DIAGNOSTICS__` и `app-zoom.ts` (`installAppZoomPrevention`): блокирующие `touchmove` только при >1 пальце вне `.pswp`/fullscreen. Однопальцевый свайп не трогают.

### Вывод по п.1
Вероятная первопричина: полноразмерная `button[data-slot="max-video-play"]` внутри `memoly-mixed-viewer-media` + исключение `button` в `watchDrag` и `onMediaTouchStart`. Фикс-направление (не делаем): исключать из блокировки только кнопки, не занимающие весь слайд, либо не считать `[data-slot="max-video-play"]` блокирующей целью, но оставлять клик по ней при отсутствии перемещения. Эмуляцию подтвердить Playwright-тестом: открыть `/e2e/fixed-carousel.harness.html?max-mixed`, открыть просмотрщик на фото, свайпнуть на видео, свайпнуть по `button[data-slot="max-video-play"]`.

## 2. Одиночное фото vs фото в мультикарусели (fullscreen)

### F2.1 Пути открытия
- Одиночное фото (kind `photo`, 1 вложение) и мультикарусель оба рендерятся через `MixedMediaCarousel` (FeedPage.tsx:467-469, условие `memory.kind === 'media' || (memory.kind === 'photo' && attachments.length > 0)`). `isCarousel = attachments.length > 1` (588). Клик по фото -> `onOpen` -> `setMixedViewer` -> `MixedMediaViewer`. То есть компонент просмотрщика один.
- Ветка `: primary ? <Attachment .../>` (470) относится только к video/voice.
- Открытие через подпись/карточку (`onOpen` у `MemoryCardPresentation`, FeedPage.tsx:477): для kind `media` и photo с >1 вложением открывается `MixedMediaViewer`, для одиночного фото `setDetail(memory)` -> `MemoryDetail` (1476): нижний лист «Воспоминание», кнопка «Закрыть» (`Button`), дата, `Attachment` во всю ширину (`PrivateImage interactive`), подпись. Тап по фото там открывает `MixedMediaViewer` через `onOpenPhoto`.
- Вывод: «одиночное фото выглядит иначе» вероятнее всего = либо MemoryDetail (по подписи), либо тот же `MixedMediaViewer`, но без элементов мультирежима (см. F2.2).

### F2.2 Различия внутри MixedMediaViewer (windowLength = attachments.length)
Одинаково: `DialogPrimitive` `.memoly-mixed-viewer` (z 71, фон `#141915`), панель `.memoly-mixed-viewer-bar` (автор `.memoly-viewer-author`, счётчик `.memoly-viewer-count`, кнопка `.memoly-viewer-close` «×»), `.memoly-mixed-viewer-media`, `object-fit: contain`, жесты (pinch-zoom до x4, pan, swipe-down >=96 px закрывает только фото, 1 палец).
Только при `windowLength > 1`: нет у одиночного:
- Лента миниатюр `.memoly-viewer-thumbnails` (FeedPage.tsx:921, css:`html[data-ui-version='v2'] .memoly-viewer-thumbnails`, 47 px, flex: 0 0 47px).
- Кнопки «Назад»/«Далее» `.memoly-mixed-viewer-nav` (922, при `total > 1`, min-height 44).
- Счётчик одиночного: «1 / 1».
- Embla: у одного слайда нет snap, `watchSlides` включён, drag нет смысла. `containScroll: 'keepSnaps'`.
- Раскладка: `.memoly-mixed-viewer` = `display:flex; flex-direction:column; justify-content:space-between` (css:199). Высоту `.memoly-mixed-viewer-media` (`flex: 1`) без миниатюр и навигации получает на ~47+44+gap*2 ≈ 120 px больше. Поэтому одиночное фото крупнее и центрируется иначе.
- Фото в мультирежиме: контейнер `.memoly-mixed-viewer-media` в v2 переопределяется `display:block; overflow:hidden` (css:551), слайд `.memoly-mixed-viewer-slide` `display:grid; place-items:center; overflow:clip` (554).
- PR #296 (161b5755) правил `.ml-media-button` в просмотрщике (`grid-template: minmax(0,1fr)/minmax(0,1fr)`, css:208) для вписывания фото. e2e: «fullscreen photos stay centered and fully visible in a short viewport» (fullscreen-swipe.spec.ts:390).

### F2.3 Путь MemoryDetail (альтернативный «вид»)
- Класс `.memoly-detail-surface[data-memoly-feed]` (css:70), `fixed inset-0 z-50 flex items-end`, фон `bg-black/50`, секция `max-h-[90dvh] overflow-y-auto rounded-[var(--radius-card)] bg-card p-5`. Нет жестов, нет pinch, нет счётчика. Это визуально совсем другой экран, чем fullscreen.

### Вывод по п.2
Нужно уточнить у пользователя, какой именно жест открывает (тап по фото или по подписи). По коду: тап по фото даёт один и тот же `MixedMediaViewer`, отличия = отсутствие ленты миниатюр, навигации и более высокая область фото; тап по подписи у одиночного фото даёт `MemoryDetail`.

## 3. Задержка появления фото в альбомах

### F3.1 Путь данных
1. `AlbumsPage.tsx` (517 строк) без react-query: состояние через `useState`, `api = albumsApi(transport, familyId, ...)` в `useMemo` с зависимостью `[transport, ...]` (AlbumsPage.tsx:60).
2. Каталог: `api.list(filter)` (limit 20) -> `api.entries` для первых 4 `year/workshop` альбомов через `albumOpenState.preload` (178-185, задержка 120 мс; `album-open-state.ts`: `PREFETCH_MS 20000`, `MAX_PAGES 4`, `MAX_PREFETCHES 2`). Это кэш в памяти на время жизни страницы, preload только для списков записей, не для картинок.
3. Свободный альбом: `FreeAlbumGallery.tsx`: `api.entries` -> `api.monthSources(albumId, entryId, 'photo', cursor, signal, limit=24)` (api.ts:48) -> пачка по 24 за запрос, следующая по `IntersectionObserver` sentinel (rootMargin 320 px, FreeAlbumGallery.tsx:89-94). Обложка `order[0]`. Первая страница кэшируется `openState.rememberPhotos/photoPage` (до 4).
4. Рендер плиток: `MonthPhotoCollage.tsx` виртуализация (`visible` <= 84 плиток, margin min(vh/2, 450), строка 52-53), `WorkshopGallery.tsx` (`visibleTiles`).
5. Картинка плитки: `SourcePreview.tsx`: `IntersectionObserver` rootMargin 150 px (13) выставляет `visible` один раз, затем `usePrivateImageResource(accountId, previewPath(source), transport, active && visible, undefined, scopeKey, keepWarm ? 'album-preview' : undefined)`. `previewPath` = `attachment.previewPath` (`?variant=preview`, 720 px webp q78, backend `photo-processor.ts:renderDerivative(source, 720, 78)`; display = 1600 q82).
6. `usePrivateImageResource` (`src/platform/media/use-private-image-url.ts:35-252`), не-аватарная ветка (161-235):
   - (a) `await readPrivateImage` (IndexedDB) -> если есть, `showBlob` (`new Image().decode()`);
   - (b) только затем `transport.raw(path, headers X-Private-Media-Purpose: image)` (201). Сеть стартует ПОСЛЕ ответа IDB (даже на промахе);
   - (c) если кэш не показан: `response.clone().blob()` -> `showBlob` (decode) -> `setLoaded`;
   - (d) `cachePrivateImageResponse` (запись + eviction).
7. Service worker `public/private-media-sw.js` для `image` запросов ставит `cache: 'no-cache'` (всегда ревалидация ETag; бэкенд `Cache-Control: private, no-cache`, поддерживает 304: `media-service.ts:331-355`, `routes.ts:70,147`).
8. Мемо-слой `idleAlbumPreviews` (`feed-poster-cache.ts:68`): 16 картинок/12 МБ/20 с, только при `keepWarm`; хранит уже декодированные blob URL при размонтировании. Для >16 плиток бесполезен.

### F3.2 Что сериализует загрузку
- Нет очереди/лимитера на сетевые запросы превью. Параллелизм = число видимых плиток (до 84) в лимите браузера на соединения (HTTP/1.1: 6 на хост; HTTP/2 больше).
- Цепочка стартов последовательна по этапам: страница каталога -> `entries` -> `monthSources` (24) -> рендер -> IO-колбэк -> эффект -> IDB open+get -> `fetch` -> `blob()` -> `decode()`. На каждом этапе ожидание, никакой предзагрузки картинок следующей страницы.
- IDB: `readPrivateImage` вызывает `readEntryWithMetadata` -> `openDatabase()` на каждое чтение (новое соединение `indexedDB.open` для каждой плитки, private-cache.ts:457-464, 519-552). На 24-84 плитках сразу это десятки открытий БД. Чтение само не в `operationQueue`, но readonly-транзакция ждёт завершения активной readwrite-транзакции на том же store.
- После каждого чтения: `touchImageEntry` (417-436) в `operationQueue`: читает ПОЛНУЮ запись и пишет `put({...entry, lastAccess})`, то есть перезаписывает байты картинки при каждом попадании в кэш.
- После каждой сети: `cachePrivateImageResponse` -> `writeEntry` + `evictPrivateImages` (380-415) в той же очереди. `evictPrivateImages` открывает курсор по индексу `userId` и поднимает ПОЛНЫЕ записи (с `imageBytes`) всех картинок пользователя, до 100 штук / 20 МБ, на КАЖДУЮ записанную картинку. N плиток = N полных сканов.

### H3.3 Оценка источников задержки (по убыванию вклада)
- H3.3a Холодный старт плитки: IDB open+get (промах) ~ 10-60 мс на мобильном WebView, затем сеть (+ 304-ревалидация с `no-cache` даже когда картинка уже есть локально), затем `blob()`+`decode()` для 720 px webp. Вдобавок `visible` ждёт IntersectionObserver (асинхронно, минимум один кадр).
- H3.3b Очередь IDB (`operationQueue`) забивается touch/write/evict при открытии альбома. Чтения не в очереди, но блокируются активной readwrite-транзакцией. Таймаут операции 3000 мс (`IDB_OPERATION_DEADLINE_MS`) означает, что зависшая операция держит очередь до 3 с.
- H3.3c Смена `transport` (обновление токена ~каждые 15 мин) перезапускает эффект для каждой видимой плитки (см. п.5).
- H3.3d `monthSources` отдаёт по 24, следующая пачка по sentinel 320 px. Для больших альбомов дозагрузка видна как задержка, пока пользователь скроллит.
- Без измерений численные оценки не подтверждены. Рекомендация для следующего шага: замерить в `/e2e/selected-family-app.harness.html?albums=24&monthPhotos=60` (фикстура `e2e/fixtures/albums.ts`, параметры `albums`, `monthPhotos`, `delayedAlbum`, `delayedPublish`) время от `monthSources` до `img.complete` по плиткам, с включённым и выключенным IDB.

### F3.4 TTL/staleTime
- react-query в альбомах не используется. В ленте: `useFeedQuery` `staleTime` 20_000 (unreadOnly Infinity) (feed/queries.ts:33), `ChildAlbumsStrip` 30_000, `member-avatar-directory` 5_000 + refetchInterval 15_000, `AlbumEntrySocial` `gcTime:0, staleTime:0`, refetchInterval 30_000. `gcTime` по умолчанию 5 мин нигде для картинок не задан.

## 4. «Что-то не так с кэшем»: оценка private-cache

Константы (`src/platform/persistence/private-cache.ts:4-14`): `PRIVATE_CACHE_LIMIT_BYTES` 20 МБ, `PRIVATE_CACHE_LIMIT_ENTRIES` 100, `PRIVATE_CACHE_MAX_IMAGE_BYTES` 2 МБ, `PRIVATE_CACHE_MAX_AGE_MS` 30 дней, `IDB_OPERATION_DEADLINE_MS` 3000.

- F4.1 Лимит 100 записей на ВСЕ картинки пользователя (аватары, постеры MAX, превью, display; `eligiblePrivateImage` 252-269: `content?variant=display|preview`, аватары, `max-videos/*/poster`, `max-channels/*/avatar`). Свободный альбом из 100+ фото (фикстура разрешает до 2000) вытесняет сам себя и ленту. Эвикция по `lastAccess` (LRU) выполняется после КАЖДОЙ записи.
- F4.2 Размер 720 px preview ~30-80 КБ: 100 записей = ~5 МБ, лимит 20 МБ недозагружен, ограничивает именно число записей (100). Для сетки это узкое место, а не байты.
- F4.3 Recency: LRU обновляется асинхронно через `touchImageEntry` в `operationQueue` после чтения. Пока очередь занята, `lastAccess` устаревший, свежепрочитанные записи могут быть выкинуты ближайшей эвикцией.
- F4.4 Кэш читается ДО сети (`readPrivateImage` перед `transport.raw`), но сеть после попадания в кэш идёт всё равно (use-private-image-url.ts:201), и тело скачивается/перезаписывается через `cachePrivateImageResponse` (`response.clone().arrayBuffer()` + write + evict). То есть кэш ускоряет первый кадр, но не снимает нагрузку (и тарифицирует каждую открытую плитку сетью и полной перезаписью записи). Исключение: если `readyUrlAlreadyShown`, кэш не читается, но сеть+запись всё равно идут.
- F4.5 Чтения не сериализуются очередью (`readEntryWithMetadata` вне `enqueue`), записи/touch/evict/clear сериализуются (513-517). Хорошо для чтений, плохо для массовых записей (см. F3.2).
- F4.6 Миниатюры кэшируются (preview входит в `eligiblePrivateImage`), но preview 720 px избыточен для плитки 45-120 px. Отдельного `thumb` варианта нет (`mediaVariantSchema`: display|preview).
- F4.7 Проверки: `blob.size > 2 МБ` -> запись удаляется при чтении (`readPrivateImage` 289-292); content-type из белого списка (jpeg/png/webp/avif/heic).
- F4.8 Таймаут IDB 3 с на каждый open/request/transaction; ошибки глотаются `.catch(() => null)` -> при проблеме IDB поведение «молча без кэша + лишние 3 с на ожидание» (чтение вне очереди, но `openDatabase` ждёт до 3 с).
- F4.9 Инвалидация: `privateFamilyCacheGeneration`, `allowPrivateFamilyCache` бампит поколение при смене/повторном выборе семьи и эмитит `family`-инвалидацию, которую слушают хуки (`invalidationRevision` -> перезапуск эффекта для всех картинок). Смена поколения без смены данных = полная перезагрузка плиток.
- H4.10 Вывод: проблема не в «поломке», а в архитектуре: (1) лимит 100 записей общий; (2) каждый показ = сеть + перезапись + полный скан; (3) каждое чтение = новое соединение IDB + перезапись записи (touch). Кэш может ускорять показ, но создаёт фоновую нагрузку, которая замедляет сам альбом.
- Юнит-тесты: `tests/private-cache.test.ts`, `tests/private-cache-children.test.ts`, `tests/indexeddb-fake.ts`, `tests/private-media-sw.test.ts`, `tests/avatar-resource-pool.test.ts`, `tests/feed-poster-cache.test.ts`. Для `use-private-image-url.ts` и `SourcePreview` юнит-тестов нет (грепом подтверждено).

## 5. Общая плавность

- F5.1 Идентичность `transport`: `provider.tsx:82-89` пересоздаёт `AuthApi` при смене `accessToken`; `provider.tsx:229-235` оборачивает в новый объект `transport` через `useMemo([api])`. Зависимости на `transport`:
  - `use-private-image-url.ts:235` (эффект загрузки каждой картинки): при смене транспорта ранний `return` не срабатывает (`lastRequest.current.transport === transport`), для каждой готовой картинки идёт `transport.raw` + `cachePrivateImageResponse` (скачивание тела, запись, скан эвикции). Массово для всех видимых/смонтированных плиток и фото ленты раз в ~15 мин.
  - `AlbumsPage.tsx:60`: `api` пересоздаётся -> `FreeAlbumGallery` `more` меняется -> `useEffect(() => { void more(); return abort }, [more])` (FreeAlbumGallery.tsx:87) обрывает идущий запрос и перезапускает.
  - `FeedPage.tsx:326` (интервал проверки новых 15 с, пересоздаётся), `feed/queries.ts:91` (реакции).
  - Отдельно `useFeedQuery` ключ без транспорта, перезагрузки ленты нет (хорошо).
- F5.2 `MixedMediaViewer` получает `memory` пересобранный `withCurrentVideoRenditions(...)` на каждый рендер FeedPage (FeedPage.tsx:250). Влияет на мемоизацию, но прямых эффектов от identity `memory` нет (индекс хранится в `useState` + refs).
- F5.3 `PrivateImage` вызывает `image.decode()` на каждый `onLoad`, при смене URL `readyUrl` сбрасывается (`data-seen-ready`), фото в карусели может на кадр показать `aria-label="Загрузка фотографии"` с плейсхолдером (aspect-ratio сохраняется, сдвига нет).
- F5.4 `MixedMediaCarousel`: соседний слайд монтирует `MixedSlideMedia` для фото и видео (±1 + `settledIndex`, FeedPage.tsx:643). Для MAX-видео `MaxVideo` на соседнем слайде включает `useQuery` readiness (`enabled: nearViewport`) и постер, дополнительные запросы при каждом свайпе. `MAX_CONCURRENT_READINESS_CHECKS = 3`.
- F5.5 Соотношение кадра ленты: `getMediaFrameRatio` для микса с видео = фиксированные 0.8 (media-ratio.ts:19), layout shift нет. Для просмотрщика плейсхолдер фиксирован.
- F5.6 Поверхности остаются смонтированными (`hidden`), блобы держатся. После #290/#291/#292/#293 переключение вкладок не пересоздаёт картинки, но IntersectionObserver-эффекты и таймеры живут в скрытых экранах (например, 15 с интервал `checkForNew` ленты и `AlbumEntrySocial` `refetchInterval` 30 с), `active` частично гасит.
- F5.7 `WorkshopGallery`: `measure` на каждый scroll через rAF -> `setViewport`, пересчёт `visibleTiles`; `MonthPhotoCollage` аналогично (с проверкой равенства состояния, у `WorkshopGallery.measure` проверки нет: `setViewport` новым объектом каждый кадр -> лишние рендеры при скролле).
- F5.8 `SourcePreview`: `loading="lazy"` на `<img>` с уже декодированным blob URL избыточен, но не вредит; `visible` никогда не сбрасывается (плитки, раз показанные, держат blob).

## 6. Команды и проверки

- Typecheck (webapp): `bun run typecheck:webapp` = `tsc -b && tsc --noEmit -p tsconfig.e2e.json` (webapp/package.json:`typecheck`). Из корня: `bun run typecheck` (все пакеты последовательно).
- Lint: `bun run lint` (корень) = `eslint .` в webapp.
- Unit: `bun run test:webapp` = `bun test tests` в webapp (docs/TESTING.md:87). Отдельный файл: `bun test tests/private-cache.test.ts` из `webapp/`.
- Build: `bun run build:webapp` = `tsc -b && vite build`.
- Профили проверки: `bun run verify:fast|standard|full` (scripts/verify-local.mjs). STANDARD запускает изменённые `webapp/e2e/*.spec.ts` через одноимённый `*.playwright.config.ts`. FULL включает fixed-carousel и fullscreen-swipe. FRONTEND запускает оба набора целиком при изменении исходников/стилей карусели (docs/TESTING.md:140-144).
- Small-change workflow (docs/development/SMALL_CHANGE_WORKFLOW.md): локация известна, изменение ограничено -> один исполнитель, один осмысленный набор проверок, после фикса перезапуск только затронутой проверки, короткая записка о сценарии. Не менять auth/session/ACL/persistence/private-media/contracts без полного пути (private-cache и SW попадают под «private-media/persistence»: изменения там = НЕ small change).

## 7. E2E харнессы

- `e2e/fixed-carousel.harness.html|.tsx` + `fixed-carousel.spec.ts` + `fixed-carousel.playwright.config.ts` (порт 5196, Desktop Chrome, `VITE_MEMOLY_UI_VERSION=v2`). Режимы по query: `?max-mixed`, `?four-max-videos`, `?lifecycle`, `?voice`, `?fullscreen-swipe`. Запуск: `cd webapp && bunx playwright test -c e2e/fixed-carousel.playwright.config.ts` (ставит Vite сам).
- `e2e/fullscreen-swipe.spec.ts` + `fullscreen-swipe.playwright.config.ts` (порт 5197, проекты `iphone-chromium-cdp-touch`, `android-chromium-cdp-touch`, `iphone-webkit-synthetic-touch`; свайп через CDP `Input.dispatchTouchEvent` или синтетические TouchEvent в WebKit). Запуск аналогично с `-c e2e/fullscreen-swipe.playwright.config.ts`. Тесты: 101 follow-the-finger, 176 direct swipes (видео private), 298 swipe-down, 345 MAX-видео после фото, 374 sync при закрытии, 390 центровка фото.
- `e2e/selected-family-app.harness.html|.tsx` (+ `e2e/fixtures/albums.ts`): query `?albums=N` (3..2000, по умолчанию 24), `monthPhotos=N`, `feedPhotos` (лента из `albums.feedMemories`), `delayedAlbum`, `delayedPublish`, `viewer`, `attachFail`, `homeDelay`, `avatarDelay`, `giftMetadata*`, `channelMemory`. Используют: `albums.spec.ts`, `album-social.spec.ts`, `gifts.spec.ts`, `memoly-v4.spec.ts`. `memoly-v4.spec.ts` имеет свой конфиг `memoly-v4.playwright.config.ts` (порт 5224). `albums.spec.ts` запускается через `playwright.max.config.ts` (`bun run e2e:webapp:max`), отдельного конфига нет; `album-social.spec.ts` через `album-social.playwright.config.ts`.
- Дополнительно: `video-lifecycle.spec.ts`, `memory-longpress.spec.ts`, `shared-author-avatar.spec.ts`.
- Установка браузеров: `bun run --cwd webapp e2e:install`.
- Пробелы покрытия: нет теста свайпа по незапущенному MAX-видео в просмотрщике (п.1), нет теста времени появления плиток альбома, нет проверки перезапуска загрузки при смене `transport`.

## 8. Юнит-тесты по теме (webapp/tests)

`private-cache.test.ts`, `private-cache-children.test.ts`, `indexeddb-fake.ts`, `private-media-sw.test.ts`, `avatar-resource-pool.test.ts`, `feed-poster-cache.test.ts`, `media-ratio.test.ts`, `albums-layout.test.ts`, `albums-child-groups.test.ts`, `month-photo-queue.test.ts`, `retargeted-touch-click-guard.test.ts`, `app-zoom.test.ts`, `playback.test.tsx`, `feed-presentation-unread.test.tsx`, `seen-batch-queue.test.ts`. Для `MixedMediaCarousel`/`MixedMediaViewer`/`use-private-image-url`/`SourcePreview`/`album-open-state` юнит-тестов нет.

## 9. Открытые вопросы

- Q1 Какое именно видео у пользователя (MAX, private storage, Telegram) и какой экран (инлайн или fullscreen)? Гипотеза H1 предсказывает: fullscreen + MAX-видео, ещё не запущенное.
- Q2 Как пользователь открывает одиночное фото: тап по фото или по подписи (MemoryDetail)?
- Q3 Какие размеры альбомов (больше 100 фото в свободных альбомах)?
