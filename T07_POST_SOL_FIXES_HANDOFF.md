# T07_POST_SOL_FIXES_HANDOFF

Task ID / дата / исполнитель / модель: T07 Post-Sol Fixes / 2026-09-11 / Codex / GPT-5

Статус: REVIEW

Worktree: `D:\codex\TG_OurMemoriesDevBot\worktrees\t07-live-feed`

Branch: `feat/t07-live-feed`

Base SHA: `b03a82993dd72ceaca0d9724b0194295d5cadd2c`

Previous reviewed HEAD: `b80ba301911998f07d449b2001db2dd86f9291cc`

New feature implementation HEAD: `ed4f7af0c15cf76c86303715424e785ac06911a2`

PR / merge SHA: не опубликовано / не слито.

## Выполнено

### Sol findings

| Finding | Статус | Результат и evidence |
|---|---|---|
| P1-1 Private media Range/206 | RESOLVED / PASS | Private voice и legacy video получают same-origin protected media URL через service worker; токен передаётся в память worker, не в URL. До play нет полной загрузки; play/seek дают Range-запрос и `206`. Telegram-only video path не изменён. Foreign/revoked access остаётся запрещённым. |
| P1-2 Next-page error | RESOLVED / PASS | Ошибка следующей страницы сохраняет загруженные MemoryCard, показывает локальный retry у pagination boundary и не запускает бесконечный auto-retry. Initial error без данных остаётся full-page состоянием. Unit и real-stack E2E зелёные. |
| P1-3 Feed E2E | RESOLVED / PASS | Создан канонический `webapp/e2e/feed.spec.ts`; точный фильтр находит и выполняет 7 тестов. Покрыты 48 записей и pagination, dedupe, retry, new/backdated entry и scroll anchor, like rollback, PhotoSwipe, private media Range/206, hide/pause, viewer/revoke и Telegram handoff boundary. |
| P1-4 Mini App hidden | RESOLVED / PASS | Playback coordinator при `document.hidden` немедленно ставит local audio/video на pause, очищает active state и не возобновляет autoplay при visible. Unmount/logout/revoke также pause/cleanup. |
| P2-1 Duplicate Telegram delivery | RESOLVED / PASS | Перед Bot API side effect выполняется durable atomic claim; конкурентный replay имеет одного победителя. Send выполняется после fresh authorization под DB locks. Если ответ Bot API неоднозначен после начала send, delivery отмечается `ambiguous` и не ретраится, поэтому exactly-once не заявляется. |
| P2-2 Pointer retention | RESOLVED / PASS | Добавлен hourly cleanup `telegram:deliveries:cleanup` и индекс по `expires_at`. Удаляются только строки, чей `expiresAt` старше retention cutoff 24 часа; active pointer до TTL сохраняется. |
| P2-3 Feed cache on logout | RESOLVED / PASS | Feed query keys помещены под общий `session` namespace. Principal transition удаляет feed, `likedByMe` и остальные authenticated cache entries; revoke дополнительно cancel/remove feed queries и закрывает экран. |
| P2-4 Real waveform | RESOLVED / PASS | Contract принимает ровно 48 нормализованных peaks; Prisma producer переносит сохранённый waveform в Memory DTO; UI рисует 48 реальных peaks с seek overlay. При отсутствии peaks остаётся обычный progress slider, fake waveform не создаётся. |
| P2-5 Telegram denial message | RESOLVED / PASS | Expired, replay/invalid, foreign, revoked и deleted случаи получают единый privacy-preserving ответ `Видео недоступно или у вас нет доступа.` без раскрытия причины или метаданных. |

### H1 — revoke vs final Telegram send

**CONFIRMED before fix; RESOLVED.** Controlled test останавливает delivery после initial authorization, коммитит revoke и продолжает выполнение. Новая final authorization/send boundary повторно читает identity, membership, family, reference и Memory под share locks; результат `denied`, `sendVideo` вызван 0 раз. Одновременно revoke/soft-delete, начатый после final boundary, ждёт завершения защищённой секции.

### H2 — PhotoSwipe / album

**CONFIRMED before fix; RESOLVED.** E2E сначала выявил, что multi-photo Memory открывал только первый attachment, а deterministic close мог зависнуть. После исправления single-photo и two-photo album используют authenticated blobs, известные dimensions, навигацию `1/2 → 2/2`, close и browser back. После destroy все object URLs revoked, scroll и focus восстановлены. Финальный PhotoSwipe E2E зелёный.

### Изменённые границы

- `backend/prisma/schema.prisma` и additive migration `20260911150000_t07_delivery_claims`;
- Telegram delivery, inbox processing, cleanup job/schedule и integration tests;
- Memory repository/API waveform mapping и contracts;
- webapp feed/query/playback/auth/media worker, PhotoSwipe и unit/E2E tests;
- Playwright discovery и Vite development API proxy;
- `T07_SOL_REVIEW.md` и этот handoff — review artifacts.

Внутренние imports выровнены по public module boundaries; generated files вручную не менялись.

## Проверено

Все перечисленные команды завершились с exit code 0.

