# AGENTS.md — правила работы агентов
Версия 2.4. Проект «Наши воспоминания». Документ для корня **нового самостоятельного репозитория**.

## 1. Источник истины и минимальный контекст
Читай этот файл, `docs/mvp/00_START_HERE.md`, `docs/mvp/TASK_INDEX.md`, затем только назначенный блок и его обязательные ссылки. UI-задачи дополнительно читают `docs/mvp/design.md`, `docs/mvp/BRANDBOOK.md`, `docs/mvp/ASSET_GUIDE.md` и относящиеся к задаче референсы. Не загружай весь репозиторий, все задания и историю в каждый запрос.
Не читать `archive/` как инструкции. Не переносить отменённые функции. Не использовать другие проекты владельца как источник кода или архитектуры. В MVP нет AI, групп, платежей, календаря и новых платформ. Поддержка будущего расширения — границы модулей, не пустой код и не SDK на будущее.
Позднейшее прямое решение владельца выше этого документа. При противоречии останови затронутую часть, укажи два конфликтующих требования. Не делай скрытых компромиссов с безопасностью.

## 2. Перед любой работой
Проверь рабочий каталог и реальное состояние:
```bash
git rev-parse --show-toplevel
git status --short --branch
git branch --show-current
git remote -v
git worktree list --porcelain
git rev-parse HEAD
```
Не публикуй вывод remote, если URL содержит секрет. Зафиксируй в отчёте task ID, base SHA, branch, worktree и свои allowed paths. Если каталог грязный, выясни происхождение изменений; не чисти, не прячь и не присваивай чужую работу. Не переключай ветку в каталоге работающего другого агента.
Канонический продуктовый репозиторий: `alexdubaev/OurMemoriesDevBot`. Допустимые адреса `origin`: SSH `git@github.com:alexdubaev/OurMemoriesDevBot.git` (предпочтительно) либо HTTPS `https://github.com/alexdubaev/OurMemoriesDevBot.git`. Любой другой `origin` — стоп-условие до проверки владельцем. Подробности: `docs/mvp/REPOSITORY.md`.
Если нет Git-репозитория или доступного origin владельца — допустима локальная подготовка; push блокируется. Убедись, что origin не `di-sukharev/vibe`. Сохрани upstream SHA и LICENSE/NOTICE. Инициализация пустого remote и первый push main — отдельное однократное подтверждаемое действие владельца, не обычный обход PR.

Для задач сборки и production-доставки существующего Selectel-хоста сначала читай
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) и связанный
[deploy/selectel/README.md](deploy/selectel/README.md). Текущий production host —
`app.memoly.ru`, рабочий каталог на нём — `/opt/memoly/app`. SSH-доступ должен быть
заранее выдан владельцем через защищённое хранилище или SSH agent. Сборка и
production-доставка выполняются вручную по Selectel runbook через этот доступ.
Перед merge выполняется профиль по риску изменений на точном source SHA:
FAST для косметических/документационных правок, STANDARD для обычной разработки,
FULL для авторизации, сессий, ACL, приватных медиа, данных, контрактов и критической
инфраструктуры. `.githooks/pre-push` запускает риск-классификацию при push в `main`/`master`;
установи hook командой `git config core.hooksPath .githooks`. PR merge локальные
hooks не запускает, поэтому профиль, причина, результат и точный SHA записываются
в PR. Перед production deploy выбирай FRONTEND или FULL на итоговом релизном SHA по правилу 2026-10-22 ниже. Отсутствие
обязательной инфраструктуры означает BLOCKED/FAIL, а не PASS. Для PostgreSQL
используй только изолированную базу с именем `*_test`.
Обычный production deploy допускается по постоянному разрешению владельца от 2026-10-11, если конкретная задача или более позднее указание его не запрещает. Он остаётся отдельным от merge действием: обязательны применимый профиль FRONTEND/FULL на точном release SHA, host lock, дисковые проверки, immutable SHA-образы, соответствующие выбранному пути recovery/readiness guards и release manifest. Документационные изменения без runtime-эффекта сами по себе деплоя не требуют. Приватные ключи и значения секретов в Git и переписке не хранятся.

