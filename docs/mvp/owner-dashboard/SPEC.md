# MEMOLY-CONTROL — техническое задание

## 1. Результат и границы

Отдельная адаптивная веб-панель владельца memoLy на основе приложенного HTML.
Шесть разделов: Обзор, Семьи, Пользователи, Хранилище, Источники данных (в макете
«Подключения»), Состояние системы. Интерфейс полностью русскоязычный.
Рабочий результат — закрытая панель с реальными данными и временем измерения,
а не опубликованный HTML с числами из демонстрации.

Первая версия — только чтение. Не добавлять удаление семей, impersonation, выдачу ролей,
управление оплатой, массовые сообщения, редактор SQL, запуск команд или настройку произвольных
URL источников из браузера. Не показывать семейные фото, видео, тексты воспоминаний,
комментарии, даты рождения детей, токены, IP-адреса или исходные user-agent.
Имя семьи, отображаемые имена участников и краткое имя ребёнка допустимы в карточке семьи.
Не переносить реальные значения в Git, demo fixtures или скриншоты публичного PR.

## 2. Архитектура и вход

### 2.1. Отдельная страница, существующая инфраструктура

Предпочтительный вариант: `webapp/control/index.html` и собственный entry
`webapp/src/control/main.tsx` в существующем Vite workspace. Выход — `/control/index.html`,
маршрут `/control/`, клиентская навигация по hash для первого выпуска. Семейный App,
его лента, persistent private cache и bootstrap семей не монтируются. Не регистрировать
отдельный service worker и не расширять offline-кэш семейного приложения на admin API.
Стили scoped к `.memoly-control-root`; no leakage в UI v4.

Дополнить текущую Vite/Rolldown multi-entry сборку, не заменяя её настройкой из старой версии
Vite. Сохранить strictExecutionOrder и действующие vendor groups. Static image содержит оба
entry. Caddy обязан отдавать control HTML для `/control/`, а не семейный `/index.html`;
несуществующие control assets возвращают 404, не SPA HTML. Проверить MIME и asset paths.
Не вводить новый платный сервис, домен, БД, Redis или отдельную копию продуктового backend.

Новый модуль `backend/src/modules/control/`, отдельные DTO в
`packages/contracts/src/control.ts`, API `/api/v1/control/*`. Общие helpers использовать через
явные порты/экспорты, не импортировать внутренности соседних доменов. Не расширять старый
универсальный `/api/admin/users/*` так, чтобы панель получила управление ролями.

### 2.2. Доступ владельца сервиса, а не владельца любой семьи

Повторно использовать существующий проверенный MAX browser-link login, refresh/logout и
requireAuth. Не создавать email/password administrator и не включать legacy password routes.
Нужен отдельный server-side guard `requireControlOwner`: действительная сессия плюс точное
совпадение `principal.id` с серверной конфигурацией `CONTROL_OWNER_USER_IDS`.
`Family.ownerUserId`, роль `full` и даже старая роль `admin` сами по себе доступа не дают.
Не доверять userId из query/body, браузерному флагу, имени «Александр» или первой регистрации.
`CONTROL_ENABLED=false` и пустой allowlist — закрыто по умолчанию.

Owner UUID устанавливается через существующий защищённый provisioning после подтверждения
конкретной MAX-учётной записи владельца. Не угадывать UUID по фамилии; при отсутствии
проверенного соответствия нужен только этот конкретный вопрос владельцу. Не публиковать
allowlist в VITE-переменных, HTML, Git или public health. Не менять `User.role` для доступа.
Авторизацию проверять на каждом endpoint, включая детали, CSV и справочники источников.
Неавторизованный запрос: 401; действительная сессия вне allowlist: 403.

Access token — существующий in-memory transport; refresh — действующая защищённая cookie.
Не вводить хранение bearer token в URL/localStorage. При 401/403/logout очистить control
query cache и скрыть уже загруженные данные. После BFCache/восстановления страницы не показывать
чувствительную таблицу до повторного подтверждения сессии. UI не использует persisted queries,
IndexedDB или offline cache. API и экспорты: `Cache-Control: private, no-store`.
CORS, CSRF/Origin, CSP и rate limits не ослаблять. Статический login shell может быть публичным,
но в нём нет данных и конфигурационных секретов. Добавить noindex; это не средство авторизации.

