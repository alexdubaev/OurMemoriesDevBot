# Источники и определения данных memoLy Control

Проверено по GitHub source `0dbc4c486f3a7841ae2d72d7fc617e552d502941`, 22.10.2026.
Это source audit для ТЗ; реальные production строки, секреты и дисковые метрики не читались.
Ни одна цифра HTML-макета не является фактической статистикой.

## 1. Проверенные точки интеграции

| Файл/символ | Что подтверждено | Следствие |
|---|---|---|
| backend/prisma/schema.prisma: User, ExternalIdentity | nullable email/password; отдельные identities, provider max/telegram | считать distinct User.id, не число identities; не требовать email для MAX |
| тот же файл: Family, FamilyMember, FamilyInvite | active/deleting/deleted; составной ключ familyId/userId; revokedAt/epoch; invite acceptance | одна учётная запись бывает в нескольких семьях; приглашение не пользователь |
| тот же файл: AuthSession | createdAt, updatedAt, expiresAt, revokedAt, externalIdentityId; нет поля пользовательской активности | last login != last seen; updatedAt изменяется служебно |
| тот же файл: MediaAsset, MediaVariant | original byteSize, variant byteSize, purpose, deletedAt/storageDeletedAt | квота != физический объём; derivatives считаются отдельно |
| тот же файл: MaxVideoReference | references/position/duration/thumbnail; нет byteSize оригинального provider video | внешние видео считаются как вложения, байты неизвестны |
| тот же файл: MaxChannelBinding | state, familyId, lastLifecycleAt, lastProviderCheckAt | configured id недостаточно для зелёного «подключён» |
| тот же файл: Memory | occurredAt, firstPublishedAt, status, deletedAt | импорт старого воспоминания не переносит сегодняшнюю загрузку в прошлое |
| тот же файл: MemoryComment, MemoryLike, MemorySeen | отдельные записи; у seen epoch и первый факт просмотра | это не полноценная user-session analytics, raw body не нужен |
| backend/src/modules/users/infrastructure/users-repository.ts: dashboard | totalUsers, totalAdmins, newUsersLast7Days | готового семейного dashboard нет, переиспользовать подход, не выдавать полный admin API |
| backend/src/modules/users/transport/routes.ts | /api/admin требует requireAuth + requireAdmin, содержит role write | новая owner-read граница отдельно, без выдачи глобального admin |
| backend/src/modules/auth/transport/routes.ts | MAX, browser-link start/status/approve, refresh/logout/me | повторно использовать действующий browser login, не новый пароль |
| backend/src/storage/port.ts: PrivateStorage | filesystem/s3, object-level operations, listObjects возвращает key/lastModified | нет готовой общей usage/quota функции; нужен отдельный metrics adapter |
| backend/src/app.ts: /health/live, /health/ready | ready выполняет SELECT 1 через probe с cache 1 сек | DB readiness есть; worker health из этого не следует |
| webapp/vite.config.ts | Rolldown output strictExecutionOrder/vendor groups | добавить multi-entry осторожно, не переписывать конфиг Vite из памяти |
| deploy/selectel/Caddyfile.static.template | общий try_files -> /index.html | /control требует явного entry routing и проверки 404 assets |
| docs/DEPLOYMENT.md | Selectel MAX-only runbook запрещает password-admin seed | доступ к панели не должен возрождать bootstrap старой авторизации |

Кодовые ссылки строятся от:
`https://github.com/alexdubaev/OurMemoriesDevBot/blob/0dbc4c486f3a7841ae2d72d7fc617e552d502941/`.
Реализация обязана сверить свежий source, не принимать этот SHA за вечный production.

## 2. Словарь продуктовых показателей

Все predicates ниже — логическое определение. SQL реализации должен учитывать фактические
enum/constraints свежей схемы. Каждый count/sum агрегируется отдельно до joins.

| ID | Определение | Доступность/ограничение |
|---|---|---|
| accountsTotal | COUNT User.id | все текущие учётные записи; не число людей вне системы |
| accountsWithFamily | DISTINCT User.id с FamilyMember.revokedAt=null и Family.status=active | человек в двух семьях учитывается один раз |
| activeMemberships | число таких FamilyMember | включает создателя; не равно accountsWithFamily |
| familiesActive | Family.status=active | deleting/deleted вынесены отдельно |
| familiesCreated | COUNT createdAt in [from,to) | регистрации сохранившихся строк; не cumulative active historical |
| accountsCreated | User.createdAt in [from,to) | не использовать updatedAt или MAX bot_started |
| invitePending | revokedAt=null, acceptedAt=null, expiresAt>asOf, active family | accepted/revoked/expired не входят; не превращать в users |
| sessionValidNow | revokedAt=null AND expiresAt>asOf | label «Действительные сессии», никогда «Онлайн» |
| lastSessionCreatedAt | MAX AuthSession.createdAt по user | лишь последняя сохранённая сессия; очистка истории делает окно неполным |
| activityUsers | DISTINCT userId в новых daily activity facts за окно | с даты включения; не SUM daily unique |
| activityFamilyUsers | DISTINCT userId в family facts за окно | не суммировать между семьями в глобальную карточку |
| memoryPublished | Memory.status=published AND deletedAt=null | количество публикаций, не вложений |
| memoryPublishedInWindow | live Memory.firstPublishedAt in [from,to) | occurredAt — дата воспоминания, а не загрузки; null не заменять молча |
| commentsCurrent | MemoryComment.deletedAt=null + live parent | только count; body не выбирается |
| reactionsCurrent | MemoryLike + live parent | отдельная метрика, не повторные действия пользователя |
| localAttachments | MemoryMedia JOIN live Memory, DISTINCT mediaId | avatar/poster не считать отдельной пользовательской фотографией |
| providerVideos | MaxVideoReference JOIN live Memory по family+memory | DISTINCT reference.id; attachmentPosition сохраняет состав |
| mediaAttachments | localAttachments + providerVideos, с проверкой disjoint representation | не двойной подсчёт thumbnailMediaId; legacy Telegram отдельно отмечается |
| familiesWithMax | active family с действующей binding, согласованной с maxBackupChatId | состояния unconfigured/disconnected/permission_problem отдельно; возраст проверки виден |