## 3. Стратегия веток
Одна долгоживущая ветка `main`. Она всегда должна собираться, но каждое попадание в main не означает production-деплой. Не создавать постоянные `dev`, `develop`, `test`, ветки по именам моделей или новую `main-final`.
Одна задача → одна короткоживущая ветка → один worktree → один PR. Примеры: `feat/t03-private-media`, `feat/t06-design-system`, `fix/t07-audio-seek`, `docs/t00-delivery-rules`. Одновременно два агента не коммитят в одну ветку. После squash-merge эта ветка не используется для следующей задачи.
Используй штатный isolated worktree Codex, если он уже создан. Проверяй linked worktree и submodule, не создавай вложенную изоляцию вслепую. Если изоляции нет, отдельные worktrees в `.worktrees/` уже разрешены данным процессом; каталог должен быть gitignored. Запрещено force-checkout одной ветки в двух worktrees.
Новые задачи начинаются от принятого актуального origin/main; волну параллельной работы интегратор закрепляет общим base SHA. Не начинать зависимую задачу от неподтверждённой соседней ветки. Stacked PR и временный integration branch не нужны этому MVP.

## 4. Команды начала и синхронизации
После проверки и при настроенном origin:
```bash
git fetch origin --prune
git worktree add .worktrees/t03-media -b feat/t03-private-media origin/main
```
Команду выполняет координатор из основного checkout только если путь/ветка ещё не существуют. В уже выделенном Codex worktree повторно её не выполнять. Для каждого worktree отдельные тестовые БД, Compose project, порты и временные storage-папки; один общий тестовый порт не делить.
Проверка связи текущей ветки с base:
```bash
git log --oneline --decorate -8
git diff --stat origin/main...HEAD
```
Если main изменился, после чистого статуса и ревью контракта выполнить **merge origin/main в свою feature-ветку** и повторить затронутые проверки. Такой merge-коммит исчезнет при squash PR. Не ребейзить опубликованную ветку и не переписывать её историю; это сознательно выбранный безопасный процесс. Не применять массовый `ours/theirs` для конфликтов. Конфликт в schema, контракте, auth или lockfile передать интегратору.

## 5. Параллельные агенты и владение файлами
Разрешены только волны из `docs/mvp/PARALLEL_WORK.md`. Каждый агент получает base SHA, task ID, allowlist путей, forbidden paths и модель ревью. Совпадение цвета в Excel не отменяет проверки зависимостей.
Интегратор единолично принимает изменения `package.json`, lockfile, Prisma schema/migrations, shared contracts, composition root, generated route tree, root config и manifests. Предложение изменения общего файла — отдельный diff/описание; два агента не модифицируют его одновременно. Владелец контракта публикует его раньше потребителя.
Автогенерируемые файлы генерирует назначенный владелец один раз после слияния входов. Не исправлять generated files вручную. Не копировать код между worktrees вне Git. Не cherry-pick'ать одни и те же изменения и одновременно сливать их ветку.

## 5A. Субагенты
Основной исполнитель не фиксируется в `AGENTS.md`: модель и reasoning для каждой задачи отдельно выбирает владелец.

Для рутинных субагентских задач использовать **GPT-6 Luna**, `reasoning_effort = high`, тариф **standard/non-Pro**. Luna подходит для чтения и анализа документации; read-only исследования кода; поиска зависимостей, assumptions и связанных usages; составления test matrix; запуска узких безопасных проверок; docs-only правок; простых low-risk изменений; независимого review конкретного diff или commit.

Не подключать субагентов ради формальности. Рутинное чтение, инвентаризацию и простые проверки предпочтительно поручать Luna, если это экономит время основного исполнителя и не создаёт лишнего риска.

