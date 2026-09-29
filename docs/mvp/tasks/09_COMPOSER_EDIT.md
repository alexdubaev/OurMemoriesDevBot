# Блок 09 — Добавление из Mini App, редактирование и удаление

**Статус T09: ACCEPTED.** Ручная приёмка владельцем на реальном iPhone внутри MAX пройдена.

**Исполнитель:** Terra; отдельные локальные формы при необходимости можно поручить Luna.
**Назначенное независимое ревью:** Sol — permissions, idempotency/finalize/retry, дубли, destructive actions и отсутствие регрессии уже принятого production video flow.
**Зависимости:** 07 и 08 приняты и слиты в `main`; production MAX Direct Video Upload принят на реальном устройстве, слит в `main` и считается готовой инфраструктурой, которую этот блок обязан переиспользовать.
**Цель:** Обеспечить обычный пользовательский сценарий добавления фото, заметок и видео через Mini App, а также безопасное редактирование и удаление воспоминаний. Голос остаётся форматом продукта: native voice, отправленный memoLy-боту в MAX, принят production flow; запись голоса непосредственно внутри Mini App через `MediaRecorder` переносится на post-MVP.
**Правила работы:** корневой `AGENTS.md`; `../PARALLEL_WORK.md`; для UI также `../ASSET_GUIDE.md`.
**Спецификация:** `../00_START_HERE.md`; дополнительно прочитать: `../01_PRODUCT.md` §§6,8–9, `../design.md` §§D11–D12, `../03_DATA_API.md` §5, `../05_STORAGE_SECURITY.md` §§3–5,8, актуальный project HANDOFF, а также актуальную документацию/код уже принятого production MAX Direct Video Upload. При противоречии старых документов с решениями этого файла приоритет имеет этот файл и более поздние явно принятые решения владельца.
**Design handoff:** [`../../design/memoly-handoff-final/00_START_HERE/README_FIRST.md`](../../design/memoly-handoff-final/00_START_HERE/README_FIRST.md) и его обязательные ссылки; дизайн остаётся источником visual/presentation решений, а реальные contracts и production media flows — источником поведения.
**Стек:** выбранный Vibe — Bun/Hono, PostgreSQL/Prisma, React/Vite, общие Zod-контракты.

## 1. Границы блока

Этот блок — единица сдачи, но внутри выполнять маленькие шаги и сохранять контрольные результаты. Пакет содержит спецификацию; пути ниже — ожидаемые создаваемые/изменяемые файлы, а не утверждение их наличия до начала. Если аналогичный файл уже существует по REPO_MAP, использовать его и указать mapping, не создавать дубль. Все пути относятся к корню проекта.

MVP этого блока:

- OWNER/FULL: добавить фото, заметку и видео из обычного интерфейса Mini App;
- VIEWER: read-only, без create/edit/delete;
- редактирование текста/подписи и даты;
- удаление с подтверждением;
- существующий voice format и playback сохраняются; MAX native voice ingestion через memoLy-бота принят;
- новая запись голоса внутри Mini App не реализуется в этом блоке и остаётся post-MVP (`MediaRecorder`);
- direct video upload не разрабатывается заново: используется уже принятый production Video Composer и существующая MAX upload/finalize infrastructure.

Вне scope:

- AI;
- группы и публичная соцсеть;
- платежи;
- MediaRecorder / in-app microphone recording;
- новый video player;
- второй video storage;
- S3-original для MAX video;
- video transcoding redesign;
- archive ZIP/export;
- Web Access / web invite implementation;
- VK integration;
- Telegram channel import;
- замена файлов внутри существующего Memory;
- broad Feed/Family redesign;
- skin marketplace.

## 2. Актуализация старого T09

Следующие старые формулировки БОЛЬШЕ НЕ ЯВЛЯЮТСЯ КАНОНОМ:

