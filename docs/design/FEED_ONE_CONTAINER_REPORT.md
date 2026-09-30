# FEED-ONE-CONTAINER · отчёт от 30 сентября 2026

Статус: REVIEW — локальная реализация, независимые технические ревью и 12 целевых database-backed E2E завершены. Не опубликовано, не слито, не развёрнуто.

Исполнители: Codex (lead); scout, worker и два отдельных reviewer — роли на `gpt-6-luna`.

- Branch: `fix/feed-one-container`.
- Worktree: `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/feed-one-container`.
- Base / HEAD: `429865c7c97ad2061e457231646873667801805c`; изменения находятся в рабочем diff, отдельного task-коммита нет.
- Канонический origin проверен: `alexdubaev/OurMemoriesDevBot`. Основной dirty checkout и его прежние untracked файлы не изменены.
- Требования, allowlist и план: [FEED_ONE_CONTAINER.md](FEED_ONE_CONTAINER.md).

## Результат и изменённые пути

`webapp/src/features/feed/presentation/MemoryCardPresentation.tsx`: общая media slot больше не применяет inset-поверхность. Внешняя карточка, автор, аватар, время, меню, контент и лайк сохранены.

`webapp/src/features/feed/presentation/memoly-feed.css`: фото, видео, mixed media, заметка и голос без второй скруглённой панели/рамки/тени. Сохранены media stage и видеоконтролы. Заметка — выбираемый HTML-текст в карточке. Компактный переключатель и стрелки имеют зоны нажатия 44 px; точки декоративные, положение карусели объявляется вспомогательным технологиям.

`webapp/src/features/feed/presentation/FeedPresentation.tsx`: удалены фильтры типов; оставлен существующий режим «Все / Непросмотренные» с проверкой его доступности.

`webapp/src/features/feed/FeedPage.tsx`: видимые числовые индикаторы карусели заменены точками. Запросы и live refresh используют все типы, поэтому старое значение route filter не может незаметно ограничивать ленту. Удалены устаревшие тексты о фильтрах типов.

`webapp/tests/feed.test.tsx`, `webapp/tests/design-system.test.tsx`, `webapp/e2e/feed.spec.ts`: проверки композиции, точки, label «Все» и действия после отзыва доступа приведены к новому решению.

## Реально выполненные проверки

| Проверка | Результат | Exit code |
|---|---|---|
| `bun install --frozen-lockfile` | Установлены зависимости без изменения lockfile | 0 |
| Baseline `bun run test:webapp` на отдельном checkout исходного SHA | 416 pass, 0 fail, 65 файлов, 3006 assertions | 0 |
| Итоговый `bun run test:webapp` | 416 pass, 0 fail, 65 файлов, 3011 assertions | 0 |
| `bun run typecheck:webapp` | TypeScript пройден | 0 |
| Итоговый `bun run build:webapp` | TypeScript + Vite, 683 модуля | 0 |
| ESLint для трёх изменённых TSX компонентов, двух unit test файлов и E2E feed | 0 errors, 0 warnings | 0 |
| `git diff --check` | Пройден | 0 |
| `bun run --cwd backend prisma:generate` | Локальный ignored Prisma client, schema не менялась | 0 |
| `bun run --cwd webapp e2e --list` | 68 тестов в 6 файлах обнаружены; это не выполнение тестов | 0 |
| Docker version / Compose / info | Engine и CLI 29.6.2, Compose 5.3.1; Docker Desktop отвечает, PostgreSQL healthy | 0 |
| Целевой E2E `feed.spec.ts` (команда ниже) | 12 passed, 0 failed, 1.5 минуты; `.last-run.json`: passed | 0 |

Команда E2E: `bun run --cwd webapp e2e -- feed.spec.ts --grep 'feed is usable|private feed images|single photos in a fixed stage|mixed carousel swipes|photo album swipes in Feed|streams voice and legacy|canonical photo card|B6 real observer|membership revoke'`.

