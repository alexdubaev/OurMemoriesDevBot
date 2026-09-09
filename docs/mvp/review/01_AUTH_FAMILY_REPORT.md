# Отчёт блока

Task ID / дата / исполнитель / модель: `01_AUTH_FAMILY` / 2026-09-09 / Codex / GPT-5

Статус: `REVIEW`

Worktree / branch / base SHA / reviewed SHA: `D:\codex\TG_OurMemoriesDevBot\worktrees\t01-auth-family` / `feat/t01-auth-family` / `87b9289c22e08ac68f9fafc954c914776b5bc680` / `a65a6d3a6056691671e34ef2ca45e6e095c876fa`

Review-fix implementation SHA: `c6569245e9123a4c2bbeb649db8323ac6ae36108` (до отчётного commit).

PR / merge SHA: не опубликовано / не слито.

## Выполнено

- Telegram стал единственным публичным источником входа: сервер проверяет HMAC, `auth_date`, future tolerance, duplicate fields и canonical replay fingerprint; при старте `getMe` подтверждает ожидаемый bot username.
- Telegram identity хранится как `ExternalIdentity(provider=telegram, subject=<decimal user id>)`; `User.email` nullable, fake email не создаётся.
- Переиспользован существующий `AuthSession`: access/refresh lifecycle, rotation, HttpOnly cookie, logout, revocation, absolute/session expiry и active-session check.
- Публичны только `/api/v1/auth/telegram`, `/api/v1/auth/refresh`, `/api/v1/auth/logout`; password/email routes доступны только явно включённому test harness, который запрещён при `NODE_ENV=production`.
- Добавлены `PilotAdmission`, `Family`, `FamilyMember`, `Child`, `FamilyInvite` и DB-инварианты: один active membership, owner — active `full`, hash-only invite token.
- Реализованы `FamilyAccess.requireMember/requireFull/requireOwner`, family/member/invite API, cross-family 404, viewer 403, отсутствие admin bypass, немедленная revocation и owner protection.
- Invite: 192-bit random token, SHA-256 at rest, ровно 72 часа, safe preview, atomic `FOR UPDATE` consume, same-user retry, конкурентный single-use и стабильный `409 ALREADY_IN_FAMILY` при гонке двух семей.
- DELETE member/invite идемпотентен для уже отозванной своей записи; чужая запись остаётся 404.
- HostBridge приведён к стабильной границе `initData/metadata`, `ready`, `close`, `back`, `openBot`, `getInsets`: есть Telegram adapter и безопасный browser-dev adapter без альтернативного auth path; `initDataUnsafe` не используется.
- `PATCH /api/v1/families/:familyId` меняет только название, IANA timezone и профиль единственного ребёнка; доступен только owner, остальные роли получают 403, чужая семья — 404.
- Создание семьи и приглашения требует UUID `Idempotency-Key`; результат и payload hash сохраняются атомарно на 24 часа, конкурентный replay безопасен, другой payload получает 409.
- Публичный error envelope унифицирован: server-generated `requestId`, optional `fieldErrors`, `422 INVALID_INPUT`, безопасные русские сообщения и отдельная внутренняя диагностика.
- Active family определена одинаково в БД и сервисах: переход из `active` атомарно отзывает memberships/invites, обратная активация и live access к неактивной семье блокируются constraint triggers.
- Integration runner стабилизирован для общей PostgreSQL: portable Windows paths, отдельный последовательный Bun-процесс на файл и сериализация только bootstrap password operations без ослабления Argon2.

Изменённые границы: `backend/prisma`, `backend/src/http`, `backend/src/modules/auth`, `backend/src/modules/families`, узкие compatibility-изменения `users/uploads`, `packages/contracts`, `webapp/src/platform/{api,telegram}` и integration scripts.

Контракты: добавлены Telegram exchange, family/current-session/member/invite/update schemas, UUID idempotency header и error codes `SESSION_REQUIRED`, `ROLE_FORBIDDEN`, `ALREADY_IN_FAMILY`, `INVITE_USED`, `INVITE_EXPIRED`, `INVITE_REVOKED`, `IDEMPOTENCY_CONFLICT`, `INVALID_INPUT`; email в user DTO стал nullable.

## Проверено

- `bun run verify:plan` — full plan из 8 command IDs, exit 0.
- `bun run architecture:check` — 499 source files, exit 0.
- `bun run template:check` — passed, exit 0.
- `bun run typecheck` — backend/contracts/webapp/website, 0 errors; один существующий deprecation hint website, exit 0.
- `bun run test:contracts` — 24 tests, 108 assertions, 0 fail, exit 0.
- `bun run test:backend:unit` — 313 tests, 903 assertions, 0 fail, exit 0.
- `bun run test:backend:integration` — 79 tests в 11 файлах, 479 assertions, real PostgreSQL, 0 fail, exit 0.
- `bun run test:webapp` — 74 tests, 290 assertions, 0 fail, exit 0.
- `bun run build:webapp` — production Vite build, exit 0.
- `prisma migrate deploy` на чистой изолированной PostgreSQL — 5 migrations applied, exit 0.
- Upgrade fixture Block 00 → Block 01 — legacy `User/AuthSession` сохранены, nullable email и новые FK/index/constraints проверены; повторный deploy — `No pending migrations`, exit 0.
- `git diff --check` — exit 0.
- Secret scan по всем changed/untracked paths: private-key/GitHub/AWS/realistic Telegram-token patterns — 0 matches; `.env` changes — 0.

Все одноразовые Compose containers, networks и volumes проверки удалены.

## Визуальный контроль

Полноценный UI не входит в Блок 01. HostBridge и честный стартовый экран проверены 74 webapp tests и production build. Новых screenshot artifacts нет.

