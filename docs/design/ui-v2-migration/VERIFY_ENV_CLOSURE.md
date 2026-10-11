# UIM-VERIFY-ENV — план и подтверждение штатной проверки

Назначение владельца: устранить оба ограничения окружения и завершить штатную
`bun run verify:local` для локального UI v2 candidate.
Base: `81380411080e7ca9cd291dd48f73a2731e8502a2`.
Branch: `feat/ui-v2-production-migration`.
Worktree: `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/ui-v2-production-migration`.
Origin/main после fetch: `ee2b25d3151afb88394687a20d3ec38bd1adbb4a`, уже включён в ветку.
Статус: локальная проверка завершена, exit 0. Продолжение текущей задачи;
publication/deploy не назначены.

## План

1. Воспроизвести отказ Bash на CRLF и исследовать задержку Prisma при запуске
   через Playwright. Сравнить штатный запуск с работающей подготовкой клиента.
2. Устранить подтверждённые причины минимальными изменениями переносимости
   файлов/локального runner. Сохранить содержимое deploy guard, реальную генерацию,
   изолированную PostgreSQL и все действующие проверки.
3. Повторить соответствующие узкие проверки и штатный E2E, затем один свежий
   независимый review инфраструктурного diff и bounded closure его findings.
4. Lead запускает исходную `bun run verify:local` без временного config и без
   пропусков; фиксирует точный product source SHA и результат всех стадий.

Предварительно допустимые пути: `.gitattributes`, backend/scripts/prisma-generate.mjs,
webapp/playwright.config.ts, связанные существующие tool tests/runner при
подтверждённой необходимости. Общие manifest/config изменения утверждает lead.
Lead владеет этим документом и актуализацией FINAL_REPORT.md.
Не менять UI, schema, API/auth/ACL, зависимости, production runtime/данные, CI/CD.
Не менять глобальную конфигурацию Git и не ослаблять/пропускать тесты.
При необходимости security/data/architecture решения scout/worker возвращает
evidence lead; новые production действия не выполняются.

## Результаты

### Диагностика

- `core.autocrlf=true`; shell-скрипты имеют `i/lf w/crlf`, атрибут eol не задан.
  Narrow baseline: `bun test ./tests/selectel-caddy-activation.test.mjs` —
  1 pass / 2 fail, Bash отвергает `pipefail\r`.
- Playwright добавляет FORCE_COLOR к унаследованному NO_COLOR. Изолированная
  генерация Prisma с обоими флагами печатает warning/assertion trace, но завершается
  успешно. Это не доказательство причины прежнего startup timeout.
- Повторный **штатный** `bun run e2e:webapp` с `VITE_MEMOLY_UI_VERSION=v2` на
  неизменённом base — **3 pass / 0 fail, exit 0**, включая обычную генерацию Prisma.
  Evidence: ignored `webapp/e2e/.artifacts/scout-canonical-e2e.log`.
  Timeout не воспроизведён; backend/Playwright runner не меняются.
- Lead утвердил только `.gitattributes`: `*.sh text eol=lf` и нормализацию четырёх
  tracked `deploy/selectel/*.sh` working copies. Содержимое скриптов в Git уже LF,
  поэтому изменений их логики или индексируемого содержимого не требуется.

### Исправление и review

Коммит: `fc7968b1b3fbf85ad13880401b3e958af4a7c5e3`.
Tracked diff: `.gitattributes`, одна строка; все четыре shell-скрипта теперь
`i/lf w/lf attr/text eol=lf`, без содержательных изменений в Git.
`bun test ./tests/selectel-caddy-activation.test.mjs`: **3 pass / 0 fail, exit 0**.
`git diff --check`: exit 0. Lead проверил фактический и staged diff.

Fresh independent reviewer `/root/verify_env_review`, GPT-6-luna high:
review `8138041..fc7968b` без implementation history; **нет P0/P1/P2**.
Проверены применимость атрибута и фактические LF; формальные повторные тесты
reviewer не запускал. Второе review не требуется по owner policy.

### Полный gate

Lead выполнил **`bun run verify:local` — exit 0**, на точном source HEAD
`fc7968b1b3fbf85ad13880401b3e958af4a7c5e3`, без `VITE_MEMOLY_UI_VERSION`.
Штатные команды/config, генерация Prisma, изолированная PostgreSQL и все проверки
сохранены; временный E2E config не использовался. Все **16 этапов** прошли.

| Проверка | Результат |
|---|---|
| Architecture / dependency audit | passed, exit 0 |
| Backend + contracts + webapp typechecks, Prisma generation | passed, exit 0 |
| Webapp lint / production build | passed, exit 0 |
| Website check / production build | passed, exit 0 |
| Tool / Selectel guard tests | 42 pass / 0 fail, exit 0 |
| Shared contracts | 56 pass / 0 fail, exit 0 |
| Backend unit | 153 pass / 0 fail, exit 0 |
| Webapp unit | 31 pass / 0 fail, exit 0 |
| Website boundary | 4 pass / 0 fail, exit 0 |
| Real PostgreSQL integration | 369 pass / 0 fail, 32 suite runs, exit 0 |
| Canonical browser journeys (default legacy) | 3 pass / 0 fail, 41.3 s, exit 0 |
| Canonical browser journeys (v2, отдельный прогон до EOL fix) | 3 pass / 0 fail, 42.5 s, exit 0 |

Evidence: ignored `webapp/e2e/.artifacts/ui-v2-verify-env-full.log` содержит
`Local publication verification passed.`; процесс завершён с кодом 0.
Итого в полном gate 658 успешных тестов, 0 неуспешных.
Тестовый Compose container удалён штатным teardown.

Прежний Prisma startup timeout не повторился в двух последовательных штатных
E2E запусках (v2 и полный gate). Его первопричина не доказана; утверждения об
исправлении Prisma нет. Диагностические warning о цветном выводе/deprecation
остались неблокирующими; не скрывались и не использовались для пропуска этапов.

Model: lead GPT-6, scout/worker/reviewer GPT-6-luna high.
Нет изменений API, schema, migrations, runtime или зависимостей.
Скриншоты не требуются: UI в этой задаче не менялся; прежние UI evidence сохранены.
Документация после gate обновлена отдельно; неизменённые product tests повторно
не запускались. Локальное исправление завершено; PR/push/main merge/deploy
не выполнялись. Проверка на реальном устройстве владельца остаётся отдельной
визуальной приёмкой UI, а не нерешённой проблемой локального gate.