- `NO direct Mini App video upload`;
- `Video only through Telegram bot`;
- `voice/video only through Telegram bot` как единственный product flow;
- старый лимит direct video `100 MB`, если он встречается в T09-связанных документах;
- требование строить новый direct-video transport внутри этого блока.

Актуальное решение:

- production direct video upload уже реализован и принят на реальном iPhone внутри MAX;
- transport: `Browser/MAX WebView → MAX` напрямую, без proxy больших video bytes через memoLy backend;
- production Video Composer уже поддерживает Reserve → direct upload → Finalize → Memory → Feed;
- T09 только подключает этот готовый flow к обычному `Добавить`;
- текущий production video limit — до `250 МБ` для поддерживаемых форматов; байтовая граница уточнена в разделе 8;
- MAX остаётся video storage/delivery adapter MVP, но `Memory.authorId` остаётся внутренним memoLy User и core domain не должен становиться MAX-specific;
- запись голоса внутри Mini App через MediaRecorder переносится на post-MVP, а не удаляется из roadmap.

## 3. Файлы / области изменения

Ожидаемые области, с обязательным переиспользованием существующих компонентов:

- `webapp/src/features/composer/` или фактический существующий composer module;
- существующий Add Sheet / bottom navigation integration;
- Photo Composer;
- Note Composer;
- существующий production `VideoComposer` — ПЕРЕИСПОЛЬЗОВАТЬ, не копировать;
- Memory editor;
- upload client / photo upload flow;
- create/update/delete contracts и adapters;
- tests;
- `webapp/e2e/composer.spec.ts` либо фактический актуальный E2E-equivalent;
- T09-related docs/acceptance, где остались устаревшие Telegram-only/direct-video запреты.

Если текущая структура проекта использует другие пути, применять существующие границы и перечислить mapping в отчёте.

## 4. Add Sheet

Центральная кнопка `Добавить` для OWNER/FULL открывает Add Sheet.

На первом уровне РОВНО три действия:

1. `Фото`
2. `Заметка`
3. `Голос или видео`

Не добавлять на первый уровень отдельные:

- Видео;
- Голос;
- Камера;
- Файл;
- Событие;
- Важная дата;
- AI-действия.

Внизу допускается короткое пояснение, что материалы увидят участники семьи.

VIEWER:

- не получает рабочую кнопку создания;
- центральная область сохраняет текущий read-only/`Просмотр` state;
- прямой запрещённый API-запрос по-прежнему должен отклоняться backend-ом.

Add Sheet должен:

- корректно закрываться через close/back/backdrop;
- не оставлять два модальных слоя одновременно при переходе в composer;
- учитывать safe areas;
- не перекрываться video overlay;
- не создавать horizontal overflow;
- работать на 320/390/430/480 CSS px.

## 5. Фото — Photo Composer

По нажатию `Фото` открыть Photo Composer.

Требования:

- системный picker;
- от 1 до 10 фото;
- preview выбранных фото;
- возможность удалить отдельное выбранное фото до публикации;
- одна общая необязательная подпись/caption;
- дата воспоминания;
- progress;
- cancel;
- retry;
- idempotency;
- понятные recoverable/fatal error states.

Не делать обязательный crop обычных Memory photos. Crop ребёнка/аватара — отдельный существующий flow.

### 5.1. Семантика multi-photo

До 10 фото публикуются согласно существующей canonical Memory/media model проекта.

Не создавать случайно 10 независимых Memory, если текущая модель представляет альбом как одно Memory с несколькими вложениями.

Перед реализацией проверить schema/contracts и сохранить существующую семантику.

### 5.2. Private storage

Фото остаются private media.

Использовать существующую private storage/media architecture проекта. Не создавать новый storage provider или публичные постоянные media URL.

Если нужный reserve/upload/finalize API уже существует — переиспользовать. Если отсутствует минимальная часть photo flow — реализовать её в существующих module/contracts boundaries.

