# MEMOLY-FAMILY-INVITES-ACCESS-FULL-AUDIT

Статус: REVIEW / частичная приёмка. Подтверждённые исправления готовятся в draft PR; полная приёмка задачи остаётся BLOCKED по явно перечисленным ниже сценариям. Merge и deploy не выполнялись.

## Состояние и границы

- Fresh main / base: `e383d79269a3595f4c6cabedf167335aea042cf3` (16 октября 2026).
- Предыдущий ориентир `3abaaa1bcb5011a7cbd99d547f978fdefd5ca71e` проверен по Git: после него в main принят голосовой плеер #175. R1–R5 на fresh main ещё присутствовали.
- Ветка: `fix/family-invites-access-audit`.
- Audited product/test source commit: `62f0a7f1961bbe84b9a836f3d63971111b5f7b66`. Проверки выполнены на его неизменённом product tree перед commit; следующие коммиты содержат только отчёты/синтетические screenshots. Fresh main при финальной сверке остался `e383d79269a3595f4c6cabedf167335aea042cf3`.
- Worktree: `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/family-invites-access-audit`.
- Lead: GPT-6 Codex; discovery/implementation/review делегируются отдельным агентам согласно teamlead-development. Чужие ветки и незакоммиченные изменения не изменялись.
- Область: MAX, MAX Mini App и браузер/PWA с MAX browser-link. Исторические интеграции исключены из требований и приёмки. Старый critical-smoke не запускается и не засчитывается.
- Схема, миграции, auth/media architecture, MAX subscriptions/webhooks и production data не изменяются. Merge/deploy запрещены текущим назначением.

## Принятое владельцем решение о видео

В ходе этой задачи владелец прямо выбрал: **«Владелец и full: согласовать capabilities/UI с сервером»**.

