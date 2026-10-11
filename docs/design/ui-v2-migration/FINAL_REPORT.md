# UI v2 — локальный результат переноса

Task ID: MEMOLY-UI-V2-PRODUCTION-MIGRATION. Дата: 2026-10-11.
Статус: REVIEW. Исполнитель: Codex / GPT-6, workers и independent reviewer: GPT-6-luna.
Branch: `feat/ui-v2-production-migration`.
Worktree: `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/ui-v2-production-migration`.
Accepted main: `ee2b25d3151afb88394687a20d3ec38bd1adbb4a`.
Base после merge main: `3955d0a30093aa245f4f57ff6a71af77c2be318e`.
Проверенный UI product HEAD: `fff0c51214887bdb9b62fee9b3bfa0cc891340b7`.
Полный штатный local gate после исправления EOL: **exit 0**, source HEAD
`fc7968b1b3fbf85ad13880401b3e958af4a7c5e3`; подробности в `VERIFY_ENV_CLOSURE.md`.
Product commits: `4cf0805904c6a1dee6b0ab9d657ab2f937a78a23`, `fff0c51214887bdb9b62fee9b3bfa0cc891340b7`.
PR / merge SHA: не опубликовано / не слито. Deployment не выполнялся.

## Выполнено

Перенесены оформление ленты и всех видов карточек, плавающее нижнее меню, семейные
экраны, профили, настройки и выбор иллюстрации, общие поверхности entry/onboarding,
приглашений, композеров и установки. Это прежние реальные контроллеры и API;
Lab и демоданные не входят в production bundle.

Цвета, типографика и геометрия определены в `webapp/src/styles/tokens.css`;
общие control variants и portal surfaces — в `components/ui-v2/shared-skin.css`,
переиспользуемый компонент — `UiV2Button.tsx`. Общие primary tokens используются
формами, композерами и nav Add; круг nav Add имеет собственные общие size/radius tokens.
Разные роли кнопок сохраняют отдельные варианты. В v2 одна cream/sage палитра;
шесть сохранённых preference IDs выбирают только иллюстрацию шапки.

Удержание карточки и keyboard trigger сохранены. «Добавить реакцию» открывает тот же
picker; показаны только реальные положительные counts из ответа API.
Новые кнопки профиля и настроек в шапке ленты открывают существующие семейные экраны.

Changed paths: 21 source/test paths в `webapp/src/{App.tsx,components,features,styles,production.css}`
и `webapp/tests/ui-v2-header.test.tsx`; 3 документа в `docs/design/ui-v2-migration/`.
Backend, контракты, schema/migrations, зависимости и deploy-файлы не изменены.
Удалена одна устаревшая markup assertion, конфликтовавшая с принятым unified avatar crop;
остальные boundary assertions сохранены.

## Проверено

| Проверка | Результат |
|---|---|
| Frozen Bun install | exit 0 |
| Architecture | 739 source files, exit 0; повторная narrow closure после review |
| Audit | no known vulnerabilities, exit 0 |
| Backend / contracts / webapp typechecks | exit 0, включая Prisma generation и E2E types |
| Webapp lint | exit 0; scoped lint после review также exit 0 |
| V2 и legacy production builds | оба exit 0; раздельные ignored artifacts |
| Website typecheck / build | exit 0; один existing deprecated-property hint |
| Contracts | 56 pass / 0 fail, 6 files, exit 0 |
| Backend unit | 153 pass / 0 fail, 25 files, exit 0 |
| Webapp final closure | 31 pass / 0 fail, 8 files, exit 0 |
| Website boundary | 4 pass / 0 fail, 1 file, exit 0 |
| PostgreSQL integration | 369 pass / 0 fail, 32 suite runs, exit 0; isolated real test DB |
| Critical browser journeys v2 | 3 pass / 0 fail, 48.1 s, exit 0; real backend, DB and private storage |
| git diff --check | exit 0 |

Критические journeys: подписанный владелец публикует заметку; владелец загружает фото
и получает его из защищённого storage; читатель не может изменить/удалить запись,
посторонний не получает приватное фото.

История первоначального запуска (ограничение закрыто, см. `VERIFY_ENV_CLOSURE.md`):
каноническая команда публикации — `bun run verify:local`. Её первый запуск здесь
**exit 1**: unchanged Selectel guards — 40 pass / 2 fail, bash через WSL не принимает
CRLF в `deploy/selectel/in-place-file.sh` (`pipefail\r`). Deploy-код не исправлялся
в UI-задаче. Оставшиеся product checks выполнены отдельно и приведены выше.
Первый web unit запуск ошибочно унаследовал v2 build env (29 pass / 2 default-legacy
assertions fail); исправленный запуск без env и final closure дают 31/31.

