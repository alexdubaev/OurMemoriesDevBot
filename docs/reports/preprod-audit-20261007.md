# AUDIT-PREPROD-2026-10-07

**Допуск к production: BLOCKED.** В обычных unit/integration suites нет падений, но найден достижимый уязвимый native decoder, воспроизведены две гонки, dependency audit красный и обязательный E2E не зелёный. Это аудит актуальной main, а не подтверждение текущего production runtime.

## Версия и границы

| Поле | Значение |
| --- | --- |
| Дата | 2026-10-07–08, Europe/Moscow |
| Task ID | AUDIT-PREPROD-2026-10-07 |
| Lead | Codex, GPT-6 |
| Независимые ревью | security, races, frontend/release: reviewer, GPT-6 Luna High; отдельное свежее ревью test diff |
| Discovery / executor | scout; bounded test-only worker GPT-6 Luna High |
| Base / HEAD | `c5f289fb9d4d9f3d97206d3e7b2e823e69efaf2d` — fetched origin/main |
| Branch | `audit/preprod-20261007` |
| Worktree | `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/preprod-audit-20261007` |
| Origin | Подтверждён канонический alexdubaev/OurMemoriesDevBot |
| Публикация | Не опубликовано; PR, commit, merge и deploy не выполнялись |

Корневой каталог запроса — пакет документации без `.git`. Создан отдельный linked worktree от свежей канонической main; чужие checkout/dirty changes не изменялись. Production-код, schema, migrations, contracts, lockfile и GitHub settings не менялись. Разрешённые записи: план/отчёт, три E2E spec-файла и локальные ignored evidence. Все данные тестов синтетические; реальные боты, приглашения и production DB не использовались.

## Подтверждённые findings

### F1 — P1: avatar preview достигает уязвимого SVG decoder

[normalize-avatar-image.ts](../../backend/src/storage/normalize-avatar-image.ts), строки 9–15; [uploads/routes.ts](../../backend/src/modules/uploads/transport/routes.ts), строки 91–104; `bun.lock` разрешает Sharp 0.35.4.

Authenticated `POST /api/uploads/avatar/preview` проверяет только заявленный Content-Type и размер. `normalizeAvatarImage` вызывает `sharp(bytes).metadata()` **до** проверки фактического формата. Безопасный SVG, объявленный `image/png`, достигает SVG loader; HTTP 422 появляется уже после разбора. Другие finalize-paths проверяют magic раньше; конкретный подтверждённый вход — avatar preview.

Sharp 0.35.4 попадает под [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w): проблема librsvg с возможностью RCE при определённых условиях Linux runtime; исправленная версия — 0.35.5. Backend Dockerfile использует Debian-based Bun образ. Условия успешной эксплуатации/PIE не проверялись, exploit payload не запускался: **подтверждена достижимость affected parser, а не RCE**.

Lead повторил harmless route probe: `decodedFormat=svg`, `sharpVersion=0.35.4`, `libvipsVersion=8.18.6`, `routeStatus=422`, exit 0. Он использует настоящий upload transport и normalize function с синтетическим auth middleware; полноценный HTTP auth flow отдельно покрыт suite. Сам probe — положительная проверка достижимости, не тест исправленного поведения.

Исправление: обновить Sharp/native dependency до patched version; проверять поддерживаемый magic/MIME до любого Sharp parse. Process-wide блокировка SVG loader — возможное дополнительное ограничение. Затем regression test должен доказать, что mislabeled SVG отвергается **до** decoder entry. Никакого исправления production в этой review-задаче нет.

### F2 — P2: очистка upload reservations и finalization deadlock

[jobs.ts](../../backend/src/jobs.ts), строки 103–105; [prisma-media-repository.ts](../../backend/src/modules/media/infrastructure/prisma-media-repository.ts), строки 164 и 206–215.

Cleanup сначала обновляет/блокирует reservation, затем family. Finalization сначала блокирует family, затем обновляет reservation. При пересечении expiry: finalization удерживает family, cleanup удерживает reservation; оба ждут друг друга. Настоящие методы `commitFinalization` и `runBackgroundJob('media:pending:cleanup')` в barrier-controlled Postgres proof дали Prisma P2039 / SQLSTATE **40P01, deadlock detected** на update reservation.

Finalization получает captured `now` до expiry, job — время после expiry. Это моделирует начатую валидную finalization, пересечённую cleanup. В proof проиграла finalization; cleanup завершился и retired upload. Пользователь получает ошибку вместо корректного сериализованного результата. MAX overlap test использует другой cleanup method с family-first order и не покрывает эту пару.