Memory не считается опубликованным до подтверждённого успешного хранения согласно существующей photo-storage policy.

### 5.3. Progress / cancel / retry

Пользователь видит состояние загрузки и может повторить recoverable failure.

При recoverable ошибке:

- caption не теряется;
- date не теряется;
- File objects сохраняются в памяти формы, пока WebView их сохраняет;
- успешные части не должны приводить к duplicate Memory при Retry.

File objects НЕ хранить в `localStorage`, `sessionStorage` или другом durable browser storage.

### 5.4. Photo idempotency

Один idempotency key относится к одной логической попытке создания.

Требование:

`one user create operation → at most one memoLy Memory`.

Double submit / Retry / сетевой повтор не создают duplicate Memory.

## 6. Заметка — Note Composer

По нажатию `Заметка` открыть Note Composer.

Поля:

- body;
- дата воспоминания.

Body обязателен после trim.

Использовать существующий лимит из shared contracts; не придумывать новый лимит, если он уже определён. Старый продуктовый ориентир — до 8000 Unicode code points.

Не добавлять:

- rich text editor;
- Markdown editor;
- AI-writing.

После успешного create:

- composer закрывается;
- Feed обновляется без hard reload;
- новая заметка появляется в существующей note card;
- не возникает duplicate из-за optimistic update + refetch.

Прямая заметка не вызывает Bot API.

## 7. `Голос или видео`

Первый Add Sheet остаётся из трёх действий.

По нажатию `Голос или видео` открыть компактный второй уровень выбора:

- `Видео`
- `Голос`

Это НЕ дополнительные пункты первого Add Sheet.

## 8. Видео — переиспользовать production Video Composer

По выбору `Голос или видео → Видео` открыть УЖЕ СУЩЕСТВУЮЩИЙ production Video Composer.

Не создавать второй uploader и не копировать existing Video Composer.

Переиспользовать уже принятые возможности:

- выбор существующего video file;
- `.mp4`, `.mov`, `.mkv`, `.webm`;
- текущий production limit `250 МБ`: документация MAX для MP4/MOV/MKV/WEBM указывает «до 250 МБ», но не определяет точное число байтов; приложение консервативно допускает не более `250 000 000` байтов;
- в Mixed Media видео использует тот же прямой browser→MAX Reserve/Upload/Finalize и тот же предел; фото сохраняются через private-media path, после готовности всех вложений публикуется одно Memory с исходным порядком;
- caption;
- date;
- Reserve;
- direct browser→MAX upload;
- progress;
- Cancel;
- Retry;
- Finalize;
- idempotency/recovery;
- создание Memory;
- Feed refresh.

Существующий transport НЕ менять:

`Browser/MAX WebView → MAX`.

Не переходить на backend streaming proxy без отдельного нового доказанного blocker и отдельного решения владельца.

Не добавлять:

- S3 original для MAX video;
- second video storage;
- transcoding redesign;
- новый player.

### 8.1. Existing playback

После Finalize использовать существующий playback contract:

`/media/max-videos/:referenceId/content`

Сохранить:

- family membership checks;
- provider message/token re-resolution;
- Range/206;
- текущий inline `<video>`;
- current video card;
- MAX fallback/handoff.

### 8.2. Acceptance entry

Специальный `startapp=max-video-upload-acceptance` был нужен для отдельной production-приёмки uploader-а.

После пройденной T09 manual acceptance:

- если entry больше не нужен — удалить отдельным маленьким cleanup change;
- если нужен как internal diagnostic — оставить только internal/debug semantics, не как пользовательский путь.

## 9. Голос — MVP и post-MVP

In-app voice recording через `MediaRecorder` в T09 НЕ реализуется.

Это НЕ означает отказ от функции навсегда.

Явное решение:

> `In-app voice recording is deferred until post-MVP.`

При выборе `Голос или видео → Голос`:

- если в актуальном продукте уже существует рабочий external/bot handoff для создания voice Memory — переиспользовать его;
- если такого рабочего flow в текущей платформе нет, показать понятное недеструктивное состояние вроде `Запись голоса появится позже`, без пустой/сломавшейся кнопки;
- не запрашивать microphone permission в WebView;
- не создавать fake recorder;
- существующие voice Memory и playback должны продолжать работать.

Post-MVP backlog для voice recording:

- microphone permissions;
- MediaRecorder;
- pause/resume;
- duration;
- preview;
- discard;
- upload/retry;
- interruption/background behavior;
- iOS/Android/MAX/Web compatibility.

## 10. Date handling — единое правило

Не повторять уже найденный production Video Composer bug, когда `today` преобразовывался в будущий `12:00 UTC` и backend возвращал `422 INVALID_INPUT`.

Для Photo/Note/Video composer flows использовать единый date-only → `occurredAt` helper или существующую уже принятую реализацию.

Требования:

- default date = today в `familyTimezone`;
- `max` date = today в `familyTimezone`;
- future date не выбирается;
- если selected date = today → `occurredAt = now`;
- прошлые даты нормализуются единообразно с текущей accepted product logic;
- не копировать в каждый composer отдельный `T12:00Z` hack.

Backend future-date validation не ослаблять.

## 11. Редактирование

Редактируются:

- note body;
- media caption/body;
- occurredAt/date.

Не реализовывать в T09:

- replacement photo attachments;
- replacement video file;
- video re-upload внутри Edit;
- reorder существующих attachments;
- смену автора;
- перенос Memory между family/child.

Edit вызывается из существующего menu `…`, только если capability разрешает.

VIEWER не получает рабочий Edit action.

### 11.1. expectedVersion / 409

Edit использует optimistic concurrency через `expectedVersion`.

При `409`:

- НЕ закрывать editor;
- НЕ очищать body/caption;
- НЕ терять выбранную дату;
- показать понятное сообщение о конфликте;
- сохранить local draft;
- позволить перечитать актуальную server version и безопасно повторить действие согласно существующему contract;
- НЕ делать silent overwrite;
- НЕ добавлять force-update API только ради T09.

Сетевая/recoverable ошибка также не должна стирать draft.

## 12. Удаление

T09 включает delete как часть полного Memory management flow, но если delete уже production-ready — НЕ переписывать его.

Переиспользовать существующий handler/API.

Delete должен:

- требовать capability;
- показывать confirmation;
- объяснять, что запись исчезнет для семьи;
- немедленно скрывать запись после подтверждённого backend success / существующего accepted optimistic flow;
- восстанавливать UI при failure, если используется optimistic removal;
- VIEWER denied;
- physical cleanup выполнять существующим надёжным worker/process согласно storage policy.

Удаление исходного provider message не считать автоматически удалением memoLy Memory, если текущая архитектура явно разделяет эти действия.

Не возвращать старый UX, где confirmation теряет визуальную связь с удаляемой карточкой.

## 13. Draft preservation

Для create/edit recoverable errors:

- body/caption сохраняются;
- date сохраняется;
- File selection сохраняется in-memory, если WebView ещё держит File;
- если platform очистила File, UI явно просит выбрать файл повторно.

Не сохранять приватный draft/file content автоматически в localStorage без отдельного product/security решения.

## 14. Permissions и family isolation

Backend — источник истины.

Create:

- OWNER/FULL allowed;
- VIEWER denied.

Edit/Delete:

- только согласно текущим capabilities/role policy.

Проверить:

- пользователь с двумя family;
- selected child принадлежит selected family;
- нельзя подставить чужой childId;
- нельзя edit/delete Memory другой family;
- revoke между reserve/finalize не даёт завершить запрещённую публикацию;
- старый upload ticket/capability сам по себе не является правом publish.

## 15. Feed integration

После успешных Photo/Note/Video create:

- использовать существующий Feed controller/update mechanism;
- invalidate/refetch или текущий canonical mechanism;
- не делать hard reload;
- не создавать duplicate из-за optimistic + refetch;
- сохранять scroll anchoring, где это возможно.

После edit:

- обновить карточку в Feed;
- не прыгать наверх только из-за изменения подписи.

После delete:

- удалить/скрыть карточку согласно существующему flow;
- rollback UI при ошибке.

## 16. UI / design

Сохранять текущий approved cozy memoLy visual language:

- cream;
- lilac;
- pink;
- soft rounded surfaces;
- текущая typography;
- approved logo/assets;
- fixed bottom navigation.

Не вводить новую design system.

Не переделывать Feed и Family.

Не генерировать logo заново.

### 16.1. Add sheet reference

Старый `design.md` D11 остаётся визуальным ориентиром по sheet geometry, но подписи/действия обновляются этим T09:

- первый уровень: `Фото`, `Заметка`, `Голос или видео`;
- старый первый-level `Фото или видео` заменён;
- старый `Голосовое в боте` заменён общим `Голос или видео` с вторым уровнем.

### 16.2. Composer reference

`design.md` D12 остаётся ориентиром для:

- textarea;
- date field;
- fixed Save над keyboard;
- progress;
- draft preservation;
- edit/409.

Но старые ограничения D12 про Telegram-only voice/video уступают текущему T09 и production Video Composer.

## 17. UX детали

Проверить:

- iOS keyboard;
- textarea font-size не вызывает нежелательный zoom (ориентир 16px);
- primary button над keyboard и safe area;
- confirmation при уходе с реально несохранённой формой;
- focus restoration после sheet;
- Back закрывает media/composer прежде чем уводить из app, согласно текущей navigation architecture;
- нет постоянной offline queue;
- не масштабировать весь экран декоративной 3D-анимацией.

## 18. Порядок выполнения

1. Прочитать текущие contracts/API и существующие composer/media modules. До редактирования перечислить затрагиваемые файлы и mapping старых имён на реальные.
2. Написать короткий implementation plan, не перепроектируя уже working video infrastructure.
3. Реализовать Add Sheet с тремя действиями и role/capability gating.
4. Реализовать/довести Photo Composer и photo create/upload/finalize/retry/idempotency.
5. Реализовать Note Composer/create.
6. Подключить существующий production Video Composer через `Голос или видео → Видео` без копирования transport logic.
7. Для `Голос` переиспользовать текущий working external flow либо оформить явный post-MVP state без MediaRecorder.
8. Реализовать/довести Edit body/caption/date + `expectedVersion`/409/draft preservation.
9. Проверить существующий Delete flow; исправлять только реальные T09 regression/requirements gaps.
10. Провести focused backend/frontend/visual/device acceptance.
11. Обновить только T09-related docs, где остались прямые противоречия текущему flow.

После implementation plan не останавливаться для подтверждения каждой технической мелочи. STOP только по стоп-условиям ниже.

## 19. Обязательные сценарии проверки

### Create / Add Sheet

- **F09.1** OWNER/FULL открывает Add Sheet и видит ровно `Фото`, `Заметка`, `Голос или видео`.
- **F09.2** VIEWER не получает create UI; ручной запрещённый POST отклоняется backend-ом.

### Note

- **F09.3** Прямая заметка создаётся без Bot API.
- **F09.4** Whitespace-only note отклоняется; recoverable error не стирает draft.

### Photo

- **F09.5** 1 фото создаёт одно логическое Memory после подтверждённого upload/finalize.
- **F09.6** 10 фото поддерживаются согласно canonical album semantics.
- **F09.7** 11 фото отклоняются до публикации.
- **F09.8** Отмена/retry не создают duplicate Memory; caption/date сохраняются.
- **F09.9** Double submit не создаёт дубль.

### Video