| Профиль | Команда / suite | Результат |
|---|---|---|
| Contracts | `bun run --cwd packages/contracts test` | 39 passed, 0 failed, 158 expect calls |
| Backend unit | `bun run --cwd backend test:unit` | 346 passed, 0 failed, 995 expect calls |
| Webapp unit | `bun run --cwd webapp test` | 96 passed, 0 failed, 778 expect calls |
| Feed real-stack E2E | `bun run --cwd webapp e2e -- feed.spec.ts` | 7 passed, 0 failed; exact required filter discovered tests |
| Telegram integration | `backend/src/modules/telegram/capture.integration.test.ts` | 17 passed, 0 failed |
| Memory integration | `backend/src/modules/memories/memories.integration.test.ts` | 14 passed, 0 failed |
| Private media integration | `backend/src/modules/media/media-access.integration.test.ts` | 7 passed, 0 failed |
| FamilyAccess/T08 regressions | family access + review fixes + persistence suites | 14 + 7 + 2 passed, 0 failed |
| Focused PostgreSQL integration total | перечисленные шесть suites | 61 passed, 0 failed |
| Family browser E2E | `bun run --cwd webapp e2e -- family.spec.ts` | 2 passed, 0 failed |
| Typecheck | `bun run typecheck` | PASS; 0 errors (website emitted one existing deprecation hint) |
| Production build | `bun run build` | PASS; contracts/backend/webapp/website built (existing website chunk-size warning) |
| Architecture | `bun run architecture:check` | PASS; 597 source files checked |
| Lint | `bun run lint` | PASS |
| Dependency audit | `bun run audit` | PASS; no known vulnerabilities |
| Diff | `git diff --check` and staged `git diff --cached --check` | PASS |
| Available secret scan | signature scan over 31 changed/new files | 0 potential secret files; `gitleaks` unavailable locally |

### Migrations

- Fresh isolated PostgreSQL deploy: 19 migrations applied, PASS.
- Populated upgrade: старые 18 migrations развёрнуты, добавлена валидная active Telegram delivery row, текущая migration применена; строка сохранена, новые state fields остались `NULL`, PASS.
- Repeat `prisma migrate deploy`: `No pending migrations to apply.`, PASS.
- Проверочный контейнер, network, volume и временный архив удалены после проверки точных путей.
- Migration additive. При rollback приложения новые nullable columns/index/check constraints можно оставить; уже применённую migration не редактировать.

## Визуальный контроль

- `D:\codex\TG_OurMemoriesDevBot\worktrees\t07-live-feed\webapp\e2e\.artifacts\t07-feed.png` — 1280×9136, 438631 bytes, full-page feed с 48 записями и реальным 48-peak waveform.
- `D:\codex\TG_OurMemoriesDevBot\worktrees\t07-live-feed\webapp\e2e\.artifacts\t07-photoswipe.png` — 1280×720, 17357 bytes, authenticated two-photo album на slide `2/2`.
- Артефакты просмотрены; неожиданных layout/regression отклонений не обнаружено. Сплошные цветовые изображения — намеренные синтетические E2E fixtures, не пользовательский контент.
- Screenshots находятся в ignored `.artifacts` и не добавлены в Git.

## Независимое ревью

Sol review выполнен до этой работы на SHA `b80ba301911998f07d449b2001db2dd86f9291cc`; источник — `T07_SOL_REVIEW.md`. Подтверждённые findings исправлены выше. Новый independent reviewer не запускался по прямому указанию владельца. Нужна назначенная владельцем verification тех же findings на новом feature implementation HEAD.

## Не выполнено / остаточные риски

- **Mobile acceptance: NOT RUN.** Browser E2E не заменяет реальный Telegram iOS/Android client.
- Telegram Bot API — внешний не-транзакционный side effect. Обычная конкурентная двойная отправка исключена, но exactly-once при потерянном/неоднозначном ответе API не гарантируется; выбран безопасный no-retry `ambiguous` state.
- Existing Control B caption/revoke P2: **confirmed, unchanged, deferred to targeted post-T07 hotfix.** T07 caption transaction path не менялся.
- Изменения не опубликованы, PR не создан, merge не выполнялся. T09 не начат.

### Manual Telegram iOS/Android acceptance checklist

Для каждого реального клиента отдельно:

1. Открыть `@OurMemoriesDevBot` Mini App участником viewer и full; подтвердить family-scoped feed.
2. Прокрутить 40+ записей, проверить pagination без дублей и сохранение scroll anchor при появлении новых записей.
3. Запустить voice и legacy private video; проверить seek, координацию одного плеера и отсутствие полной предварительной загрузки по сетевым признакам клиента.
4. Свернуть Mini App / переключить приложение: playback должен сразу остановиться; после возврата autoplay не должен начаться.
5. Открыть single и multi-photo Memory; проверить swipe/navigation, системный back/close и восстановление позиции ленты.
6. Открыть Telegram-video card и handoff в бот; проверить успешную доставку один раз и generic denial для replay/expired/foreign случая.
7. Во время открытой ленты отозвать membership: playback останавливается, family cards исчезают, показывается закрытое состояние без утечки cached data.

## Следующий шаг

STOP. Не запускать T09 и второго independent review. Ждать отдельного назначения владельца на verification Sol findings по новому feature implementation HEAD.
