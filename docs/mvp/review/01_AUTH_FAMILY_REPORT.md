# Отчёт блока

Task ID / дата / исполнитель / модель: `01_AUTH_FAMILY` / 2026-09-09 / Codex / GPT-5

Статус: `REVIEW`

Worktree / branch / base SHA / implementation SHA: `D:\codex\TG_OurMemoriesDevBot\worktrees\t01-auth-family` / `feat/t01-auth-family` / `87b9289c22e08ac68f9fafc954c914776b5bc680` / `979f1f1a52d1c1c085fdb05890ce5fe58ba67067`

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
- Добавлен минимальный Telegram HostBridge: raw `initData` для server exchange, safe metadata/readiness/insets; `initDataUnsafe` и browser dev-auth не используются.
- Integration runner стабилизирован для общей PostgreSQL: portable Windows paths, отдельный последовательный Bun-процесс на файл и сериализация только bootstrap password operations без ослабления Argon2.

Изменённые границы: `backend/prisma`, `backend/src/modules/auth`, новый `backend/src/modules/families`, узкие compatibility-изменения `users/uploads` tests и nullable email, `packages/contracts`, `webapp/src/platform/telegram`, `verification-map.json`, integration scripts.

Контракты: добавлены Telegram exchange, family/current-session/member/invite schemas и error codes `SESSION_REQUIRED`, `ROLE_FORBIDDEN`, `ALREADY_IN_FAMILY`, `INVITE_USED`, `INVITE_EXPIRED`, `INVITE_REVOKED`; email в user DTO стал nullable.

## Проверено

- `bun run verify:plan` — full plan из 8 command IDs, exit 0.
- `bun run architecture:check` — 496 source files, exit 0.
- `bun run template:check` — passed, exit 0.
- `bun run typecheck` — backend/contracts/webapp/website, 0 errors; один существующий deprecation hint website, exit 0.
- `bun run test:contracts` — 22 tests, 99 assertions, 0 fail, exit 0.
- `bun run test:backend:unit` — 309 tests, 892 assertions, 0 fail, exit 0.
- `bun run test:backend:integration` — 72 tests в 9 файлах, 421 assertions, real PostgreSQL, 0 fail, exit 0.
- `bun run test:webapp` — 74 tests, 282 assertions, 0 fail, exit 0.
- `bun run build:webapp` — production Vite build, exit 0.
- `prisma migrate deploy` на чистой изолированной PostgreSQL — 4 migrations applied, exit 0; повтор на той же БД — `No pending migrations`, exit 0.
- `git diff --check` — exit 0.
- Secret scan: private-key/GitHub/AWS/realistic Telegram-token patterns — 0 matches. Общий эвристический scan нашёл только три явно synthetic test fixtures; реальные значения и `.env` не добавлены.

Все одноразовые Compose containers, networks и volumes проверки удалены.

## Визуальный контроль

Полноценный UI не входит в Блок 01. HostBridge и честный стартовый экран проверены 74 webapp tests и production build. Новых screenshot artifacts нет.

## Независимое ревью

Отдельный threat/authorization pass выполнен тем же Codex/GPT-5 по implementation SHA `979f1f1a52d1c1c085fdb05890ce5fe58ba67067`; это не независимое approval.

Исправленные findings:

- P1: replay можно было обойти перестановкой подписанных query fields — fingerprint переведён на hash проверенной Telegram signature, добавлен API regression.
- P1: конкурентный accept двух семей иногда возвращал 500 — DB unique conflict преобразован в `409 ALREADY_IN_FAMILY`.
- P2: invite TTL иногда отличался на 1 ms — `createdAt` и `expiresAt` теперь вычисляются от одного clock value.
- P2: невозможная дата наподобие `2024-02-30` проходила нормализацию JavaScript — добавлена строгая calendar-date проверка.
- P2: повторный DELETE отозванного member/invite возвращал 404 — исправлен на идемпотентный 204 без IDOR.
- P2: Bun/Windows мог зависать при конкурентных bootstrap Argon2 operations — bootstrap hash/verify сериализованы; параметры Argon2 не ослаблены.

Открытых P0/P1 в самостоятельном проходе не найдено. Независимое техническое ревью другой моделью/исполнителем не выполнялось и остаётся условием перехода из `REVIEW`.

## Не выполнено / риски

- Ветка не опубликована, PR и CI run отсутствуют.
- Реальный development bot token намеренно не использовался в тестах; `getMe` boundary проверен mock-тестом, секреты не выводились.
- Передача ownership не выставлена как пользовательский endpoint: `01_PRODUCT.md` требует отдельную проверяемую операционную процедуру с подтверждением обеих сторон, которой в Блоке 01 не задано. Owner нельзя понизить, удалить или покинуть семью.
- Rollback кода требует совместимости с nullable email и новыми таблицами; уже применённую migration не редактировать. Безопасный rollback данных — отдельная операционная процедура, не `down` migration.

## Следующий шаг

Получить независимое техническое ревью, затем по решению владельца опубликовать task branch и создать draft PR. Не запускать следующий блок до назначения.