- **F09.10** `Голос или видео → Видео` открывает существующий production Video Composer, а не новый uploader.
- **F09.11** Реальный video проходит существующий Reserve → direct MAX upload → Finalize → Memory → Feed flow.
- **F09.12** Progress/Cancel/Retry работают через normal Add flow.
- **F09.13** Файл больше `250 000 000` байтов отклоняется согласно текущей production video policy; старый 100 MB limit не возвращается.

### Voice

- **F09.14** `Голос` НЕ запрашивает microphone permission и НЕ создаёт MediaRecorder в MVP.
- **F09.15** Existing voice memories продолжают воспроизводиться; current external voice handoff либо явный post-MVP state не ведёт в пустой экран.

### Edit/Delete

- **F09.16** Edit body/caption/date использует expectedVersion.
- **F09.17** Устаревшая версия вызывает `409`, draft не теряется, silent overwrite отсутствует.
- **F09.18** Правка caption/date не заменяет attachment/file hash.
- **F09.19** Delete требует подтверждения и скрывает Memory у семьи согласно существующему accepted flow.
- **F09.20** Viewer не может edit/delete прямым API.

### Date / isolation

- **F09.21** Today в familyTimezone не превращается в future timestamp; future date заблокирована.
- **F09.22** Чужая family/child/Memory не доступны через подстановку ID.

## 20. Проверочный цикл

Для каждого существенного изменения:

- [ ] Найти существующие границы и перечислить затронутые файлы до редактирования.
- [ ] Написать/уточнить ближайший релевантный test.
- [ ] Где возможно, получить RED, относящийся к нужному поведению, а не к окружению.
- [ ] Реализовать минимальное изменение в существующем module boundary.
- [ ] Запустить тот же test и только связанные проверки области влияния.
- [ ] Проверить diff.
- [ ] В конце блока выполнить одно независимое назначенное Sol review по permissions/idempotency/finalize/destructive actions и video regression; не запускать бесконечный review loop.
- [ ] Записать команды, результаты и ограничения в отчёт по `../review/BLOCK_REPORT.md` либо текущему canonical report format проекта.
- [ ] Передать владельцу результат и остановиться до merge/deploy/manual acceptance, если на это нет отдельного разрешения.

## 21. Команды проверки

Использовать фактические команды текущего repo. Старые команды ниже — ориентиры, а не повод создавать дубль test harness.

Минимальный набор должен включать релевантные аналоги:

    bun run test:webapp
    bun run --cwd webapp e2e -- composer.spec.ts
    bun run test:backend:integration -- <relevant media/memory tests>
    bun run typecheck:webapp
    bun run typecheck:backend
    bun run build:webapp
    bun run architecture:check
    git diff --check

Не считать «0 tests found» успехом.

Не запускать нерелевантные тяжёлые suites только ради объёма отчёта. Если full-tree check имеет доказанные pre-existing unrelated failures, перечислить их отдельно и не смешивать с регрессиями T09.

## 22. Visual QA

Проверить минимум:

- 320 px;
- 390 px;
- 430 px;
- 480 px.

Особенно:

- Add Sheet;
- keyboard;
- textarea;
- photo previews;
- progress/error/retry;
- date input;
- fixed nav;
- safe areas;
- отсутствие horizontal overflow.

Статический CSS review не считать visual acceptance.

## 23. Что показать владельцу

На реальном iPhone/MAX после deployment:

1. OWNER/FULL открывает `Добавить` и видит 3 действия.
2. Добавить 1 фото с caption/date → Memory в Feed.
3. Добавить несколько фото (в том числе проверить upper limit) → правильная album semantics, без дублей.
4. Создать Note → Memory в Feed.
5. `Голос или видео → Видео` → открывается тот же production Video Composer.
6. Video: progress → Cancel → Retry → Save → Memory в Feed → playback.
7. `Голос` не запускает MediaRecorder; показывает рабочий current handoff либо честный post-MVP state.
8. Edit caption/body/date.
9. Проверить 409/draft preservation на тестовом конфликте, если environment позволяет безопасно воспроизвести.
10. Delete после confirmation.
11. VIEWER не имеет create/edit/delete.

