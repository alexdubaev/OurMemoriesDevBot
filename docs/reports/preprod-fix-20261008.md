# FIX-PREPROD-2026-10-08 — исправления и локальная приёмка

## Продолжение доставки — RELEASE-PREPROD-20261008

Текущий статус: IN_PROGRESS. Владелец прямо разрешил commit, push и deploy. Task-коммит `dd21d6aeb189eaf05a277d92e127d90e8628927a` опубликован в [PR157](https://github.com/alexdubaev/OurMemoriesDevBot/pull/157), base main `c5f289fb9d4d9f3d97206d3e7b2e823e69efaf2d`. Merge и production-деплой ещё не выполнены.

[Verify37789536271](https://github.com/alexdubaev/OurMemoriesDevBot/actions/runs/37789536271) на точном task HEAD завершился failure: default E2E88 passed,3 failed,35 did not run. Тест failed-like остановился до reaction-request; два семейных сценария исчерпали общий90-секундный timeout при клике по строкам настроек. Причина движения элементов/исчерпания бюджета не доказана. Companion E2E, S3 и Docker smoke не достигнуты. Выполненные предшествующие CI-проверки успешны; отдельный Webapp build объяснимо пропущен FULL plan, обе production-сборки выполнены в Build artifact contract checks.

API артефактов первого прогона вернул0: ссылки на trace/screenshot/error-context существовали только в runner-local журнале. Коммит `08bdf2018263229f42cc816aaf5dd9b89dfc8869` добавил сохранение этих синтетических файлов при падении E2E; upload action закреплён immutable SHA. Проверки YAML, architecture (807 source files), template и diff-check имеют exit0.

[Verify37798236797](https://github.com/alexdubaev/OurMemoriesDevBot/actions/runs/37798236797) на этом HEAD также завершился failure:88 passed,3 failed,35 did not run. Сохранение диагностики успешно:3 traces,3 error contexts,4 screenshots. Lead скачал и независимо сверил SHA256 архива с API: `1fc9cac8563e5d38817f4a11b1cae01f9b5d64a8164b47c92e4b7e2112e87785`. S3/Docker smoke и companion profiles снова не достигнуты; предшествующие selected checks успешны.

Трассировки доказали ошибку семейных тестов: частичное имя «Настройки» выбирало строку «Настройки семьи» в закрывающемся sheet. Lead лично проверил `__playwright_target__=data-settings-row=pencil` при `data-state=closed`, call@2495/call@2598. Страница переходила в family-settings; ожидаемая строка затем отсоединялась примерно через0.93s, а тест ждал отсутствующий элемент до общего90s deadline. Увеличение timeout не требуется. Исправление использует exact accessible name для launcher и сохраняет сценарии/проверки.

Для failed-like trace зафиксировал mouseDown(1064,539) при viewport1280×720; Lead просмотрел ближайший кадр через10ms: фото занимает x≈429..851. Диагностический Ubuntu-прогон воспроизвёл то же промахнувшееся нажатие: elementFromPoint=root DIV, picker0, до reaction request. Источник смещения сырого boundingBox остаётся неизвестным; подтверждена отсутствующая проверка actionability. Тест использует active-slide image и обычный hover перед настоящим mouse hold, затем явно ожидает synthetic503 перед проверкой rollback. Production carousel не меняется.

Uninstrumented focused Ubuntu baseline исходного dd21 прошёл3/3 за1.6m (feed8.5s, app-settings30.9s, management37.4s), exit0; это не отменяет двух CI failures. Измерительные прогоны добавляли время перед действиями и считаются только диагностикой. Итог локальной приёмки исправленного diff приведён ниже; новый remote CI ещё требуется. Логи, traces и Git-archive snapshot находятся в ignored `webapp/e2e/.artifacts/fix/`. Retries, timeout, release-profile и assertions не ослаблены; локальная приёмка ниже не заменяет GitHub CI.

Первый actual-source Ubuntu acceptance исправления:5 passed,1 failed, exit1. Family-management выявил дополнительную ошибку тестовой правки: exact имя намеренной строки «Настройки семьи» не учитывало subtitle. После lead ruling reviewer исправил подтверждённыйP2: три menu-scoped row locators снова используют исходный regex; только launcher «Настройки» имеет exact:true. ESLint/diff-check reviewer и строгий web/E2E typecheck Lead — exit0 после коррекции.

Первый шестисценарный прогон окончательной пары файлов:6 passed за2.8m, `PLAYWRIGHT_EXIT=0`, но после тестов оболочка завершилась2 из-за CR в `exit 0`; это не overall exit0. Неполные discovery/harness attempts сохранены как failures/incomplete, не используются как acceptance.

Финальный actual-source Ubuntu acceptance через literal LF script: discovery6/6; все6 исходных focused scenarios прошли за2.7m, `PLAYWRIGHT_EXIT=0`, `CONTAINER_EXIT=0`. Включены failed-like, native mouse hold, Chromium touch/text-selection safety, onboarding, app-settings и family-management. Lead независимо прочитал `ci-trace-fix/ubuntu-six-acceptance-lf-console.log`, проверил counts/exits и совпадение SHA256 actual-source файлов с readonly mounts: feed `7e46a0f2563e55b280f70983c191d43144d0db065ac9a8b92e30f0d701aa7989`; family `80d7f09f9b1796fe4ee95cd1136bfed6e008c4990eb974134575aed2a49d7a37`.

Повторный actual-source Ubuntu race check через literal LF script: discovery9/9; каждый из трёх CI-failing scenarios выполнен3 раза, `9 passed (3.8m)`, `PLAYWRIGHT_EXIT=0`, `CONTAINER_EXIT=0`. Lead независимо прочитал полный итог stdout и сверил текущие file hashes. Retries0, worker1, timeout90s; новые budgets/sleeps/forced clicks отсутствуют. Новый GitHub Verify на этом diff ещё требуется.

После подтверждённогоP2 и lead ruling выполнено одно final fresh review: новых подтверждённыхP0/P1/P2 нет, code/CI acceptance разделены. Lead лично повторил strict web/E2E typecheck, ESLint2 files, diff-check — exit0; release-verification tooling26/0 (80expects), avatar/Docker smoke unit10/0 (39expects) — exit0, raw logs сохранены. Manifest92 source files по сравнению с `08bdf201` отличается только2 E2E files; production source не менялся в этом продолжении. Report изменён отдельно. Whole-PR review проверил инвентарь и release/race/security/media execution paths, не заявлял построчного аудита каждого asset/fixture.

Windows acceptance текущего E2E diff остановился до тестов: Prisma migration schema-engine error, exit1,0 tests. Lead независимо проверил TCP127.0.0.1:60327=False; mapping принадлежит task-owned PostgreSQL, который healthy и отвечает psql внутри своего контейнера. Это ограничение host-to-WSL соединения, не успешная проверка. Глобальные настройки Docker не менялись. Продолжение выпуска опирается на actual-source Ubuntu acceptance и обязательный полный CI; прежний Windows FULL ниже относится к исходному source freeze и неизменённому production code.

Read-only Selectel preflight подтвердил SSH-доступ, canonical host origin/clean checkout, достаточное место и48 применённых миграций без pending/failed. В этом task нет schema/migration diff, поэтому migration input=false. Следующий выпуск требует green текущего PR HEAD, squash merge, отдельного успешного Verify на точном main SHA, затем штатного `ci-release.sh`, проверки runtime image IDs/revision и публичного smoke. Ограничение zoom и принятое решение о контрасте сохраняются.

### Предыдущий обязательный CI и Add-sheet correction

[Verify37810662081](https://github.com/alexdubaev/OurMemoriesDevBot/actions/runs/37810662081) на `abca0e4983de87e4a1892891723abe78fca82617` завершился failure: default91 passed,1 failed,34 did not run за22.5m. Предыдущие failing scenarios прошли; новый сбой — Add-sheet test, width390: top633.359375 при test minimum640. Companion profiles, S3 и Docker smoke не достигнуты. Архив диагностики сохранён; lead независимо сверил API/local SHA256 `3ad61a65868a45bcb8c6bff9667010c9c4c2401d9e095f3d723d66a6cd7e664b`, размер10169113 bytes.

Scout проверил trace и происхождение assertion: абсолютные top bounds добавлены тестом в `c0e14a7a`, D11/T09 не задают точную координату. Intrinsic-height sheet полностью виден: bottom844, actions702.531..830, горизонтального overflow нет. Причина различия текстовых метрик не доказана; изменение font не заявляется. Primary просмотрел failure screenshot, CSS и продуктовые требования. Исходный actual-source Ubuntu test повторён3 раза:3 failed, discovery3, Playwright/container exit1, тот же633.359375; hashes до/после совпали. Это RED baseline, не успешная проверка.

Текущая test-only правка заменяет абсолютную координату на containment заголовка, подписи и actions внутри sheet/viewport; остальные assertions, включая ширины, горизонтальный ряд, safe margin, navigation coverage, scaled text и focus, сохранены. Смена шести тем сравнивает top/bottom с исходной settled geometry390 в пределах существующей1px precision. Production CSS/source не менялись. Primary проверил actual diff, strict E2E TypeScript, ESLint и diff-check: exit0. Actual-source Ubuntu acceptance: discovery3/3,3 passed за2.7m, Playwright/container exit0; до/после SHA256 feed `10ad5ce7d5eac8ee9929e7a366c108c18cc951d7c3afff2099411ce90e244e85`, family unchanged. Primary независимо прочитал итог лога и проверил exited container0. Два fresh reviewers не нашлиP0/P1/P2; final verdict production_ready относится только к текущей двухфайловой правке. Manifest92: изменён только feed.spec.ts,91 других source hashes совпадают с предыдущим freeze. Дополнительно запущены ранее skipped34 feed cases, результат ещё не известен. Новый обязательный CI и accepted-main CI требуются до merge/deploy.

### E2E startup gate и оставшиеся сценарии

Коммит Add-sheet correction `66369d6c6c727afdbd25002fc55915d507e3c38a` опубликован. [Verify37816346190](https://github.com/alexdubaev/OurMemoriesDevBot/actions/runs/37816346190) прошёл selected проверки до Release E2E, но завершился failure до первого теста: PrismaP1001 на localhost45281. E2E executed0; API artifacts0, upload сообщил no files. Storage/Docker smoke не достигнуты. Этот run не подтверждает браузерную приёмку.

Read-only investigation выявило несовпадение transport: pg_isready без-h проверял Unix socket. Primary лично прочитал entrypoint retainedpostgres18-alpine: временный init server запускается с listen_addresses='' и не слушает TCP. Правка требует explicitTCP127.0.0.1 внутри контейнера, затем boundedTCP connect к exactconfiguredhost/port перед Prisma migration. E2E_SKIP_DOCKER пропускает Compose, но проверяет внешний endpoint. Defaults30 attempts,1s delay/probe/spawn limits; теоретический суммарный максимум90s. Нет blanket migration retry, defaultURL/config/production/schema changes; credentials не выводятся.

TDD RED:2 real tests executed,0pass2fail — прежний probe не требовалTCP и допускал недоступный hostendpoint. GREEN расширен до4tests/14expects/exit0: explicitTCPargv, delayedhost/container, timeoutfailclosed, configuredhost/port и realephemeralTCP available/unavailable cleanup. Primary независимо повторил unit4/0, затем stricttypecheck выявил unusedconstant (exit2); worker связал общий timeout с обоими probes. Последующий primary strictE2Etypecheck/ESLint/diffcheck имеютexit0. Два fresh reviewers не нашлиP0/P1/P2; finalreview отметил толькоP3 устаревшую строку статуса, она обновлена. ActualsyntheticLinuxsetup прошёл: E2E_SKIP_DOCKER=1, exactconfigured endpoint через loopbackproxy, Prisma migrate48/0pending и seed, inner/outerWSL-Docker exit0. Primary сверил actual-runtime.json, лог и sourcehashes; LF runner0CRLF. Это проверяет externalendpoint→migration, а normalcoldDockerstartup ещё требует нового полногоCI.

Отдельный actual-source Ubuntu tail34: discovery34,4passed1failed29didnotrun за1.6m, Playwright/container exit1. Упал второй alignment helper после MAXprocessing→ready: stableFrames0 за5s. Trace не сохраняет numericdelta; sourceнеизменён, причина неизвестна. Один instrumented container-copy run прошёл1/1; processingdelta343.54→0.03, readydelta0. Два последующих diagnostic five-case groups прошли10/10 за2.9m; измерение добавлено только в catch после failure, который не сработал. Оригинальные budgets/assertions не изменены. Это диагностические результаты, не доказательство исправления; новый actual-source tail acceptance ещё требуется.

### Последующий CI, native scroll карусели и стабильная visual fixture

[Verify37819227005](https://github.com/alexdubaev/OurMemoriesDevBot/actions/runs/37819227005) на опубликованном `03362057918a81a7e31fd6d675cd44f337e27d71` завершился failure: default E2E126,111 passed,1 failed,14 did not run; Playwright exit1. Cold Compose readiness/migrations теперь прошли, тесты действительно выполнялись; последующий сбой не относится к PostgreSQL. Предшествующие selected checks успешны; S3/Docker smoke пропущены после E2E failure и не считаются успешными. Diagnostics upload успешен; lead сверил trace SHA256 `052e4e75fa38055ae5e7e67128c228f4ee8147429996bf2801b55a0ae33db718` и числа из полного лога. FFmpeg install занял9m18s, browser/dependency install12m20s, default E2E28m34s; это фактические задержки данного запуска.

Lead независимо извлёк из сохранённого original MAX trace native `__playwright_scroll_left_: "8"` у `.memoly-mixed-viewport` в `input@call@960`, timestamp87175.678. Click log показывает scroll-into-view непосредственно перед snapshot; offset сохраняется перед/после ready response. Причина не была доказана одним track transform: native scroll добавлял отдельный сдвиг. Гипотеза о filesystem/mount timing не выдаётся за root cause. Оригинальный RO tail34 падал три раза с4/1/29; diagnostic copies, включая appended afterEach34/34, не считались исправлением. Byte-identical native-Linux copy исходного test дал34/34 за8.6m, но сам по себе не устранял дефект.

Production correction меняет mixed viewport на последовательные `overflow:hidden; overflow:clip`, сохраняя прежнее clipping в движках без clip. В современных движках viewport больше не является отдельным scroll container; Embla продолжает перемещать track. Это соответствует [семантике CSS overflow](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overflow). Новый browser spec использует production stylesheet, реальный scrollTo/focus/scrollIntoView, transformed slide и vertical page scrolling, без inline override. Canonical TDD:4 failed/2 passed, exit1 на исходном CSS; после исправления6/6, exit0 в Chromium+WebKit. Lead повторил6/6,exit0. Первый independent reviewer подтвердил compatibility P2, сам добавил ordered hidden fallback; lead проверил actual diff и повторил6/6,exit0. Legacy WebView/device execution недоступен: fallback сохраняет прежнее clipping, а устранение native scroll в таких движках не подтверждено.

Integrated acceptance повторяет прежнее падавшее окружение: original feed SHA `10ad5ce7d5eac8ee9929e7a366c108c18cc951d7c3afff2099411ce90e244e85` RO на canonical path, unchanged setup/family/helper RO, corrected production CSS RO; без instrumentation. Discovery34,34 passed за8.5m, Playwright/container exit0. Lead проверил retained container `62ce882f6208`/pinned image и пять hashes. Этот прогон использовал CSS clip-only SHA `c821ef481c61f7c953a75b762c102e16c492a2e07554fb09c7a97745cf2cbd72` до compatibility fallback; после fallback современный computed clip сохранён и browser6 повторно успешен. Итоговый CSS SHA `100b051375914f4cfb9ab80ee544e7657f52fc7a3bb755c10b261b12faf311ef` также использован следующей focused acceptance.

Единственный сбой CI378192 — canonical photo/unread geometry test. Trace подтверждает правильный product flow: family unreadCount1; real seen POST204 в18:27:04.148; refresh family count0 в18:27:04.170. Кнопка исчезает по контракту, пока visual test продолжает viewport/theme captures. Production observer/count/timing не изменены. Test-only correction через typed `FamilyHomeResponse` pin удерживает ready/count1 только у fixture family в GET summary, сохраняя остальные поля/семьи и реальный seen POST/DB acknowledgement. Handler удаляется точно в finally до прежнего cleanup; другие seen tests не подменяются.

Focused regression сначала требует actual fixture-family seen204 с matching memoryId до capture. Первый pre-pin RED имел Playwright1 и source SHA `a74e77233de765af97abb8cafb83a4d52c27e7c71b7c95e10d900fc113554fe4`; outer exit этого удалённого контейнера недоступен. Retained RED snapshot восстановлен из HEAD plus waiter, SHA `1c035a23655f7a66aac20bd5d758fae73d0f75833f8a4bde4dd92510444efe71`; await находится после существующего child-tag assertion, тогда как final source ждёт сразу после card visibility. Lead проверил diff: geometry assertions/budgets неизменны, в обоих случаях actual acknowledgement обязателен до capture. Retained RED discovery1/1,1 failed, Playwright/container/outer exit1 (`44d09d879a28`). Предварительный остановленный runner129 не запускал Playwright и не считается проверкой.

После scoped summary pin discovery3/3,3 passed за1.8m, Playwright/outer exit0; log `fix/unread-geometry-fixture/green-repeat3.log`, source SHA `12c8b64f3dc3aa82472246d43134a3a5c66c6bdbc3baced2d7393c040ceb69ab`. Lead прочитал actual log/runner и независимо выполнил strict E2E typecheck, ESLint обоих новых/изменённых E2E files, diff-check: exit0. Fresh reviewer текущих followups не нашёл подтверждённых P0/P1/P2; последующий whole-current review выявил два дополнительных P2, приведённых ниже. Snapshots, retries, skips, исходные budgets и tolerances не изменялись; schema/migrations/public contracts не менялись.

### Финальное whole-current review: Docker image identity и audio event order

Свежий независимый reviewer проверил whole-current inventory106 paths, отдельно production execution/release/race/security и assets/fixtures inventory, без утверждения построчного аудита каждого снимка. Подтверждены два P2; lead проверил actual source и принял bounded rulings. Reviewer исправил оба, новых подтверждённых P0/P1/P2 в своём проходе не оставил. Self-review исправлений не заменяет следующий fresh review.

Docker smoke ранее строил и запускал общий mutable tag: concurrent buildB мог заменить image между buildA и runA, несмотря на разные Compose/container names. Deterministic interleaving на runtime argument boundary дал RED:3 passed,1 failed, exit1; runA фактически выбрал imageB. Теперь build пишет в run-owned `--iidfile`, результат проверяется как immutable sha256 image ID и именно он передаётся docker run; custom/default tag сохраняется только как build label. Missing/malformed ID fail closed, cleanup ограничен своим single IID file; тесты удаляют только свои два файла и пустой mkdtemp directory без recursive deletion. Lead лично выполнил финальные5 tests/26 expects, exit0. Логи `fix/smoke-image-isolation/docker-smoke-red.log`, `docker-smoke-green.log` и `lead-final-tests.log`; первые GREEN4 относятся к этапу до добавления пятого fail-closed test. Реальный Docker runtime на новом source ещё требует обязательного CI. Семантика IID подтверждена [официальной Docker CLI reference](https://docs.docker.com/reference/cli/docker/buildx/build/).

AudioPlayer обрабатывал каждый queued pause как текущий, инвалидируя новый play attempt и показывая «Слушать», хотя audio.paused=false. Current-element guards теперь игнорируют stale pause/play events; настоящий onPlay синхронизирует playing=true, реальные pause/abort/unmount guards сохраняются. Browser regression монтирует настоящий FeedPage/AudioPlayer с synthetic2s WAV, проверяет обычные play/pause/resume, удерживает actual native pause event и после нового play выполняет controlled synthetic re-delivery. Это воспроизводит event ordering, а не утверждает самопроизвольное browser timing в каждом запуске. Test-only loop удерживает playback активным на медленном CI; production loop не меняется.

До AudioPlayer correction оба engines дали RED2 failed, exit1 при actual paused=false и неправильной кнопке; после correction Chromium+WebKit GREEN2 passed, exit0, повторён после test-only loop. Логи `fix/audio-pause-event-order/red.log` и `green.log` содержат команды, exits и source Git blob hashes. Lead после freeze лично запустил весь existing companion profile: discovery8,8 passed за1.3m, exit0, no snapshot updates; это включает прежние6 video/poster tests и новые2 audio cases. Дополнительно lead: webapp unit478 passed/0 failed,3279 expects,75 files, exit0; strict web/E2E typecheck0, full webapp lint0, node --check обоих Docker scripts0, diff-check0. Raw logs/exit markers сохранены рядом с audio TDD.

Следующий fresh reviewer подтвердил related P2 у queued ended после replay: handler без current ended guard мог поставить paused UI и current=duration у уже играющего того же элемента. Lead принял bounded ruling; reviewer добавил только `if (!currentTarget.ended) return`. Тест удерживает реальное завершение synthetic WAV, restart делает ended=false/paused=false, controlled re-delivery выявляет неправильную кнопку. Chromium RED1 failed/exit1; после correction Chromium+WebKit GREEN2/exit0. Финальный test также проверяет обычное completion («Слушать»,0:02/0:02) до test-only loop при replay; первоначальный RED spec не byte-identical этому расширенному финальному варианту. Исторические RED/hash/exit сохранены в `fix/audio-ended-event-order/`, GREEN2 повторён после loop stabilization; monotonic currentTime assertion удалён, поскольку loop wrap его делает невалидным, основные stale-event UI/state assertions сохранены.

Lead после frozen ended correction лично выполнил оба mounted audio scenarios: discovery4,4 passed за20.6s, Playwright/outer exit0, Chromium+WebKit; playback unit10 passed/21 expects, exit0; строгий web/E2E typecheck и affected lint exit0. Прежние full companion8/0 и webapp478/0 относятся к freeze до последней ended guard; video paths и snapshots в этом followup не менялись. Новый CI выполнит итоговый полный companion profile.

Lead дополнительно подтвердил тот же Unix-only init readiness риск в Docker smoke: прежний pg_isready без host мог пропустить temporary init server перед host TCP prisma:deploy. Reviewer на actual wait/probe boundary добавил deterministic scenario с Unix-ready/TCP-not-ready; RED6 passed/1 failed/exit1, helper вернулся после1 probe вместо3. Единственная readiness semantics correction — явный `-h 127.0.0.1`; migrations/default URLs/ports неизменны. Timeout regression сохраняет30 probes/30 waits. GREEN7 passed/31 expects, exit0; lead лично повторил7/0 и node --check/diff-check0. IID helpers и bounded cleanup не менялись. Логи `fix/smoke-tcp-readiness/red.log`, `green.log`, `lead-final-tests.log`. Real Docker cold startup ещё требует итогового CI; simulated boundary не выдаётся за фактический контейнерный прогон.

Итоговый source freeze96 сравнен с previous94:87 прежних hashes неизменны,7 изменены (Docker script/test, FeedPage,3 poster harness files, canonical feed),2 paths добавлены (carousel CSS и browser spec). Final source/fingerprints frozen после всех lead rulings. Новое свежее independent acceptance review (GPT-6 Luna High) одобрило code diff, подтверждённых P0/P1/P2 нет. Reviewer лично проверил BASE-to-current inventory106, Docker/audio/carousel/touch/viewer, release workflows/gate/planner, jobs/media/caption races, avatar и accessibility paths; не заявлял line-by-line audit каждого asset/fixture. Runtime tests reviewer не повторял: перечисленные выше lead checks отмечены как lead evidence, собственные команды были read-only Git/diff/rg/Get-Content с exit0. Root сверил actual diff и hashes после проверок; секретоподобных pattern hits в10 текущих paths нет. Code approval не является production readiness. Новый current-head PR Verify и отдельный exact-main-SHA Verify после squash остаются обязательными. Merge/production deploy до этих gates не выполнялись.

## Исходная локальная приёмка до публикации

Локальный статус на исходном source freeze: REVIEW. Подтверждённые дефекты исправлены и проверены локально. Независимое ревью не оставило подтверждённых P0/P1/P2. На момент фиксации этой локальной приёмки публикация, merge и deploy ещё не выполнялись; результаты не являются production-сертификацией.

Task ID: FIX-PREPROD-2026-10-08. Назначение владельца: глубокое code review, гонки, TDD/E2E с субагентами и последующее «Тогда исправляй». Lead: GPT-6; reviewers — GPT-6 Luna High, role-based scout/worker — GPT-6 Luna Medium, первоначальные workers — GPT-6 Luna High. Точный runtime identifier lead недоступен.

- Branch: `fix/preprod-20261008`.
- Worktree: `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/preprod-audit-20261007`.
- Base/head: `c5f289fb9d4d9f3d97206d3e7b2e823e69efaf2d`; проверен текущий незакоммиченный task diff поверх этого SHA.
- Origin: подтверждён канонический `alexdubaev/OurMemoriesDevBot`. PR / merge SHA: не опубликовано / не слито.
- Schema, migrations и публичные contracts: изменений нет. Production token/calls, реальные приглашения и удаления не использовались.

## Изменения и доказательства

Reservation cleanup теперь берёт family lock перед reservation и освобождает запись условно. Проигравший concurrent cleanup не повторяет counters/side effects. Caption consume блокирует и перечитывает request: committed cancellation не меняет memory, duplicate reply увеличивает version один раз. PostgreSQL barrier regressions сначала воспроизвели три падения, после исправления прошли; полный integration suite также прошёл.

Avatar validator проверяет raster byte signature и MIME до Sharp: SVG, замаскированный под PNG, отвергается без вызова decoder. Sharp, Hono и уязвимые транзитивные зависимости обновлены. Shadcn CLI удалён; точный используемый CSS и MIT notice сохранены в `vendor/shadcn/`. Audit не использует suppressions.

Release gate закрывается при missing/pending/failed Verify, API timeout и более новом failed run. Он требует точный текущий SHA main, canonical workflow и единственный успешный `verify-required` в последнем trusted run/attempt. FULL planner и CI command mapping исправлены. Main protection реально включена после accepted baseline [Verify 37723627116](https://github.com/alexdubaev/OurMemoriesDevBot/actions/runs/37723627116): strict required check, PR, admins enforcement, resolved conversations, linear history, запрет force push/delete, auto-merge off; approvals=0 при единственном владельце. Новый локальный CI diff ещё не проверен на GitHub.

PhotoSwipe закрывается при `memoly:feed-inactive`; listener удаляется при unmount. Regression case24 проверяет отсутствие оставшихся viewer handlers и баланс 7 созданных / 7 освобождённых object URLs. Pending touch при уходе в список семей больше не активирует новую карточку после отпускания: guard удерживает matching release/click, ограничен 900 мс после pointerup, снимается при fresh pointer/cancel/blur/pagehide/click/timeout. Keyboard и посторонние координаты проходят. Естественный touch case52 прошёл три повтора без instrumentation, включая persistence и reload. Reviewer усилил unit coverage; async unit не заявляется как TDD RED до реализации.

При pause/hide голосового сообщения отменённый `play()` Promise больше не создаёт unhandled rejection. AudioPlayer принимает результат только текущей попытки; pause/ended/source change/unmount/new click инвалидируют старую. Ошибка playback оставляет кнопку доступной для следующего запуска. Общий platform media helper не менялся. Три deferred-play regressions проверяют cancellation, stale result и genuine rejection/next play. Worker выполнил behavioral RED с preparatory extraction старого direct-await поведения; исходный RED stdout не сохранён, поэтому он подтверждён tool result/worker evidence, а не отдельным raw log. Root самостоятельно проверил actual diff и GREEN full web unit.

Контраст Family role/info и MAX status/error/action исправлен существующим foreground `#302a2e`; рассчитанные ratios превышают 10.6:1. Frozen reference, backgrounds, fonts, layout и assets сохранены. Старый contrast whitelist удалён. По прямому решению владельца запрет page zoom сохраняется; допускается только exact axe `meta-viewport`, отдельно отражённый в каждом scan. [Решения, исторический эталон и новые цвета](../mvp/review/AGENT_K_ACCESSIBILITY_DECISION.md).

E2E fixtures приведены к принятым welcome/persistence/private-media contracts, точным synthetic bytes/DTOs, реальным PUT и playback при preload=none. Strict E2E/TSX включён в обычный typecheck. Test-only Inter cache проверяет TLS, URL/content/size/deadline, SHA/length и OFL; production font не менялся. Artifact directory исключён из Vite watcher, copied specs — из companion discovery; бюджеты и tolerances не увеличивались. Poster fixture использует synthetic Bearer как production rawAuthenticated; production SW/token не менялся. Carousel screenshot ждёт readiness/active position и окончания движения через animation frames.

Два RED после reload оказались missing test prerequisite: выбранная семья/экран ещё не проверены в IndexedDB перед restart. Добавлены только typed readonly assertions существующей записи feed+family; automatic restore и целевые loading/empty/error/retry/viewer проверки сохранены, fallback выбора семьи отсутствует. Focused case74 прошёл3/3, loading/error matrix —6/6, exit0, no-update (`e2e/feed-case74-repeat-r1.log`, `e2e/matrix-viewer-persistence-repeat-r1.log`).

Docker frozen install слои зависят от manifests/lock; source COPY идёт после install. Smoke создаёт отдельные UUID project/container/network/volume и synthetic DB на свободном порту, игнорирует ambient DB/container overrides, удаляет только собственные resources. Unit сначала RED, затем GREEN; настоящий smoke с foreign sentinels подтвердил их сохранность и cleanup своего проекта.

## Выполненные проверки

Все итоговые строки ниже имеют exit code 0. Evidence paths относительно `webapp/e2e/.artifacts/fix/`, материалы ignored и синтетические. История неуспешных и focused прогонов сохранена отдельно: [evidence history](preprod-fix-20261008-evidence-history.md).

| Команда / проверка | Результат | Evidence |
|---|---:|---|
| `bun run test:backend:unit` | 640 / 0 | `lead/backend-unit.log` |
| `bun run test:backend:integration` | 369 / 0, 32 files | `lead/backend-integration-final.log` |
| `bun run test:contracts` | 56 / 0 | `lead/contracts.log` |
| `bun run test:webapp` | 474 / 0, 74 files, 3265 expects | `lead/webapp-unit-final-r2.log` |
| `bun run test:infra` | 124 / 0 | `lead/infra-final.log` |
| `bun run test:website` | 7 / 0 | `lead/website-unit.log` |
| `bun run test:verification-tools` | 26 / 0 | `lead/verification-tools-final.log` |
| `bun run test:storage:s3` | 16 / 0 | `lead/s3-live.log` |
| `bun test backend/scripts/docker-smoke.test.mjs` | 3 / 0, 20 expects | `lead/docker-smoke-unit-final-r3.log` |
| `bun run test:build-contracts` | 3 / 0, обе production сборки | `lead/build-contracts-final-r2.log` |
| Root typecheck + strict E2E | все workspaces, 0 errors | `lead/typecheck-final-r3.log` |
| Lint / architecture / template | 0 errors; architecture807 files | `lead/lint-final-r6.log`, `lead/architecture-final-r4.log`, `lead/template-final-r5.log` |
| Frozen install / audit | 935 packages; known advisories0 | `lead/dependency-audit-final.log` |
| Windows default E2E, no-update | 126 / 0, 0 skipped, 27.1m | `e2e/default-final-r4.log` |
| Windows poster E2E, no-update | 6 / 0, 0 skipped, 2.0m | `e2e/poster-final-r7.log` |
| Windows warm-cache E2E, no-update | 1 / 0, 0 skipped, 50.8s | `e2e/warm-final-r2.log` |
| Linux poster E2E, no-update | 6 / 0, Chromium3 + WebKit3 | `../linux-poster-repeat-20261008/artifacts/linux-poster-six-r3.stdout.log` |
| Natural voice cancellation, repeat3 | 3 / 0, 41.2s | `e2e/voice-case68-repeat-final-r1.log` |
| Fresh Docker build / runtime / DB smoke | health/ready, challenge/cookie/status passed | `lead/docker-smoke-owned-final-r2.log`, `lead/docker-smoke-owned-final-r2-summary.json` |
| Source freeze / diff check | 92 hashes unchanged; exit0 | `lead/source-freeze-verification-final-r2.json`, `lead/diff-check-final-r4.log` |

Сумма последнего deterministic набора — 1718 test executions; это не число уникальных бизнес-сценариев. Итоговый Windows release batch выполнен последовательно одним browser owner: из `webapp` `bun run e2e -- --update-snapshots=none --output e2e/.artifacts/fix/e2e/default-final-r4-results`, затем такой же вызов с `--config e2e/private-video-poster.playwright.config.ts` / `poster-final-r7-results`, затем с `--config e2e/warm-navigation-cache.playwright.config.ts` / `warm-final-r2-results`. Буквальный root `e2e:webapp:release` не запускался; проверены его три компонента с запретом обновления snapshots. Итого Windows133/0, 0 skipped, все три observed exit markers0 и .last-run passed; root лично сверил summaries/list entries/markers, unhandled rejection lines0. Aggregate evidence: `lead/windows-final-batch-summary.json`. Focused соседние family cases98/99 также прошли6/0, exit0, 2.9m (`e2e/family-worker-crash-repeat-r1.log`).

Agent K в итоговом default run: 42 unique scans, contrast0, unapproved0, acceptedviewport42; root summary `lead/accessibility-default-final-r4-summary.json`. Passing axe с принятым запретом zoom не означает полного WCAG compliance. Existing Astro `verticalAlign` deprecation hint не блокирует typecheck.

## Независимое ревью и визуальная приёмка

Первое whole review выявило три P2 CI completeness; они исправлены, следующее review подтвердило. Позднее fresh whole review выявило P2 shared Docker DB cleanup; lead подтвердил finding, reviewer исправил bounded scope, root проверил actual diff, unit и настоящий Docker runtime. Финальный fresh reviewer `review_final_preprod_adjudicated` проверил whole active diff и не оставил P0/P1/P2; source edits/tests не выполнял. Его первоначальный label production_ready отозван: принято только static review clear, runtime evidence отдельно проверен lead.

После voice/persistence правок выполнены два новых независимых whole reviews: `review_preprod_voice_and_whole_final` и `review_preprod_whole_final_second`, подтверждённых P0/P1/P2 нет. Reviewer отозвал предположение о pre-validation исполнении release SHA после проверки фактического порядка pinned checkout → fixed SHA/current-main validation → Node. Предположение о touch-target replacement после pointerup не подтверждено: исходный regression unmounts при активном touch; эта ветка защищена и проверяется естественным release. Static pending-runtime verdict не заявлялся как production-ready; итоговые runtime evidence проверены lead отдельно.

Lead просмотрел Family screenshots шести themes (`lead/family-contrast-{mint,rose,sky,lavender,apricot,sand}.png`), canonical photo-empty320px и representative Linux images. Все 18 изменённых Win32 poster PNG просмотрены по expected/actual парам; изменения — одна raster row и native-controls edge/glyph rendering при той же композиции. Общие tolerances не менялись. 18 Linux baselines сняты настоящими Chromium/WebKit и проверены повторным no-update run. Diagnostic candidate run не считается acceptance. Frozen canonical HTML/hash не менялся.

Linux final R3: Debian13.6 trixie amd64, PW1.62.1, Chromium151.0.7922.34, WebKit26.5, Node20.19.2, Bun1.4.0, FFmpeg7.1.5. Image `ourmemories-playwright-runner:20261008`, imageID `sha256:665aa72749db62a44672543c84d15b1115c2d1138c00f50f789d910d28274e95`. Lead сверил stdout/exit marker/passed `.last-run.json` и шесть traces. Current-source manifest589:588 SHA совпадают с host, дополнительный служебный placeholder отсутствует; stale inputs не осталось. Fingerprint `deefd610dcbb66e72dccb4d54f6d421e5a720d8f6225bdb99337899b4fd2617d`; all18Linux PNG unchanged (`lead/linux-source-fingerprint-comparison-final-r2.json`). Runtime metadata `../linux-poster-repeat-20261008/artifacts/runtime-r3-final.stdout.log`. Official OS deps installed только в owned ephemeral container; libraries missing0. Root подтвердил удаление exact R3 container, cache/evidence сохранены. Debian run не сертифицирует unpublished Ubuntu CI.

Свежий Docker image `memoly-backend:preprod-owned-smoke-20261008`, imageID/manifest-list digest `sha256:659953be26e2f7fb2683a4e249d68449ae95d627c064fd5c386e21fa4dfcf20b`: linux/amd64, USER bun, Sharp0.35.5 реально декодировал synthetic2×2PNG95B. Foreign sentinels preserved=true; own UUID service/volume/network отсутствуют после cleanup. Это локальный verification artifact, без staging promotion или опубликованного release digest. При финальном read-only cleanup recheck Docker Desktop API был недоступен (daemon не запущен); исторический exit0 smoke и stop/remove evidence сохранены, Docker заново не запускался.

## Остаточные ограничения и rollback

Для production остаются новый GitHub Verify на опубликованном SHA, staging promotion того же digest, real-device Telegram/MAX/PWA smoke, restore drill и нагрузочная приёмка. В предыдущем Windows default-r3 один worker аварийно завершился с code3221226505 (125/1, exit1). Соседние cases98/99 затем прошли каждый по3 (6/0, exit0); причина native crash не установлена. Исходники и runner config ради этого не менялись, неуспешный run сохранён в evidence history. Poster-r6 также остался без финального summary/exit marker после WebKit failures (expected0/receivedundefined); причина не установлена, trace сохранён. Повтор poster-r7 выполнен на неизменных исходниках. Known-advisory audit не исключает неизвестные уязвимости. Cold font cache не pin неизменяемой upstream revision; production remote fonts/performance требуют внешней проверки. Fixture credential/error semantics не полностью повторяют production HttpClient.

Schema/contracts/migrations не менялись. Rollback кода — обычный обратный commit; database restore не выполнялся. Новая задача и production deploy не запускались.

Автоматическая проверка разрешений отклонила recursive delete exact synthetic context `C:/Users/Alexandr/AppData/Local/Temp/OurMemoriesDockerCacheProbe-20261008` с причиной `blocked by policy`. Каталог оставлен, запрет не обходился. Удалены только собственные разрешённые Docker resources; unrelated Bun PID48320 не трогался.

Allowed paths: backend jobs/caption/avatar/race tests/Docker; dependency manifests/lock/vendor CSS; verify/release planner/gate/tests/docs; FeedPage/touch guard/scoped Family CSS; E2E specs/helpers/fixtures/configs/platform references; website dependency/CSS import. Точный список активного diff следует ниже; `webapp/src/main.tsx` имеет пустой actual diff и в список реализации не входит.


## Активные changed paths (102)

```text
.github/workflows/selectel-release.yml
.github/workflows/verify.yml
backend/Dockerfile
backend/package.json
backend/scripts/docker-smoke.mjs
backend/scripts/docker-smoke.test.mjs
backend/src/jobs.ts
backend/src/modules/media/infrastructure/reservation-race.integration.test.ts
backend/src/modules/telegram/infrastructure/caption-race.integration.test.ts
backend/src/modules/telegram/infrastructure/prisma-caption-repository.ts
backend/src/race-regression-fixtures.ts
backend/src/storage/normalize-avatar-image.test.ts
backend/src/storage/normalize-avatar-image.ts
bun.lock
deploy/selectel/README.md
docs/DEPLOYMENT.md
docs/mvp/review/AGENT_K_ACCESSIBILITY_DECISION.md
docs/reports/preprod-audit-20261007-plan.md
docs/reports/preprod-audit-20261007.md
docs/reports/preprod-fix-20261008-evidence-history.md
docs/reports/preprod-fix-20261008-plan.md
docs/reports/preprod-fix-20261008.md
package.json
scripts/require-release-verification.mjs
scripts/verify-plan.mjs
tests/require-release-verification.test.ts
tests/verify-plan.test.ts
vendor/shadcn/LICENSE
vendor/shadcn/README.md
vendor/shadcn/tailwind.css
verification-map.json
webapp/e2e/adult-avatar-harness.tsx
webapp/e2e/adult-avatar.spec.ts
webapp/e2e/agent-k-accessibility.spec.ts
webapp/e2e/child-avatar.spec.ts
webapp/e2e/carousel-native-scroll.spec.ts
webapp/e2e/feed.spec.ts
webapp/e2e/global-setup.ts
webapp/e2e/helpers/inter-font-cache.ts
webapp/e2e/helpers/test.ts
webapp/e2e/private-video-poster.fixture.tsx
webapp/e2e/private-video-poster.playwright.config.ts
webapp/e2e/private-video-poster.spec.ts
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-carousel-preview-chromium-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-carousel-preview-chromium-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-carousel-preview-webkit-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-carousel-preview-webkit-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-four-portrait-preview-chromium-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-four-portrait-preview-chromium-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-four-portrait-preview-webkit-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-four-portrait-preview-webkit-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-paused-chromium-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-paused-chromium-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-paused-webkit-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-paused-webkit-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-playing-chromium-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-playing-chromium-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-playing-webkit-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-playing-webkit-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-preview-chromium-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-preview-chromium-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-preview-webkit-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-preview-webkit-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-playing-chromium-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-playing-chromium-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-playing-webkit-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-playing-webkit-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-preview-chromium-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-preview-chromium-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-preview-webkit-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-preview-webkit-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-playing-chromium-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-playing-chromium-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-playing-webkit-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-playing-webkit-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-preview-chromium-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-preview-chromium-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-preview-webkit-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-preview-webkit-win32.png
webapp/e2e/private-video-poster.vite.config.ts
webapp/e2e/specs/family.spec.ts
webapp/e2e/specs/missing-visual-matrix.spec.ts
webapp/e2e/specs/mm1-mixed-composer.spec.ts
webapp/e2e/specs/welcome.spec.ts
webapp/e2e/warm-navigation-cache-regression.spec.ts
webapp/e2e/warm-navigation-cache.fixture.tsx
webapp/e2e/warm-navigation-cache.playwright.config.ts
webapp/package.json
webapp/playwright.config.ts
webapp/README.md
webapp/src/features/feed/audio-playback.ts
webapp/src/features/feed/FeedPage.tsx
webapp/src/features/feed/presentation/memoly-feed.css
webapp/src/features/feed/presentation/MemoryCardPresentation.tsx
webapp/src/features/feed/presentation/retargeted-touch-click-guard.ts
webapp/src/features/memoly-ui/family-management.css
webapp/src/features/memoly-ui/memoly-ui.css
webapp/src/index.css
webapp/tests/playback.test.tsx
webapp/tests/retargeted-touch-click-guard.test.ts
webapp/tsconfig.e2e.json
webapp/vite.config.ts
website/package.json
website/src/styles/global.css
```