## 3. Экраны

### Обзор

Карточки: активные семейные пространства; уникальные зарегистрированные аккаунты;
уникальные активные люди за выбранный период; измеренный объём основного media storage.
Отдельно подписать аккаунты без семьи, активные членства и ожидающие приглашения.
Периоды 7/30/90 дней. Новые регистрации и наблюдаемая активность — две разные серии.
Недостаток истории отмечается явно; не рисовать историю активности до включения сбора.

Последние семьи и события открывают соответствующую карточку/список. Лента событий —
типизированные события без body/metadata/raw logs: family_created, membership_joined,
memory_published, source_state_changed. Поле joinedAt старого членства не является полным
журналом переподключений. Отображать только подтверждаемые события, не обещать полный audit log.

### Семьи

Серверная пагинация, поиск по имени, фильтр status/MAX state, сортировка по дате создания,
имени, числу активных членств, учтённому объёму и наблюдаемой активности.
Строка: id, имя семьи, краткое имя ребёнка при наличии, владелец, активные участники,
учтённые байты/резерв/квота, опубликованные воспоминания, медиавложения, состояние MAX,
createdAt, lastObservedAt либо «ещё нет наблюдений».
Карточка: те же данные, участники с их ролями в этой семье, метаданные активных приглашений,
разбивка хранения и возраст подтверждения MAX. Никаких invite tokens/ссылок или приватных media URL.
Семья без ребёнка, без медиа, без канала и в status deleting/deleted имеет отдельное состояние.

### Пользователи

Одна строка на `User.id`, не на семью/сессию/ExternalIdentity. Показывать displayName,
createdAt, число активных семей, краткий список семей с «ещё N», последний доступный факт
начала сессии и последний сигнал активности раздельно. Роль показывается в контексте семьи;
у человека нет одной общей «семейной роли». Подробности и длинные списки членств пагинируются.
Приглашённый, ещё не принявший приглашение, не становится зарегистрированным пользователем.

Действительная сессия не означает «онлайн». В первой версии не показывать онлайн-счётчик.
Поверхность MAX Mini App / PWA / browser — отдельный наблюдаемый атрибут, а не вывод из
`ExternalIdentity.provider=max`: browser-link тоже использует MAX identity.

### Хранилище

Четыре независимые сущности: семейный учёт квоты; физические объекты media storage;
файловая система хоста; размер PostgreSQL. Backup storage показывать отдельно и отмечать,
в какой filesystem/bucket он находится. Не складывать вложенные объёмы.
Основной объём по умолчанию — проверенные метрики фактического media storage. При их отсутствии
можно показать «Учтено в memoLy» из БД, но нельзя подписывать его «Занято на диске».
Квота/потолок неизвестны — только bytes, без фиктивных 500 ГБ, свободного места и процентов.
Для S3 чаще это настраиваемый бюджет, не физическая ёмкость: подпись «Бюджет» обязательна.

Разбивка: originals photo/video/voice, derived preview/transcode, child avatars, user avatars,
прочее/неатрибутировано — только для одного совместимого набора и измерения. Внешние MAX-видео
считать как вложения, но не оценивать их байты по длительности/разрешению. Их локальные posters
учитывать отдельно. Нельзя подписывать число публикаций как число файлов.
Прогноз — только при достаточной сопоставимой истории: >=7 полных daily samples за >=7 суток,
явно «оценка», метод расчёта подписан. При нулевом/отрицательном росте срок заполнения не выводить.

### Источники данных

Карточки configured adapters: product_db, media_storage, host_filesystem, postgres_size,
service_probes, max_binding_state, release_evidence/backup_evidence. Для каждого: тип,
возможности, источник измерения, последний успех, последняя попытка, свежесть и sanitized error.
Никаких ключей, bucket credentials, raw endpoints с query parameters или кнопки произвольного
подключения. Отсутствующий адаптер — «Не настроен», не зелёная карточка.

### Состояние системы