Если Luna обнаруживает архитектурный выбор, изменение data model или migration, вопрос security/ACL, риск для production data, сложный race или idempotency либо несколько несовместимых вариантов решения, она останавливается и возвращает findings основному исполнителю; решение остаётся за ним.

По умолчанию одновременно работает не больше одного Luna-субагента. Большее число допустимо, только если владелец или основной исполнитель явно обосновал независимость задач. Luna не запускает субагентов.

Независимое review поручать GPT-6 Luna с `reasoning_effort = high`, тариф **standard/non-Pro**. Основной агент может запустить такое review самостоятельно, без отдельной команды владельца, если оно остаётся внутри уже назначенного scope, не выполняет production action, не расширяет функциональную задачу и действительно повышает независимость проверки. Для значимых docs/spec blocks, contracts, migrations, backend changes и существенного diff такое review предпочтительно по умолчанию, если явно не избыточно. Не запускать review ради формальности. Review read-only и ограничен конкретным diff или commit; findings помечаются P0/P1/P2. Ревьюер не переписывает scope задачи и не запускает бесконечные циклы QA/review.

После review основной агент может сам исправить простые docs/mechanical findings, low-risk P2 и очевидный bounded P1 либо поручить узкое исправление Luna High, если оно не требует архитектурного, data model или security/ACL решения, изменения migration semantics, решения о production data либо сложного race/idempotency решения. Затем выполнить одну узкую повторную проверку закрытия findings и вернуть финальный HANDOFF. Обычный предел — один независимый review, один fix pass и одна narrow recheck; не повторять бесконечный review → fix → review → fix цикл.

Не требовать бесконечной самоидентификации модели. Достаточно записанного orchestration call с `model = gpt-6-luna` и `reasoning_effort = high`; фактический уровень подтверждения модели указывать честно.

## 6. Реализация и проверки
Для memoLy поддерживаются только MAX Bot, MAX Mini App, Web/PWA с MAX authentication и browser-link MAX. Другие мессенджеры не входят в разработку или критерии тестирования. Исторический код сохраняется; не удаляй его без отдельной задачи.
Сохраняй Bun/Hono/Prisma, React/Vite и модульный монолит выбранного Vibe. Общие публичные контракты — отдельный пакет. Не импортируй внутренности соседнего домена.
Сначала сформулируй сценарий и проверь baseline, затем тест на нужной границе → минимальная реализация → тот же тест. Чисто визуальная задача может иметь целевую визуальную приёмку, а не бессмысленный тест цвета в коде.
Профили: FAST — `git diff --check` и быстрые релевантные проверки; STANDARD — typecheck/lint/build и тесты затронутого модуля; FULL — архитектура, аудит зависимостей, сборки, действующие MAX и platform-neutral tests, PostgreSQL, MAX/Web/PWA browser journeys и Selectel safety. Выбирай наиболее рискованную границу; неопределённость и неизвестные пути означают FULL. `bun run verify:local --profile ...` не позволяет запросить профиль ниже автоматически требуемого. Перед merge записывай профиль, причину, команды, результаты и проверенный SHA. Dry-run показывает план и не является PASS. Не запускай FULL ради косметических правок и не устраивай циклы review/test ради формальности. Перед production deploy применяй правило 2026-10-22: FRONTEND для доказанного presentation-only выпуска, FULL для остальных runtime-изменений. Проверка на точном итоговом release SHA охватывает все изменения относительно работающей версии. Проверки дополняют соответствующие выбранному пути recovery/readiness guards и Selectel safeguards.
Не выполнять реальные платежи, отправку приглашений посторонним, production-удаления, массовые рассылки или создание платной инфраструктуры без прямого разрешения. В тестах только синтетические материалы.

