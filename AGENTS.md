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
Интегратор единолично принимает изменения `package.json`, lockfile, Prisma schema/migrations, shared contracts, composition root, generated route tree, CI, root config и manifests. Предложение изменения общего файла — отдельный diff/описание; два агента не модифицируют его одновременно. Владелец контракта публикует его раньше потребителя.
Автогенерируемые файлы генерирует назначенный владелец один раз после слияния входов. Не исправлять generated files вручную. Не копировать код между worktrees вне Git. Не cherry-pick'ать одни и те же изменения и одновременно сливать их ветку.

## 6. Реализация и проверки
Сохраняй Bun/Hono/Prisma, React/Vite и модульный монолит выбранного Vibe. Общие публичные контракты — отдельный пакет. Не импортируй внутренности соседнего домена. Telegram SDK только в адаптере; UI и память не зависят напрямую от Telegram.
Сначала сформулируй сценарий и проверь baseline, затем тест на нужной границе → минимальная реализация → тот же тест. Чисто визуальная задача может иметь целевую визуальную приёмку, а не бессмысленный тест цвета в коде.
Профили: FAST — локальные сигналы; DOMAIN — затронутый модуль; CONTRACT — производители/потребители интерфейса; FULL — активный продукт перед выпуском и сквозными изменениями. План проверок не равен выполненным тестам. Ноль найденных тестов не считается успехом. Не повторяй полный suite на каждую мелкую правку. Не скрывай проблему окружения под зелёной проверкой синтаксиса.
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

## 7A. Telegram development-бот и секреты
Development/pilot bot проекта: `@OurMemoriesDevBot` («Наши воспоминания • Test»). Не создавать второй без решения владельца.
Публично допустимы username и URL `https://t.me/OurMemoriesDevBot`. Секретны `TELEGRAM_BOT_TOKEN` и `TELEGRAM_WEBHOOK_SECRET`; они существуют только в environment/secret store. В Git хранится `TELEGRAM_BOT_EXPECTED_USERNAME=OurMemoriesDevBot`, а secret fields в `.env.example` остаются пустыми.
Перед использованием token сервер вызывает `getMe`, проверяет ожидаемый username и только затем начинает polling/webhook. Не выводить token/secret в debug output, command arguments, screenshots, CI annotations или PR. Если секрет попал в историю Git — остановить работу и потребовать rotation; не пытаться «спрятать» только новым commit.

## 8. Слияние
Только назначенный интегратор или владелец выполняет merge. GitHub PR → **Squash and merge**. Merge в main требует зелёных проверок актуального head SHA, назначенного технического ревью и одобрения владельца. После новых изменений старый review пересматривается. Две зелёные ветки по отдельности ещё не доказывают, что они работают вместе.
После первого PR волны обновить вторую ветку от текущего main, проверить стык и только затем squash. Одна очередь слияния, без гонки двух операторов. Merge queue — возможное позднее усиление, не обязательный сервис пилота.
Review другой моделью под тем же GitHub-пользователем не является независимым GitHub approval. Если второй человек с write-доступом есть, включить required review=1 и stale approvals dismissal. Если владелец один, не настраивать невозможное self-approval: оставить required PR/checks и ручной merge владельцем после отдельного зафиксированного технического ревью. В обоих случаях report не заменяет работающие checks.
После squash сверить PR merged status и записать merge SHA. Удалять task branch/worktree можно только после подтверждения, что работа сохранена, PR слит, каталог чистый и агент завершён. Не использовать `branch --merged` как единственное доказательство для squash-ветки. Если обычное безопасное удаление ветки отказывается из-за squash-истории — сообщить, не делать -D автоматически.

