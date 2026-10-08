# AUDIT-PREPROD-2026-10-07 — план проверки

Запрос владельца: глубокое код-ревью, проверка гонок, TDD/регрессий и E2E перед production с сабагентами.

- Base/head: `c5f289fb9d4d9f3d97206d3e7b2e823e69efaf2d` — fetched `origin/main`.
- Branch: `audit/preprod-20261007`.
- Worktree: `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/preprod-audit-20261007`.
- Origin: подтверждён канонический `alexdubaev/OurMemoriesDevBot`.
- Lead: GPT-6; discovery: scout; независимые reviewers: GPT-6 Luna High.
- Allowed writes lead: этот план, итоговый отчёт `docs/reports/preprod-audit-20261007.md`, игнорируемые локальные evidence.
- Reviewers: чтение назначенных source/config/spec surfaces; только собственные proof artifacts под `webapp/e2e/.artifacts/audit/`. Production code, schema, contracts, lockfile и чужая работа не изменяются.

## Дополнение после baseline E2E

Вход через welcome-экран отсутствует в двух устаревших тестах, из-за чего падает setup и пропускаются 53 сценария serial feed. Lead назначил bounded worker `e2e_test_entry_fix` (GPT-6 Luna High) только на `webapp/e2e/agent-k-accessibility.spec.ts` и `webapp/e2e/feed.spec.ts`. Исправляется явное продолжение welcome перед проверкой формы семьи; assertions сохраняются. Редактирование начинается после завершения baseline. Первичный RED и артефакты сохраняются; затем реальные backend-backed сценарии повторяются. Production-код и default Playwright config не изменяются. Три fixture-owned poster-сценария проверяются отдельно с их существующей конфигурацией; неправильный default discovery остаётся finding.

После повторного доказательства mobile bottom-nav на Desktop viewport baseline остановлен без объявления полного результата. Scope worker расширен только на defaults двух shared helpers в `webapp/e2e/specs/family.spec.ts`: mobile viewport 390×844 до первого входа владельца и в новом guest context. Явные проверки ширин и assertions сохраняются. Общий initial-entry feed setup больше не зависит от имени теста; внутри-тестовые reload/cache проверки не изменяются. Затем запускается полезная повторная проверка затронутых сценариев; остановленный baseline остаётся отдельным partial run.

## Независимые области

1. Security: authentication/session, семейный ACL/IDOR, приватная выдача HEAD/Range, uploads, export/delete, sensitive logging.
2. Reliability: transactions/locks, quota/reservations, idempotency, outbox claims/leases/retry/shutdown, Telegram/MAX capture, concurrent invites/revoke/edit/reactions.
3. Frontend/release: stale async results/cache/logout/revoke, PWA, mutation failures, E2E coverage, production build, CI/release gating, migrations/rollback.

Read-only review этих областей разрешён прямым запросом владельца; агенты не меняют общие файлы. DB-mutating проверки используют отдельные порты и Compose projects: integration `46111`, E2E `46112`, E2E API `51112`, E2E web `56112`. Повторные race proofs не запускаются одновременно с suite на той же БД.

Фактический E2E API port заменён на `52112`: исходный `51112` попал в Windows excluded range. Race proofs — отдельный disposable project/DB на `46113`; S3 — `27117`, Docker smoke Postgres — `46115`. Итог и реальные exit codes записаны в [отчёте](preprod-audit-20261007.md). Test-only setup changes не дали green E2E: stale selectors/fixtures и несовместимые harnesses остаются findings; production implementation не изменялась.

## Baseline и проверка

1. Изолированная установка: Bun 1.4.0, `bun install --frozen-lockfile`.
2. FULL активного продукта: architecture, typecheck, contracts, backend unit+real DB integration, webapp tests, production web build, backend build, backend-backed E2E.
3. Дополнительные preproduction сигналы: template check, lint, dependency audit, infra tests, build-contract tests; при доступной локальной инфраструктуре S3/live storage и Docker smoke.
4. Для подтверждённых гонок: детерминированная последовательность с барьерами и воспроизводимый тест. Не называть TDD простое выполнение существующего suite. В этой review-задаче изменение production не назначено, поэтому red proof фиксируется как blocker и не маскируется green-тестом.
5. Lead проверяет фактические исходники findings, diff/status и тестовые evidence; отделяет code defect от environment failure и coverage gap.

## Критерий результата

Итоговый отчёт содержит P0/P1/P2 с путём и строками, воспроизведение/impact, команды, числа tests, exit codes, skipped и BLOCKED, evidence paths, migration/contract changes, известные ограничения и verdict. Любая невыполненная обязательная проверка не считается PASS. Браузерные тесты не заменяют Telegram iOS/Android и staging/restore evidence.

Стоп: секрет в Git, noncanonical origin, риск production data, необходимость платной инфраструктуры или разрушительного действия. Push/PR/merge/deploy, реальные боты и семейные данные не входят в эту задачу.