## 7. Коммиты, push и PR
Коммиты небольшие и законченные: `feat(media): ...`, `fix(auth): ...`, `test(feed): ...`, `docs(delivery): ...`. Рекомендуемый формат Conventional Commits — процесс проекта, не повод переписывать старую историю.
Перед commit:
```bash
git diff --check
git diff --stat
git status --short
```
Добавляй **явные пути**, а не бездумный `git add .`. Проверь staged diff и секреты. Не коммить .env, токены, подписанные медиа-URL, семейную переписку, node_modules, БД, uploads, browser cookies, приватные артефакты и файлы шрифтов из окружения агента. Публичную зависимость шрифта разработчик подключает отдельно по лицензии.
После согласованного назначения задачи допускается обычный push **своей task-ветки** в подтверждённый origin и создание draft PR. Если разрешение на публикацию не дано, оставь локальные коммиты и попроси его. Не считать просьбу «написать код» разрешением опубликовать частный проект в публичный repo.
```bash
git push --set-upstream origin feat/t03-private-media
```
При non-fast-forward остановиться и fetch/сравнить историю. `--force`, `--force-with-lease`, `reset --hard`, `clean -fd/-fdx`, удаление чужих веток, reflog rewrite — запрещены по умолчанию. Даже force-with-lease требует отдельного конкретного разрешения и подтверждённого expected SHA.
PR имеет base `main`, назначенный task ID, описание пользовательского результата, изменённые границы, реальные команды/результаты, скриншоты для UI, миграции, rollback, известные ограничения. Использовать шаблон `templates/PULL_REQUEST_TEMPLATE.md`. Автор не выдаёт своё self-review за независимое ревью.

## 7A. MAX development-бот и секреты
Для memoLy проверяются только MAX Bot, MAX Mini App, Web/PWA с MAX authentication и browser-link MAX. Другие мессенджеры исключены из разработки и критериев тестирования; исторический код не удалять без отдельной задачи. MAX tokens и webhook secrets существуют только в environment/secret store. Не выводить секреты в debug output, command arguments, screenshots или PR. Если секрет попал в историю Git — остановить работу и потребовать rotation; не пытаться «спрятать» только новым commit.

## 8. Слияние
Merge выполняет назначенный интегратор либо ведущий агент задачи, если отдельный интегратор не назначен. GitHub PR → **Squash and merge**. Владелец заранее разрешил merge при выполнении всех gates: применимый риск-профиль PASS на точном актуальном source SHA с evidence в PR, независимое техническое review, отсутствие открытых P0/P1/P2, конфликтов и нерешённых вопросов, требующих решения владельца. Отдельное одобрение владельца на нажатие merge для такого PR не нужно. Если после review изменён код, перепроверь затронутые риски и необходимость узкого повторного review. Перед production deploy нужен применимый FRONTEND/FULL на итоговом релизном SHA по правилу 2026-10-22. Прямой запрет merge в конкретной задаче сохраняет силу до его отмены владельцем.
После первого PR волны обновить вторую ветку от текущего main, проверить стык и только затем squash. Одна очередь слияния, без гонки двух операторов. Удалённые Actions checks не являются условием публикации.
После squash сверить PR merged status и записать merge SHA. Удалять task branch/worktree можно только после подтверждения, что работа сохранена, PR слит, каталог чистый и агент завершён. Не использовать `branch --merged` как единственное доказательство для squash-ветки. Если обычное безопасное удаление ветки отказывается из-за squash-истории — сообщить, не делать -D автоматически.

## 9. GitHub и публикация
Для main сохраняются PR review, запрет force-push и удаления, linear history и разрешение обсуждений. GitHub Actions CI/CD не используется. Перед merge обязателен подходящий риск-профиль на точном source SHA; серверный merge не запускает локальный hook, поэтому доказательство прикладывается к PR. Перед production deployment обязателен применимый FRONTEND/FULL на точном итоговом release SHA по правилу 2026-10-22. Production deployment остаётся отдельным от merge и выполняется по постоянному разрешению владельца от 2026-10-11, если оно не ограничено конкретной задачей или более поздним указанием; все применимые к выбранному пути safety/recovery/readiness guards обязательны; обычный FULL-путь сохраняет backup/migration guards.

