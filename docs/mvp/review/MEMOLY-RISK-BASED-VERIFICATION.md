# MEMOLY — risk-based verification

Task ID: MEMOLY-F12-CLOSURE-AND-RISK-BASED-VERIFICATION, часть B. Model: GPT-6 Codex (lead); bounded implementation worker и один независимый read-only reviewer.

## Source и границы

- Base: `e383d79269a3595f4c6cabedf167335aea042cf3`.
- Проверяемый implementation source: `12f40cba63dd2371b3d96eb528009969959af8b6`.
- Branch: `chore/risk-based-verification`; worktree: `.worktrees/risk-based-verification`.
- Draft PR: https://github.com/alexdubaev/OurMemoriesDevBot/pull/179.
- Allowed/changed paths: `AGENTS.md`, `README.md`, `GIT_SETTINGS.md`, `.githooks/pre-push`, `package.json`, `scripts/verify-local*`, backend test runners/catalog и synthetic integration fixtures, MAX Playwright config/spec, PR template, developer/release docs и этот отчёт. Полный список — diff PR.
- Production application code, Prisma schema/migrations, семейные ACL и публичные контракты не изменены. #176 не менялся. F12 опубликован отдельно в #177.

## Политика и механизм

`bun run verify:local --profile fast|standard|full`; aliases `verify:fast`, `verify:standard`, `verify:full`. Без флага — автоматически требуемый профиль.

| Профиль | Состав |
| --- | --- |
| FAST | Проверки committed/working diff; для production CSS/assets — affected frontend typecheck/build. Документация без сборки приложения. Визуальная приёмка изменённого экрана остаётся обязанностью агента. |
| STANDARD | Affected typecheck/lint/build, связанные unit/module PostgreSQL tests, architecture при затронутой границе. Browser acceptance добавляется адресно, когда поведение нельзя подтвердить иначе. |
| FULL | 19 этапов: diff, architecture, audit, TypeScript, lint, builds, tool/Selectel guards, verifier boundaries, MAX/neutral contracts и unit tests, PostgreSQL auth/session/ACL/private-media/data/upgrade tests, два MAX browser journey. |

Классификация учитывает наиболее рискованный путь и весь diff от trusted merge-base `origin/main`, а также staged/dirty/untracked изменения. Более поздний `--base` не скрывает ранее изменённую auth-границу. Неизвестные пути, contracts, tooling/infrastructure, auth/session/ACL/private media/data требуют FULL. Флаг может повысить профиль, но не понизить его. Cosmetic CSS остаётся FAST даже в auth directory; изменение исполняемого auth-кода требует FULL.

Вывод содержит profile/minimum, точный source SHA, comparison base, clean tree либо dirty fingerprint, план и длительности. Изменение source во время выполнения даёт failure. Dry-run возвращает 2 и явно не является PASS. Нулевой test exit без выполненных cases, required skip/todo, неожиданный filtered test, ошибка команды или отсутствие БД не считаются успехом. Исторические messenger tests исключаются явно; активные MAX admission/provenance и платформонезависимые границы сохранены. Старый production-код не удалялся.

Pre-push сохраняет main/master, ref/SHA, clean-tree и deletion guards; запускает автоматический профиль относительно remote old SHA. Feature push не запускает полный gate. Hook не является проверкой GitHub merge: exact-source evidence должно быть в PR. AGENTS, PR template и release инструкции теперь согласованы; Selectel backup/readiness/migration/health/host-lock safeguards сохранены. FULL обязателен перед production на совместном release SHA.

## Фактическая проверка

Фактический synthetic Git fixture: FAST через настоящий pre-push — exit 0, 76 ms, две diff-проверки; STANDARD — реальный tsc и один meaningful unit test (1 pass/1 assertion), exit 0, 1.282 s. Auth downgrade отказан exit 1/45 ms; hook branch/ref/dirty guards отказаны exit 1 (7/7/11 ms). Никакого push fixture не выполнялось. Лог: `.scratch/fixture-execution-evidence.log`.

`bun run verify:local --profile full` на чистом source `12f40cba63dd2371b3d96eb528009969959af8b6`: **19/19 stages passed, exit 0, 156.9 s** (157.29 s включая внешний Docker invocation). Source оставался чистым и неизменным до/после проверки.

