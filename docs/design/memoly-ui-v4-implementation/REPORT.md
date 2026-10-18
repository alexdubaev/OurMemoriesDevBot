# MEMOLY-UI-V4-IMPLEMENTATION-AND-OWNER-PREVIEW

Статус: implementation review; preview и приёмка владельцем ещё не выполнены. Этот PR нельзя сливать до явной приёмки развёрнутой feature-версии.

## Исходные данные

- Base: `f0a4e8ba3fa174f43c661ab2a70a6b744c6543f4`.
- Reference: `c080dc1b2fc9530c18751c138f455600b407293a`, [reference PR #184](https://github.com/alexdubaev/OurMemoriesDevBot/pull/184); reference-ветка не изменена и не слита.
- Проверенный SHA256 `reference.zip`: `d15fd7b8ca78bfec494c1f0edbb1fa817eb3097749a7f1af29241ea9e051bcfc`.
- Ветка: `feat/memoly-ui-v4-implementation`; worktree: `D:/codex/TG_OurMemoriesDevBot/worktrees/memoly-ui-v4-implementation`.
- Lead: Codex; последовательные implementation workers и независимый read-only reviewer: `gpt-6-luna`, high.
- Fingerprint 30 изменённых webapp source/test/asset файлов: `fc4e97c4f2ffe4e238abe9fa6d63d8f4ecf1a75b834124e8da4bed46ac0c63e7`. Алгоритм и индивидуальные SHA256: [source-files.json](evidence/source-files.json). Текст нормализован к LF; удалённый файл имеет отдельный маркер. Это идентификатор проверенного дерева, а не Git SHA.
- Точный implementation HEAD и результат FULL после коммита публикуются в описании implementation PR: коммит не может содержать собственный SHA.

## Изменения и сохранённые границы

Подтверждён активный путь: `FeedPage → features/feed/presentation`, `ChildHeader → ChildHeaderV2`, `FamilyScreen → memoly-ui/FamilyPresentation`. Одноимённые legacy renderers не подменяют действующее приложение.

Allowed paths: presentation/style/typography в `webapp/src/components`, `features/feed`, `features/memoly-ui`, `styles`; минимальные accessibility entrypoints `index.html`, `index.css`, `main.tsx`, удаление неиспользуемого `platform/app-zoom.ts`; соответствующие `webapp/tests`, `webapp/e2e`, два WebP и этот отчёт. Backend, schema, migrations, package/lock/config, MAX adapter и контракты не изменены.

Перенесены компактная шапка и нижняя панель, дата/автор/подпись/реакции/заметка/голос, семейный обзор и общие primitives существующих форм. Имена, роли, «Вы», количество участников и состояния MAX берутся из прежних props. Темы продолжают выбирать прежние изображения через существующий provider. Управление семьёй, приглашениями и профилями доступно через существующие callbacks.

Рамка резервируется по имеющимся metadata: clamp ratio 0.8–2.4, первая фотография в фотоальбоме, 0.8 для mixed video и fallback. Локальный state snapshot фиксирует рамку по составу публикации; readiness, metadata event и активный слайд не меняют её. Нет БД, localStorage или растущего Map для размеров.

Сохранены Embla, PhotoSwipe, MixedMediaViewer, выбранный индекс, history/MAX Back, private-media endpoints/SW, avatar loading, playback coordinator и lifecycle. Из `loadedmetadata` убран только sizing state; duration и media events остаются. Полная дата доступна в деталях; timezone/grouping и исходная подпись не изменены. В PhotoSwipe добавлены caption/thumbnails через штатный UI API с уже загруженными URL.

Auth/browser-link/F12, session epoch, ACL, membership semantics, query keys/cache isolation, MAX import/dedup, unread/seen и publication queues не переработаны. Реальный редактор crop, имена аккаунта/семьи/ребёнка и существующие формы остаются прежними. Изменение глобального zoom blocker и внешнего CDN-шрифта — минимальное исключение, прямо требуемое SPEC A3.

Новый MAX mark взят из [официального brandbook MAX](https://go.max.ru/brandbook), [архив оригиналов](https://st.max.ru/brandbook/all-max-logo.zip). SHA256 исходного `Max colored.png`: `cb6baba7bc9fa5b51e91f83d45465f02101c9f0c479c27c65816a0329b401ba9`. Поставляются только WebP RGBA 66/99 px, 2796/4426 bytes с настоящим alpha; исходный архив не включён. Новых icon libraries, внешних шрифтов и production SVG нет.

## Визуальные доказательства

Снимки сделаны с настоящих React-компонентов на синтетических данных, Chromium `151.0.7922.34`, DPR 1, reduced motion, фиксированная дата. E2E reference placeholders из обезличенного пакета находятся только в test fixtures; они не входят в production assets. [Baseline](evidence/baseline-shell-390.png) снят с неизменённого base.

| 390×844, zero insets | Reference | React | Максимальное отклонение |
|---|---|---|---|
| Header x/y/w/h | 0/0/390/96 | 0/0/390/96 | 0 CSS px |
| Первое media x/y/w/h | 16/175/358/216.1875 | 16/175/358/216.1875 | 0 CSS px |
| Nav x/y/w/h | 0/782/390/62 | 0/782/390/62 | 0 CSS px |

[Измерения](evidence/measurements.json), [сопоставление координат](evidence/canonical-comparison.json), [320](evidence/comparison-first-card-320.png), [390](evidence/comparison-first-card-390.png), [430](evidence/comparison-first-card-430.png), [50% overlay](evidence/overlay-first-card-390.png). Без выравнивания и масок; сравниваются первые 530 CSS px. Дальнейшие записи — представительная выборка, а не копия всего контента эталона. Сохранено действующее «Сегодня» вместо демонстрационной строки с полной датой. Accessibility A1/A2 дают более тёмные вторичные подписи и дополнительные 5 px для реальных hit areas pagination. Это не заявление о попиксельном совпадении всего приложения.

Выборка: feed 320/390/430 и desktop 1280×900, середина/конец, loading/empty/error/unread; Owner/Full/Viewer, 2/10 участников и длинные имена; [шесть тем](evidence/themes-contact-sheet.png); [200% текст](evidence/feed-long-text200.png); профиль ребёнка/редактор/[crop](evidence/child-crop.png)/отмена, собственный и чужой профиль, приглашение, settings/appearance, add sheet. Полный перечень — в JSON и каталоге evidence.

A3: zoom разрешён, system font stack без CDN. A4: текст может увеличивать контейнеры; проверка root font 200% не дала горизонтального overflow. Input min 48 px/font 16 px; основные кнопки min 48 px, secondary min 44 px. Pagination hit 24 px при визуальных точках 4/13 px. [Computed controls](evidence/control-measurements.json), [формы](evidence/form-measurements.json).

Bottom inset вычисляется один раз как `max(host, browser env)`, применяется к nav и clearance. Синтетическая проверка browser=20 при host=0/12/30 даёт nav 82/82/92 px, не сумму; family/child profile проверяются отдельно. Это проверка CSS с подставленным safe-area token, а не измерение настоящего iPhone env.

[Targeted contrast](evidence/contrast.json): минимальный контраст имени на шести фонах ≥9.076, возраста ≥5.232; primary crop/editor white-on-accent 5.91. Это выборочная проверка, не полная сертификация WCAG.

## Проверки и ревью

Классификатор требует **FULL** из-за media/UI entrypoints; профиль не понижен. Перед публикацией выполняется единая команда `bun run verify:local --profile full` на точном feature HEAD. Её завершённый результат и SHA фиксируются в PR. Ни dry-run, ни skips не считаются PASS.

Только собственная синтетическая PostgreSQL `web_app_demo_test` на `127.0.0.1:56594`, task-owned storage/Compose project и порты 56595/56596. `DATABASE_URL` равен `TEST_DATABASE_URL`; перед запуском проверены адрес, имя БД и отсутствие production env files. Автоматические записи против production не выполнялись.

Узкие завершённые проверки (exit 0):

- Canonical React suite: 7/7 после последнего nav fix (11.7 s).
- Media regressions: 7/7 (1.2 min): carousel/fullscreen, MAX metadata frame, shared avatar, video release across 60 cards, voice playback/seek. После bounded viewer corrections — Chromium 1/1 и WebKit fullscreen 1/1.
- Unit boundaries: 17/17, 51 assertions: ratio, header и playback.
- Webapp typecheck и lint: exit 0; одна прежняя hook warning в `auth/provider.tsx:89`, 0 errors.
- `git diff --check`: exit 0.

Существующий lifecycle тест получил явный scroll block:start и test-only нижнее пространство: при компактных карточках `scrollIntoViewIfNeeded` оставлял предыдущее видео частично видимым. Проверки source/buffers/listeners и 60-card limits сохранены. Voice alignment ожидает центр реальной audio panel согласно v4; проверки playback/seek сохранены. Удалена устаревшая проверка буквального тега span вместо поведения.

Один свежий [independent read-only review и его narrow closure](REVIEW.md). Исходное P2: отсутствовал browser bottom safe area. Исправлено через max(host, browser), проверено узко. В том же bounded проходе исправлены computed font inheritance, цвета/размеры nav, crop button variants, ordinal viewer labels и sheet token. Lead дополнительно проверил снимки и убрал двойной индикатор на экране семьи; существующий family scenario проверяет обе вкладки. Повторный общий review не запускался.

## Preview и граница выпуска

Preview URL/SHA: **ещё отсутствуют**. Вопрос владельцу о сервере/адресе, доступе и допустимых данных остаётся открытым. Минимальный предложенный вариант — отдельный entry на существующем Selectel host при сохранении текущего root UI и прежнего API. Если используются реальные API, действия действительно меняют реальные данные; автоматические fixtures туда не направляются.

Production source, проверенный read-only: `af606f93ed5e91ff4f7a50c96b6444bfb386adb5`. Существующие main-only guarded release scripts не изменены и не обойдены. Ветка сама по себе не изолирует окружение. До выбора target и проверки cookies/SW/manifest/cache/API routing deployment не заявляется выполненным.

Merge, замена единственного интерфейса и финальный deploy ожидают явной приёмки работающего preview. Ветка/worktree остаются открыты. После приёмки нужны актуальный main, FULL точного merged SHA и свежие backup/readiness/rollback safeguards для новой runtime tree, затем guarded deploy, SHA/health/smoke/manifest. Миграций нет; rollback кода не означает восстановление БД.

Физический iPhone и MAX Mini App не проверялись. Chromium/WebKit emulation и browser preview не заменяют эту приёмку. Остаточная незавершённая часть задания — доступный владельцу preview, его явное одобрение и последующий штатный выпуск.