## 10. Версии и релизы
Task-коммит не меняет номер продукта. Номер назначает интегратор в релизном PR. Первый кандидат `v0.1.0-rc.1`, следующий `v0.1.0-rc.2`, принятый пилот `v0.1.0`; исправления `v0.1.1` и т.д. Документационный пакет 2.4 не равен версии приложения.
Release tag annotated, неизменяемый, указывает на проверенный commit из main. Запрещено переносить существующий тег. Release manifest: app version, full Git SHA, image digest, web bundle checksum, migration set, окружение, время и результат smoke. Образы не деплоить по mutable `latest`.
Артефакт собирается один раз, тестируется на staging и продвигается по тому же digest. Если конфигурация требует иной сборки, её считать другим артефактом и проверить заново; не обещать, что это тот же build. Production-токен бота и тестовый токен различаются. Миграции запускает один release job, не каждый процесс при старте.
Миграции преимущественно expand → compatible code → contract отдельным релизом. Уже применённую миграцию не редактировать. Безопасный откат кода не равен восстановлению БД: backup restore может удалить новые записи. Если миграция может пересечь границу совместимости схемы и runtime, останови старые пишущие процессы до SQL; не откатывай автоматически несовместимый runtime, а при неизвестном результате применения продолжай только вперёд. Деструктивные миграции и восстановление production только с отдельным согласованием.

## 11. Графика
Собственные иконки генерировать/создавать заранее и поставлять только оптимизированными **WebP RGBA**, с настоящим прозрачным фоном. Не создавать SVG-иконки, inline SVG, SVG data URI, icon-font или SVG sprite. Не подключать Lucide/Hugeicons ради новых пиктограмм. Иконки выбранных UI-библиотек переопределять штатными слотами.
Текст интерфейса, формы, поля, progress, waveform, layout и кнопки — настоящий HTML/CSS, не растровый скриншот. Пользовательские фото/голос/видео не заменять генерацией; оригиналы не уничтожать оптимизацией. Генерация графики — этап разработки, не AI-функция MVP.
Соблюдать `docs/mvp/ASSET_GUIDE.md`, manifest и бюджеты. Не генерировать один и тот же значок заново в каждом блоке; переиспользовать общий WebpIcon. Референсы/demo не включать в production bundle.

## 12. Завершение задачи
В отчёт: task ID; model; branch/worktree; base/head SHA; changed paths; тесты с числами и exit code; скриншоты; review findings; миграции; изменения контрактов; остаточные риски; PR link либо «не опубликовано». См. `templates/review/BLOCK_REPORT.md`.
Статусы: NOT_STARTED → IN_PROGRESS → REVIEW → APPROVED → MERGED. WAITING_FOR_OWNER_APPROVAL — ожидается одно конкретное решение владельца для продолжения той же задачи; BLOCKED — отдельный статус только при доказанной невозможности безопасно продолжать. «Готово» нельзя писать, если обязательные проверки не выполнены. Не завершай назначенную задачу на READY_FOR_MERGE: когда gates зелёные и полномочия позволяют, самостоятельно выполни squash merge, проверь итоговый main SHA и безопасно заверши свой worktree/ветку. Если для назначенной задачи разрешён production release, выполни его со всеми обязательными проверками; если есть явный запрет или неразрешённый риск — соблюдай его. Не начинай следующую независимую задачу без назначения.

## Решение владельца 2026-10-11: деплой по умолчанию
Если владелец прямо не указал другое, после завершения задачи, зелёных применимых локальных проверок и технического ревью нужно довести изменения до публикации и production-деплоя. Это постоянное разрешение владельца: отдельное повторное подтверждение обычного деплоя не требуется. Процедура остаётся ручной, через существующий guarded release; GitHub Actions не вводить.
Не запускать лишние проверки или повторные ревью для формальности. Уже зелёные целевые проверки повторяются только после новых изменений, ошибки или конкретного оставшегося риска. Проверки перед merge и deploy выбираются по риску с исключением FRONTEND по правилу 2026-10-22; проверка поднявшегося релиза сохраняется.
Сохранять данные и существующую возможность отката. Это правило не разрешает деструктивные миграции, восстановление production-БД, удаление данных или создание платной инфраструктуры. Более позднее прямое указание владельца имеет приоритет.