`familyDisplayName` относится к членству; `User.displayName` к аккаунту. В карточке пользователя
показывать membership aliases/roles в списке семей. Owner определяется по ownerUserId, не по full.
Повторное вступление обновляет существующий membership и epoch; оно не создаёт нового User.
Полный исторический граф подключений нельзя восстановить из текущей строки FamilyMember.

## 3. Хранилище: четыре разных величины

1. **Учёт квоты семьи:** Family.storageUsedBytes и storageReservedBytes. Использовать текущую
   конфигурацию family quota из действующего service/env; не копировать 2 ГБ/500 ГБ из макета.
   Проверить места обновления этих counters и не менять их ради отчёта.
2. **Известные физические объекты:** оригиналы, variants, аватары и прочие namespaces.
   Составить read-only inventory по objectKey; один physical object — один раз. Если оригинал
   и variant ссылаются на один key, не складывать byteSize. Удалённое логически, но ещё не
   удалённое физически хранится до очистки. storageDeletedAt означает другую границу.
   UserAvatar — отдельная таблица/хранилище; не забывать её и не приписывать произвольной семье.
3. **Измерение backend/provider storage:** scoped bucket/prefix, filesystem или provider metering.
   Источник, политика current objects/versioned objects и время измерения явно указаны.
   Generic S3 ListObjects не доказывает полный billable usage с noncurrent versions/multipart.
   При provider usage без разбивки по семьям показывать общий объём отдельно от учётного top families.
4. **Host filesystem / PostgreSQL / backups:** БД и backup могут лежать на той же FS.
   PostgreSQL size — часть диска, не отдельный ресурс для суммирования. Host free доступен только
   из измерения нужного mount, не из размера семейных медиа или container overlay.

Плановая provider-neutral схема ресурса:
`resourceId, kind, parentResourceId?, sourceId, scopeLabel, usedBytes, capacityBytes?,
availableBytes?, capacityKind(physical|configured_budget|unknown), accountingBasis,
observedAt, status`. bytes — decimal strings. `other/unattributed` не может быть отрицательным:
при несопоставимых измерениях показать disagreement, не корректировать отрицательное до нуля.
Сумма семейной квоты и реальный storage могут расходиться; это предупреждение, а не повод
автоматически чинить counters или удалять «лишние» файлы.

## 4. Новые данные, которые нужно начать собирать

- daily user activity: unique(userId, utcDay), first/lastObservedAt, последний surface enum;
- daily family activity: unique(familyId,userId,utcDay), first/lastObservedAt;
- метрики источников с observedAt/attemptAt/status/coverage и стабильным sourceId;
- bounded health probe rollups и worker/scheduler evidence;
- snapshots общей численности/объёма для будущей честной динамики.

Это предлагаемая новая схема, а не существующие таблицы. Не хранить raw initData, IP,
user-agent, текст действия, историю просмотренных семейных медиа или содержимое MAX ingress.
У таблиц есть индексы по utcDay/observedAt, userId/familyId для карточек и retention 100 дней.
Исторические графики не backfill из предположений. Registration history из настоящих createdAt
можно показывать с пояснением; активные семьи в прошлом и storage usage требуют снимков.

Для числа активных за последние 7 суток daily гранулярность требует явной семантики:
первая версия считает календарные UTC дни (сегодня и предыдущие 6), начиная в 00:00 UTC.
Для 30/90 — аналогично. Верхняя граница serverNow, сегодняшний bucket неполный.
UI должен писать «За 7 календарных дней» в tooltip. Не выдавать это за скользящие 168 часов.
Период сравнения — предшествующее такое же число полных дней; partial today/coverage отмечаются.

## 5. Границы backend и тестовые данные

Control read repository выбирает только поля DTO. Для family/user lists: aggregate CTE/subquery,
keyset order(value,id), отдельная страница memberships, никакого N+1 на каждую строку.
Синтетический набор: 4 users, 3 active families, один пользователь в двух семьях,
revoked membership, приглашения pending/expired/accepted/revoked, external MAX video,
one original + two variants + shared key fixture, pending deletion, unavailable storage quota.
Assertions должны быть конкретными по рассчитанным fixtures, а не snapshots всей Prisma схемы.
Production DB используется лишь для разрешённых read-only контрольных агрегатов при выпуске.

## 6. Первичные внешние справочные источники

- OWASP Authorization Cheat Sheet: deny-by-default, checks на каждом запросе:
  https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- PostgreSQL 18, system administration functions, pg_database_size:
  https://www.postgresql.org/docs/18/functions-admin.html
- Prometheus naming/cardinality: не делать time-series labels из userId/email/familyId:
  https://prometheus.io/docs/practices/naming/

Это ориентиры реализации и безопасности, не требование внедрить Prometheus или новый SaaS.