Проверены четыре ширины 320/390/430/480, приватные фото, mixed/photo carousel, voice и legacy video playback с Range/206 и паузой при скрытии, геометрия карточки и переключателя, реальный observer непросмотренных и отзыв доступа. Тестовая база и 43 миграции запускались в отдельном Compose project; его контейнер и volume убраны после прогона. Существующие контейнеры не изменены. Полный E2E suite не запускался.

Промежуточные E2E выявили ожидание переключателя в fixture с выключенным unread tracking и позднюю установку network listener после video metadata preload. Исправлены только тесты: готовое состояние включается в нужной synthetic fixture, состояние canonical scenario восстанавливается в finally, listener ставится до открытия ленты. Production-логика не менялась. Дополнительный свежий reviewer не нашёл P0/P1/P2; ESLint E2E и diff check прошли.

Первый промежуточный запуск после правок, но до обновления assertions, не считается baseline. Baseline отдельно выполнен на неизменённом base SHA.

## Визуальный и интерактивный контроль

In-app browser, локальная страница `http://127.0.0.1:4197/feed-qa.html` с временным harness настоящего `FeedPage`, synthetic fixtures и mock transport. Проверены 320×844, 390×844 и 430×844. Скриншоты показаны в выводе browser-инструмента; отдельные файлы скриншотов не сохранены.

- Фото, mixed media, note, voice и private video визуально находятся в одном внешнем контейнере.
- Computed styles внутренних content slots, note, voice и private video: прозрачный фон, radius 0, shadow none.
- На проверенных ширинах horizontal overflow = 0; десять фото и точки помещаются на 320 px.
- Переключение стрелкой: слайд 1 → 2, активная точка и доступный номер изменились синхронно.
- «Непросмотренные» → «Все»: `aria-pressed` переключается корректно.
- Контрольные стрелки и кнопки режима имеют высоту 44 px; ошибок/warnings консоли при проверке нет.

Это проверка локальной композиции и состояний UI. Mock transport не доказывает работу server-side unread filtering или приватного playback. Для voice/video осмотрены controls и недоступное состояние, без утверждения о проверенном воспроизведении.

## Независимое ревью

Первый reviewer подтвердил и исправил два P2: служебный текст карусели нарушал typography lint policy; два E2E сценария обращались к удалённым фильтрам. Lead проверил фактический diff исправлений, повторил unit tests, lint и сборку. Второй свежий reviewer проверил весь активный diff и не нашёл P0/P1/P2; 78 целевых тестов прошли. Оба ревью относятся к base HEAD плюс текущему рабочему diff, не являются GitHub approval и не подтверждают production readiness без интеграционного запуска.

## Ограничения и откат

При первоначальной проверке Docker daemon не ответил; после просьбы владельца проверить Docker недоступность не воспроизвелась, 12 целевых E2E прошли. Сохранены скриншоты в ignored `webapp/e2e/.artifacts/`: `task-5-feed-{320,390,430,480}.png` и `agent-b-react-comparable-*.png` (геометрия и шесть тем). Lead осмотрел canonical 320 px. Telegram/MAX WebView, полный E2E suite и текст 200% не проверены.

Миграций, изменений backend/shared contracts, конфигурации или новых assets нет. Public `FeedFilter` оставлен для совместимости потребителей, но реальная лента отображает все типы. Откат — отдельная Git-правка перечисленных UI/test файлов; данных семьи задача не меняет.

Владелец явно разрешил 30 сентября 2026 завершить текущую задачу через commit → push → PR → squash merge → production deploy при зелёных проверках и ревью. Прежнее ограничение остановиться до публикации отменено для FEED-ONE-CONTAINER. Данный отчёт фиксирует локальную проверку; итог PR/merge/runtime будет записан в handoff после выпуска.

Временный QA harness удалён, его dev server остановлен. Baseline проверялся в отдельном detached checkout `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/feed-one-container-baseline`; исходный Git-код там не менялся. Рабочий task diff содержит только перечисленные семь code/test файлов и два документа.