## Решение владельца 2026-10-20: самостоятельное завершение зелёных задач

Владелец предоставил **постоянное разрешение на Squash Merge** для назначенных задач: после PASS обязательного risk gate на точном текущем HEAD, независимого технического review, устранения P0/P1/P2 и проверки стыка с актуальным main интегратор/ведущий агент сам публикует evidence, переводит PR из Draft в Ready, выполняет squash merge с проверкой ожидаемого HEAD и подтверждает merge SHA в main. Не проси владельца служить «прокси» для обычного подтверждения merge; ручной просмотр кода владельцем не требуется, когда независимое review уже закрыто. Если проверка недоступна или реально FAIL — merge запрещён; статус BLOCKED должен быть обоснован.

Разрешение **не отменяет** отдельной продуктовой приёмки, если она прямо назначена, запрета merge/deploy в конкретной задаче, согласования существенных архитектурных изменений, рисков для данных/ACL/безопасности, деструктивных миграций, изменения production-данных без полномочий, а также правил безопасного релиза. Для обычного deploy применяй действующее отдельное разрешение 2026-10-11 и применимый FRONTEND/FULL на финальном release SHA по правилу 2026-10-22; docs-only PR не требует deploy. Приоритет имеют более поздние прямые указания владельца. Новую независимую задачу без назначения не начинай.

## Autonomous Engineering Ownership

Owner policy: the agent owns the agreed result, not just the plan. A technical obstacle starts investigation, not automatic termination.

1. **Resolve and continue.** Establish the cause, reproduce the failure, verify facts, assess safe alternatives, implement the best authorized fix, verify it, and resume the original task. An unfamiliar error or first failed command is not grounds for BLOCKED.

2. **Investigate independently.** For Windows test failures, evaluate available WSL, Docker or isolated Linux execution. For test infrastructure failures, inspect settings, environment, ports, containers and safe alternatives. For build errors, localize the cause from logs. For vulnerable dependencies, consult authoritative documentation for compatible safe versions, apply a minimal authorized fix and check regressions. For unfamiliar failures use documentation, source and research tools; choose commands and diagnostics independently.

3. **Coordinate available AI.** Use authorized researchers, subagents and independent reviewers where useful, within existing delegation limits. The lead remains accountable. Never ask the owner to relay technical reports between AIs when direct investigation or coordination is available; never claim unavailable delegation occurred.

4. **Stay within authority.** Preserve architecture unless change is necessary and authorized; minimize fixes and avoid unrelated refactoring. Never disable tests, fabricate checks, weaken security, bypass STOP conditions or Git/review/merge/deploy/secret rules, change production data without authority, perform unapproved destructive actions or create paid infrastructure. If a fix exceeds scope, assess a separate safe fix through the existing process; request specific permission before unauthorized changes.

5. **Escalate owner decisions only.** Ask when product behavior, substantial product-impacting architecture, dangerous/irreversible/destructive action, material security/privacy/data risk, unplanned expense, missing access, real manual user acceptance or an otherwise prohibited action requires the owner. Routine technical troubleshooting is the agent's responsibility.

6. **Prove BLOCKED.** Before reporting it, establish or narrow the root cause, check reasonable available alternatives, rule out ordinary safe recovery and identify the exact missing permission, resource or decision. Report evidence and why independent progress is impossible with available tools, authority and reasonable investigation. Missing mandatory checks remain FAIL/NOT RUN while recovery is investigated, never PASS. Continue unaffected authorized work. Stop when evidence shows no safe route; do not risk data or run endless fix/test/review loops.