Исправление: единый порядок family → reservation → asset, повторная проверка eligibility под теми же locks. Deadlock retry сам по себе не исправляет неустойчивый lock order. Нужен regression на реальной DB.

### F3 — P2: подпись изменяется после успешного `/cancel`

[prisma-caption-repository.ts](../../backend/src/modules/telegram/infrastructure/prisma-caption-repository.ts), строки 10–25 и 30–37.

`consumeReply` читает live request; `cancel` коммитит `cancelledAt`; reply продолжает update memory и без повторной проверки выставляет `consumedAt`. Реальный barrier-controlled proof получил изменённую подпись и одновременно оба timestamps. Sequential cancel-then-reply coverage этого не обнаруживает; разные inbox IDs не сериализуют две операции.

Исправление: обе операции должны claim/lock один CaptionRequest и проверять состояние на общей атомарной границе; mutation memory — в той же transaction после успешного claim. Не оставлять conditional claim после уже совершённого изменения memory.

### F4 — P2 / release decision: временный always-on welcome в runtime

[App.tsx](../../webapp/src/App.tsx), строки 513–515: `TEMP_OWNER_WELCOME_ALWAYS_ON = true` обходит результат `claimWelcome` для всех пользователей. Комментарий требует удалить после first-run acceptance. Это не ограничено development build или конкретным owner identity.

История явно подтверждает намеренный временный режим: commit `859279e`, `fix(welcome): temporarily show splash on every app mount (#140)`. Новые `welcome-app-fixture.spec.ts` прямо проверяют temporary splash при уже consumed claim и повтор на reload; эти проверки прошли. Это не выдано за случайно появившийся welcome, а старый тест не ставится выше более позднего решения. Но обычный returning reload снова показывает welcome и блокирует проверку списка/ошибки до нажатия Continue; acceptance и старый `welcome.spec.ts` всё ещё требуют одноразовый показ. Перед production нужен явный итог по временному режиму и согласованный критерий first-run/returning-user поведения. Такие warm-reload assertions сохранены; flag в этом аудите не удалялся. Решения о завершении временного режима или его production acceptance в назначенных документах не найдено.

### F5 — P2: реального release gate на проверенном SHA нет

[verify.yml](../../.github/workflows/verify.yml), [verify-plan.mjs](../../scripts/verify-plan.mjs), [selectel-release.yml](../../.github/workflows/selectel-release.yml).

GitHub read-only API на момент аудита: `main.protected=false`, classic branch protection — HTTP 404 `Branch not protected`, rulesets — 0, check-runs на проверяемом HEAD — 0, Actions runs на этом exact SHA — пустой список. PR checks могут существовать на другом SHA; это не evidence проверки текущего main.

Verify workflow запускается только на PR/manual dispatch; full command IDs не включают dependency audit, lint и E2E. Поэтому имеющиеся 29 advisories и красный browser suite не являются его обязательными проверками. Backend build сейчас повторяет generate/tsc из typecheck; отсутствие отдельного его step не выдано за самостоятельный runtime defect.

Selectel release сверяет current main SHA и строку DEPLOY, но перед SSH не подтверждает успешный verify-required на этом SHA. Environment deploy key сейчас отсутствует по AGENTS, поэтому автоматический путь блокируется до SSH; это ограничивает текущую возможность, но не создаёт отсутствующий gate для ручного выпуска.

Исправление: актуальные checks на exact release SHA, required PR/check protection или доступный ruleset, явное включение audit/E2E release profile, подтверждение проверки перед promotion. GitHub-настройки в этой задаче не менялись.

### F6 — P2: default E2E запускает fixture-owned specs в чужом harness

[playwright.config.ts](../../webapp/playwright.config.ts) обнаруживает весь `e2e`; [private-video-poster.spec.ts](../../webapp/e2e/private-video-poster.spec.ts) требует companion [private-video-poster.playwright.config.ts](../../webapp/e2e/private-video-poster.playwright.config.ts) с отдельным Vite fixture plugin и synthetic media.

Default `bun run e2e:webapp` запускает три poster cases на обычном API/app без этого plugin: все три падают до intended coverage. Companion harness запускает Chromium и WebKit: четыре lifecycle/error cases прошли, две screenshot checks упали при 334×419 вместо 334×418. Это отдельное малое визуальное расхождение, не доказательство privacy/playback поломки. Snapshots автоматически не обновлялись.

Вторая подтверждённая spec — [warm-navigation-cache-regression.spec.ts](../../webapp/e2e/warm-navigation-cache-regression.spec.ts), строка 397, имеет hard-coded `4193`, а default audit server запускается на 56112. Default run падает с `ERR_CONNECTION_REFUSED` до final cache assertion. Её companion [warm-navigation-cache.playwright.config.ts](../../webapp/e2e/warm-navigation-cache.playwright.config.ts) запускает нужный fixture server на 4193. Это runner/discovery defect, а не доказательство поломанного cache.