## 24. Критерий готовности / Definition of Done

T09 готов, когда:

1. Add Sheet имеет ровно 3 действия: `Фото`, `Заметка`, `Голос или видео`.
2. OWNER/FULL могут добавить 1–10 private photos.
3. Photo create поддерживает caption/date/progress/cancel/retry/idempotency.
4. OWNER/FULL могут создать Note.
5. Video открывается через normal Add flow и ПЕРЕИСПОЛЬЗУЕТ уже готовый production Video Composer.
6. Direct video upload не реализован второй раз и существующий MAX transport не сломан.
7. MAX native voice ingestion через memoLy-бота принято; in-app recording явно deferred post-MVP.
8. MediaRecorder отсутствует в T09.
9. Edit body/caption/date работает.
10. expectedVersion/409 работает без silent overwrite.
11. Draft не теряется при conflict/recoverable errors.
12. Delete работает через существующий capability flow.
13. VIEWER не может create/edit/delete.
14. Feed обновляется без hard reload и без дублей.
15. Existing photo/video/voice playback не сломан.
16. Family isolation сохранена.
17. Today/future date logic не повторяет уже исправленный video bug.
18. Manual iPhone/MAX acceptance пройдена владельцем, включая MAX native voice: отправка боту, Voice Memory в Feed, Play/Pause/Seek — PASS.
19. T09-related docs больше не требуют отказаться от уже принятого direct video upload и не возвращают старый 100 MB video limit.
20. Голосовая запись внутри приложения явно записана в post-MVP backlog, а не удалена из планов.

## 25. Стоп-условия

STOP только если:

- current API/data model фундаментально не поддерживает photo 1–10 и требуется продуктовое решение;
- для Note/Edit нужна destructive migration;
- existing production Video Composer нельзя переиспользовать без redesign;
- current voice flow отсутствует и невозможно реализовать честный post-MVP state без нового продуктового решения;
- требуется ослабить auth/security/role model;
- deployment требует неразрешённый destructive action.

Не STOP из-за обычных implementation bugs.

Невозможность запустить обязательный test отмечается `BLOCKED` с конкретной причиной; не заменять его проверкой синтаксиса. Локальный успех не доказывает production readiness.

## 26. Визуальные референсы пакета 2.3

Сохраняются как статические визуальные ориентиры, но их старая логика уступает текущему T09 и production flow:

- [S07 — Новая заметка](../../../references/screens/S07.webp)
- [S08 — Фотоальбом с подписью](../../../references/screens/S08.webp)
- [S09 — Новое видео](../../../references/screens/S09.webp)
- [S10 — Загрузка медиа](../../../references/screens/S10.webp)
- [S11 — Изменение подписи и даты](../../../references/screens/S11.webp)
- [S12 — Удаление записи · подтверждение](../../../references/screens/S12.webp)
- [S18 — Как добавить голосовое](../../../references/screens/S18.webp)
- [S32 — Лимит тестового архива](../../../references/screens/S32.webp)
- [S34 — Конфликт редактирования](../../../references/screens/S34.webp)
- [S40 — Ошибка загрузки · повтор](../../../references/screens/S40.webp)

Статические референсы показывают состояние, но не подтверждают работу API. Для одного подшага передавать только нужные 2–5 изображений. Старые Telegram-only подписи на референсах не переопределяют текущую product logic.

## 27. Финальный отчёт блока

Весь финальный отчёт вернуть ОДНИМ markdown code block.

Обязательно указать:

### Repo
- worktree;
- branch;
- base HEAD;
- final HEAD;
- git status.

### Add Sheet
- три действия;
- VIEWER state.

### Photo
- 1–10;
- storage/create flow;
- progress/cancel/retry;
- idempotency.