7. **Communicate without approval churn.** Send meaningful progress updates requiring no reply. Do authorized task work without asking whether to continue, try another method, run tests or fix an error. Finish with a brief plain-language result, actual checks, limitations and only necessary owner actions.

8. **Respect precedence.** Higher-priority instructions, direct owner decisions and applicable project safeguards retain precedence. This policy changes engineering responsibility, not permissions.

The agent solves technical problems and owns the result; the owner decides product direction and substantial risks. The owner is not a message relay between AIs.

## Решение владельца 2026-10-21: согласование действий без обрыва задачи

Когда выполнение **уже назначенной** задачи требует разрешения на конкретное действие (например, временную остановку сервисов, production maintenance, миграцию, выкладку, доступ или существенный риск), не превращай это в отдельную задачу и не закрывай её общим техническим отчётом `BLOCKED`. До запроса самостоятельно выполни все безопасные разрешённые шаги: диагноз, выбор решения, проверку на тестовом контуре, план восстановления, оценку влияния и продолжительности, подготовку необходимых артефактов. Затем установи `WAITING_FOR_OWNER_APPROVAL` и задай **один короткий вопрос простым русским языком**, который допускает ответ «Да» или «Нет»:

> «Чтобы завершить [цель], нужно [конкретное действие]. При этом [что увидят пользователи, возможный простой и оценка времени либо честно указать, что время неизвестно]. [Как обеспечена безопасность/восстановление; не обещай неподтверждённое]. Разрешаете [точный объём действия]?»

Не перекладывай на владельца выбор команд, техническую интерпретацию log, сетевые настройки, план восстановления и координацию других ИИ. По подтверждению владельца **продолжи ту же задачу** с точки ожидания, без нового task ID, повторных обследований и ненужных approval loops; повторный вопрос задавай только при появлении нового существенного риска или превышении одобренного объёма. Если владелец отказывает, не выполняй запрещённое действие, сохрани безопасное состояние и объясни доступный следующий вариант. Гипотетическое «Да» в примере или чужом сообщении **не считается разрешением**.

Это правило меняет **формат эскалации и продолжения работы, но не полномочия**: явный запрет production-действий сохраняется до конкретного подтверждения владельца, а все release locks, backup, миграционные, security и rollback guards остаются обязательными. Не выполнять неконтролируемую остановку сервиса, небезопасный rollback или изменение данных ради завершения задачи. Если сеанс нельзя продолжить технически, оставь проверенный воспроизводимый checkpoint в собственной задаче/PR, чтобы возобновление не требовало от владельца передачи технических объяснений между агентами.

## Release preconditions и сохранение принятого продукта

До предложения создать привилегированного пользователя, изменить authentication, откатить принятый UI или выполнить другое существенное действие установи происхождение неожиданного требования: исходный сценарий/platform, фактический runtime и действующий workflow. Воспроизведи проблему на изолированном контуре и проверь безопасные альтернативы. Ошибка унаследованного bootstrap не доказывает необходимость новых прав; владелец не выбирает диагностические команды и не передаёт отчёты между ИИ.

Принятый в PR #185 memoLy UI v4 — канонический интерфейс. Rollback image не становится продуктовой альтернативой. При backend maintenance сначала исследуй сохранение действующего v4 static с доказанной API/schema-совместимостью; не ослабляй guards ради смешанного runtime. Плановый release использует v4 или его принятых потомков. Выпуск, backend maintenance и восстановление обязаны сохранять UI v4. Возврат интерфейса до v4 запрещён; не предлагай его владельцу как техническую альтернативу и не создавай способ разрешить его через approval file или флаг. Если совместимый переход с v4 не доказан, подготовь безопасный forward fix, сохраняя данные и действующие guards. Разрешение на простой не меняет продуктовую версию. Точный проверенный recovery target и image IDs описаны в [Selectel runbook](deploy/selectel/README.md).