## Независимое ревью

Независимый Sol review выполнен по SHA `a65a6d3a6056691671e34ef2ca45e6e095c876fa`; verdict: `Block 01 changes requested`. Ниже зафиксированы исправления для короткого повторного ревью.

Исправленные findings:

- P1: replay можно было обойти перестановкой подписанных query fields — fingerprint переведён на hash проверенной Telegram signature, добавлен API regression.
- P1: конкурентный accept двух семей иногда возвращал 500 — DB unique conflict преобразован в `409 ALREADY_IN_FAMILY`.
- P2: invite TTL иногда отличался на 1 ms — `createdAt` и `expiresAt` теперь вычисляются от одного clock value.
- P2: невозможная дата наподобие `2024-02-30` проходила нормализацию JavaScript — добавлена строгая calendar-date проверка.
- P2: повторный DELETE отозванного member/invite возвращал 404 — исправлен на идемпотентный 204 без IDOR.
- P2: Bun/Windows мог зависать при конкурентных bootstrap Argon2 operations — bootstrap hash/verify сериализованы; параметры Argon2 не ослаблены.

## Independent review fixes

- **P1.1 Telegram initData HMAC.** Было: `signature` исключалась из bot-token `data_check_string` вместе с `hash`. Изменено: исключается только `hash`; Ed25519 не добавлялся. Доказательство: валидный initData с `signature`, tamper `signature`, duplicate/reordered/replay regression tests в `telegram-init-data.test.ts` и Telegram integration.
- **P1.2 PATCH family.** Было: endpoint и shared update DTO отсутствовали. Изменено: добавлен owner-only `PATCH /api/v1/families/:familyId` только для `name`, `timezone`, `child.displayName`, `child.birthDate`; lookup ограничен active family. Доказательство: contract whitelist и PostgreSQL owner/full/viewer/non-member matrix с 200/403/403/404.
- **P1.3 HostBridge.** Было: граница покрывала только часть архитектурного интерфейса. Изменено: Telegram и safe browser-dev adapters реализуют `initData/metadata`, `ready`, `close`, `back`, `openBot`, `getInsets`; dev adapter всегда возвращает `initData=null`, production entrypoint использует только Telegram adapter. Доказательство: `telegram-host-bridge.test.ts` и production Vite build.
- **P1.4 Idempotency-Key.** Было: creation endpoints не имели нормативной идемпотентности. Изменено: UUID header обязателен для family/invite creation; SHA-256 payload hash, 24-hour record, transaction-scoped advisory lock и resource restore находятся в одной транзакции; другой payload получает `409 IDEMPOTENCY_CONFLICT`. Доказательство: concurrent same-key family/invite creation, changed-payload, missing-key, TTL и retention PostgreSQL tests.
- **P1.5 Error envelope.** Было: legacy code/status, optional requestId и wire `details` расходились с контрактом. Изменено: `422 INVALID_INPUT`, optional `fieldErrors`, server-generated UUID `requestId` в body/header, безопасные русские public messages; diagnostic detail остаётся только в internal logs. Доказательство: strict contract tests, `errors.test.ts`, CORS/rate-limit/auth integration assertions и web client preservation tests.
- **P1.6 Security / integration coverage.** Было: критические boundary-свойства не были полностью доказаны real PostgreSQL. Изменено: добавлены компактные centralized/endpoint tests для cross-family family/child/member/invite, owner/full/viewer/non-member, owner DB invariant, invite state/reuse/concurrency, family-create/two-family races и отсутствия admin bypass. Доказательство: `family-review-fixes.integration.test.ts` + `family-access.integration.test.ts`.
- **P2.1 Active family semantics.** Было: active membership определялась без единого lifecycle, неактивная семья могла удерживать пользователя. Изменено: service queries учитывают `family.status=active`; DB transition атомарно отзывает memberships/invites, запрещает восстановить live access/reactivate family, accept отклоняет inactive family. Доказательство: retirement DB/service integration test и успешное создание replacement family.
- **P2.3 Upgrade migration.** Было: проверялся только clean deploy. Изменено: добавлен fixture, который поднимает Block 00, создаёт legacy `User/AuthSession`, применяет Block 01, проверяет сохранность, nullable email, FK/index/constraints и повторный deploy. Доказательство: `block01-upgrade.integration.test.ts` — 1 test, 7 assertions, exit 0.
- **P2.2 pilot limits.** Не реализовано по прямому решению владельца: лимиты 10 families / 10 members не являются acceptance requirement `01_AUTH_FAMILY.md`; finding остаётся для pilot/release planning.

## Не выполнено / риски

- Ветка не опубликована, PR и CI run отсутствуют.
- Два промежуточных полных integration-прогона завершились native crash Bun 1.4.0 на Windows внутри async `rejects.toThrow` после успешных DB assertions. Эквивалентная явная проверка rejection через `try/catch` устранила нестабильность; последующий полный прогон 79/79 завершился exit 0. Production-код для этого не менялся.
- Реальный development bot token намеренно не использовался в тестах; `getMe` boundary проверен mock-тестом, секреты не выводились.
- Передача ownership не выставлена как пользовательский endpoint: `01_PRODUCT.md` требует отдельную проверяемую операционную процедуру с подтверждением обеих сторон, которой в Блоке 01 не задано. Owner нельзя понизить, удалить или покинуть семью.
- Rollback кода требует совместимости с nullable email и новыми таблицами; уже применённую migration не редактировать. Безопасный rollback данных — отдельная операционная процедура, не `down` migration.

## Следующий шаг

Провести короткий независимый re-review исправлений. До решения владельца не публиковать ветку, не создавать PR, не выполнять merge и не запускать следующий блок.