### Note
- create;
- validation;
- Feed refresh.

### Video
- existing production Video Composer reused: yes/no;
- direct MAX transport unchanged: yes/no;
- duplicate uploader created: yes/no.

### Voice
- current MVP behavior;
- MediaRecorder implemented: NO;
- post-MVP backlog documented: yes/no.

### Edit/Delete
- fields;
- expectedVersion/409;
- draft preservation;
- delete/capability behavior.

### Permissions / Isolation
- OWNER;
- FULL;
- VIEWER;
- wrong family/child protections.

### Verification
- focused backend/frontend tests;
- typechecks/build;
- architecture/lint where relevant;
- visual QA;
- independent Sol review.

### Docs
- какие устаревшие T09 statements обновлены.

### GitHub
- commit;
- PR;
- CI.

### Manual acceptance
- результаты ручной проверки владельца.

Принятый статус блока: `ACCEPTED`. Факты ручной приёмки записаны ниже.

После этого STOP.

Не начинать T09.5 Web Access самостоятельно.

## Manual acceptance

21 сентября 2026 владелец принял normal Add flow на реальном iPhone внутри MAX. Add Sheet содержит `Фото`, `Заметка`, `Голос или видео`.

- **Note: PASS.** Создание заметки через рабочий production flow.
- **Video: PASS.** `Добавить → Голос или видео → Видео` открывает существующий Video Composer; direct browser → MAX upload и Finalize создают Memory в Feed, playback работает.
- **Photo: PASS.** JPEG через normal Photo Composer проходит upload → finalize → Memory → Feed. Последний production fix — [PR #42](https://github.com/alexdubaev/OurMemoriesDevBot/pull/42), merge/deployed SHA `27b2ad4f6a0fe22f72e152796875ea77cfb4c89e`: Caddy направляет обычные API/storage-запросы в единственный backend с нужным filesystem storage root. Общий Docker alias ранее мог разделить одну операцию между контейнерами с разными storage roots.
- **MAX native voice: PASS.** Обычное voice message, отправленное memoLy-боту в MAX, проходит `message_created` / `audio` → provider media → private Voice pipeline → Voice Memory в Feed; Play, Pause и Seek работают. Production capability принята в [PR #49](https://github.com/alexdubaev/OurMemoriesDevBot/pull/49), merged/deployed SHA `04cf58fa94825972aee0b4e7a5aef28f4c9a5540`.

T09 принят владельцем. VIEWER остаётся read-only; create/edit/delete доступны только согласно capabilities. MAX native voice ingestion через memoLy-бота — ACCEPTED; in-app voice recording через Web `MediaRecorder` deferred until post-MVP.

## Accepted flows and next steps

Без отдельной доказанной bug/product причины считаются frozen: Photo create/upload/finalize, Note create, Video Reserve/direct upload/Finalize, MAX audio classification, provider download/resolver, private Voice media pipeline, `SourceMemoryPublisher`, существующий media playback, permissions и idempotency. Для Photo source of truth — существующий flow в `webapp/src/features/family/api.ts`; параллельный Photo uploader не создавать. Video Composer переиспользовать, не копировать. Presentation changes не должны создавать новую media orchestration. Будущие UI/design задачи не должны переписывать MAX audio classification, provider download/resolver, private Voice media pipeline, `SourceMemoryPublisher`, idempotency или Voice playback без отдельной доказанной bug/product причины.

Future design migration must preserve the accepted Photo, Note and Video business flows and integrate through their existing controllers/contracts rather than creating parallel upload/create implementations.

Порядок следующей работы: 1) дочистить остатки старого UI и добиться faithful HTML parity; 2) зафиксировать чистый UI baseline; 3) добавить новые Profile / Family Member screens в canonical HTML; 4) реализовать profile/avatar/name logic; 5) затем T09.5 Web Access. Это порядок roadmap, а не начало следующего блока.