Исправление runner: разделить backend-backed и fixture browser projects/commands так, чтобы каждая spec шла со своим сервером и оба профиля входили в проверку. Простое исключение падающих specs без отдельного запуска не является исправлением.

### F7 — P2: устаревшие fixtures/selectors оставляют visual и accessibility coverage пустым

[missing-visual-matrix.spec.ts](../../webapp/e2e/specs/missing-visual-matrix.spec.ts), строка 564, создаёт опубликованное memory без `firstPublishedAt`. Настоящая migrated DB отвергает insert: SQLSTATE 23514, `new memory publication requires first publication timestamp`. Visual assertions не достигнуты; это несовместимый seed, а не дефект DB constraint.

[agent-k-accessibility.spec.ts](../../webapp/e2e/agent-k-accessibility.spec.ts), строка 70, ищет старый accessible name `Создать семью`, тогда как screenshot/context показывает `＋ Создать свою семью`. 42 accessibility scans не исполнились. Добавленный initial Continue убрал только первый setup blocker; тест в целом не исправлен.

Исправление: привести synthetic fixtures к актуальному publication contract и selectors к согласованному UI, затем реально выполнить visual/accessibility assertions. Не удалять constraint, не обнулять assertions и не называть collection PASS выполненной проверкой.

## Проверки и evidence

Все команды запускались с Bun 1.4.0. Локальные raw logs находятся под `webapp/e2e/.artifacts/audit/`; они ignored и остаются в worktree. Повторные focused suites частично дублируют базовые tests и не прибавлены к общему числу.

| Команда | Результат | Tests / exit | Evidence в audit/lead |
| --- | --- | --- | --- |
| `bun install --frozen-lockfile` | PASS | 1065 packages, exit 0; lockfile не изменён | tool transcript |
| `bun run architecture:check` | PASS | 753 source files, exit 0 | architecture.log |
| `bun run template:check` | PASS | exit 0 | template.log |
| `bun run typecheck` | PASS | все workspaces, exit 0; website — 1 deprecation hint | typecheck.log |
| `bun run lint` | PASS | exit 0; повтор после test diff также 0 | lint.log, lint-after-test-fix.log |
| `bun run test:contracts` | PASS | 56 pass / 0 fail, exit 0 | contracts.log |
| `bun run test:backend:unit` | PASS | 639 pass / 0 fail, exit 0 | backend-unit.log |
| `bun run test:backend:integration` | PASS | 366 pass / 0 fail в 30 файлах, exit 0; skips не найдены | backend-integration.log |
| `bun run test:webapp` | PASS | 468 pass / 0 fail, exit 0 | webapp-tests.log |
| `bun run test:infra` | PASS | 124 pass / 0 fail, exit 0 | infra.log |
| `bun run build:webapp` | PASS | production bundle, exit 0 | build-webapp.log |
| `bun run build:backend` | PASS | Prisma generate + tsc, exit 0 | build-backend.log |
| `bun run --cwd webapp test:build-contracts` | PASS | 2 pass / 0 fail, exit 0 | build-contracts-webapp.log |
| `bun run test:storage:s3` | PASS | live local S3: 16 pass / 0 fail, exit 0 | storage-s3.log |
| `bun run audit` | FAIL | 29 advisories / 14 packages, exit 1 | dependency-audit.log, dependency-raw.log |
| `bun test ./webapp/e2e/.artifacts/audit/races/race-proofs.test.ts --timeout=30000 --max-concurrency=1` | RED: actual defects | 0 pass / 2 fail, exit 1; lead reproduced | racecheck-red.log |
| SVG reachability probe | REPRODUCED | exit 0; не regression PASS | avatar-svg-proof.log |
| `bun run e2e:webapp` baseline | FAIL, interrupted | 37 pass / 8 fail / 53 skipped; 32 not run из 130 | audit/e2e-release/baseline/ |
| Dedicated poster config | FAIL | 4 pass / 2 fail (Chromium + WebKit), exit 1 | audit/e2e-release/poster-fixture.log |
| Три изменённых E2E specs, `--max-failures=3` | FAIL, bounded | 1 pass / 3 fail / 66 not run из 70; 1 runner error, exit 1 | audit/e2e-release/worker-diff-check/ |
| Оставшиеся 12 non-poster E2E файлов, `--max-failures=3` | FAIL, bounded | 36 pass / 3 fail / 18 not run из 57; 1 runner error, exit 1 | audit/e2e-release/remaining-nonposter/ |
| Четыре независимых welcome/cache E2E файла | FAIL, completed | 9 pass / 2 fail из 11, exit 1 | audit/e2e-release/pwa-cache-followup/ |
| Warm-cache companion config | PASS | 1 pass / 0 fail, exit 0; 21.4s | audit/e2e-release/warm-cache-fixture/ |
| `bun run smoke:backend:docker` | BLOCKED | canceled exit 1 до readiness/auth smoke | docker-smoke.log |

