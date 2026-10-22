# memoLy Control — Implementation Plan

**Goal:** отдельная закрытая панель с реальными продуктово-инфраструктурными метриками.
**Architecture:** существующие React/Vite + Bun/Hono/Prisma, отдельный page entry и owner-only
read API, provider-neutral collectors. **Spec:** SPEC.md и DATA_MAP.md.
**Source baseline:** 0dbc4c486f3a7841ae2d72d7fc617e552d502941; исполнитель обновляет origin/main.
Для agentic workers: выполнять поэтапно самому либо с разрешёнными локальной политикой
субагентами; AGENTS.md/teamlead-development выше общих workflow skills.

## Общие ограничения

Одна назначенная задача, отдельный worktree/branch. Три этапа ниже — внутренние результаты,
не три обязательных раунда согласований. По умолчанию один итоговый PR; разделение допускается
только при доказанной необходимости, последовательный merge, без незавершённого enabled UI.
Все общие manifests/contracts/schema/release scripts редактирует ведущий агент.
Макет — внешний вид, не production architecture. Нет фото/текстов семей, нет SQL/roles mutation UI.
Значимые auth/data/release изменения требуют FULL; перед deploy FULL на точном release SHA.

## Review focus

1. Владелец чужой семьи либо legacy admin вне allowlist запрашивает чужие metadata/CSV: 403.
2. Один user в двух семьях: account один, memberships два; revoked и expired не раздувают счётчики.
3. Provider timeout после хорошей метрики: старое значение маркировано, не становится нулём/зелёным.
4. Возврат через BFCache/после logout: owner data скрыты до revalidation, не persisted/offline.
5. Новый HTML entry и additive migrations меняют release fingerprint: совместимость recovery
   доказана до promotion; семейный UI v4 и MAX login сохранены.

## Этап 1. Реальный owner-read контур и основная страница

Предлагаемые новые файлы (до создания проверить, не появились ли аналоги):
- packages/contracts/src/control.ts + contract tests; export через существующий index;
- backend/src/modules/control/{index.ts,application/control-service.ts,application/ports.ts,
  infrastructure/control-read-repository.ts,transport/routes.ts,transport/owner-guard.ts};
- backend/src/modules/control/control-access.integration.test.ts;
- backend/src/modules/control/control-counts.integration.test.ts;
- webapp/control/index.html; webapp/src/control/{main.tsx,ControlApp.tsx,api.ts,queries.ts,
  control.css,components/,pages/};
- webapp/e2e/control.spec.ts + isolated fixture/config по существующему образцу.

Изменяемые интеграционные точки: backend/src/app.ts, backend/src/env.ts,
packages/contracts/src/index.ts, webapp/vite.config.ts, deploy/selectel/Caddyfile.static.template.
Shared auth helpers выносить только при реальной необходимости, не импортировать семейный App.

Interfaces: `requireControlOwner` после requireAuth; `ControlReadRepository` возвращает
whitelisted DTO для overview/lists/details. Внешние метрики пока честно not_configured,
не seed-значения. Query keys имеют owner-session scope, фильтры и cursor.

- [ ] Read-only проверить свежий main, prod revision, актуальные guards. Прочитать пакет,
  распаковать эталон; зафиксировать небольшой план/allowed paths и тестовые ресурсы.
- [ ] RED: 401 без токена, 403 ordinary/full/family-owner/admin вне allowlist, 200 точный owner;
  revoked session/allowlist removal -> отказ всех details/exports. Нельзя подменить actor query param.
- [ ] RED: seeded counts/list pagination: user в двух семьях не дублируется, creator включён,
  expired/revoked invite исключён, zero values валидны, malicious q остаётся данными.
- [ ] Добавить минимальный owner guard/env и read repository с агрегатами. Существующий
  /api/admin role mutation не расширять. Empty allowlist deny-by-default.
- [ ] Построить отдельный frontend entry по исходному HTML, в компонентах React.
  Выполнить MAX browser-link login с возвратом на /control/, без family bootstrap.
- [ ] Реальные Overview/Families/Users, фильтры, карточки, pending/error/empty; pagination
  на сервере. Нет persistent cache. Состояние источников не подменено demo.
- [ ] Проверить названные RED-тесты GREEN; typecheck/lint/build по существующим scripts.
  Реальная изолированная PostgreSQL *_test обязательна; mock-only не считается проверкой SQL.
- [ ] Browser: /control/ открывает правильный entry, auth guards, responsive 1440/390/320,
  семейный / остаётся UI v4, reload/deep hash не отправляет пользователя в семейную ленту.

## Этап 2. Активность, источники и рабочая аналитика

