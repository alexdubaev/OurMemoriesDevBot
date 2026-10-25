# Предложение для AGENTS.md (вишлист)

`AGENTS.md` не тронут. Ниже готовые строки: вставляйте, если согласны. Все пункты проверены по коду ветки `feat/wishlist`. В `AGENTS.md` сейчас нет ни подводных камней, ни списка проверочных команд, ни указателей на модули.

Куда: новый раздел `## 13. Подводные камни и проверенные команды` в конец файла, после раздела «Решение владельца 2026-10-22». Подразделы «Правка без автопилота» и «История git» идут в тот же раздел, в конце.

---

## Вставка 1. Подводные камни (раздел 13, подраздел `### Подводные камни`)

- Новое значение `MediaAssetPurpose` требует двух правок, иначе фото пропадёт: ветка в `resolveContent` (`backend/src/modules/media/infrastructure/prisma-media-repository.ts`, иначе контент отдаёт 404) и исключение связанных ассетов в обоих фильтрах `media:pending:cleanup` (`backend/src/jobs.ts`, иначе фото удалится через сутки). Пример: `gift` и relation `giftPhotoFor`.
- Новый экран в `webapp/src/App.tsx` добавляй и в `PersistentFamilyPresentation.screen`, и в `validatePresentation` (`webapp/src/platform/persistence/private-cache.ts`). Иначе сохранённый экран при запуске отбрасывается и пользователь попадает на хаб. Ключи запросов приватных данных семьи также должны чиститься в `removePrivateFamilyQueries`.
- `HostBridge.openExternalUrl` открывает только собственный https-адрес приложения. Для внешних ссылок (магазины и т. п.) используй `openExternalLink` и проверку `isSafeExternalLink` из `webapp/src/platform/external-link.ts`: только http/https, без логина и пароля в адресе. Метод необязательный, всегда проверяй результат и показывай запасное сообщение.
- Docker Compose на этой машине может не создать сеть (ошибка «address pools fully subnetted»). Тогда интеграционные тесты backend запускай через отдельный PostgreSQL: `TEST_DATABASE_URL` (база строго `*_test`, loopback) + `TEST_SKIP_DOCKER=1`. Подробности: `docs/TESTING.md`.
- Базовый `webapp/playwright.config.ts` стартует backend через `bun run start`. Эта команда проверяет бота через настоящий MAX API и падает без него. Для локального прохода используй backend `backend/scripts/max-verification-server.ts`, как в `webapp/playwright.max.config.ts` (требует `NODE_ENV=test`, одинаковые `DATABASE_URL` и `TEST_DATABASE_URL`, базу `*_test`).

## Вставка 2. Где что (раздел 13, подраздел `### Где что: вишлист`)

- Сервер: `backend/src/modules/gifts` (слои `domain|application|infrastructure|transport`, вход `createGiftsModule`, монтируется в `backend/src/app.ts`). Таблица `gifts`, миграция `20261023120000_gift_wishlist`. При удалении участника семьи его брони снимаются в `families/application/family-service.ts` (`removeMember`).
- Контракты: `packages/contracts/src/gifts.ts` (в том числе `MAX_ACTIVE_GIFTS`, `isAllowedGiftUrl`), назначение медиа `gift` в `media.ts`.
- Веб: `webapp/src/features/gifts` (`GiftsPage`, `GiftCard`, `GiftForm`, `api.ts`, `queries.ts`). Вкладка подключена в `App.tsx` и `BottomNavigation.tsx`, иконка `gift` в `assets/icons` и `webapp/public/assets/icons`.
- Внешние ссылки: `webapp/src/platform/external-link.ts` (`isSafeExternalLink`), мосты в `platform/max/host-bridge.ts` и `platform/telegram/host-bridge.ts` (браузерный dev-мост).

## Вставка 3. Проверенные команды (раздел 13, подраздел `### Проверенные команды`)

Все прогнаны на ветке `feat/wishlist` и прошли.

```bash
bun install --frozen-lockfile
bun run typecheck && bun run lint && bun run architecture:check
bun run test:contracts && bun run test:backend:unit && bun run test:webapp
bun run build:webapp
```

Интеграционный тест модуля (значения в адресе — заглушки, подставь свои; база строго `*_test`):

```bash
TEST_DATABASE_URL=postgresql://<user>:<pass>@127.0.0.1:<port>/<name>_test DATABASE_URL=$TEST_DATABASE_URL TEST_SKIP_DOCKER=1 bun run test:backend:integration -- src/modules/gifts/gifts.integration.test.ts
```

## Вставка 4. Правка без автопилота (раздел 13, подраздел)

### Правка без автопилота
Мелкий баг или доводка после сборки — обычная сессия, без прогона.
Сначала прочитай:
1. `.autopilot/PROGRESS.md` — что не доделано, известные баги, о чём договорились с пользователем.
2. Что правили после последней сборки — первая строка таблицы в «История git».
3. Только если правка их касается: что именно просили — `manifest.md` в папке сборки (указана в начале `PROGRESS.md`).
После правки:
- коммит — по правилам из «История git»;
- строка в «Правки без автопилота» в `PROGRESS.md`: дата — что — почему;
- починенный пункт из «Не доделано» или «Известные баги» — удали;
- договорились с пользователем о том, что следующая сборка не должна пересматривать, — строка в «Договорились», его словами.

## Вставка 5. История git (раздел 13, последний подраздел)

### История git
Целиком не читай — бери срез под вопрос:

| Вопрос | Команда |
|---|---|
| что правили после последней сборки | `git log --oneline "$(git log -1 --format=%h --grep='^Autopilot: сборка сдана')"..HEAD -- . ':(exclude).autopilot'` |
| всё, что делали ради требования | `git log --oneline --grep="R02"` |
| история файла | `git log --oneline -10 -- <файл>` |
| когда появился или исчез код | `git log --oneline -S "<фрагмент>"` |
| почему строка такая | `git blame -L <с>,<по> <файл>`, затем `git show <sha>` |

Коммит: стиль Conventional Commits по §7 (`feat(gifts): ...`, `fix(media): ...`), заголовок — что, тело — почему. Трейлер `--trailer "Requirements: R02"`, если правка касается требования из `manifest.md`. Заголовок `Autopilot: сборка сдана` и трейлер `Autopilot-Run` пишет только автопилот.