Итого обычных автоматических tests до дополнительных browser/proof runs: **1671 pass, 0 fail**. Это не общий green verdict: race proofs намеренно красные, audit/E2E не зелёные. Backend migration/upgrades реально выполнялись на disposable Postgres; ноль обнаруженных tests не считался успехом.

Первый lead racecheck command без `./` был интерпретирован Bun как filter и не нашёл tests; это не RED evidence. Команда исправлена и обе invariants воспроизведены настоящими падениями. Первичный invocation error сохранён отдельно.

Docker Desktop сначала был выключен; после запуска real DB и S3 проверки стали доступны. Docker smoke остановлен после примерно 14 минут без дальнейшего вывода на двух frozen dependency install stages; backend runtime не был построен/запущен. Контрольный fetch npm registry из Bun container дал HTTP 200, но причина stall не установлена. Это **environment/build BLOCKED**, не выдуманный code failure и не PASS. Локальный диагностический build не является staging/promoted release artifact.

### Дополнительные browser runs

Повтор трёх test-only specs обнаружил 70 cases и остановился на заданном `--max-failures=3`: 1 pass, 3 fail, 66 not run; exit 1. Это не доказательство трёх новых product bugs:

- Agent K после Continue дошёл до пустого списка семей, но ищет старый button name `Создать семью`; настоящий UI — `＋ Создать свою семью`. Accessibility scans 42 состояний не достигнуты.
- Feed, строка 374, после reload ждёт family card, но находится на welcome. Это runtime-поведение F4; assertion не изменён.
- Family helper видит «Мои семьи» и уже созданную «Наша семья» / Лиза вместо пустого списка. Повтор использовал синтетическую DB baseline с тем же fixed subject; результат загрязнён test state и не доказывает отдельный onboarding defect.

Lead прочитал error contexts и лично просмотрел family screenshot: `webapp/e2e/.artifacts/audit/e2e-release/worker-diff-check/test-results/specs-family-onboards-a-ch-01d8e-icit-bot-start-confirmation-chromium/test-failed-1.png`. Screenshots, videos, traces и stdout сохранены вместе, baseline не перезаписан.

Отдельный запуск остальных 12 non-poster файлов обнаружил 57 cases: 36 pass, 3 fail, 18 not run; exit 1 на `--max-failures=3`. Первый fail — несовместимый visual-matrix seed F7. Два MM1 fail остановились на видимом welcome с Continue вместо ожидаемого heading «Мои семьи»; intended mixed-media mutation assertions не достигнуты. Лог 401 про refresh не объявлен причиной этих падений: snapshot явно показывает welcome.

Оба bounded runs дополнительно сообщают `1 error was not a part of any test`; stdout и `.last-run.json` не объясняют отдельное событие. Оно сохранено как unexplained runner error, а не добавлено к числу подтверждённых product findings.

Точные команды из worktree root:

```sh
bun run --cwd webapp e2e -- e2e/agent-k-accessibility.spec.ts e2e/feed.spec.ts e2e/specs/family.spec.ts --max-failures=3
bun run --cwd webapp e2e -- e2e/adult-avatar.spec.ts e2e/avatar-editor.spec.ts e2e/bootstrap-held-css.spec.ts e2e/bootstrap-pwa.playwright.spec.ts e2e/child-avatar.spec.ts e2e/pwa-install.spec.ts e2e/specs/missing-visual-matrix.spec.ts e2e/specs/mm1-mixed-composer.spec.ts e2e/specs/welcome.spec.ts e2e/warm-navigation-cache-regression.spec.ts e2e/welcome-app-fixture.spec.ts e2e/welcome-splash-fixture.spec.ts --max-failures=3
bun run --cwd webapp e2e --config e2e/private-video-poster.playwright.config.ts
```

Изолированные browser ports: PostgreSQL 46112, API 52112, web 56112; первоначальный API 51112 попал в Windows excluded range и заменён. Эти command args не содержат реальных credentials.

