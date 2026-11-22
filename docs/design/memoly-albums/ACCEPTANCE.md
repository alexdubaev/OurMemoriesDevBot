# Приёмка реализации альбомов

Это требования к будущему настоящему приложению. PASS прототипа не заменяет перечисленные проверки. Отчёт должен привязывать результаты к точному source SHA и явно отделять синтетику, desktop WebKit и реальный iPhone/MAX.

## Продуктовая матрица

| Граница | Обязательное доказательство |
|---|---|
| Навигация | Лента/Альбомы/Добавить/Семья в этом порядке;4 равные колонки;Albums активны во вложенных album screens;Plus возвращает origin;Viewer видит Albums,не может публиковать. |
| Каталог | Пустая новая семья без seeded albums;фильтры;реальные cover/count;create→open;edit/reload;delete не удаляет оригинал. |
| Первый год | Ровно12 слотов;8/12 демо не зашито;заполнить5-й→9/12;обзор12;очистить месяц без удаления слота;DOB отсутствует/меняется без потери выбора;первое фото выбирается отдельно от карусели. |
| Открытия | preset/custom;текст без медиа;day/month/year/unknown;нет выдуманной даты;хронология;edit/undo или явный error rollback. |
| Мастерская |224 demo и2000 synthetic works;years/months;3px gaps;8/5/3;фильтр;year jump;pinch focal anchor;single touch scroll;нет случайного click после pinch;viewer/close восстанавливает позицию. |
| Work details | Несколько ракурсов;необязательное название/дата/цитата;категория;массовое добавление с раздельными ошибками;повторы без дублей. |
| Free | Создать пустой;выбрать обложку;ordered items;перестановка с touch и доступной альтернативой;конфликт версии не теряет чужие изменения. |
| Исходники | Одна photo в2 albums без второй storage copy;remove link/delete album не удаляет Memory;удалённый original не доступен в list/detail/cover/playback. |
| Upload | Existing Memory pipeline;новый Memory в ленте+album;lost attach response→same key;failed attach не републикует и не удаляет сохранённую Memory. |

## Права, данные и конкурентность

Только собственные синтетические семьиA/B, Owner/Full/Viewer/outsider/revoked, изолированные `*_test` PostgreSQL и storage. Явные DATABASE_URL и TEST_DATABASE_URL; никакого cleanup чужой базы/production. Новые tests — MAX/neutral, без исторических платформ.

- Чтение/запись album/entry/source/cover другой семьи не проходит ни по URL, ни по подставленным ID.
- Viewer не создаёт/не изменяет/не удаляет на сервере; скрытая кнопка не является доказательством.
- Полномочия проверяются после revoke и при конкурирующей write, session/account switch; stale ответ семьиA не виден вB.
- Публичные DTO без storage keys/provider tokens/временных исходных URL. Media transport не создаёт новый обход family ACL.
- Same idempotency key+payload возвращает тот же результат; altered payload — conflict. Replay после отзыва не возвращает приватные данные.
- Создание year/12слотов атомарно;duplicate request не создаёт второй year. Уникальность экземпляра шаблона не глобальная: пользователь может создать второй по явному новому flow, если продукт это позволяет, без смешения idempotency.
- Удаление исходника в гонке attach/read, скрытые stale thumbnails и cover fallback. Нельзя считать разрешённым attachment только по совпадению UUID без membership+Memory relation.
- Миграция additive, fresh+existing synthetic DB, constraints/indexes; нет destructive rewrite или SQL исправления production memories.
- Date boundaries, leap year/month-end, missing DOB, family timezone;sorting/cursor стабильны на равных датах;unknown отдельная группа.
- Сохранённая мутация+failed refresh отображает saved и retry read-only, не повторный submit.

## Медиа и UI-регрессии

Проверить actual React в320×844,390×844,430×932 и одном desktop viewport. Не создавать общую browser matrix всего приложения.

Обязательные состояния: empty/loading/error/retry,offline,mutation pending,conflict,unavailable source,revoked family,text200%,длинное имя,keyboard иsafe-area0/34px. Нет root horizontal overflow. Полная кнопка≥44px;при8 колонках preview допускается меньше, но доступен zoom и альтернативное открытие списка/крупного режима. Focus возвращается после sheet/viewer. Системный zoom не заблокирован.

Сравнить настоящий экран с эталоном на одинаковом viewport: каталог, year timeline/overview, empty month picker, events, workshop5/8/3, viewer иcreate/edit. Проверять композицию и computed styles;neutral fixture content не входит в pixel comparison. Записать допустимые отличия: реальный artwork темы,production icons/capabilities,loading/errors,реальная авторизация. Не объявлять весь продукт пиксельно совпавшим по одному screenshot.

Сохранённые рабочие стыки: feed carousel/fullscreen index,photo→video→photo,отсутствие frame collapse при metadata/poster,offscreen video stop/source cleanup,shared avatars,existing crop,MAX Back,реальные comments/reactions,author attribution идаты MAX. Проверить узкий существующий media journey, не переписывать его ожидания ради зелёного теста.

Для2000works: pagedAPI,bounded DOM (ориентир≤320tiles на390px),миниатюры lazy,без запроса всех originals/video;после многократного open/close/zoom не растут collections/objectURLs/listeners. Галерея не должна заново загружать всё при изменении масштаба. Измерения desktop — не обещание плавности настоящего iPhone.

## Gate и отчёт

Во время работы — узкие red→green/domain/UI tests. На законченном source — **FULL**, поскольку albums включают backend/contracts/data. Один independent read-only review итогового diff, один bounded fix/narrow closure. No skips/dry-run/нулевыеtests вместоPASS. Runtime текущего сервера и весь accumulated diff сверяются перед доставкой; source-only main не равен production.

Документационный пакет сам не требует runtime deployment. Implementation заканчивается PR→merge→разрешённый guarded Selectel deploy→smoke по актуальному AGENTS. При pending SQL применяется только действующий MAX-only migration entrypoint, а не исторический одноразовый preview operator. Backup/readiness/recovery проверяются для точных версий;DB restore не используется как обычный rollback. Не откатывать к pre-v4 интерфейсу.

Финальный краткий handoff:base/head/PR,типmigration,пройденныеtests/exitcode,FULL SHA,review,actual frontend/backend SHA,deploy/smoke/recovery,непроверенные physicalMAX/iPhone сценарии. Владелец проверяет4вкладки,заполнение месяца,мастерскую zoom/viewer/назад иновое добавление. Не отправлять владельцу технический выбор тестов вместо результата.