## 9. GitHub-защиты — настроить и проверить в этапе 00
Сначала запусти baseline workflow и убедись, что статус verify-required действительно существует; только затем включай его как required, чтобы не заблокировать первый PR навсегда. Для main: PR required; unique required check `verify-required`; запрет force-push и удаления; linear history; обсуждения resolved; свежая проверка относительно target; минимальные bypass-права. Auto-merge и production auto-deploy выключены. Защиту применить к администратору, где возможно. Условия доступности защиты частного repo зависят от тарифа GitHub; не выдавать документ за реально включённую защиту.
CI запускается для каждого PR; не отключать целый required workflow верхнеуровневым paths filter. Внутри определить changed modules, выполнить нужные jobs; агрегатор `verify-required` с `always()` проверяет, что каждая требуемая проверка завершилась success, а skip имеет объяснимую причину. Failed/cancelled/missing required job → failure. Не давать зелёный итог, если всё skipped.
Concurrency CI — на PR/branch, старый run можно отменить. Deploy concurrency — один environment, без прерывания уже идущей миграции. Pull request из недоверенной ветки не получает production secrets. Не выполнять недоверенный код через `pull_request_target` с write-token. Third-party Actions закреплять immutable SHA после проверки; minimal permissions.

## 10. Версии и релизы
Task-коммит не меняет номер продукта. Номер назначает интегратор в релизном PR. Первый кандидат `v0.1.0-rc.1`, следующий `v0.1.0-rc.2`, принятый пилот `v0.1.0`; исправления `v0.1.1` и т.д. Документационный пакет 2.4 не равен версии приложения.
Release tag annotated, неизменяемый, указывает на проверенный commit из main. Запрещено переносить существующий тег. Release manifest: app version, full Git SHA, image digest, web bundle checksum, migration set, окружение, время и результат smoke. Образы не деплоить по mutable `latest`.
Артефакт собирается один раз, тестируется на staging и продвигается по тому же digest. Если конфигурация требует иной сборки, её считать другим артефактом и проверить заново; не обещать, что это тот же build. Production-токен бота и тестовый токен различаются. Миграции запускает один release job, не каждый процесс при старте.
Миграции преимущественно expand → compatible code → contract отдельным релизом. Уже применённую миграцию не редактировать. Безопасный откат кода не равен восстановлению БД: backup restore может удалить новые записи. Деструктивные миграции и восстановление production только с отдельным согласованием.

## 11. Графика
Собственные иконки генерировать/создавать заранее и поставлять только оптимизированными **WebP RGBA**, с настоящим прозрачным фоном. Не создавать SVG-иконки, inline SVG, SVG data URI, icon-font или SVG sprite. Не подключать Lucide/Hugeicons ради новых пиктограмм. Иконки выбранных UI-библиотек переопределять штатными слотами.
Текст интерфейса, формы, поля, progress, waveform, layout и кнопки — настоящий HTML/CSS, не растровый скриншот. Пользовательские фото/голос/видео не заменять генерацией; оригиналы не уничтожать оптимизацией. Генерация графики — этап разработки, не AI-функция MVP.
Соблюдать `docs/mvp/ASSET_GUIDE.md`, manifest и бюджеты. Не генерировать один и тот же значок заново в каждом блоке; переиспользовать общий WebpIcon. Референсы/demo не включать в production bundle.

## 12. Завершение задачи
В отчёт: task ID; model; branch/worktree; base/head SHA; changed paths; тесты с числами и exit code; скриншоты; review findings; миграции; изменения контрактов; остаточные риски; PR link либо «не опубликовано». См. `templates/review/BLOCK_REPORT.md`.
Статусы: NOT_STARTED → IN_PROGRESS → REVIEW → APPROVED → MERGED. BLOCKED — отдельный статус. «Готово» нельзя писать, если обязательные проверки не выполнены. После блока остановиться; не запускать следующую задачу или production-деплой без очередного назначения.

## Selectel staging — доступ и выкладка

### Окружение

- Публичный адрес: `https://app.memoly.ru`
- Selectel-сервер: `136.234.5.56`
- Hostname: `memoly-staging`
- SSH-пользователь: `root`
- Репозиторий: `alexdubaev/OurMemoriesDevBot`
- Локальный SSH-ключ на рабочей машине: `%USERPROFILE%\.ssh\id_ed25519`

Подключение из PowerShell:

```powershell
ssh -i "$env:USERPROFILE\.ssh\id_ed25519" root@136.234.5.56
```

Никогда не выводить, не копировать в чат и не коммитить:

- содержимое приватного SSH-ключа;
- значения файлов из `/opt/memoly/secrets`;
- токены и пароли из `/opt/memoly/env`;
- подписанные URL и provider credentials.

### Серверные пути

```text
/opt/memoly/app          — checkout Git-репозитория
/opt/memoly/compose.yml  — Docker Compose staging
/opt/memoly/env          — конфигурация окружения
/opt/memoly/secrets      — серверные секреты
```

Checkout `/opt/memoly/app` принадлежит системному пользователю `memoly`.
Git-команды выполнять от его имени.

### Проверка состояния перед выкладкой

Всю последовательность выполнять в одной SSH-сессии. Перед первой проверкой захватить
эксклюзивную блокировку и держать дескриптор открытым до конца выкладки или отката:

```bash
exec 9>/run/lock/memoly-staging-deploy.lock
flock -n 9 || { echo 'another staging deployment is already running'; exit 1; }
set -euo pipefail
```

```bash
cd /opt/memoly

docker compose -f compose.yml ps
docker compose -f compose.yml images

test -z "$(git -C /opt/memoly/app status --porcelain)" || {
  echo 'staging checkout is dirty'; exit 1;
}
git -C /opt/memoly/app rev-parse HEAD
origin="$(git -C /opt/memoly/app remote get-url origin)" || exit 1
case "$origin" in
  git@github.com:alexdubaev/OurMemoriesDevBot.git|https://github.com/alexdubaev/OurMemoriesDevBot.git) ;;
  *) echo 'unexpected origin'; exit 1 ;;
esac
```

Не продолжать автоматически, если:

- checkout содержит неизвестные изменения;
- `origin` не указывает на `alexdubaev/OurMemoriesDevBot`;
- новый SHA не находится в актуальном `origin/main`;
- Docker Compose configuration validation завершается ошибкой;
- миграционная проверка сообщает о проблеме.

### Правила выкладки

Выкладка выполняется из GitHub по конкретному полному Git SHA.

Запрещено:

- загружать файлы приложения через FTP вручную;
- использовать Docker-тег `latest`;
- выводить секреты в терминал или логи;
- выполнять `git reset --hard`, `git clean` или force-push;
- изменять staging БД вручную без отдельной задачи;
- редактировать уже применённые миграции.

Последовательность:

1. Убедиться, что PR слит в `main`, required CI зелёный.
2. Получить полный merge SHA.
3. Сохранить резервную копию `compose.yml`.
4. Fetch `origin/main`.
5. Переключить серверный checkout на точный SHA в detached HEAD.
6. Собрать backend и webapp с immutable-тегом SHA.
7. Проверить Docker Compose configuration.
8. Выполнить предусмотренную проектом проверку миграций.
9. Применить миграции только штатной командой проекта.
10. Пересоздать сервисы.
11. Проверить контейнеры и публичные health endpoints.
12. Зафиксировать реально установленный SHA.

### Обновление checkout