Отдельно backend live/ready, static entry, worker progress/liveness, scheduler progress,
PostgreSQL connectivity, outbox backlog/oldestDueAge. Наличие контейнера или отсутствие ошибок
не доказывает работоспособность worker. HTTP 200 главной страницы не доказывает работу всех сервисов.
Для worker/scheduler нужен собственный проверяемый heartbeat/progress или источник мониторинга.
Первый сбор должен поставлять хотя бы backend ready, static, DB size и host disk при выданном
host access. MAX provider outage не выводить из одной только давней успешной привязки канала.

«Доля успешных проверок» и покрытие наблюдения — не SLA uptime. Latency readiness probe — не
медиана всех API-запросов. Request error rate/p50/p95 показывать только по настоящему источнику
этих метрик; иначе unsupported/not_configured. Бэкап: latest artifact + проверенный результат
и дата проверки; зелёный backup не означает, что restore когда-либо проверялся.

## 4. Контракты и API

Новые JSON DTO валидируются общими схемами. Предлагаемые endpoints:

- `GET /api/v1/control/me` — разрешение, serverNow, доступные функции.
- `GET /api/v1/control/overview?days=7|30|90`.
- `GET /api/v1/control/families` и `/families/:familyId`.
- `GET /api/v1/control/families/:familyId/members` и `/invites`.
- `GET /api/v1/control/users` и `/users/:userId`, `/users/:userId/memberships`.
- `GET /api/v1/control/storage`, `/sources`, `/system`, `/events`.
- `GET /api/v1/control/exports/families.csv` и `/exports/users.csv`.

У списков: limit default 25, max 100; q <=100 символов; whitelist sort/filter;
стабильный keyset cursor с версией, sort value и id, привязанный к фильтру/сортировке.
Внутренние child/member joins не должны размножать строки. SQL параметризован.
При изменении фильтра cursor сбрасывается. Unknown/malformed cursor: 400, не SQL error.

Единая оболочка измерения:

```ts
type Sample<T> = {
  value: T | null;
  status: 'ok' | 'stale' | 'error' | 'not_configured' | 'unsupported' | 'insufficient_history';
  sourceId: string;
  observedAt: string | null;       // время фактического измерения
  lastAttemptAt: string | null;
  staleAfterSeconds: number;
  coverageFrom: string | null;
  coverageRatio: number | null;   // 0..1, если имеет смысл
  errorCode: string | null;       // allowlist, не текст исключения
};
```

`value=0,status=ok` отличается от неизвестного `null`. Ошибка нового сбора не перезаписывает
старое успешное значение нулём; UI показывает старое значение с stale/error и датой.
Все timestamps ISO UTC, диапазоны полуоткрытые [from,to), календарная группировка первой версии
UTC с явной подписью «UTC». Семейная timezone не меняет продуктовые aggregate windows.
BigInt bytes/ordinals передавать десятичными строками, не Number с потерей точности.
Счётчики — безопасные целые числа. UI: байты форматируются единообразно (ГиБ = 1024^3).
Проценты скрываются при неизвестном/нулевом знаменателе. Сравнение с пустой прошлой базой:
«нет базы сравнения», не Infinity и не фиктивные +100%.

CSV использует те же права, filters и DTO allowlist; не берёт сырые Prisma rows.
UTF-8 BOM, корректное quoting, нейтрализация формул `= + - @`, TAB/CR/LF и ведущих пробелов
перед ними. Два экспорта в минуту на owner, лимит 10 000 строк и 10 МиБ; превышение — явная
ошибка/предложение сузить фильтр, не молчаливое обрезание. Никаких постоянных публичных export URLs.

## 5. Сбор данных и производительность

Backend агрегирует данные; браузер не подключается к PostgreSQL/S3/SSH. Разрешённые providers
задаются server-side. Интерфейс `MetricSource.collect(signal): Promise<SourceSnapshot>`:
одна реализация на фактически настроенный source, не SDK всех облаков на будущее.
Не менять `PrivateStorage` на административный SDK: создать отдельный read-only metrics port.