Первоначальный `bun run e2e:webapp` завершился webServer timeout на повторной генерации
Prisma (сценарии ещё не начались). Для исполнения тех же трёх сценариев использован
ignored temporary config: `bunx playwright test --config=e2e/.artifacts/ui-v2-closure.config.ts`
из webapp с v2 env. Единственное изменение запуска backend — `bun src/index.ts`
с уже успешно сгенерированным Prisma client; исходный config, auth, DB setup,
тестовые сценарии и storage не подменялись. Это честный обход startup limitation,
а не зелёный результат канонической команды.

Ignored evidence: `webapp/e2e/.artifacts/ui-v2-verify-local.log`,
`ui-v2-remaining-checks.log`, `ui-v2-remaining-closure.log`,
`ui-v2-critical-closure.log`, `ui-v2-final-closure.log`, build logs.

## Визуальный контроль

Actual App preview, synthetic owner/family/media; 390×844 и targeted 320×740.
Изолированный fixture использует настоящие App/components с synthetic API responses.
Preview service worker заблокирован для совместимости с route mocks; защищённая загрузка
фото проверена отдельно на реальных зависимостях в critical journeys.

- Удержание загруженной фотографии открывает 6 choices; кнопка открывает тот же picker.
  Выбор сердца обновляет count; Escape возвращает focus карточке.
- Settings acknowledgement не повторяется после hub → family remount;
  закрытие возвращает focus видимой family gear.
- Все 6 previews загружены; переключение cover не меняет palette/nav colors.
- Подстановка shared primary color/radius/height отражается на family Save,
  note Publish и editor Save. Nav primary color также меняется; круг сохраняет свою роль.
- Mixed viewer background `rgb(32,38,32)`, foreground white. Photo/mixed stage 4:3,
  изображения загружены, voice compact; pending video status сохранён.
- 320px: нет горизонтального overflow; header logo/back не пересекаются;
  6 cover tiles образуют одну колонку шириной 277px.
- Narrow visual closure: feed gear имеет shared background `rgba(255,252,247,.78)`;
  date heading использует shared muted `rgb(112,110,103)`, 19px / weight 600.
- Legacy actual preview сохраняет прежнюю шапку, палитру и navigation; v2 reaction
  button отсутствует. Legacy остаётся default при omitted/invalid build flag.

Снимки в `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.playwright-mcp/`:
`ui-v2-feed-final.png`, `ui-v2-family-final.png`, `ui-v2-covers-final.png`,
`ui-legacy-feed.png`. Материалы синтетические; снимки не входят в product bundle.

## Независимое ревью

Fresh reviewer `/root/uiv2_final_review` не получал implementation history;
проверил полный working diff над base выше. Подтверждённые P2 исправлены одним
bounded pass: settings request replay/focus; composer/video token coverage;
mixed viewer dark surface. Lead проверил actual diff и browser behavior.
Lead adjudication сохранило круг nav Add отдельными shared variant tokens.
Последняя двухстрочная CSS closure устранила legacy override header actions и
hardcoded date style; targeted build и actual computed styles подтверждены.
Второе whole-change review не запускалось согласно owner lean verification policy.

## Ограничения и следующий шаг

Статус REVIEW, без утверждения о готовом production release. Канонический local gate
завершён успешно: 16 этапов, 658 тестов, exit 0 на `fc7968b`.
Отдельный штатный v2 E2E также прошёл 3/3. EOL-проблема устранена одной строкой
в `.gitattributes`; прежний startup timeout не повторился, runner не менялся.
Нужна owner acceptance на устройстве перед принятием интерфейса.
Нативные Telegram/MAX/WebView, install handoff и настоящее audio/video playback
на устройствах этим browser preview не проверены; существующие playback boundary
tests прошли, движки не менялись. В mock preview проверено voice presentation,
не реальное воспроизведение защищённого аудио.

Миграций и изменений публичных контрактов нет. Быстрый возврат — совместимый legacy
frontend artifact из того же source; инструкция `LOCAL_MODES.md`. UI mode compile-time,
не query/localStorage toggle; production Dockerfile не прокидывает этот build flag.
Не применять rebuild/deploy к действующему боту без отдельного назначения владельца.
Следующая работа — только после назначения; main/push/PR/deploy не выполнялись.