Новые файлы: control/application/metric-source.ts, infrastructure/sources/{database,
media-storage,host-snapshot,service-probes}.ts, control/activity/*, control/collection/*,
control-activity.integration.test.ts, control-metrics.test.ts, contracts DTO tests.
Аддитивные Prisma models/migrations только после проверки необходимости. Интеграция scheduler
через его реальные handlers; isolated collector не должен задерживать outbox.
Host sampler/runbook в deploy/selectel/ с explicit read-only mount/path allowlist.

Interfaces: `MetricSource.collect(signal)` -> SourceSnapshot; `Sample<T>` как в SPEC.
Activity endpoint derives actor/time server-side; daily global и family records раздельны.

- [ ] RED: 0 vs null, stale после timeout, oversized response, timeout cancellation,
  unknown quota, source not configured, физический и логический объёмы не складываются.
- [ ] RED: duplicate activity и multiple memberships не раздувают DAU; background/refresh
  не является активностью; revoked family не получает family signal; server timestamp обязателен.
- [ ] Добавить minimal activity collector и дневные факты с retention. В app только маленький
  signal module, без UI redesign/фонового heartbeat/сбора пользовательского содержимого.
- [ ] Добавить bounded collectors для DB counts/size, фактического storage adapter, host disk,
  backend/static и worker/scheduler evidence. Credentials брать только из штатного secret store.
  При отсутствии внешнего доступа вернуть конкретный not_configured, не «всё работает».
- [ ] Сохранить snapshots/coverage, обновить графики и storage breakdown. Обозначить историю,
  которая ещё не накоплена. Общий count за период distinct, не сумма daily counts.
- [ ] CSV whitelist, sanitization формул, quota/size/rate caps, same filter/policy.
- [ ] GREEN: целевые PostgreSQL/contract/collector/browser тесты, невлияние collector failures
  на upload/auth/feed, query plan и отсутствие N+1 на synthetic 10k users/много членств.
  Не заявлять нагрузочную ёмкость по одному локальному замеру; записать фактический query count
  и latency, устранить доказанные full scans на часто вызываемых путях.

## Этап 3. Защита, независимое review и production

- [ ] Проверить все 6 экранов и реализацию отказов источников. Synthetic скриншоты desktop/mobile.
  Cross-origin, cache headers, BFCache, CSV injection, malformed cursor и stale credentials.
- [ ] Провести одно свежее независимое read-only review: auth/SQL/privacy/metrics semantics/
  release совместимость. Один bounded fix pass и narrow recheck; без циклического общего аудита.
- [ ] Проверить текущие release-fingerprint inputs и принятую recovery pair. Если multi-entry,
  schema или diagnostics меняют их, подготовить точную attestation только с проверенной
  совместимостью и negative source-drift regression. Не ждать первого production STOP.
- [ ] Применимый verification profile на source, PR evidence, squash merge и точный main SHA.
  Перед запуском FULL использовать актуальные scripts/package.json; каноническая команда,
  если сохранена: `bun run verify:full --base <base_sha>`.
- [ ] FULL на итоговом release SHA, штатный guarded Selectel deploy. Additive миграции через
  разрешённый entrypoint; не добавлять password-admin bootstrap, не восстанавливать DB.
- [ ] Provision exact CONTROL_OWNER_USER_IDS через разрешённый secret/config flow. Проверить
  реальный вход владельца. Недостаток доступа не обходить автоматическим self-grant.
- [ ] Smoke: UI v4/MAX auth старого приложения; /control/ + assets; anonymous 401; other user403;
  owner lists; no-store; read-only SQL totals; host disk и DB size; configured storage freshness;
  четыре app services/revision, manifest, readiness и разрешённый recovery.
- [ ] Последний отчёт: shipped URL/SHA, tests/review, какие источники реально подключены,
  какие ждут credentials/историю, измерения на cutoff и место evidence. Не отдавать длинные
  infrastructure логи вместо результата. Не закрывать задачу только на merge.

## Команды и честность проверки

Узкие Bun tests указывать точными путями созданных tests. Integration запускать существующим
PostgreSQL harness, не произвольным `bun test` против неизвестной DATABASE_URL.
`TEST_SKIP_DOCKER` допустим только штатно с уже работающей выделенной настоящей *_test БД.
Browser config показывает фактический engine; desktop WebKit не называется физическим iPhone.
Сборка нового entry включена в стандартный build и build-contract tests. Retention/collectors
тестируются на синтетических данных, не удалением production history.

Правила автономности действуют: обычные PR/merge/deploy разрешены. Если возникает конкретное
неразрешённое действие (данные, привилегии, разрушительная миграция, новая платная услуга),
сначала исследовать и подготовить безопасный checkpoint; задать один короткий понятный вопрос,
после ответа продолжить эту же задачу, не завершать её искусственно.