Четыре независимых welcome/cache файла, не достигнутых из-за лимита ошибок, выполнены отдельно на fresh disposable DB: 11 cases, 9 pass, 2 fail; exit 1. Все temporary-welcome App fixture checks прошли. Старый once-welcome test упал уже на disabled-vs-enabled Continue assertion, поэтому последующие once/reload assertions этого теста не достигнуты; падение само по себе не доказывает once-регрессию. Второй fail — неправильный port/harness для warm-cache F6. Ни один stopped/partial run не объявляется FULL PASS.

```sh
bun run --cwd webapp e2e -- e2e/specs/welcome.spec.ts e2e/warm-navigation-cache-regression.spec.ts e2e/welcome-app-fixture.spec.ts e2e/welcome-splash-fixture.spec.ts --max-failures=5
```

Warm-cache companion run на 4193 выполнен: **1 pass / 0 fail**, exit 0, 21.4s. Он проверил ten round trips и real cache restore в своём synthetic fixture; default connection-refused не означает дефект cache.

```sh
bun run --cwd webapp e2e --config e2e/warm-navigation-cache.playwright.config.ts
```

Все owned disposable Postgres/S3 Compose containers, volumes и networks очищены после своих runs. E2E API/web/fixture servers остановлены; порты 46112, 52112, 56112 и 4193 свободны. Чужие Docker resources не удалялись. Worktree и ignored evidence сохранены.

## Изменения и независимое ревью

- `webapp/e2e/agent-k-accessibility.spec.ts`: явный initial welcome Continue; остальные assertions сохранены.
- `webapp/e2e/feed.spec.ts`: common initial entry принимает только два известных состояния — welcome или family heading; title-based allowlist удалён. Внутри-тестовые reload/cache assertions не переписаны.
- `webapp/e2e/specs/family.spec.ts`: intended mobile viewport в owner/guest setup; explicit width loops сохранены. Warm reload не адаптирован к temporary always-on flag.
- `docs/reports/preprod-audit-20261007-plan.md`, этот отчёт.

Lead прочитал actual diff и исходники findings, лично повторил SVG и обе DB-race proofs, проверил lint и collection после test edits. Свежий независимый reviewer test diff не обнаружил P0/P1/P2; его вывод относится только к трём test-файлам, **не к production readiness приложения**. Production fixes отсутствуют, поэтому второй production fix/review loop не симулировался.

## Coverage и ограничения допуска

Default browser profile — Chromium Desktop Chrome с synthetic Telegram initData и локальным backend; часть specs использует Playwright route mocks. Dedicated poster fixture — Chromium/WebKit с synthetic media. Это не физические Telegram iOS/Android и не подтверждение реальной платформенной доставки/MAX/Telegram bot runtime.

Не выполнено/не подтверждено: полный зелёный E2E active profile; successful Docker runtime smoke; целевая нагрузка/capacity и длительный soak; полноценный DAST; staging promotion immutable image/web hashes; physical phone acceptance; production restore drill; фактические TLS/private bucket/at-rest encryption/закрытая DB/backup freshness/queue alerts. Это не утверждение об отсутствии этих настроек — они не проверялись live в рамках аудита. Реальные production credentials и семейные материалы не читались.

Текущие tracked files проверены ограниченным поиском Telegram-token/private-key signatures без вывода значений; совпадений не найдено. Это не полноценный historical secret scan и не сертификат отсутствия секретов в Git history.

Dependency triage: 2 critical, 10 high, 14 moderate, 3 low. Sharp — подтверждённый backend runtime path. Hono присутствует в backend, но advisory касается неиспользуемого `hono/jsx`. Seroval runtime-linked через TanStack Router; affected fromJSON/plugin path в текущем SPA не подтверждён. Proxy-addr, Undici и MCP SDK — tooling/build paths; library severity не приравнивается к доказанной уязвимости приложения. Подробная таблица сохранена в `audit/security/dependency-triage.md`.

Acceptance docs расходятся: Task 11 ссылается на P01–P24, linked acceptance содержит A01–A20. Никакие отсутствующие критерии не объявлены пройденными. Website/mobile неактивные product pipelines не выдаются за pilot coverage; root typecheck сам включил website.

## Приоритет следующего исправления

1. Закрыть F1 и dependency audit с reachability review и точным lockfile.
2. Исправить F2/F3 с сохранением deterministic RED proofs, показать GREEN на тех же invariants и связанном DB suite.
3. Решить F4; повторить first-run/returning-user/warm-reload behavior.
4. Исправить F5/F6/F7, получить зелёный active release profile на exact clean SHA, затем successful runtime smoke и staging/restore/phone evidence.

Миграции и публичные контракты в этом аудите не изменены. Остаточный риск — findings открыты. Задача не назначает production deploy или следующую разработку; опубликованного PR нет.