До решения обнаружено расхождение: [принятый PR #25](https://github.com/alexdubaev/OurMemoriesDevBot/pull/25) и MAX direct-video спецификация разрешают OWNER/FULL; сервер MAX и generic media проверяет requireFull; `/me/families` возвращал `canPublishVideo: false`. T-09.5.1 не расширял прежние видеоправа. Новое прямое решение снимает коллизию: готовая семья + full даёт video capability, viewer её не получает. Полномочия владельца от full отделены. Mixed media продолжает использовать действующие MAX attachment sessions; обход запрета private-storage video внутри mixed не добавляется.

## Production: только read-only

Строгий SSH с существующим доступом владельца; содержимое семей и значения секретов не читались/не выводились.

| Runtime | Image tag / OCI revision | Состояние |
|---|---|---|
| frontend (`memoly-static-1`) | `e383d79269a3595f4c6cabedf167335aea042cf3` | running |
| backend | тот же SHA | running, healthy |
| worker | тот же SHA | running |
| scheduler | тот же SHA | running |

MAX_ENABLED=true; ожидаемый публичный bot username `id911018762027_bot`; MULTI_FAMILY_ACTIVATION=on. В `_prisma_migrations`: 48 строк, 48 завершённых, 0 незавершённых. Это read-only запрос только к метаданным миграций.

Публичный `GET https://app.memoly.ru/` вернул HTTP 200. SHA-256 HTML совпал с `/srv/index.html` работающего `memoly-static-1`: `7d114c44ab1a2aa3b95d18deb5401b5fa512032a9ccd1f8284959c0f4e62091f`. Это подтверждает маршрут к текущему static artifact, а не только Docker label.

Дополнительно подтверждены только безопасные поля конфигурации: `PRIVATE_STORAGE_DRIVER=filesystem`, наличие MAX webhook URL и mini-app URL. Локальная проверка private storage использует тот же filesystem driver с отдельным synthetic root. Значения секретов и storage-пути production не выводились.

Сканирование логов текущих контейнеров за доступный период `--since 24h`: backend 9 строк, worker 44280, scheduler 753; во всех 0 строк с маркерами `error`, `invite`, `forbidden`. Контейнеры запущены 16 октября в 18:39 UTC: эти числа не доказывают отсутствие ошибок за полные сутки или успешные реальные приглашения. Выводились только агрегированные счётчики, без строк логов. Итоговый диагностический скрипт завершился exit 0; production-команды ничего не записывали.

## Матрица фактических ролей

Owner определяется `family.ownerUserId`, хранится как membership full; дополнительная роль не вводится. Общая серверная граница: authenticated principal + familyId → действующее членство активной семьи → requireMember/requireFull/requireOwner. UI скрытие не заменяет эту границу.

Ниже зафиксирована фактическая политика по коду. Эта таблица не означает, что каждая ячейка прошла отдельный UI/API тест: исполняемое покрытие и ограничения перечислены далее.

| Действие | Owner | Full non-owner | Viewer |
|---|---|---|---|
| Лента, опубликованные фото/альбомы/видео/голос/заметки | да | да | да |
| Профиль ребёнка, имена/аватары участников | да | да | да |
| Реакции | да | да | да |
| Создание заметки, фото, голоса | да | да | нет |
| Загрузка/публикация видео | да, готовая семья | да, готовая семья; решение владельца выше | нет |
| Редактирование/удаление воспоминаний семьи | да | да | нет |
| Создание приглашения full/viewer | да, готовый профиль | да, готовый профиль | нет |
| Просмотр/отзыв активных приглашений | все | только созданные этим full | нет |
| Имя участника внутри семьи | участник кроме владельца | участник кроме владельца | нет; собственное имя аккаунта — отдельное действие |
| Изменение роли | участники кроме владельца | нет | нет |
| Исключение другого участника | да, кроме владельца | нет | нет |
| Самостоятельный выход | владелец не выходит как обычный участник | да | да |
| Профиль ребёнка/его аватар | да | нет | нет |
| Настройки семьи | да | нет | нет |
| Управление привязанным MAX-каналом | full + проверки MAX admin/provenance | full + проверки MAX admin/provenance | нет |

Основные источники: `families/infrastructure/family-access.ts`, `FamilyService`, `MemoryService` + транзакционный `PrismaMemoryRepository`, `MediaService` + `PrismaMediaRepository`, MAX direct upload и channel-onboarding. UI: App → FamilyScreen / FeedPage → FamilyPresentation / composer. Channel bindings проверяются чтением кода и безопасных тестовых метаданных; реальные каналы не перепривязываются.

В Web/PWA импорт аудиофайла в composer пока недоступен: Owner/Full получают переход в MAX-бот для голосового. Это разрешение на MAX ingress, а не обещание нового Web audio composer.

## R1–R5: подтверждённые дефекты и исправления

| ID / severity | Точный сценарий и причина | Исправление | Доказательство / остаток |
|---|---|---|---|
| R1 / P2 | `/me/families` уже вернул новую роль, но открытая лента/FamilyScreen брали её из старого members | свежий summary обновляет роль и owner flag; после смены роли один guarded members read получает текущую version; membershipEpoch не меняется | actual-App MAX: оставаясь в выбранной семье, viewer→full→viewer через online refresh; Add появляется/исчезает, alias сохраняется по актуальной version, epoch прежний |
| R2 / P2 | expired/revoked/used/not-found invite оставлял пользователя на терминальном экране без перехода к семьям | явная кнопка «Мои семьи», сброс invite state и MAX browser startapp; без повторного accept/создания семьи | actual-App MAX: неизвестный токен → терминальный экран → hub, accept calls=0; expired/revoked/used отдельно проверены API |
| R3 / P2 | приглашение создалось, ответ потерялся; повтор создавал новый UUID и новую ссылку | ключ живёт в одной операции InviteFlow; повтор неопределённой операции сохраняет его; новый flow/изменённый payload получают новый ключ | actual-App MAX: первый POST commit, ответ оборван; повтор использует тот же key, active links=1; новый flow даёт другой key, links=2 |
| R4 / P2 | listInvites не проверял expiresAt; уже загруженный список тоже не старел | фильтр expiresAt > server now, UI expiry timer/resume/online projection для списка/счётчика; записи не удаляются | MAX PostgreSQL regression: 1 pass, 5 assertions; отдельный UI expiry E2E не выполнен |
| R5 / P2 | FamilyScreen просил throw-mode, refreshSelected проглатывал исключение; ошибка чтения смешивалась с результатом сохранения | throw-mode проходит до caller; раздельные mutation/read failures; явное сообщение «Изменение сохранено…», retry выполняет чтение | actual-App MAX: PATCH сохранён, следующий GET=503; показан saved banner без ложной save error; recovery убирает ошибку, PATCH count остаётся 1 |
| F6 / P2 | ready full non-owner разрешён сервером MAX, но family capability всегда false | согласно прямому решению владельца: canPublishVideo = full && ready; launch проверяет capability и актуальную роль | signed-MAX приглашённый Full: reserve/finalize/replay через API и PostgreSQL; Viewer получает 403; одна публикация. Настоящая загрузка в MAX на устройстве BLOCKED |
| F7 / P2 | настоящий MAX approval UI получал `200 {approved:true}`, затем показывал ошибку; повторный MAX exchange при remount переводил epoch E1→E2, а approval использовал AuthApi E1 | публикация epoch перед токеном плюс пересоздание AuthApi по собственному MAX/browser-link epoch, даже при том же токене; constructor-bound stale-response guards сохранены | воспроизведено actual-App E2E; same-token/stale-instance regression проходит; PWA start→MAX approval UI→verifier redeem→authenticated hub проходит |
| F8 / P2 | активный voice-handoff экран, доступный Owner/Full в MAX, содержал переход в неподдерживаемую среду | использовать существующий настроенный hostBridge.openBot для MAX и browser/PWA; адаптеры старой интеграции не меняются | отдельный actual-App MAX regression; неправильный переход не выполнялся; итоговый повтор ниже |
| F9 / P2 | Back во время create invite сбрасывает operation key и позволяет позднему результату менять другой экран | заблокированы UI Back и MAX host Back незавершённой операции; сохраняется ключ неопределённой попытки | независимое review; actual-App проверка disabled Back при удержанном ответе прошла |
| F10 / P2 | createInviteResult сохраняет созданную ссылку, но поглощает ошибку обновления списка без понятного предупреждения | сообщать saved-refresh failure отдельно от создания; оставить готовую ссылку и только read retry | actual-App: готовая ссылка сохранена при GET 503; read retry убирает banner, число create POST не растёт |
| F11 / P2 | ответ сохранения A приходит после выбора B; старое refreshSelected захватывает уже новую selectionVersion и читает A | сверять selected family ID до и после await, включая обработку отказа | real UI red `resume-20261016-203040-cd5d3d7c`; после исправления тот же обычный переход прошёл, B остаётся, старый A read не отправлен |
| F12 / P1, OPEN | media cookie предыдущей MAX session остаётся действительным после замены входа и logout текущей session | исправление не выполнено: требуется отдельное согласование auth/session lifecycle | isolated synthetic diagnostic: B bearer+cookie A →404, logout B →204, cookie-only запрос собственной fixture A после logout →200; A session active, B revoked |

Fixed-tree actual-App сценарии R1/R2/R3/R5 прошли. Отдельные запуски поведенческих regression-тестов R1–R5 на исходных hunks не выполнены и не выдаются за доказательство red→green. Временный R4 тест структуры запроса не засчитывается; оставлено поведенческое PostgreSQL покрытие. F7 ранее воспроизведён в настоящем MAX approval UI до исправления.

## Приглашения, лента, изоляция и private media

Приглашение живёт 72 часа. Сервер хранит хеш токена, выбранную роль и необязательное имя. Accept сериализует пользователя, семью и invite row; роль берётся из сохранённого invite. Повтор успешного accept тем же действующим участником восстанавливает результат; другой пользователь не использует занятую ссылку. После исключения использованная ссылка не восстанавливает членство, новое приглашение увеличивает membershipEpoch. Expiry/revocation не удаляют историю.

| Сценарий приглашения | Реальная проверка / предел доказательства |
|---|---|
| Owner создаёт viewer, Full создаёт full/viewer, Viewer не создаёт | signed-MAX API + PostgreSQL; Owner UI create, переходы viewer↔full в actual App |
| Full видит/отзывает только свои pending invites | API: owner pending invite остаётся после отказа Full; собственный Full invite отзывается |
| Роль/userId/familyId в accept payload | strict contract 422 для лишних полей; membership берётся из действующего invite |
| До join нет private history/media | API 404 и actual-App preview; фото и лента отдельно |
| Expired/revoked/unknown/used-by-other | API: 410/404/409 по контракту; UI terminal recovery отдельно для unknown, used после remove |
| Двойной accept тем же пользователем | параллельные API запросы 200/200, одна membership; повтор результата без новой мутации |
| Два разных invitee, revoke одновременно с accept | real PG race: ровно один победитель 200/409; revoke/accept соответствует одной допустимой сериализации |
| Потерян create response | actual-App commit + разрыв ответа; retry с тем же ключом создаёт одну ссылку, сознательный новый flow — новую |
| Повторный вход MAX после перезапуска страницы | actual-App fresh signed initData + reload; семья и приглашение доступны после MAX auth |
| Optional invitee name и точная граница TTL | поддержка подтверждена кодом; пустое имя исполняется, отдельный UI сценарий непустого имени и граница ровно expiresAt не выполнены |

Обычная лента не отсекается unread baseline: baseline ограничивает счётчик/фильтр непросмотренных. API regression проверяет старую опубликованную фотографию и пустой unread-only при сохранённой обычной истории. Actual-App MAX viewer видит заметку, двухфотографический альбом, голосовую карточку и аватар ребёнка, опубликованные до вступления; это реальные компоненты, API и filesystem storage. Наличие voice controls подтверждено, декодирование на телефонах — нет.

Семья A и B имеют независимые membership, family IDs, query keys и media authorization. API подтверждает запрет владельцу A писать в B с ролью viewer. Actual-App проверяет одинаковые имена, разные профили/историю и запоздалый ответ ленты B после выбора A. Начальные попытки задержанного сохранения останавливались на тестовой навигации; они не засчитываются как ошибки продукта. После правильного закрытия settings sheet и перехода через «Все семьи» позднее сохранение воспроизвело F11. Все отчёты и исходный эксперимент сохранены в `.scratch/recovery-ui-unproven-save-20261016/` и Playwright artifacts.

Private storage: membership проверяется до asset lookup, ETag/304 и Range. Asset scope содержит familyId, stored status, отсутствие deletedAt и опубликованное живое воспоминание либо разрешённый avatar reference. GET и HEAD идут через один authorization path. Финализация привязана к uploader/family и повторно проверяет членство под транзакционной блокировкой. MAX video/playback/poster имеют отдельную guarded ветку.

| Проверка private media | Фактическое доказательство |
|---|---|
| Photo preview/display/original, GET/HEAD/Range 206/If-None-Match 304 | новый MAX API suite, реальная загрузка и filesystem; Viewer разрешён, prejoin/outsider/anonymous/revoked отказ |
| Незавершённая загрузка, удалённое/неопубликованное воспоминание | MAX API suite, отказ; finalize во время remove возвращает отказ и failed asset |
| Media-cookie после исключения | MAX API suite: актуальное membership закрывает доступ |
| Аватар ребёнка, voice card | actual-App реальная загрузка и отображение; полная независимая HTTP-матрица всех ролей/вариантов не выполнена |
| MAX video reserve/finalize Full vs Viewer | отдельный signed-MAX API case, PostgreSQL, синтетический provider port |
| MAX video playback/poster, voice playback, avatar HTTP matrix по всем ролям | код просмотрен; полная новая MAX end-to-end матрица не выполнена; не считать PASS |

## Revocation, session и cache

Query keys включают accountId/familyId/membershipEpoch. Реакции и seen queue используют такой же scope. IndexedDB имеет namespace пользователя и generations; поздняя запись картинки после account/family invalidation отбрасывается. Service worker хранит bearer отдельно для каждого client, HEAD и Range используют no-store. Подтверждённый revoke удаляет семейные queries/изображения, очищает выбранную семью и возвращает hub. Старые асинхронные ответы проверяют scope/version.

Actual-App MAX revocation regression прошёл: viewer поставил реакцию; offline сохраняет уже загруженную историю; owner удаляет membership, отдельный API read возвращает 404; online refresh убирает B и возвращает hub, A остаётся; used invite не возвращает B, новая ссылка открывает старую историю с epoch+1. Один успешный focused run: `resume-revocation-20261016-2330`, 1 pass, 0 fail, 28.2s test / 41.1s total, exit 0.

Ограничение: пока устройство офлайн и не узнало об отзыве, оно может показывать уже сохранённые локальные данные того же аккаунта. Это не новый защищённый серверный запрос. Физическое уничтожение уже загруженных буферов не обещается. Механизмы освобождения медиаресурсов iPhone не переписываются.

## Незавершённые проверки и предложение владельцу

Полную приёмку не объявлять. Пока не подтверждены автоматически: actual-App старое видео и mixed фото/видео у приглашённого; новая публикация после вступления во всех форматах; UI пагинация и все фильтры; незавершённый профиль собственной семьи при приглашении; смена аккаунта с поздним optimistic update; двухвкладочный logout/login с реальным IndexedDB; все варианты private media для каждой роли; отзыв во время настоящего воспроизведения. Частичное покрытие этих границ сервисными тестами не равно полному пользовательскому сценарию.

**F12: отдельное предложение по auth/session, без реализации.** `media/transport/routes.ts:51–62` выдаёт family-path media cookie с access JWT на 300 секунд; `:164–168` выбирает cookie при отсутствии bearer. MAX exchange / browser-link redeem создают новую auth session, не отзывая предыдущую; logout (`auth/transport/routes.ts:207–212`, `auth-service.ts:333–343`) отзывает только текущую refresh session и удаляет refresh cookie (`auth/transport/routes.ts:311–316`). Старый media cookie остаётся связан с предыдущей активной session после замены входа.

Обычный lifecycle воспроизведён на новой `memoly_family_audit_session_20261016_test`: synthetic MAX A создаёт свою семью и публикует реальную тестовую фотографию через upload/finalize; получает media cookie; тот же браузерный набор cookies проходит MAX вход B; B выходит. API с bearer B и media cookie A возвращает 404; после logout B=204 запрос с оставшимся media cookie возвращает 200, A session не отозвана, B отозвана. Ни содержимое файла, ни токены/cookies/идентификаторы семьи в лог не выводились. Диагностический script/log сохранены в ignored `backend/.scratch/session-lifecycle-max-20261017-0110.ts` и `...0116.log`, exit 0; исходная ошибка настройки profile POST вместо PUT и её log также сохранены. Это диагностическое подтверждение HTTP/session поведения, а не routine passing regression, закрепляющий нежелательную политику.

Bearer имеет приоритет, service worker требует текущий bearer; отзыв membership отдельно защищает файл. Появление фотографии A в UI после входа B не воспроизводилось, поведение реального WebView cookie jar не проверялось. Исправления F7 согласованности клиентского epoch эту серверную границу не меняют.

Перед изменением нужен выбор владельца: (A) централизованно очистить/заменить все ранее выданные family-path media cookies при смене входа/logout; либо (B, рекомендуется) завершать ровно предыдущую browser session при её замене и согласовать это с MAX exchange и browser-link redeem, сохраняя независимые сессии других устройств. B требует изменения session lifecycle: `auth/transport/routes.ts`, `max-auth-service.ts`, `browser-link-service.ts`, `auth-repository.ts` и отдельного синтетического MAX login→own media→new login→logout regression. Диагностическое подтверждение уже получено; перед fix оформить его как failing regression с ожидаемым отказом после logout и отдельно проверить same-account replay/multi-device/browser-link. Не менять ACL или auth architecture внутри текущего исправления. Вопрос с этими вариантами отправлен владельцу; до ответа F12 OPEN и блокирует полную приёмку.

Решение о видео уже принято владельцем и повторного вопроса не требует. Схема, миграции и production остаются без изменений.

## Выполненные проверки

Каждая DB-команда получает явные TEST_DATABASE_URL и DATABASE_URL. БД созданы для этой задачи в Docker PostgreSQL 18 `memoly-family-audit-pg18-20261016`, loopback `127.0.0.1:56550`, synthetic user `memoly_audit`. Проверены current_database/current_user; все 48 миграций применены только к disposable DB. Пароли/токены этого окружения синтетические.

| Команда / окружение | Результат | Что доказывает |
|---|---|---|
| `bun install --frozen-lockfile` | exit 0, 864 packages | зависимости по текущему lockfile |
| MAX direct video integration, отдельная `memoly_family_audit_video_test` | 21 pass, 0 fail, 93 assertions, exit 0 | reserve/finalize concurrency, durable idempotency/recovery, membership/author/family guards; MAX provider — тестовый port |
| `capture.integration.test.ts`, целевой MAX role/revoke/channel-status filter, та же отдельная video DB | 6 pass, 0 fail, 27 assertions, exit 0; 94 вне выбранного фильтра | full/viewer/revoked/inactive/childless MAX ingress; mixed revoke до provider fetch; независимый family target; синтетический channel status |
| `capture.integration.test.ts`, MAX native audio + video reference + alternating mixed publication filter | 3 pass, 0 fail, 73 assertions, exit 0; 97 вне выбранного фильтра | настоящий MAX ingestion/services + PostgreSQL, синтетический MAX port; OGG voice, video retry/idempotency, порядок mixed media |
| `bun test webapp/tests/private-cache.test.ts webapp/tests/private-media-sw.test.ts webapp/tests/seen-batch-queue.test.ts` | 11 pass, 0 fail, 39 assertions, exit 0 | provider-neutral cache/SW/seen boundaries |
| `bun test webapp/tests/app-host-auth-race.test.tsx` | 3 pass, 0 fail, 20 assertions, exit 0 | устаревшие MAX auth attempts после замены/unmount |
| `bun run --cwd backend test:integration src/modules/families/invite-expiry-max.integration.test.ts` | 1 pass, 0 fail, 5 assertions, exit 0 | R4 реальный API + MAX identity/session + PostgreSQL, запись сохранена |
| `bun run --cwd webapp typecheck` после R1–R5 | exit 0 | types, включая E2E; не доказывает пользовательский flow |
| `git diff --check` после R1–R5 | exit 0 | формат diff |
| Новый `max-family-audit.integration.test.ts` + отдельный expiry regression, финальный backend run на `memoly_family_audit_verify_20261016_test` | 8 pass, 0 fail, 171 assertions, exit 0; 2.77s | signed MAX auth, preview privacy, old published photo, private protocols/revocation, family isolation, invite races, stale versions, finalize barrier/remove, rejoin epoch, browser verifier, Full non-owner video; log `backend/.scratch/max-family-audit-verify-20261017-0032.log` |
| `max-auth-epoch.test.ts` + `family-video-capability.test.ts` | 2 pass, 0 fail, 9 assertions, exit 0 | старый AuthApi не оживает после own same-token MAX transition; video capability/role/ready |
| Отдельный actual-App MAX Playwright config, Chromium; raw JSON проверен lead | 3 pass, 0 fail, 0 skipped, 0 flaky, 42.6s, exit 0 | browser-link; R1/R3/R5 + prejoin privacy/old photo+note; R2 My Families |
| MAX actual-App old album/voice feed, `resume-20261016-2340-c337` | 1 pass, 0 fail, exit 0; 11.3s test / 23.37s total | настоящие App/FeedPage/cards, старые note/album/voice, child avatar после join; API/storage реальные |
| MAX actual-App offline revocation/rejoin, `resume-revocation-20261016-2330` | 1 pass, 0 fail, exit 0; 28.2s test / 41.1s total | реакция, серверный отказ после remove, online hub, A не затронута, used invite не работает, новая ссылка epoch+1 |
| Финальный набор MAX/cache/session boundaries, 6 файлов | 16 pass, 0 fail, 68 assertions, exit 0 | два новых boundary tests + private-cache/SW/seen/MAX host auth race |
| Backend typecheck после нового Full video case | exit 0 | log `backend/.scratch/max-family-audit-verify-20261017-0034-typecheck.log` |
| Lead final actual-App Chromium, `lead-final-20261016-a78f` | 6 pass, 1 fail, 0 skipped, 0 flaky; 176.4s, exit 1 | шесть сценариев прошли на финальном product source, включая R1/R2/R3/R5/F9/F10/F11 и revoke/rejoin; F8 timeout из-за test waiter после goto при уже успешном MAX auth, отдельный узкий повтор ниже |
| F8 после переноса test waiter до goto, `resume-voicefix-20261017-0030-7c21` | 1 pass, 0 fail, exit 0; 11.2s test / 23.5s total; webapp typecheck exit 0 | реальный composer открывает настроенный MAX bot через hostBridge; product не менялся. Все семь сценариев имеют успешные результаты: шесть в итоговом наборе и один в узком closure run; единый повтор всех семи после test-only fix не выполнялся |
| Lead browser-link на WebKit, `lead-webkit-20261016-9c21` | 1 pass, 0 fail, exit 0; 9.8s test / 21.6s total | настоящий App MAX approval→browser verifier redeem→hub на desktop WebKit. Первый запуск с anchored grep не нашёл тестов, exit 1; не засчитывается |
| Финальный webapp typecheck, architecture, lint | exit 0 каждый; architecture 747 source files; lint 0 errors / 1 warning | warning о dependency apiSessionEpoch намеренный: даже одинаковый token требует нового AuthApi с текущим epoch; убрать dependency ради предупреждения нельзя |
| F12 synthetic MAX session lifecycle diagnostic, новая session DB | exit 0, но подтверждён открытый дефект | B bearer=404, logout B=204, оставшийся A media-cookie=200; это НЕ зелёная security acceptance; код auth/media не изменён |

Один свежий независимый reviewer (`independent_access_review`, read-only) сообщил два P2: F9/F10. Других подтверждённых P0/P1/P2 в просмотренном diff не сообщил; тесты не запускал. Выполнен один ограниченный fix pass; actual-App сценарий обоих замечаний прошёл. Узкая closure-проверка тем же reviewer подтвердила устранение обоих замечаний, новых findings в этих путях нет. Его closure verdict не означает приёмку всего аудита или F12. Второй полный review не запускался согласно политике владельца. F11 отдельно воспроизведён и закрыт lead/worker по реальному UI red→green; F12 относится к неизменённой auth/session архитектуре и остаётся открытым.

Первый финальный webapp typecheck нашёл шесть ошибок только в новых E2E types; architecture check нашёл internal import в новом тесте, lint — два неиспользуемых значения в новом E2E. Исправлено, целевые closure checks прошли; неуспешные запуски сохранены и не выдаются за зелёные проверки. `bun run verify:local` не запускался: его стандартный состав включает исключённые из этой задачи исторические suites; отдельный MAX config не импортирует их. Перед будущим merge требуется согласованный MAX-only gate на точном source SHA. Текущая задача main не публикует.

Воспроизводимые узкие команды (PowerShell; URL задаётся явно для собственной disposable DB, никогда из неявного `.env`):

```powershell
$env:TEST_DATABASE_URL = '<explicit task-owned loopback PostgreSQL URL>'
$env:DATABASE_URL = $env:TEST_DATABASE_URL
$env:TEST_SKIP_DOCKER = '1'
$env:E2E_SKIP_DOCKER = '1'
bun test ./backend/src/modules/families/invite-expiry-max.integration.test.ts ./backend/src/modules/families/max-family-audit.integration.test.ts
bun test ./webapp/tests/max-auth-epoch.test.ts ./webapp/tests/family-video-capability.test.ts ./webapp/tests/private-cache.test.ts ./webapp/tests/private-media-sw.test.ts ./webapp/tests/seen-batch-queue.test.ts ./webapp/tests/app-host-auth-race.test.tsx
bun run typecheck:backend
bun run typecheck:webapp
bun run architecture:check
```

Для actual-App из `webapp/`: `bunx playwright test --config e2e/max-family-audit.playwright.config.ts`. Дополнительно требуются уникальный `MAX_FAMILY_AUDIT_RUN_ID`, свободные `MAX_FAMILY_AUDIT_API_PORT` / `MAX_FAMILY_AUDIT_WEB_PORT`, `ffmpeg` в PATH и установленный Playwright Chromium (WebKit — только для отдельного browser-link smoke). Backend API suite и E2E используют разные назначенные DB; не запускать очистку fixtures параллельно против одной DB. API suite очищает только собственные synthetic rows. Новый filesystem root и отчёты сохраняются на каждый run.

## Сохранность результатов предыдущей сессии

Перед продолжением создан snapshot `.scratch/recovery-20261016-230036-dede72/` (26 файлов, diff и SHA256 manifest) и отдельный recovery report. Коммиты, ветки, чужие worktrees, отчёты и старые логи не удалялись. Старые уже запущенные серверы не останавливались; новые используют другие порты, loopback, уникальный runId и storage root.

Отклонение: унаследованный API-test cleanup во время одного повторного запуска удалил старую фиксированную папку `.scratch/max-family-audit-storage` с синтетическими медиа. Это не production и не отчёты/исходники, но не соответствует требованию сохранить всё; hooks удалены, новый root содержит UUID и сохраняется. Disposable verify DB допускает очистку только собственных synthetic fixtures между тестами. Storage и artifacts больше автоматически не удаляются.

## Физическая приёмка: BLOCKED без устройств владельца

1. На настоящем iPhone/MAX и Android/MAX открыть viewer invite после обычного входа и после перезапуска; подтвердить старые фото/альбом/видео/голос/заметку и реакцию.
2. Принять full invite; добавить видео и mixed фото/видео, проверить просмотр. Viewer не должен получать элементы создания.
3. На iPhone Safari установленной PWA пройти MAX browser-link, открыть приглашение при уже работающем приложении, переключиться между двумя семьями с одинаковыми именами.
4. Во время полноэкранного фото, видео и голоса отозвать доступ со второго устройства; следующий защищённый запрос должен отказать, возврат из фона/сеть должны вернуть «Мои семьи». Уже загруженный буфер не является новым запросом.
5. Повторить logout/login другим MAX-аккаунтом на том же устройстве и в двух вкладках; проверить отсутствие чужой семьи/медиа. После offline→online проверить отказ старой семье и вступление только по новой ссылке.

Desktop Chromium и viewport emulation не подтверждают реальные MAX host, Safari/PWA install lifecycle или декодеры телефонов.

## Изменённые файлы и доказательства

- Backend: `backend/src/modules/families/application/family-service.ts`; новые `invite-expiry-max.integration.test.ts`, `max-family-audit.integration.test.ts`, `test-support/max-family-audit-server.ts`.
- UI: `webapp/src/App.tsx`; `features/family/{api.ts,model.ts,FamilyScreen.tsx,InvitationScreens.tsx}`; `features/memoly-ui/{FamilyPresentation.tsx,AddSheetPresentation.tsx}`.
- MAX/browser epoch: `webapp/src/features/auth/{api.ts,provider.tsx}` — локальная согласованность клиента, без изменения серверной session/ACL архитектуры.
- Tests: `webapp/e2e/max-family-audit.max-e2e.ts`, standalone Playwright/Vite configs; `webapp/tests/{max-auth-epoch.test.ts,family-video-capability.test.ts}`. Имя `.max-e2e.ts` специально не попадает в стандартный исторический harness; используется только явный MAX config.
- Документы: этот отчёт, execution plan, неизменённый recovery report. Изображения только синтетические: [MAX-auth hub](evidence/family-access-max/pwa-max-authenticated-hub.png), [saved/read error](evidence/family-access-max/saved-refresh-failed.png), [viewer после demotion](evidence/family-access-max/viewer-after-demotion.png), [старая лента](evidence/family-access-max/invited-feed-album-voice.png), [повторное вступление](evidence/family-access-max/rejoined-history.png).

Shared contracts, package/lockfile, Prisma schema/migrations, CI/deploy config и механизмы освобождения media не менялись. Runtime secrets, traces/cookies, DB, uploads и сырые диагностические логи в Git не добавляются.

## Откат

Изменения не требуют миграций или восстановления данных. До merge — закрыть draft PR; после отдельно разрешённого merge — обычный revert task-коммита через новый PR с локальными проверками. Production runtime в этой задаче не меняется. БД не откатывать, старые приглашения и membership history не удалять.
