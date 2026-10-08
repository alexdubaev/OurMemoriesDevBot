# Канонический GitHub-репозиторий проекта

**Проект:** `alexdubaev/OurMemoriesDevBot`<br>
**HTTPS:** https://github.com/alexdubaev/OurMemoriesDevBot.git<br>
**SSH:** `git@github.com:alexdubaev/OurMemoriesDevBot.git`<br>
**Рабочая долгоживущая ветка:** `main`

Этот репозиторий — единственный push-remote продукта. Репозиторий шаблона `di-sukharev/vibe` не является местом публикации нашего кода и никогда не должен оставаться `origin`.

## 1. Нормативная конфигурация remotes
Предпочтительный developer transport — SSH:

```bash
git remote set-url origin git@github.com:alexdubaev/OurMemoriesDevBot.git
```

HTTPS допустим как эквивалентный `origin`:

```text
https://github.com/alexdubaev/OurMemoriesDevBot.git
```

Перед любой веткой, push, PR или release агент обязан проверить:

```bash
git rev-parse --show-toplevel
git remote -v
git remote get-url origin
git branch --show-current
git status --short --branch
git rev-parse HEAD
```

`origin` должен совпадать **ровно с одним из двух адресов выше**. Любой другой `origin` — стоп-условие. Не исправлять неизвестный remote и не делать push «наугад»: сначала показать владельцу расхождение.

## 2. Vibe как шаблон, а не второй проект
Исходный технический шаблон: `di-sukharev/vibe`, выбранный SHA фиксируется в `UPSTREAM.md` на этапе 00. Если агенту нужен git remote для сравнения с шаблоном, использовать отдельное read-only имя, например:

```bash
git remote add vibe-template https://github.com/di-sukharev/vibe.git
git fetch vibe-template --tags
```

Никогда не переименовывать `vibe-template` в `origin`, не создавать PR в шаблон и не пушить туда ветки продукта. Обновления шаблона не подтягиваются автоматически: любое последующее заимствование — отдельная задача с diff, security review и тестами.

## 3. Если удалённый репозиторий пустой
Первичная инициализация `main` — одноразовая операция этапа 00. До неё агент:
1. проверяет доступность remote через `git ls-remote origin`;
2. убеждается, что в remote нет неожиданной истории, которую можно затереть;
3. показывает владельцу base SHA/план первого push;
4. только после явного разрешения публикует первый `main`.

Нельзя использовать `push --force`, `reset --hard` или пересоздание репозитория как способ «синхронизировать» историю. Если remote уже содержит commits, сначала сравнить историю и согласовать безопасное объединение.

## 4. Обычная разработка после bootstrap
После появления принятого `origin/main`:
- новая задача стартует от свежего `origin/main`;
- одна задача = одна короткоживущая branch + worktree + PR;
- task-ветка публикуется только в `origin`;
- PR всегда target=`main`;
- слияние — назначенным интегратором после проверок, предпочтительно squash;
- release tag создаётся только на принятом commit из `main`.

Примеры:

```bash
git fetch origin --prune
git worktree add .worktrees/t04-bot -b feat/t04-bot-capture origin/main
# ... работа и проверки ...
git push --set-upstream origin feat/t04-bot-capture
```

## 5. GitHub-права и локальная проверка
Наличие URL в документации не доказывает доступ к private repository, право push или branch protections. Этап 00 проверяет remote/permission и записывает результат в `GIT_SETTINGS.md`. GitHub Actions CI/CD не используется. Перед каждой публикацией в `main`, включая PR merge, требуется локальный `bun run verify:local` на точном source SHA с записью команды, результата и ограничений среды. Установи hook командой `git config core.hooksPath .githooks`; PR merge не вызывает локальный hook. Gate требует Linux/Bash, Bun 1.4.0, Node.js, Docker и Playwright Chromium; для уже работающей тестовой PostgreSQL поддерживаются `TEST_DATABASE_URL` с именем `*_test` и `TEST_SKIP_DOCKER=1 E2E_SKIP_DOCKER=1`.

## 6. Секреты
GitHub URL и имя репозитория — публичная конфигурация. В Git нельзя помещать Bot Token, webhook secret, cloud credentials, `.env`, signing keys и приватные семейные данные. Git remote с credential/token внутри URL запрещён; использовать SSH-agent, Git credential manager или GitHub App/secret store среды.