```bash
sudo -u memoly git -C /opt/memoly/app fetch origin --prune
TARGET_SHA='<FULL_GIT_SHA>'
if [ "${#TARGET_SHA}" -ne 40 ]; then
  echo 'TARGET_SHA must be exactly 40 hexadecimal characters'; exit 1
fi
case "$TARGET_SHA" in
  *[!0-9a-fA-F]*) echo 'TARGET_SHA must be exactly 40 hexadecimal characters'; exit 1 ;;
esac
TARGET_SHA_NORMALIZED="$(printf '%s' "$TARGET_SHA" | tr '[:upper:]' '[:lower:]')"
RESOLVED_TARGET_SHA="$(sudo -u memoly git -C /opt/memoly/app rev-parse --verify "${TARGET_SHA_NORMALIZED}^{commit}")" || {
  echo 'target SHA is not a commit in the staging checkout'; exit 1;
}
[ "$RESOLVED_TARGET_SHA" = "$TARGET_SHA_NORMALIZED" ] || {
  echo 'target SHA did not resolve to the requested commit'; exit 1;
}
ORIGIN_MAIN_SHA="$(sudo -u memoly git -C /opt/memoly/app rev-parse --verify origin/main^{commit})"
sudo -u memoly git -C /opt/memoly/app merge-base --is-ancestor "$RESOLVED_TARGET_SHA" "$ORIGIN_MAIN_SHA" || {
  echo 'target SHA is not reachable from origin/main'; exit 1;
}
sudo -u memoly git -C /opt/memoly/app checkout --detach "$RESOLVED_TARGET_SHA"
CHECKED_OUT_SHA="$(sudo -u memoly git -C /opt/memoly/app rev-parse HEAD)"
[ "$CHECKED_OUT_SHA" = "$RESOLVED_TARGET_SHA" ] || {
  echo 'checked out SHA does not match the requested commit'; exit 1;
}
```

Полученный HEAD должен точно совпадать с `<FULL_GIT_SHA>`.

### Резервная копия Compose-конфигурации

```bash
cp -a \
  /opt/memoly/compose.yml \
  /opt/memoly/compose.yml.before-<FULL_GIT_SHA>
```

Перед изменением тегов убедиться, что новый `compose.yml` использует конкретный SHA для всех собираемых образов.

### Проверка и запуск

Команды сборки и миграций брать из актуальной документации репозитория и `compose.yml`. Базовая последовательность:

```bash
cd /opt/memoly

docker compose -f compose.yml config --quiet
docker compose -f compose.yml build
docker compose -f compose.yml run --rm backend bun run db:deploy
docker compose -f compose.yml up -d
docker compose -f compose.yml ps
docker compose -f compose.yml images
```

Не считать выкладку успешной только потому, что команда `up -d` завершилась без ошибки.

### Обязательная проверка после выкладки

```bash
git -C /opt/memoly/app rev-parse HEAD

test "$(curl -fsS -o /dev/null -w '%{http_code}' https://app.memoly.ru/)" = 200
test "$(curl -fsS -o /dev/null -w '%{http_code}' https://app.memoly.ru/health/ready)" = 200
```

Ожидаемый результат:

- checkout соответствует целевому SHA;
- backend, worker, scheduler и webapp запущены;
- backend healthy;
- все образы используют целевой immutable SHA;
- главная страница отвечает HTTP 200;
- `/health/ready` отвечает HTTP 200.

### Откат

Если smoke-проверка не прошла:

1. Не изменять и не удалять данные вручную.
2. Сохранить логи проблемного релиза.
3. Завершить явную проверку совместимости предыдущей версии кода со всеми уже применёнными миграциями.
4. Если совместимость не подтверждена, остановиться и не запускать предыдущие контейнеры.
5. Только после подтверждения совместимости вернуть предыдущую сохранённую версию `compose.yml`.
6. Запустить предыдущие immutable Docker-образы.
7. Повторить `ps`, image verification и публичные health-checks.

Пример восстановления Compose-файла:

```bash
if [ "${ROLLBACK_SCHEMA_COMPATIBLE:-}" != 'true' ]; then
  echo 'rollback stopped: schema compatibility was not explicitly confirmed'; exit 1
fi

cp -a \
  /opt/memoly/compose.yml.before-<FAILED_SHA> \
  /opt/memoly/compose.yml

cd /opt/memoly
docker compose -f compose.yml config --quiet
docker compose -f compose.yml up -d
```

Откат кода не означает автоматический откат базы данных.

### Текущая конфигурация платформ

```text
MAX_ENABLED=true
TELEGRAM_ENABLED=false
```

### Доступ к Selectel

Для обычной staging-выкладки используется SSH-доступ к серверу.

Данные панели управления Selectel и API-ключ Selectel в проектном runbook не хранятся. Если для задачи потребуется управление инфраструктурой через панель или API Selectel, запросить доступ у владельца отдельно.
