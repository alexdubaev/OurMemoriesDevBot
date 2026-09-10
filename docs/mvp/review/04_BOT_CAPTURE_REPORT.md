# Отчёт блока 04

Task ID / дата / исполнитель / модель: T04 / 2026-09-10 / Codex / GPT-5 (роль Terra по task-файлу)
Статус: APPROVED
Worktree / branch / base SHA / implementation head SHA: `D:\codex\TG_OurMemoriesDevBot\worktrees\t04` / `feat/t04-bot-capture` / `cf7dcbc83bffbe0015584461849bf8346eca370c` / `550c29e`
PR / merge SHA: [#8](https://github.com/alexdubaev/OurMemoriesDevBot/pull/8) / не слито

## Выполнено

- Личный Telegram adapter для polling или webhook. До запуска вызывается `getMe`, проверяется `@OurMemoriesDevBot`, а фактический numeric `bot_id` участвует в ключах inbox/source.
- Webhook `/webhooks/telegram` проверяет отдельный secret-token и ограничивает поток тела до 512 KiB по умолчанию. HTTP 200 возвращается только после транзакции inbox + outbox.
- Нормализованный минимальный payload хранится AES-256-GCM; после терминальной обработки ciphertext очищается. Контент групп не попадает в inbox.
- Permanent source uniqueness `(bot_id, chat_id, message_id)` не зависит от 24-часового HTTP idempotency. TaskOutbox хранит только UUID задания.
- Text note и photo caption публикуются через явную trusted-source границу Memories. Telegram media потоково проходит существующий reserve → private storage → validation → finalize lifecycle Block 03.
- Фотоальбомы используют PostgreSQL-состояние, тишину 1,5 секунды, hard deadline 8 секунд, advisory single-flight, порядок `message_id`, late append и отдельные записи для mixed album.
- `full` проверяется при приёме, перед import и внутри публикации. Viewer, inactive family и revoked member не публикуют.
- Команды `/start`, `/app`, `/help`, `/privacy`, `/cancel`; child questionnaire в Telegram отсутствует. `/start` с payload открывает приглашение через fragment Mini App URL, если HTTPS URL настроен.
- Receipt отправляется только в исходный личный чат: «Получено» после durable commit и «Сохранено» только после stored original + Memory. Незавершённый receipt имеет отдельный durable marker и повторяется после transient/429 без второго Memory. Родственникам рассылка не выполняется.
- Добавлен безопасный config dry-run. `--apply` идемпотентно настраивает команды/menu button, но намеренно не вызывает `setWebhook`.

## Проверено

- `bun run test:backend:unit -- src/modules/telegram/update-mapping.test.ts`: 7 pass, 0 fail, exit 0.
- `bun run test:backend:unit -- src/modules/telegram/telegram-api.test.ts`: 2 pass, 0 fail, 4 assertions, exit 0.
- `bun run test:backend:integration -- src/modules/telegram/capture.integration.test.ts`: 8 pass, 0 fail, 45 assertions, exit 0; все 10 миграций применились на чистой PostgreSQL 18.
- `bun run test:backend:unit`: 339 pass, 0 fail, 974 assertions, exit 0.
- `bun run architecture:check`: 575 source files, exit 0.
- `bun run typecheck`: backend/contracts/webapp/website без errors, exit 0; один существующий Astro hint о deprecated `verticalAlign`.
- `bun run test:contracts`: 34 pass, 0 fail, exit 0.
- `bun run test:webapp`: 84 pass, 0 fail, exit 0.
- `bun run build:webapp`: production Vite build, exit 0.
- `bun run template:check`: exit 0.
- `bun run --cwd backend telegram:config` без Telegram secrets: dry-run показал `@OurMemoriesDevBot`, polling и `not configured` URL; secret fields отсутствуют, exit 0.
- Полный `bun run test:backend:integration`: 94 теста всех запущенных suites прошли; затем Bun 1.4.0 на Windows завершился с известным baseline segfault после зелёного `users.integration`, exit 3. Обязательный T04 integration и затронутые Memories/Media/Auth suites до сбоя прошли. Окончательный Linux verdict даёт `verify-required`.

## Визуальный контроль

Прочитан S36. Production UI и Block 06 assets не изменялись; screenshot не требуется. Bot copy проверено unit/integration assertions, а реальные пользовательские материалы не использовались.

## Независимое ревью

Выполнен ровно один независимый review моделью GPT-5.6 Sol (`cf7dcbc..e819f20`). Первичный verdict `CHANGES_REQUIRED`: четыре P1 — retry после transient media failure, атомарность album/source bookkeeping, retry финального receipt и Telegram `web_app` button. Все четыре исправлены коммитом `550c29e`, покрыты красными-зелёными тестами и тем же reviewer подтверждены как `FIXED`; остаточных blocker findings нет.

## Не выполнено / риски

- Реальный `TELEGRAM_BOT_TOKEN` в среде отсутствует, поэтому live-вызов development-бота не выполнялся. Секрет не запрашивался и не создавался.
- `TELEGRAM_MINI_APP_URL` и staging webhook URL пока не настроены. Bot config и webhook не применялись к Telegram; это отдельная операция владельца после готового HTTPS окружения.
- Полноценный UI ребёнка, family UI, feed/composer/player, caption ForceReply workflow, AI/группы/платежи не добавлялись.
- Миграции additive: `telegram_inbox`, `telegram_sources`, `telegram_albums`, четыре enum и nullable `receipt_sent_at`. Для rollback кода таблицы/поле безопасно оставить неиспользуемыми; destructive down-migration после появления capture data не выполнять.

## Следующий шаг

Push → PR → Linux `verify-required` → squash merge. Следующий блок не запускать без отдельного назначения.