| Проверка | Фактический результат |
| --- | --- |
| Repository/Selectel guards | 58 tests, 67 assertions, exit 0 |
| Verifier boundaries | 13 tests, 52 assertions, exit 0; negative fixtures действительно отклоняются |
| MAX/neutral contracts | 53 tests, 224 assertions, exit 0; 3 объявленных исторических exclusions |
| Backend units | 138 tests, 499 assertions, exit 0 |
| Web app units | 55 tests, 275 assertions, exit 0 |
| Website boundaries | 4 tests, exit 0 |
| PostgreSQL | 26 files, 307 tests, 2406 assertions, 0 fail, exit 0, 63.8 s; 2 объявленных historical exclusions, без required skips |
| MAX browser journeys | 2 passed, exit 0, 12.4 s stage / 11.6 s Playwright |
| Architecture/audit/types/lint/builds | Все обязательные этапы exit 0; audit без известных уязвимостей |

Логи: `.scratch/linux-full-verification.log`, `.scratch/linux-full-result.json`. `FAILED` внутри negative verifier fixtures — ожидаемые проверки отказа, а не пропущенный failure верхнего плана. Chromium journeys используют real Hono/Prisma test server с NODE_ENV=test, matching loopback *_test DB и synthetic signed MAX context; live bot startup/getMe не вызывается. Финальные README/GIT_SETTINGS/Node prerequisite/report edits после этого source — только документация; их diff проверен отдельно, product tests не повторяются.

Windows FULL на `7acce9288d31fb394514d64b935136ae20d5b14e` НЕ прошёл: exit 255, 692.1 s, после остановки только зависшего собственного Bun users-test child. Все предыдущие static/build/unit/Selectel этапы прошли; users tests 1–16 прошли, затем native hang; один узкий повтор дал Windows native `0xC0000409`. Tests не удалялись и не пропускались. Добавлен внешний timeout 180 s на integration subprocess. Неизменённый весь users suite в Linux прошёл: 18 tests, 157 assertions, 7.16 s, exit 0. Этот узкий результат не подменяет FULL.

Первый Linux FULL остановился корректно (exit 1, 53.85 s): Node 20 не поддерживается текущим Astro. Установлен Node 22.20.0 с проверкой официального SHA256; source не менялся.

Runtime: изолированный Linux/Bun 1.4.0/Node 22.20.0, PostgreSQL 18 loopback, база `memoly_risk_verify_linux_20261017_test`; synthetic identities и отдельный storage. Source получен через Git на точном commit; secrets/logs остаются в ignored `.scratch`, не входят в PR. Existing migrations применялись только к новой test DB; новых migrations нет.

## Review и ограничения

Один независимый review нового diff, один bounded fix/recheck: сохранено MAX subject admission/null provenance coverage; неизвестные package/script paths требуют FULL. Отдельно проверено, что явно исключённая история не смешивается с пропуском обязательного теста, а negative-test fixtures не отравляют итоговый Bun summary. Нового общего аудита F12 не проводилось.

Это предложение правил. До отдельного решения владельца и принятия #179 оно не отменяет действующий gate для других PR. #177 (auth/session) и #176 (family access) требуют FULL; их прежние узкие результаты не заменяют этот профиль. Физическая приёмка iPhone/MAX, установленной PWA и реального host bridge остаётся отдельной: синтетический Chromium не доказывает поведение устройства.

## Порядок принятия

1. Владелец отдельно принимает новые правила и разрешает merge #179; используется приложенное exact-source evidence, без обхода старой защиты.
2. По вступившим в силу правилам выполнить FULL точных актуальных source SHA #177 и #176; повторять прежние независимые расследования не нужно.
3. Отдельное разрешение merge #177. Обновить #176 от принятого main без rebase, проверить стык; отдельное разрешение merge #176. Read-only сравнение уже не выявило конфликтов auth-контракта или изменения ACL со стороны F12.
4. Проверить совместное состояние MAX login → invitation → family reopen и независимые устройства.
5. Перед будущим отдельно разрешённым production deploy — FULL итогового release SHA плюс backup/readiness/migration/health guards и device acceptance.

Никаких merge, production deploy, production data writes или реальных приглашений в этой задаче не выполнялось. Rollback предложения — отдельный revert PR; данные не затронуты. После FULL добавлены только README/GIT_SETTINGS/Node prerequisite и этот отчёт; documentation-only отличие отмечено явно, unchanged product tests не повторялись ради документации.
