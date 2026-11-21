# Выпуск на Selectel: памятка

Короткая выжимка обычного выпуска на `app.memoly.ru`. Миграции с особыми границами, восстановление, первичная настройка хоста и все детали описаны в [Selectel runbook](../../deploy/selectel/README.md). Если памятка и runbook расходятся, прав runbook.

## 1. Выбрать режим

- **Короткий (`frontend`).** Весь diff от реально работающих backend и webapp проходит `deploy/selectel/frontend-scope.sh`: только пути A и R, для каждого диапазона с R есть квитанция независимого ревью. Обновляется только static. Backend, worker, scheduler, БД и миграции не трогаются.
- **Полный (`full`).** Всё остальное. Третий аргумент `true` (миграция) — только если в выпуске есть новая миграция.

Проверка перед выпуском: для короткого — профиль FRONTEND, для полного — профиль, который выбрал `bun run verify:local` (FULL только для защищённых изменений). Результат проверки после squash переносится по [AGENTS.md, «Перенос source-bound evidence после squash»](../../AGENTS.md#перенос-source-bound-evidence-после-squash).

## 2. Узнать, что сейчас работает

```sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes root@app.memoly.ru \
  'docker inspect --format "{{.Config.Image}} {{.Image}}" memoly-backend-1 memoly-static-1'
```

Записать полные SHA backend и webapp. Не брать их из checkout на сервере.

## 3. Короткий выпуск

1. В чистом checkout кандидата:

   ```sh
   bun run verify:local --profile frontend --base '<SHA backend>' \
     --frontend-base '<SHA webapp>' [--frontend-review '<каталог квитанций>'] \
     --journey webapp/e2e/<сценарий>.spec.ts
   ```

2. Для диапазонов с R: `bash deploy/selectel/frontend-scope.sh inspect '<база>' '<кандидат>'` для каждой базы, независимое ревью, установка отчёта и квитанции в `/opt/memoly/frontend-reviews` (root, 0600). Формат — runbook, «Short frontend releases», шаг 2.
3. Squash merge, перенос результата проверки на итоговый SHA.
4. Из чистого `main`:

   ```sh
   SHA=$(git rev-parse HEAD)
   git show "$SHA:deploy/selectel/ci-release.sh" |
     ssh -o BatchMode=yes -o StrictHostKeyChecking=yes root@app.memoly.ru \
       bash -s -- "$SHA" DEPLOY false id911018762027_bot frontend
   ```

5. В журнале выпуска проверить: разные SHA backend и frontend, smoke, готовность отката фронтенда.

Откат: тот же вход с пятым аргументом `frontend-rollback`.

Первый выпуск после изменения `frontend-safe-paths.txt`, `frontend-scope.sh`, `frontend-release.sh` или `scripts/verify-local.mjs` идёт только полным: короткий режим не принимает диапазон, в котором менялись его собственные правила.

## 4. Полный выпуск

1. Убедиться, что отпечаток кандидата принят аттестацией отката (`rollback_source_compatibility_profile` в `deploy/selectel/redeploy.sh`). Если нет, нужна новая строка аттестации по runbook, раздел «Measured application rollback compatibility». Это правка `deploy/`, она требует FULL и независимого ревью.
2. Из чистого `main`:

   ```sh
   SHA=$(git rev-parse HEAD)
   test -z "$(git status --porcelain)"
   git show "$SHA:deploy/selectel/ci-release.sh" |
     ssh -o BatchMode=yes -o StrictHostKeyChecking=yes root@app.memoly.ru \
       bash -s -- "$SHA" DEPLOY false id911018762027_bot
   ```

3. Проверить журнал выпуска и статус миграций.

## 5. Запуск с Windows

Команды выше рассчитаны на Git Bash. Из PowerShell не передавай `ci-release.sh` конвейером: в stdin попадут BOM и CRLF. Сохрани скрипт в файл из Git Bash и передай его через `cmd /c "ssh … bash -s -- … < файл"`.

## 6. Что записать после выпуска

Режим, развёрнутые SHA backend и frontend, выполненные проверки, результат promotion, smoke и готовности отката, ограничения.