DB counters cached/single-flight 30 секунд; storage/DB size — 5 минут; host/probes — 60 секунд.
Физическая inventory большого S3 bucket — отдельный bounded job не чаще раза в сутки либо
готовая статистика провайдера. Не делать list+HEAD всех объектов при открытии dashboard.
Кэш проверяется только ПОСЛЕ авторизации. UI обновляется раз в 60 секунд только видимый раздел,
прекращает запросы в фоне/offline, отменяет их при навигации; manual refresh не обходит лимиты.
Read timeout 5 секунд, один retry с backoff, collector timeout 10 секунд, concurrency <=2.
Тяжёлый сбор не выполняется в auth/feed request и не блокирует сохранение воспоминаний.

Host disk измерять вне контейнерной overlay FS, на allowlisted filesystem через ограниченный
host sampler или существующий мониторинг. Не монтировать docker.sock/host root в web/backend,
не давать приложению SSH/root. При filesystem storage указывать stable filesystemId и shared
resource id, чтобы одна FS не суммировалась несколько раз. PostgreSQL size получать
`pg_database_size(current_database())` с минимальными правами; это не free disk и не WAL/backup.
Все remote endpoints fixed-configured, HTTPS/internal allowlist, bounded payload и redirects;
браузер не задаёт URLs, paths или shell arguments. Ошибки источника не раскрывают секреты.

Для активности добавить минимальный signal без изменения семейного UI: видимый запуск/focus
и реальное взаимодействие, без содержимого действий, координат, текстов и fingerprints.
Не считать background polling, token refresh, health checks и работу worker активностью людей.
Новый `POST /api/v1/activity` (не owner namespace) принимает только ограниченный enum surface
и optional familyId; userId/время задаёт сервер; membership проверяется сервером.
Клиент не чаще 1 события/60 сек на активную вкладку, сервер coalesce <=1 записи/5 минут на
user/family, cross-tab не раздувает distinct counts. Отказ telemetry не ломает приложение.
Никаких постоянных heartbeats в фоне. Это последнее наблюдение, не статус «онлайн».
DAU/WAU/MAU — distinct users в точном окне; нужны daily user records, а не только lastSeenAt.
Отдельные family daily records не суммируются для глобального activeUsers.

Аддитивные таблицы activity/day и metrics snapshots, индексы и retention проектировать
минимально: activity и агрегированная история 100 дней для 90-дневного окна; raw diagnostic
payloads не сохранять. Daily facts после начала сбора; прошлое не выдумывать и не восстанавливать
из created_at/updated_at. Для uptime хранить число попыток/успехов и интервалы покрытия;
пробелы сбора не являются ни успехами, ни доказанными падениями. Очистка ограниченная пакетами.
Техническая запись новых telemetry tables допустима; продуктовые семейные данные панель не меняет.

## 6. Выпуск и критерий готовности

Контроль доступа, реальные SQL aggregates, storage adapters, отображение unknown/stale,
санитизация exports и независимое review обязательны. Проверить desktop 1440 и mobile 390/320,
Chromium/WebKit; скриншоты на синтетических данных. FULL на точном итоговом release SHA,
штатный ci-release.sh, lock/backup/migration/readiness/immutable images и recovery guards.
Точные source attestation изменения для этого выпуска входят в задачу при доказанной совместимости,
не разрешают исключений для произвольных будущих SHA. Новые additive tables отдельно проверяются
current -> permitted v4 recovery -> current; нельзя считать прежнюю аттестацию действующей автоматически.
Если совместимость не доказана — безопасный forward-compatible вариант, не обход guards.

Наличие рабочего login shell не означает готовую панель. Обязательные product counts и семейные
списки должны сверяться с read-only контрольными агрегатами. Реальный host disk/DB size подключены
при имеющемся штатном доступе; отсутствующие внешние credentials отражаются честно и конкретно
указываются в отчёте. Активность после включения реально появляется; старые окна имеют coverage.
Пользователи семей не видят новую навигацию и не получают cross-family API доступ.
Финал: PR/main/runtime SHA, адрес панели, доступ владельца проверен, smoke и recovery PASS,
перечень подключённых/неподключённых источников, никаких demo values в рабочем режиме.