Каноническое разделение cloud-bootstrap, существующего MAX-only Selectel, обычного update и recovery: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Проверяй полный вызываемый путь до его postconditions, а не только Prisma SQL. Обязательные regression tests должны воспроизводить реальный deployment-сценарий без реальных семейных данных. После конкретного согласования продолжай ту же задачу по правилу 2026-10-21 выше. Этот раздел не разрешает production-действия, запрещённые назначением.

## Решение владельца 2026-10-22: короткий выпуск фронтенда по умолчанию

Для небольших изменений текста, кнопок, навигации и оформления используй **FRONTEND**, если весь накопленный diff относительно реально работающих backend и frontend проходит строгий scope gate. Это правило заменяет прежнее безусловное требование FULL перед каждым production deploy. Одного утверждения «backend не трогали» недостаточно: проверь реальные SHA и все ещё не выпущенные изменения.

- Разрешены только presentation-only изменения в путях из `deploy/selectel/frontend-safe-paths.txt`, сопутствующие тесты и пассивная документация. Авторизация/сессии, ACL и проверки прав, API-клиенты/контракты, приватные медиа и video lifecycle, storage/cache/offline/service worker, бизнес-логика, backend/schema/migrations, зависимости/lockfile, сборка и deployment tooling требуют **FULL**, даже если менялся только frontend-файл. Неизвестный путь или сомнение — FULL. Техническое review подтверждает семантику, scope gate проверяет пути; не расширяй allowlist ради одной зелёной выкладки.
- Перед публикацией и на точном итоговом release SHA выполни `bun run verify:local --profile frontend --base <работающий backend SHA> --journey <путь существующего короткого E2E>` и целевую визуальную проверку изменённых экранов. FRONTEND включает typecheck, lint, production build, релевантные узкие тесты и обязательный выполненный browser journey. Ноль тестов, skips, dry-run и непроверенный SHA не считаются PASS. Путь и дополнительные параметры см. в [Selectel runbook](deploy/selectel/README.md).
- После squash сначала сравни дерево с проверенным feature tree. Если изменился только commit SHA, повтори FRONTEND на итоговом SHA; FULL ради самого squash не запускай. При изменении исходников повтори только затронутые проверки выбранного профиля; при выходе за FRONTEND — FULL.
- Выпускай через версионированный `ci-release.sh` в режиме `frontend`: строится и обновляется только static/webapp. Backend, worker, scheduler, gateway/config и БД сохраняются; `migrate`, `pg_dump`, подготовка полного application rollback и перезапуск серверных сервисов в этом пути не выполняются. Не вызывай Compose вручную. Scope, текущий main, чистота/ownership, host lock, disk, UI v4, immutable image ID/OCI, read-only migration/history, сохранность серверных сервисов, smoke и manifest остаются обязательными.
- Короткий выпуск сохраняет отдельное точное состояние восстановления frontend с прежним webapp image ID и неизменным backend. Перед promotion проверь возможность такого отката; после — frontend recovery-readiness и public smoke. Designated application recovery pair в `rollback.env` не переписывается и не объявляется заново аттестованной для произвольного source. При ошибке восстанавливается только прежний frontend. БД не откатывается. Операторское восстановление — через тот же guarded entry point в режиме `frontend-rollback`, с проверкой сохранённого состояния.
- Используй готовое локальное тестовое окружение и кэш, когда зависимости не изменились. Не пересоздавай стенд, не запускай backend FULL, повторные полные ревью и матрицы браузеров/скриншотов для формальности. Для затронутых браузерных рисков проверяй соответствующий браузер; реальный iPhone/MAX не объявляй проверенным по desktop WebKit.
- Изменение самого процесса выпуска, scope gate, verifier или recovery требует FULL и независимого review. Docs-only без runtime-эффекта деплоя не требует. Отчёт краткий: release mode, deployed backend/frontend SHA, фактические проверки, PR, promotion/smoke/recovery и реальные ограничения. Постоянные разрешения на commit/PR/merge/deploy сохраняются.
